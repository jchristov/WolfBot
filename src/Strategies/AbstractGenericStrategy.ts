import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as EventEmitter from 'events';
import {TradeConfig} from "../Trade/TradeConfig";
import {Candle, Currency, Trade, Order, Ticker, Funding} from "@ekliptor/bit-models";
import {TrendDirection} from "../Indicators/AbstractIndicator";
import {CandleBatcher} from "../Trade/Candles/CandleBatcher";
import {DataPlotCollector, PlotMarkValues, PlotMark} from "../Indicators/DataPlotCollector";
import * as crypto from "crypto";
import * as _ from "lodash";
import {OrderBook} from "../Trade/OrderBook";
import {TradeInfo} from "../Trade/AbstractTrader";
import {StrategyGroup} from "../Trade/StrategyGroup";
import {MarginPosition} from "../structs/MarginPosition";
import Notification from "../Notifications/Notification";
import * as path from "path";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import {AbstractCandlestickPatterns} from "../Indicators/Candlestick/AbstractCandlestickPatterns";
import {Trendlines} from "../Indicators/Trendline/Trendlines";
import {FibonacciRetracement} from "../Indicators/Trendline/FibonacciRetracement";


export interface InfoProperty {
    label: string;
    property: string; // just the name of the property. the value can be "any"
}
export interface InfoFunction {
    label: string;
    propertyFn: () => string | number | boolean;
}

export interface ChartMark {
    position: number; // the position within patternSize*patternRepeat. starting with index 0
    rate: number;
    candle: Candle.Candle;
}

export interface StrategyInfo {
    [label: string]: string | number | boolean;
}
export type GenericStrategyState = any; // TODO


export interface GenericStrategyAction {
    candleSize: number; // candle size in minutes (only applies if this strategy implements candleTick() function)
    enableLog: boolean; // use this to debug a certain strategy. call this.log()
}

export abstract class AbstractGenericStrategy extends EventEmitter {
    protected className: string;
    protected action: GenericStrategyAction;
    protected readonly runningCandleSize: number = -1;
    protected marketPrice: number = -1; // price of the last trade for the market this strategy is watching
    protected lastMarketPrice: number = -1;
    protected avgMarketPrice: number = -1; // avg price of the currently received trades
    protected positionSyncPrice: number = -1;
    protected lastAvgMarketPrice: number = -1;
    protected candle: Candle.Candle = null; // most recent candle. short for this.candleHistory[0]
    protected candleTrend: TrendDirection = "none";
    protected candleHistory: Candle.Candle[] = [];
    protected candles1min: Candle.Candle[] = [];
    protected currentCandle: Candle.Candle = null;

    protected tickQueue = Promise.resolve();
    //protected candleTickQueue = Promise.resolve(); // use the same queue to ensure we never mix buy/sell events
    protected tradeTick = 0; // counter for debugging and print logs every x trades. gets reset
    protected candleTicks = 0; // counts the number of candle ticks received. NEVER gets reset
    protected logMap = new Map<string, number>(); // (sha1, timestamp)
    protected saveState = false; // should we save the state after backtesting?
    protected notifier: AbstractNotification;
    protected notificationPauseMin: number = nconf.get('serverConfig:notificationPauseMin'); // can be changed in subclasses
    protected lastNotification: Date = null;

    // date of the last closing price
    // ALWAYS use this instead of "new Date()" so that backtesting works properly!
    protected marketTime: Date = null;
    protected strategyStart: Date = null;

    protected infoProperties: InfoProperty[] = [];
    protected infoFunctions: InfoFunction[] = [];
    protected plotData = new DataPlotCollector();
    protected candlesticks: AbstractCandlestickPatterns = null; // create the instance only when needed by strategy
    protected trendlines: Trendlines = null;
    protected fibonacci: FibonacciRetracement = null;

    constructor(options) {
        super()
        this.className = this.constructor.name;
        this.action = options;
        if (this.action.candleSize)
            this.runningCandleSize = this.action.candleSize; // candle size changes need a bot restart
        this.action.enableLog = options.enableLog ? true : false;
        this.setMaxListeners(nconf.get('maxEventListeners'));
        this.loadNotifier();
    }

    public getClassName() {
        return this.className;
    }

    /**
     * Overwrite this function if this strategy uses a different implementation for backtesting and live trading (for example "DEMA" and "DEMALeverage")
     * @returns {string}
     */
    public getBacktestClassName() {
        return this.className;
    }

    /**
     * Overwrite this function if the strategy executes trades initiated by another strategy (for example forwarded through "tradeStrategy").
     * @returns {string}
     */
    public getInitiatorClassName() {
        return this.className;
    }

