import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractExchange, ExchangeMap} from "./Exchanges/AbstractExchange";
import {AbstractStrategy, TradeAction} from "./Strategies/AbstractStrategy";
import {TradeConfig, ConfigCurrencyPair} from "./Trade/TradeConfig";
import Backtester from "./Trade/Backtester";
import {OrderModification} from "./structs/OrderResult";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as db from "./database";
import * as Heap from "qheap";
import {AbstractTrader, TradeInfo} from "./Trade/AbstractTrader";
import {CandleMarketStream} from "./Trade/CandleMarketStream";
import {CandleMaker} from "./Trade/Candles/CandleMaker";
import {CandleBatcher} from "./Trade/Candles/CandleBatcher";
import {StrategyGroup} from "./Trade/StrategyGroup";
import {MarginPosition} from "./structs/MarginPosition";
import {AbstractGenericTrader} from "./Trade/AbstractGenericTrader";
import {AbstractGenericStrategy} from "./Strategies/AbstractGenericStrategy";
import {AbstractAdvisor} from "./AbstractAdvisor";
import {ArbitrageConfig} from "./Arbitrage/ArbitrageConfig";
import {AbstractArbitrageStrategy} from "./Arbitrage/Strategies/AbstractArbitrageStrategy";
import {TradeBook} from "./Trade/TradeBook";
import ExchangeController from "./ExchangeController";


export class GenericStrategyMap<T extends AbstractGenericStrategy> extends Map<ConfigCurrencyPair, T[]> {
    constructor() {
        super()
    }

    public static getSameCandleSizeCount(strategies: AbstractStrategy[], candeSize: number) {
        let count = 0;
        for (let i = 0; i < strategies.length; i++)
        {
            if (strategies[i].getAction().candleSize === candeSize)
                count++;
        }
        return count;
    }

    public getStrategyCount() {
        let count = 0;
        for (let strat of this)
            count += strat[1].length
        return count;
    }
}
export class StrategyMap extends GenericStrategyMap<AbstractStrategy> {
    constructor() {
        super()
    }
}
export class GenericTraderMap<T extends AbstractGenericTrader> extends Map<number, T> { // (configNr, instance)
    constructor() {
        super()
    }

    public getUniqueInstances(): T[] {
        // we have a trader map per configNr
        // instances across configs are shared. this function returns every instance once
        let map = new Map<string, T>(); // (instance name, instance)
        for (let trader of this)
        {
            if (!map.has(trader[1].getClassName()))
                map.set(trader[1].getClassName(), trader[1])
        }
        let instances = []
        for (let int of map)
            instances.push(int[1])
        return instances;
    }

    public getAll() {
        let instances: T[] = []
        for (let int of this)
            instances.push(int[1])
        return instances;
    }
}
export class TraderMap extends GenericTraderMap<AbstractTrader> {
    constructor() {
        super()
    }
}
export class WaitingStrategyResultMap extends Map<string, number> { // (currency pair, waiting events)
    constructor() {
        super()
    }
}
export class WaitingCandleSizeMap extends Map<number, number> { // (candle size, waiting events)
    constructor() {
        super()
    }
}
export class WaitingCandleStrategyResultMap extends Map<string, WaitingCandleSizeMap> { // (currency pair, candle size map)
    constructor() {
        super()
    }
}
export class StrategyActionMap extends Map<string, Heap> { // (currency pair, action Heap)
    constructor() {
        super()
    }
}

export class GenericCandleMakerMap<T extends Trade.SimpleTrade> extends Map<string, CandleMaker<T>> { // 1 candle maker per currency pair
    constructor() {
        super()
    }
}
export class CandleMakerMap extends GenericCandleMakerMap<Trade.Trade> {
    constructor() {
        super()
    }
}
export class GenericCurrencyCandleBatcherMap<T extends Trade.SimpleTrade> extends Map<number, CandleBatcher<T>> {
    constructor() {
        super()
    }
}
export class CurrencyCandleBatcherMap<T extends Trade.SimpleTrade> extends GenericCurrencyCandleBatcherMap<T> {
    constructor() {
        super()
    }
}
export class CandleBatcherMap extends Map<string, CurrencyCandleBatcherMap<Trade.Trade>> { // 1 candle batcher per currency pair per interval
    constructor() {
        super()
    }
}
export class MaxCandleBatcherMap extends Map<string, CandleBatcher<Trade.Trade>> { // 1 candle batcher per currency pair (the one with the biggest interval)
    constructor() {
        super()
    }
}

export interface LastSentTradesGeneric<T> {
    pendingTrades: T[];
    last: Date;
}
export class LastSentTradesMap extends Map<string, LastSentTradesGeneric<Trade.Trade>> { // (currency str, trades)
    constructor() {
        super()
    }
}

export class ExchangeCurrencyPairMap extends Map<string, Currency.CurrencyPair[]> { // (exchange name, currency pair)
    constructor() {
        super()
    }
}

export type StrategyActionName = "buy" | "sell" | "close" | "hold";
export interface StrategyAction {
    action: StrategyActionName;
    weight: number;
}

