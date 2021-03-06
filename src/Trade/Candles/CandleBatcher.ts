import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as _ from "lodash";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {CandleStream} from "./CandleStream";

/**
 * Creates candles of x minutes from 1 minute candles of CandleMaker.
 */
export class CandleBatcher<T extends Trade.SimpleTrade> extends CandleStream<T> {
    protected interval: number; // candle size in minutes
    protected minuteCandles: Candle.Candle[] = [];
    protected lastCandle: Candle.Candle = null;
    protected isMax = false; // this instance has the max interval for this currency pair

    constructor(interval: number, currencyPair: Currency.CurrencyPair, exchange: Currency.Exchange = Currency.Exchange.ALL) {
        super(currencyPair, exchange)
        this.interval = interval;
        if (!this.interval || !_.isNumber(this.interval) || this.interval <= 0)
            throw new Error("Candle size has to be a positive number");
    }

    public getInterval() {
        return this.interval;
    }

    public addCandles(candles: Candle.Candle[]) {
        // loop through our 1 minute candles and emit x minute candles at the right time
        _.each(candles, (candle) => {
            this.minuteCandles.push(candle);
            this.checkCandleReady();
        });
    }

    public setMax(max: boolean) {
        this.isMax = max;
    }

    public getMax() {
        return this.isMax;
    }

    public static batchCandles(smallCandles: Candle.Candle[], interval: number = 0, copyCandles = true): Candle.Candle {
        if (copyCandles)
            smallCandles = _.cloneDeep(smallCandles); // ensure we don't modify any data of candles being used outside of this class
        if (!interval)
            interval = smallCandles[0].interval*smallCandles.length; // assume all candles are the same size
        const first = _.cloneDeep(smallCandles.shift()); // always copy the first one because properties get modified
        first.vwp = first.vwp * first.volume;

        let candle = _.reduce<Candle.Candle, Candle.Candle>(
            smallCandles,
            (candle, m) => { // TODO check if currency pair & exchange match? but this error shouldn't happen
                candle.high = _.max([candle.high, m.high]);
                candle.low = _.min([candle.low, m.low]);
                candle.close = m.close;
                candle.volume += m.volume;
                candle.vwp += m.vwp * m.volume;
                candle.trades += m.trades;
                if (candle.tradeData/* !== undefined*/)
                    candle.tradeData = candle.tradeData.concat(m.tradeData);
                return candle;
            },
            first // accumulator = candle, m = current candle
        );

        if (candle.volume) {
            // we have added up all prices (relative to volume)
            // now divide by volume to get the Volume Weighted Price
            candle.vwp /= candle.volume;
        }
        else
        // empty candle
            candle.vwp = candle.open;

        candle.start = first.start;
        candle.interval = interval;
        CandleStream.computeCandleTrend(candle);
        return candle;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkCandleReady() {
        if (this.minuteCandles.length % this.interval !== 0)
            return;

        this.lastCandle = this.calculate();
        this.emitCandles([this.lastCandle]);
        this.minuteCandles = [];
    }

    protected calculate() {
        return CandleBatcher.batchCandles(this.minuteCandles, this.interval,false);
    }
}