    public getAction() {
        return this.action;
    }

    public getMarketTime() {
        if (!this.marketTime) {
            if (nconf.get('trader') === "Backtester") {
                logger.error("marketTime not yet set in %s %s", this.className, this.getCurrencyStr())
                return null;
            }
            logger.warn("marketTime not yet set in %s %s - assuming current time", this.className, this.getCurrencyStr())
            return new Date();
        }
        return this.marketTime;
    }

    public getMarketPrice() {
        return this.marketPrice;
    }

    public getLastMarketPrice() {
        return this.lastMarketPrice;
    }

    public getAvgMarketPrice() {
        return this.avgMarketPrice;
    }

    public getLastAvgMarketPrice() {
        return this.lastAvgMarketPrice;
    }

    public getCandle() {
        return this.candle;
    }

    public sendCurrentCandleTick(candle: Candle.Candle) {
        this.tickQueue = this.tickQueue.then(() => {
            candle = Object.assign(new Candle.Candle(candle.currencyPair), candle);
            let isNew = true;
            if (this.currentCandle && this.currentCandle.start.getTime() === candle.start.getTime())
                isNew = false;
            this.currentCandle = candle;
            //this.emit("onCurrentCandleTick", this); // sync call to events. currently no event for done (save CPU, not needed, same as trades event)
            return this.currentCandleTick(candle, isNew)
        }).catch((err) => {
            logger.error("Error in current candle tick of %s", this.className, err)
        })
    }

    /**
     * Returns an array of candles of the specified size
     * @param candleSize in minudes
     * @param candleCount the number of candles to return starting from the latest candle. use -1 to return all candles
     * @returns {Candle.Candle[]} the array of candles. empty array if the strategy doesn't have enough data yet
     */
    public getCandles(candleSize: number, candleCount: number = -1) {
        // TODO candle cache to speed up backtesting. we can invalidate the cache every candleSize ticks
        let longCandles: Candle.Candle[] = [];
        let batcher = this.getCandleBatcher(candleSize);
        batcher.on("candles", (candles: Candle.Candle[]) => {
            longCandles = longCandles.concat(candles);
        })
        let candles = Object.assign([], this.candles1min);
        //if (candleCount > 0)
        //candles.splice(0, candles.length - (candleSize * candleCount + 1*candleSize)) // batcher will only emit full candles, so add 1 candle
        while (candles.length > candleSize*candleCount)
            candles.pop();
        batcher.addCandles(candles);
        while (longCandles.length > candleCount)
            longCandles.shift();
        return longCandles;
    }

    public getLatestCandle(candleSize: number) {
        let candles = this.getCandles(candleSize, 1);
        if (candles.length === 0)
            return null;
        return candles[0]
    }

    /**
     * Batch all candles together to 1 large candle. The candleSize will be the combined amount of time of all candles.
     * @param {Candle.Candle[]} candles
     * @returns {Candle.Candle}
     */
    public batchCandles(candles: Candle.Candle[]): Candle.Candle {
        if (candles.length === 0 || candles[0] == null || candles[candles.length-1] == null)
            return null;
        return CandleBatcher.batchCandles(candles, candles[0].interval*candles.length)
    }

    /**
     * Get the candle i ticks back.
     * @param i The candle tick backwards starting at 0 for the current candle.
     * @returns {Candle}
     */
    public getCandleAt(i: number): Candle.Candle {
        if (i >= nconf.get("serverConfig:keepCandles") || i < 0) {
            logger.warn("Can return history candle at index %s. Storing max %s candles", i, nconf.get("serverConfig:keepCandles"))
            return null;
        }
        if (i >= this.candleHistory.length)
            return null;
        return this.candleHistory[i];
    }

    /**
     * Returns a list of candles starting with the oldest candle. Range is inclusive.
     * @param {number} startMs
     * @param {number} endMs
     * @returns {Candle.Candle[]}
     */
    public getCandleHistory(startMs: number, endMs: number): Candle.Candle[] {
        let candles = [];
        if (!this.action.candleSize) {
            logger.error("Can not get candle history for %s strategy without candle size", this.className)
            return candles;
        }
        const candleSizeMs = this.action.candleSize*utils.constants.MINUTE_IN_SECONDS*1000;
        for (let i = this.candleHistory.length-1; i >= 0; i--)
        {
            const candleStart = this.candleHistory[i].start.getTime();
            if (candleStart < startMs)
                continue;
            //if (candleStart + this.candleHistory[i].interval*utils.constants.MINUTE_IN_SECONDS*1000 > endMs)
            if (candleStart + candleSizeMs > endMs)
                break;
            candles.push(this.candleHistory[i])
        }
        return candles;
    }