/**
 * Core controller class that:
 * 1. listens to MarketStream data
 * 2. relays it to our Strategies
 * 3. accumulates strategy results
 * 4. calls buy/sell methods in AbstractTrader based on signals from those strategies
 * 5. connects trade events from AbstractTrader back to strategies
 *
 * It also forwards trades to CandleMaker (strategies can rely on candles too).
 */
export default class TradeAdvisor extends AbstractAdvisor {
    protected strategyFile: string;
    protected exchangeController: ExchangeController;
    protected exchanges: ExchangeMap; // (exchange name, instance)
    protected strategies: StrategyMap = new StrategyMap();
    protected configs: TradeConfig[] = [];
    protected trader: TraderMap = new TraderMap(); // 1 trader per config
    protected readonly start = Date.now(); // TODO use market time for backtesting. warmup per strategy? or allow this only for RealTimeTrader
    protected waitingStrategyResultCount = new WaitingStrategyResultMap();
    protected waitingStrategyCandleResultCount = new WaitingCandleStrategyResultMap();
    protected candleMakers = new CandleMakerMap();
    protected candleBatchers = new CandleBatcherMap();
    // use the same map for arbitrage mode (with different keys)
    //protected exchangeCandleBatchers = new CandleBatcherMap(); // same as candleBatchers, but with key "exchange-currencyPair" to allow multiple entries for arbitrage
    protected maxCandleBatchers = new MaxCandleBatcherMap(); // to traders we only forward the biggest candles (for statistics)
    protected lastSentTrades = new LastSentTradesMap();

    protected actionHeap: StrategyActionMap = new StrategyActionMap();

    constructor(strategyFile: string, /*exchanges: ExchangeMap*/exchangeController: ExchangeController) {
        super()
        this.strategyFile = strategyFile;
        //this.exchanges = exchanges;
        this.exchangeController = exchangeController;
        this.exchanges = this.exchangeController.getExchanges();
        if (nconf.get("ai"))
            return; // BudFox manages the markets for AI. we just need few variables from here for status & logging
        else if (nconf.get("lending") || nconf.get("social"))
            return; // we have our own lending/social controller

        if (!this.strategyFile) {
            logger.error("Please specify a config/strategy file with the command line option --config=")
            logger.error("example: --config=StopLossTime")
            this.waitForRestart();
            return
        }
        if (this.strategyFile.substr(-5) !== ".json")
            this.strategyFile += ".json";

        this.tradeBook = new TradeBook(this, null);
        this.loadConfig();
        if (this.errorState)
            return;
        this.loadTrader();
        this.connectTrader();
        this.connectCandles();

        if (nconf.get('trader') === "Backtester") {
            if (this.configs.length > 1)
                logger.warn("More than 1 config entry is not supported when backtesting")
            for (let trader of this.trader)
            {
                if (trader[1] instanceof Backtester)
                //(<Backtester>trader[1]).backtest() // deprecated because of .jsx conflict
                    (trader[1] as Backtester).backtest(this.exchangeController)
            }
        }
        else
            this.restoreState();
    }

    public process() {
        return new Promise<void>((resolve, reject) => {
            // TODO is there anything to do on this "heartbeet" tick?
            // our trades come from MarketStreams: no stream data -> no price changes
            if (!this.errorState)
                resolve()
        })
    }

    public getExchanges() {
        return this.exchanges;
    }

    public getStrategies() {
        return this.strategies;
    }

    public getCandleMaker(currencyPair: string, exchangeLabel?: Currency.Exchange): CandleMaker<Trade.Trade> {
        return super.getCandleMaker(currencyPair, exchangeLabel) as CandleMaker<Trade.Trade>;
    }

    public getCandleBatchers(currencyPair: string, exchangeLabel?: Currency.Exchange): CurrencyCandleBatcherMap<Trade.Trade> {
        return super.getCandleBatchers(currencyPair, exchangeLabel);
    }

    public getStrategyInfos() {
        let infos = {}
        for (let strat of this.strategies)
        {
            let configCurrencyPair = strat[0];
            let strategies = strat[1];
            let strategyInfos = strategies.map(s => s.getInfo()) // TODO remove spaces from keys for nicer JSON?
            infos[configCurrencyPair] = strategyInfos;
        }
        return infos;
    }

    public getMainStrategy(pair: ConfigCurrencyPair) {
        let strategies = this.strategies.get(pair);
        for (let i = 0; i < strategies.length; i++)
        {
            if (strategies[i].isMainStrategy())
                return strategies[i];
        }
        logger.error("No main strategy found for config currency pair %s", pair)
        return null;
    }

    public serializeStrategyData(pair: ConfigCurrencyPair) {
        let strategies = this.strategies.get(pair);
        let data = {}
        for (let i = 0; i < strategies.length; i++)
        {
            if (strategies[i].getSaveState())
                data[strategies[i].getClassName()] = strategies[i].serialize();
        }
        return data;
    }

    public unserializeStrategyData(json: any, filePath: string) {
        let strategies = this.getStrategies();
        let configs = this.getConfigs();
        let restored = false; // check if we restored at least 1 state
        configs.forEach((config) => {
            let pairs = config.listConfigCurrencyPairs();
            pairs.forEach((pair) => {
                if (!json[pair]) {
                    let found = false;
                    if (nconf.get("serverConfig:searchAllPairsForState")) {
                        // it's in the other config. just check if it matches
                        const maxLen = Math.max(pairs.length, configs.length, Object.keys(json).length);
                        for (let i = 1; i <= maxLen; i++)
                        {
                            pair = pair.replace(/^[0-9]+/, i.toString())
                            if (json[pair]) {
                                found = true;
                                break;
                            }
                        }
                    }
                    if (!found)
                        return logger.warn("Skipped restoring state for config currency pair %s because no data was provided", pair);
                }
                let restoreData = json[pair];
                pair = pair.replace(/^[0-9]+/, config.configNr.toString()) // restore the real config number in case we changed it
                let confStrategies = strategies.get(pair);
                confStrategies.forEach((strategy) => {
                    let strategyName = strategy.getClassName();
                    if (!restoreData[strategyName]) {
                        strategyName = strategy.getBacktestClassName();
                        if (!restoreData[strategyName])
                            return; // no data for this strategy
                    }
                    if (!strategy.getSaveState())
                        return;
                    if (!strategy.canUnserialize(restoreData[strategyName]))
                        return;
                    strategy.unserialize(restoreData[strategyName])
                    logger.info("Restored strategy state of %s %s from %s", pair, strategyName, path.basename(filePath))
                    restored = true;
                })
            })
        })
        return restored;
    }

    public getConfigName() {
        return this.strategyFile.replace(/\.json$/, "");
    }

    public getConfigs() {
        return this.configs;
    }

    public getTraders() {
        return this.trader.getAll();
    }