    protected computeAverageCandleVolume(candles: Candle.Candle[]) {
        if (!candles || candles.length === 0)
            return 0.0;
        let totalVolume = 0;
        candles.forEach((candle) => {
            totalVolume += candle.volume;
            //totalVolume += candle.getVolumeBtc();
        })
        return totalVolume / candles.length;
    }

    public abstract getCurrencyStr(): string;

    public abstract getInfo(): StrategyInfo;

    /**
     * Serialize candles to store the state after backtesting.
     * Overwrite this function to serialize more data.
     */
    public serialize(): GenericStrategyState {
        return {
            // json gets too big with trade data data (> 500MB for 2 weeks)
            runningCandleSize: this.runningCandleSize,
            candleHistory: Candle.Candle.copy(this.candleHistory), // TODO add parameter to remove oldest candles (checking candle start property)
            candles1min: Candle.Candle.copy(this.candles1min),
            lastNotification: this.lastNotification
        }
    }

    public unserialize(state: GenericStrategyState) {
        // copy them to get Candle instances (from JSON they are just plain objects)
        // note: if we add a new value it is undefined on first unserialize() call. then it will not be shown in getInfo()
        // use if (state.value) this.value = state.value; to avoid undefined problems during update

        this.candleHistory = Candle.Candle.copy(state.candleHistory);
        this.candles1min = Candle.Candle.copy(state.candles1min);
        this.candle = this.getCandleAt(0);
        if (this.candle)
            this.candleTrend = this.candle.trend;
        if (state.lastNotification) // TODO remove
            this.lastNotification = state.lastNotification;
        // TODO return true/false depending on if required information was available (important in subclasses with custom serialized data)
        this.updateIndicatorCandles();
    }

    public canUnserialize(state: any) {
        if (this.runningCandleSize !== state.runningCandleSize) {
            logger.warn("Skipped restoring %s data because candle size changed from %s min to %s min", this.className, state.runningCandleSize, this.runningCandleSize)
            return false;
        }
        return true;
    }

    public createTradeState() {
        let state = this.serialize();
        delete state.candleHistory;
        delete state.candles1min;
        if (state.candles)
            delete state.candles; // TechnicalStrategy
        return state;
    }

    public onConfigChanged() {
        this.resetValues(); // anything else we want to do?
    }