    public backtestDone() {
        return new Promise<void>((resolve, reject) => {
            let storeOps = []
            for (let maker of this.candleMakers)
            {
                storeOps.push(maker[1].store());
            }
            Promise.all((storeOps)).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected loadConfig() {
        //const filePath = path.join(utils.appDir, "config", this.strategyFile)

        const filePath = path.join(TradeConfig.getConfigDir(), this.strategyFile)
        let data = fs.readFileSync(filePath, {encoding: "utf8"});
        if (!data) {
            logger.error("Can not load config file under: %s", filePath)
            return this.waitForRestart()
        }
        let json = utils.parseJson(data);
        if (!json || !json.data) {
            logger.error("Invalid JSON in config file: %s", filePath)
            return this.waitForRestart()
        }
        if (json.data.length > 10)
            logger.error("WARNING: Using %s markets. High CPU load, possibly hanging and Poloniex (and others?) will not send market updates for more than 10 markets", json.data.length)

        //let currencyPairs = new Set<Currency.CurrencyPair>();
        let currencyPairs = new ExchangeCurrencyPairMap();
        let connectedExchanges = []
        json.data.forEach((conf) => {
            let config;
            try {
                if (nconf.get("arbitrage")) {
                    config = new ArbitrageConfig(conf, this.strategyFile);
                    if (!Array.isArray(config.exchanges) || config.exchanges.length !== 2)
                        throw "You must configure exactly 2 exchanges per currency pair to do arbitrage." // TODO allow multiple exchanges?
                }
                else {
                    config = new TradeConfig(conf, this.strategyFile);
                    if (!Array.isArray(config.exchanges) || config.exchanges.length > 1)
                        throw "You must configure exactly 1 exchange per currency pair for trading."
                }
            }
            catch (e) {
                logger.error("Error loading config. Please fix your config and restart the app", e);
                this.waitForRestart()
                return;
            }
            this.configs.push(config)

            // connect exchanges -> strategies
            const configExchanges = this.pipeMarketStreams(config);
            connectedExchanges = connectedExchanges.concat(configExchanges);
            let currentExchangeLabel = configExchanges.length > 1 ? Currency.Exchange.ALL : this.exchanges.get(configExchanges[0]).getExchangeLabel();
            config.markets.forEach((pair) => {
                config.exchanges.forEach((exchangeName) => {
                    let pairs = currencyPairs.get(exchangeName)
                    if (!pairs)
                        pairs = []
                    pairs.push(pair)
                    currencyPairs.set(exchangeName, pairs)
                })

                // load strategies (new strategy instance per exchange + pair)
                let isMainStrategy = true;

                const configCurrencyPair = config.getConfigCurrencyPair(pair);
                for (let className in conf.strategies)
                {
                    const modulePath = path.join(this.getStrategyDir(), className)
                    let strategyInstance: AbstractStrategy = this.loadModule(modulePath, conf.strategies[className])
                    if (!strategyInstance)
                        continue;
                    if (!strategyInstance.getAction().pair.equals(pair))
                        continue; // this strategy is not set for this currency pair
                    //strategyInstance.setMainStrategy(isMainStrategy); // we can have multiple main strategies based on internal config
                    if (isMainStrategy)
                        strategyInstance.setMainStrategy(true)
                    let strategies = this.strategies.get(configCurrencyPair)
                    if (!strategies)
                        strategies = []
                    strategies.push(strategyInstance)
                    this.strategies.set(configCurrencyPair, strategies)
                    this.connectStrategyEvents(config, strategyInstance, pair);

                    // candle config
                    const pairStr = pair.toString();

                    // always add 1min candles (so strategies can create candles of arbitrary size). don't set it as max batcher
                    if (nconf.get("arbitrage")) {
                        config.exchanges.forEach((exchangeName) => {
                            currentExchangeLabel = this.exchanges.get(exchangeName).getExchangeLabel();
                            const batcherKey = Currency.Exchange[currentExchangeLabel] + "-" + pairStr;
                            if (!this.candleMakers.get(batcherKey)) // separate makers per exchange for arbitrage
                                this.candleMakers.set(batcherKey, new CandleMaker<Trade.Trade>(pair, currentExchangeLabel));

                            if (!this.candleBatchers.get(batcherKey))
                                this.candleBatchers.set(batcherKey, new CurrencyCandleBatcherMap());
                            // overwrites existing instances before they are connected
                            let smallBatcher = new CandleBatcher<Trade.Trade>(1, pair, currentExchangeLabel);
                            this.candleBatchers.get(batcherKey).set(1, smallBatcher);

                            let candleSize = strategyInstance.getAction().candleSize
                            if (candleSize) { // is this strategy interested in candles?
                                if (typeof candleSize === "string" && candleSize === "default")
                                    candleSize = nconf.get('serverConfig:defaultCandleSize')
                                let batcher = new CandleBatcher<Trade.Trade>(candleSize, pair, currentExchangeLabel);
                                this.candleBatchers.get(batcherKey).set(candleSize, batcher);
                                let maxBatcher = this.maxCandleBatchers.get(batcherKey)
                                if (!maxBatcher || maxBatcher.getInterval() <= candleSize)
                                    this.maxCandleBatchers.set(batcherKey, batcher)
                            }
                        });
                    }
                    else {
                        // TODO add an option for strtegies to receive all currencies. needed for portfolio balancing. maybe only possible as global setting?
                        if (!this.candleMakers.get(pairStr)) // TODO this map means we can only trade a currency pair on 1 exchange (in non-arbitrage mode). add configNr to key?
                            this.candleMakers.set(pairStr, new CandleMaker<Trade.Trade>(pair, currentExchangeLabel));

                        if (!this.candleBatchers.get(pairStr))
                            this.candleBatchers.set(pairStr, new CurrencyCandleBatcherMap());
                        // overwrites existing instances before they are connected
                        let smallBatcher = new CandleBatcher<Trade.Trade>(1, pair, currentExchangeLabel);
                        this.candleBatchers.get(pairStr).set(1, smallBatcher);

                        let candleSize = strategyInstance.getAction().candleSize
                        if (candleSize) { // is this strategy interested in candles?
                            if (typeof candleSize === "string" && candleSize === "default")
                                candleSize = nconf.get('serverConfig:defaultCandleSize')
                            let batcher = new CandleBatcher<Trade.Trade>(candleSize, pair, currentExchangeLabel);
                            this.candleBatchers.get(pairStr).set(candleSize, batcher);
                            let maxBatcher = this.maxCandleBatchers.get(pairStr)
                            if (!maxBatcher || maxBatcher.getInterval() <= candleSize)
                                this.maxCandleBatchers.set(pairStr, batcher)
                        }
                    }

                    isMainStrategy = false;

                    // forward the orderbook to strategy
                    if (nconf.get('trader') !== "Backtester") {
                        // order books are only available via APIs of exchanges for real time trading (no history data)
                        // and we have to wait with connecting it until it is loaded
                        let timer = setInterval(() => {
                            let allReady = true;
                            configExchanges.forEach((exchange) => {
                                const exchangeInstance = this.exchanges.get(exchange);
                                const pairStr = strategyInstance.getAction().pair.toString();
                                const orderBook = exchangeInstance.getOrderBook().get(pairStr);
                                if (!strategyInstance.isOrderBookReady()) {
                                    if (orderBook)
                                        strategyInstance.setOrderBook(orderBook);
                                    else
                                        logger.warn("%s Order book of %s not ready", pairStr, exchange)
                                }

                                const ticker = exchangeInstance.getTickerMap();
                                if (!strategyInstance.isTickerReady()) {
                                    if (ticker && ticker.has(pairStr))
                                        strategyInstance.setTicker(ticker.get(pairStr))
                                    else
                                        logger.warn("%s Ticker of %s not ready", pairStr, exchange)
                                }

                                if (!orderBook || !ticker || !ticker.has(pairStr))
                                    allReady = false;
                            })
                            if (allReady) {
                                //logger.info("All tickers and orderbooks are ready"); // logged once per strategy
                                clearInterval(timer);
                            }
                        }, 8000)
                    }
                }

                let strategies = this.strategies.get(configCurrencyPair)
                StrategyGroup.createGroup(strategies)
            })
        })

        for (let batcher of this.maxCandleBatchers)
            batcher[1].setMax(true);

        this.logCandleSubscriptions(); // log candle subscriptions

        connectedExchanges = utils.uniqueArrayValues(connectedExchanges); // shouldn't change anything
        if (connectedExchanges.length === 1) {
            for (let maker of this.candleMakers)
                maker[1].setExchange(this.exchanges.get(connectedExchanges[0]).getExchangeLabel())
        }
        this.pipeGlobalMarketStreams();
        connectedExchanges.forEach((exchangeName) => {
            let ex = this.exchanges.get(exchangeName)
            let supportedPairs = currencyPairs.get(exchangeName);
            //ex.subscribeToMarkets(Array.from(supportedPairs))
            ex.subscribeToMarkets(supportedPairs)
        })
        for (let ex of this.exchanges)
        {
            if (connectedExchanges.indexOf(ex[0]) === -1) {
                logger.verbose("Removing not used exchange %s", ex[0])
                this.exchanges.delete(ex[0])
            }
        }
    }

    protected pipeMarketStreams(config: TradeConfig) {
        let connectedExchanges: string[] = []
        const exchangeNames = config.exchanges;
        for (let ex of this.exchanges)
        {
            if (exchangeNames.indexOf(ex[0]) === -1)
                continue; // this exchange is not part of our config

            connectedExchanges.push(ex[0])
            ex[1].getMarketStream().on("trades", (currencyPair: Currency.CurrencyPair, trades: Trade.Trade[]) => {
                if (!config.hasCurrency(currencyPair))
                    return; // another config is interested in this
                //console.log("%s %s TRADES", ex[0], currencyPair, trades)
                //if (!this.warmUpDone(config)) // moved to Trader because technical strategies need to collect data
                //return;

                // batch trades and send them at most every x sec to save CPU
                let tradesToSend = [];
                if (nconf.get('trader') === "Backtester")
                    tradesToSend = trades;
                else {
                    const currencyStr = currencyPair.toString();
                    let lastSent = this.lastSentTrades.get(currencyStr)
                    const forwardTradesMs = (nconf.get("serverConfig:forwardTradesSec") + nconf.get("serverConfig:forwardTradesAddPerMarketSec")*this.candleCurrencies.length)*1000;
                    if (!lastSent || lastSent.last.getTime() + forwardTradesMs < Date.now()) {
                        if (lastSent)
                            tradesToSend = lastSent.pendingTrades;
                        tradesToSend = tradesToSend.concat(trades);
                        this.lastSentTrades.set(currencyStr, {pendingTrades: [], last: new Date()})
                    }
                    else {
                        lastSent.pendingTrades = lastSent.pendingTrades.concat(trades);
                        return;
                    }
                }
                if (tradesToSend.length !== 0) {
                    const configCurrencyPair = config.getConfigCurrencyPair(currencyPair);
                    let strategies = this.strategies.get(configCurrencyPair)
                    strategies.forEach((strategy) => {
                        strategy.sendTick(tradesToSend)
                    })
                }
            })
            ex[1].getMarketStream().on("orders", (currencyPair: Currency.CurrencyPair, orders: OrderModification[]) => {
                if (!config.hasCurrency(currencyPair))
                    return; // another config is interested in this
                //console.log("%s %s ORDERS", ex[0], currencyPair, orders)
                // TODO send orders to strategies
            })
        }
        return connectedExchanges
    }

    protected pipeGlobalMarketStreams() {
        for (let ex of this.exchanges)
        {
            // has to be checked after the stream starts
            //const isCandleStream = ex[1].getMarketStream() instanceof CandleMarketStream && (ex[1].getMarketStream() as CandleMarketStream).isStreamingCandles();
            const isCandleStream = () => {
                return ex[1].getMarketStream() instanceof CandleMarketStream && (ex[1].getMarketStream() as CandleMarketStream).isStreamingCandles();
            }
            const getCandleMaker = (currencyPair: Currency.CurrencyPair) => {
                if (nconf.get("arbitrage")) {
                    const exchangeLabel = ex[1].getExchangeLabel();
                    const batcherKey = Currency.Exchange[exchangeLabel] + "-" + currencyPair.toString();
                    return this.candleMakers.get(batcherKey);
                }
                else
                    return this.candleMakers.get(currencyPair.toString());
            }
            ex[1].getMarketStream().on("trades", (currencyPair: Currency.CurrencyPair, trades: Trade.Trade[]) => {
                if (nconf.get("serverConfig:storeTrades") && nconf.get('trader') !== "Backtester") { // speeds up backtesting a lot
                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                    })
                }
                if (!isCandleStream()) {
                    getCandleMaker(currencyPair).addTrades(trades);
                }
                this.trader.getAll().forEach((trader) => {
                    trader.sendTick(trades);
                })
            })
            ex[1].getMarketStream().on("orders", (currencyPair: Currency.CurrencyPair, orders: OrderModification[]) => {
            })
            ex[1].getMarketStream().on("candles", (currencyPair: Currency.CurrencyPair, candles: Candle.Candle[]) => {
                if (isCandleStream())
                    getCandleMaker(currencyPair).addCandles(candles);
            })
        }
    }

    protected connectStrategyEvents(config: TradeConfig, strategy: AbstractStrategy, currencyPair: Currency.CurrencyPair) {
        // strategy A can send "buy" and B "sell" at the same time.
        // collect results here and perform the action with the highest weight
        if (nconf.get("arbitrage") && strategy instanceof AbstractArbitrageStrategy) {
            //strategy.setExchanges(config.exchanges);
            let exchangeLabels = [], exchangeNames = [];
            config.exchanges.forEach((exchangeName) => {
                let exchangeInstance = this.exchanges.get(exchangeName)
                if (exchangeInstance) {
                    exchangeLabels.push(exchangeInstance.getExchangeLabel())
                    exchangeNames.push(exchangeName)
                }
                else
                    logger.error("Error getting exchange instance with name %s", exchangeName)
            });
            strategy.setExchanges(exchangeLabels, exchangeNames);
        }
        const pairStr = currencyPair.toString();
        const actions: StrategyActionName[] = ["buy", "sell", "hold", "close"];
        actions.forEach((actionName) => {
            strategy.on(actionName, (weight: number, reason: string, exchange: Currency.Exchange) => {
                // we can use the same heap for trade + candle ticks because strategies never execute both ticks together (see tickQueue)
                this.ensureCurrencyPair(pairStr);
                if (weight === Number.MAX_VALUE || (nconf.get("serverConfig:mainStrategyAlwaysTrade") && strategy.isMainStrategy())) {
                    // execute MAX VAL events immediately (no other strategy can get higher)
                    // this also ensures that events emitted outside of candle ticks can get executed
                    // TODO exchange/currencyPair have their own trader instances. still according to logs we might emit close for others? how?
                    this.trader.get(config.configNr).callAction(actionName, strategy, reason, exchange);
                    // dirty way to ensure no action is stuck in the heap
                    this.actionHeap.set(pairStr, this.getNewHeap());
                    let waiting = this.waitingStrategyResultCount.get(pairStr);
                    if (waiting)
                        this.waitingStrategyResultCount.set(pairStr, --waiting);
                    //let waitingCandle = this.waitingStrategyCandleResultCount.get(pairStr).get(candleSize);
                    this.waitingStrategyCandleResultCount.set(pairStr, new WaitingCandleSizeMap());
                }
                else {
                    this.actionHeap.get(pairStr).insert({action: actionName, weight: weight, reason: reason, exchange: exchange, strategy: strategy})
                }
            })
        })

        // we count waiting results per currency pair
        // if we are connected to multiple exchanges our strategy will trigger once it reaches it's trigger on 1 exchange
        // currently also trade streams are merged in strategies (good idea because higher volumes, bad idea because local spikes get lost)
        // TODO select specific exchanges in strategy? or require > x exchanges to trigger? and allow strategy instance per exchange
        const configCurrencyPair = config.getConfigCurrencyPair(currencyPair);
        strategy.on("startTick", (curStrategy: AbstractStrategy) => {
            //this.waitingStrategyResultCount = this.strategies.getStrategyCount();
            // TODO this is called multiple times at the beginning (and set to the same value). really safe? issue warnings?
            this.ensureCurrencyPair(pairStr);
            let waiting = this.waitingStrategyResultCount.get(pairStr);
            /*
            if (waiting > 0) { // not undefined
                logger.error("%s %s sent tick before old events have finished", configCurrencyPair, curStrategy.getClassName())
                this.executeHeapAction(config, pairStr, this.actionHeap);
            }
            */
            // safer to just increment/decrement
            //this.waitingStrategyResultCount.set(pairStr, this.strategies.get(configCurrencyPair).length);
            this.waitingStrategyResultCount.set(pairStr, waiting ? ++waiting : 1);
        })
        strategy.on("doneTick", (curStrategy: AbstractStrategy) => {
            let waiting = this.waitingStrategyResultCount.get(pairStr);
            if (waiting > 0) {
                this.waitingStrategyResultCount.set(pairStr, --waiting);
                if (waiting === 0)
                    this.executeHeapAction(config, pairStr, this.actionHeap);
            }
            else if (this.actionHeap.get(pairStr).length !== 0) { // only show error if there are actions left
                logger.warn("Strategies emitted multiple done events. Last: %s", curStrategy.getClassName());
                // now more common after we execute MAX VAL trades immediately
                //let err = new Error("Multiple done events")
                //utils.test.dumpError(err, logger);
            }
        })

        // for candle ticks we have to wait for all strategies with the same candle size only
        strategy.on("startCandleTick", (curStrategy: AbstractStrategy) => {
            const candleSize = curStrategy.getAction().candleSize;
            if (!candleSize)
                return;
            if (!this.waitingStrategyCandleResultCount.has(pairStr))
                this.waitingStrategyCandleResultCount.set(pairStr, new WaitingCandleSizeMap());
            let strategies = this.strategies.get(configCurrencyPair);
            // wait for number of strategies with this currency pair + candleSize
            this.ensureCurrencyPair(pairStr);
            let waiting = this.waitingStrategyCandleResultCount.get(pairStr).get(candleSize);
            /*
            if (waiting > 0) { // not undefined
                logger.error("%s %s sent candle tick before old events have finished", configCurrencyPair, curStrategy.getClassName())
                this.executeHeapAction(config, pairStr, this.actionHeap);
            }
            */
            if (!waiting)
                waiting = 0;
            this.waitingStrategyCandleResultCount.get(pairStr).set(candleSize, waiting + StrategyMap.getSameCandleSizeCount(strategies, candleSize));
        })
        strategy.on("doneCandleTick", (curStrategy: AbstractStrategy) => {
            const candleSize = curStrategy.getAction().candleSize;
            let waiting = this.waitingStrategyCandleResultCount.get(pairStr).get(candleSize);
            if (waiting > 0) {
                this.waitingStrategyCandleResultCount.get(pairStr).set(candleSize, --waiting);
                if (waiting === 0)
                    this.executeHeapAction(config, pairStr, this.actionHeap);
            }
            else if (this.actionHeap.get(pairStr).length !== 0) { // only show error if there are actions left
                // TODO happens in the main strategy after StopLossTurn/TakeProfit fires with timeout (if same candle size is used)
                logger.error("Strategies emitted multiple candle done events. Last: %s", curStrategy.getClassName());
                let err = new Error("Multiple candle done events")
                utils.test.dumpError(err, logger);
            }
        })
    }

    protected executeHeapAction(config: TradeConfig, currencyPair: string, heap: Heap) {
        let action = heap.get(currencyPair).remove();
        if (action) {
            this.trader.get(config.configNr).callAction(action.action, action.strategy, action.reason, action.exchange);
            heap.set(currencyPair, this.getNewHeap());
        }
    }

    protected loadTrader() {
        let traderMap = new Map<string, AbstractTrader>(); // (trader path, instance) map to deduplicate trader instances
        // currently we only allow 1 global trader in config

        const modulePath = path.join(__dirname, "..", "src", "Trade", nconf.get("trader"));
        this.configs.forEach((config) => {
            const key = modulePath + config.exchanges.toString();
            let cachedInstance = traderMap.get(key);
            //if (!cachedInstance) { // config such as marginTrading is different per instance
                cachedInstance = this.loadModule(modulePath, config);
                traderMap.set(key, cachedInstance);
            //}
            if (!cachedInstance) {
                logger.error("Error loading trader %s", nconf.get("trader"))
                return this.waitForRestart()
            }
            cachedInstance.setExchanges(this);
            this.trader.set(config.configNr, cachedInstance); // in this map the instance can be present multiple times
        })
    }

    protected connectTrader() {
        // our strategies send events on which the trader can act
        // if the trader acts he will send an event back to the strategy
        const actions: TradeAction[] = ["buy", "sell", "close"];
        //let traders = this.trader.getUniqueInstances();
        let traders = this.trader.getAll();
        actions.forEach((action) => {
            //for (let trader of this.trader)
            for (let i = 0; i < traders.length; i++)
            {
                //trader[1].removeAllListeners(action);
                traders[i].on(action, (order: Order.Order, trades: Trade.Trade[], info: TradeInfo) => {
                    let tradingConfigCurrencyPair: ConfigCurrencyPair = null;
                    for (let strategyList of this.strategies)
                    {
                        const configCurrencyPair = strategyList[0];
                        const configNr = parseInt(configCurrencyPair.split("-")[0]);
                        strategyList[1].forEach((strategyInstance) => {
                            if (!this.isInterestedStrategy(strategyInstance, order.currencyPair, configNr, traders[i]))
                                return;
                            if (tradingConfigCurrencyPair === null)
                                tradingConfigCurrencyPair = configCurrencyPair;
                            else if (tradingConfigCurrencyPair !== configCurrencyPair)
                                logger.error("Multiple config currency pairs executed the same trade. first %s, second %s", tradingConfigCurrencyPair, configCurrencyPair)
                            //console.log("CONNECTING", action, strategyInstance.getAction().pair.toString(), strategyInstance.getClassName())
                            strategyInstance.onTrade(action, order, trades, info);
                        })
                    }
                    this.tradeBook.logTrade(order, trades, info, tradingConfigCurrencyPair);
                })
            }
        })

        // sync portfolio
        for (let i = 0; i < traders.length; i++)
        {
            traders[i].on("syncPortfolio", (currencyPair: Currency.CurrencyPair, coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) => {
                let calledStrategies = new Set<AbstractStrategy>();
                for (let strategyList of this.strategies)
                {
                    // here we have to go through all possible config numbers to find strategies interested in this sync
                    //const configCurrencyPair = strategyList[0];
                    //const configNr = parseInt(configCurrencyPair.split("-")[0]);
                    for (let configNr = 1; configNr <= this.configs.length; configNr++)
                    {
                        strategyList[1].forEach((strategyInstance) => {
                            if (calledStrategies.has(strategyInstance))
                                return;
                            if (!this.isInterestedStrategy(strategyInstance, currencyPair, configNr, traders[i]))
                                return;
                            //console.log("calling %s %s - %s", strategyInstance.getClassName(), currencyPair.toString(), strategyInstance.getAction().pair.toString())
                            strategyInstance.onSyncPortfolio(coins, position, exchangeLabel);
                            calledStrategies.add(strategyInstance)
                        })
                    }
                }
            })
        }
    }

    protected connectCandles() {
        // forward to strategies
        for (let candle of this.candleMakers)
        {
            candle[1].on("candles", (candles: Candle.Candle[]) => {
                // forward 1min candles to CandleBatcher
                // TODO option to drop 1st candle here if we are in realtime mode (first candle is generally incomplete until we can fetch history data)
                let interestedBatchers: CurrencyCandleBatcherMap<Trade.Trade>;
                if (nconf.get("arbitrage")) {
                    const exchangeName = Currency.Exchange[candle[1].getExchange()]; // exchange label from maker
                    const batcherKey = exchangeName + "-" + candle[1].getCurrencyPair().toString();
                    interestedBatchers = this.candleBatchers.get(batcherKey);
                }
                else
                    interestedBatchers = this.candleBatchers.get(candle[1].getCurrencyPair().toString());
                if (!interestedBatchers || interestedBatchers.size === 0)
                    return;
                for (let bat of interestedBatchers)
                {
                    bat[1].removeAllListeners(); // attach them again every round (every candles event from the maker) // TODO improve
                    bat[1].on("candles", (candles: Candle.Candle[]) => {
                        // forward x min candles from batcher to strategies which are interested in this specific interval
                        candles.forEach((candle) => {
                            for (let strategyList of this.strategies)
                            {
                                strategyList[1].forEach((strategyInstance) => {
                                    if (!strategyInstance.getAction().pair.equals(candle.currencyPair))
                                        return; // this strategy is not set for this currency pair
                                    if (candle.interval === 1) // there is always a 1min batcher instance
                                        strategyInstance.send1minCandleTick(candle);
                                    if (strategyInstance.getAction().candleSize === candle.interval) // both can be true
                                        strategyInstance.sendCandleTick(candle);
                                })
                            }

                            // forward to traders
                            if (bat[1].getMax() === false)
                                return;
                            this.trader.getAll().forEach((trader) => {
                                trader.sendCandleTick(candle);
                            })
                        })
                    })
                    bat[1].addCandles(candles); // has to be called AFTER we attach the event above
                }
            });
            candle[1].on("currentCandle", (candle: Candle.Candle) => {
                for (let strategyList of this.strategies)
                {
                    strategyList[1].forEach((strategyInstance) => {
                        if (!strategyInstance.getAction().pair.equals(candle.currencyPair))
                            return; // this strategy is not set for this currency pair
                        strategyInstance.sendCurrentCandleTick(candle);
                    })
                }
            });
        }
    }

    protected logCandleSubscriptions() {
        for (let maker of this.candleMakers)
        {
            const exchangeName = Currency.Exchange[maker[1].getExchange()];
            this.candleCurrencies.push(exchangeName + " " + maker[1].getCurrencyPair().toString())
        }
        let batchers = []
        for (let batcherMap of this.candleBatchers)
        {
            for (let bat of batcherMap[1])
            {
                const exchangeName = Currency.Exchange[bat[1].getExchange()];
                batchers.push(exchangeName + " " + bat[1].getCurrencyPair().toString() + ": " + bat[1].getInterval() + " min")
            }
        }
        if (this.candleCurrencies.length !== 0)
            logger.info("Active candle makers:", this.candleCurrencies);
        if (batchers.length !== 0)
            logger.info("Active candle batchers:", batchers);
    }

    protected isInterestedStrategy(strategyInstance: AbstractStrategy, currencyPair: Currency.CurrencyPair, configNr: number, trader: AbstractTrader) {
        if (!strategyInstance.getAction().pair.equals(currencyPair))
            return false; // this strategy is not set for this currency pair
        else if (TradeConfig.createConfigCurrencyPair(configNr, currencyPair) !== trader.getConfig().getConfigCurrencyPair(currencyPair))
            return false; // just to be sure
        return true;
    }

    protected ensureCurrencyPair(currencyPair: string) {
        if (!this.actionHeap.has(currencyPair))
            this.actionHeap.set(currencyPair, this.getNewHeap());
    }

    protected getStrategyDir() {
        if (nconf.get("arbitrage"))
            return path.join(__dirname, "..", "src", "Arbitrage", "Strategies")
        return path.join(__dirname, "..", "src", "Strategies")
    }

    protected getNewHeap(): Heap {
        return new Heap({
            comparBefore(a: StrategyAction, b: StrategyAction) {
                return a.weight > b.weight; // higher numbers come first
            },
            compar(a: StrategyAction, b: StrategyAction) {
                return a.weight > b.weight ? -1 : 1;
            },
            freeSpace: false,
            size: 100
        });
    }
}