    public static getStrategyByName(strategies: AbstractGenericStrategy[], findName: string): AbstractGenericStrategy {
        if (Array.isArray(strategies) === false)
            return null;
        for (let i = 0; i < strategies.length; i++)
        {
            if (strategies[i].getClassName() === findName || strategies[i].getBacktestClassName() === findName)
                return strategies[i];
        }
        return null;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    /**
     * Runs the strategy. Called every time there is new data from MarketStream.
     * Delayed until "warmUpMin" has passed.
     * Will emit buy/sell events according to this strategy.
     * @param trades all trades since the last tick
     */
    protected abstract tick(trades: Trade.Trade[] | Funding.FundingTrade[]): Promise<void>;

    /**
     * Runs the strategy. Called once every candle from CandleBatcher (interval specified per strategy).
     * Delayed until "warmUpMin" has passed.
     * Will emit buy/sell events according to this strategy.
     * @param candle a candle with the specifized time interval for this strategy. The candle will also contain all
     * trades in candle.tradeData[]
     */
    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // overwrite this in your subclass if your strategy needs candles
            resolve()
        })
    }

    /**
     * Receives an update of the current (latest candle). Called multiple times (every few seconds) with the same candle.
     * @param {Candle.Candle} candle
     * @param {boolean} isNew is set to true when the next candle arrives (once after every candleSize interval passes).
     * @returns {Promise<void>}
     */
    protected currentCandleTick(candle: Candle.Candle, isNew: boolean): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // overwrite this in your subclass if your strategy needs the current candle
            resolve()
        })
    }

    protected abstract getCandleBatcher(candleSize: number): CandleBatcher<Trade.SimpleTrade>;

    protected addInfo(label: string, property: string) {
        this.infoProperties.push({label: label, property: property});
    }

    protected addInfoFunction(label: string, propertyFn: () => string | number | boolean) {
        this.infoFunctions.push({label: label, propertyFn: propertyFn});
    }

    /**
     * Log arguments
     * @param args the arguments to log. You can't use %s, but arguments will be formatted as string.
     * Use utils.sprintf() to format strings.
     */
    protected log(...args) {
        if (!this.action.enableLog)
            return;
        logger.info("%s %s:", this.className, this.getCurrencyStr(), ...args)
    }

    protected logOnce(...args) {
        if (!this.action.enableLog)
            return;
        const now = Date.now();
        let clearMessages = () => {
            for (let log of this.logMap) // clear old logs of  messages
            {
                if (log[1] + nconf.get('serverConfig:logTimeoutMin')*utils.constants.MINUTE_IN_SECONDS*1000 < now)
                    this.logMap.delete(log[0]);
            }
        }
        let key = crypto.createHash('sha1').update(JSON.stringify(args), 'utf8').digest('hex');
        if (this.logMap.has(key)) {
            if (utils.getRandomInt(0, 99) < nconf.get("serverConfig:clearLogOnceProbability"))
                clearMessages(); // allow logging the same message next time
            return; // ANOTHER message has to be logged for this one to expire
        }
        clearMessages();
        this.logMap.set(key, now);
        this.log(...args);
    }

    /**
     * Log arguments as warning
     * @param args the arguments to log. You can't use %s, but arguments will be formatted as string.
     * Use utils.sprintf() to format strings.
     */
    protected warn(...args) {
        if (!this.action.enableLog)
            return;
        logger.warn("%s %s:", this.className, this.getCurrencyStr(), ...args)
    }

    protected resetValues(): void {
        // don't reset candles and market data
        //this.marketPrice = -1;
        //this.lastMarketPrice = -1;
        //this.avgMarketPrice = -1;
        //this.lastAvgMarketPrice = -1;
        //this.candle = null;
        //this.candleTrend = "none";

        this.tickQueue = Promise.resolve();
        this.tradeTick = 0;
        this.logMap.clear();
    }

    protected addCandleInternal(candle: Candle.Candle) {
        this.candleHistory.unshift(candle);
        if (this.candleHistory.length > nconf.get("serverConfig:keepCandles"))
            this.candleHistory.pop();
    }

    protected updateIndicatorCandles() {
        if (this.candlesticks !== null)
            this.candlesticks.setCandleInput(this.candleHistory);
        if (this.trendlines !== null)
            //this.trendlines.setCandleInput(this.getCandles(60, nconf.get("serverConfig:trendlineKeepDays") * 24));
            this.trendlines.setCandleInput(this.candleHistory); // faster
        if (this.fibonacci !== null)
            this.fibonacci.setCandleInput(this.candleHistory);
    }

    protected loadNotifier() {
        /*
        const notificationClass = nconf.get('serverConfig:notificationMethod');
        const notificationOpts = nconf.get("serverConfig:apiKey:notify:" + notificationClass);
        const modulePath = path.join(__dirname, "..", "Notifications", notificationClass)
        this.notifier = this.loadModule(modulePath, notificationOpts)
        if (!this.notifier) {
            logger.error("Error loading %s in %s", notificationClass, this.className)
            return;
        }
        */
        this.notifier = AbstractNotification.getInstance();
    }

    protected sendNotification(headline: string, text: string = "-", requireConfirmation = false, forceSend = false, addPrice = false) {
        // note that pushover won't accept empty message text
        if (nconf.get("trader") === "Backtester")
            return;
        const pauseMs = this.notificationPauseMin * utils.constants.MINUTE_IN_SECONDS * 1000;
        if (!forceSend && this.lastNotification && this.lastNotification.getTime() + pauseMs > Date.now())
            return;
        headline = utils.sprintf("%s %s: %s", this.className, this.getCurrencyStr(), headline);
        if (addPrice)
            text += "\r\nRate: " + this.avgMarketPrice.toFixed(8);
        let notification = new Notification(headline, text, requireConfirmation);
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        this.lastNotification = new Date();
    }

    protected loadCandlestickPatternRecognizer(candlestickClassName: string, options = undefined) {
        const modulePath = path.join(__dirname, "..", "Indicators", "Candlestick", candlestickClassName);
        return this.loadModule<AbstractCandlestickPatterns>(modulePath, options)
    }

    protected loadModule<T>(modulePath: string, options = undefined): T {
        try {
            let ModuleClass = require(modulePath)
            if (ModuleClass.default)
                ModuleClass = ModuleClass.default; // fix for typescript default exports
            let instance = new ModuleClass(options)
            return instance
        }
        catch (e) { // e.code === 'MODULE_NOT_FOUND'
            logger.error('failed to load module: ' + modulePath, e)
            return null
        }
    }
}