// exported keys in here must be exactly the same as they are written on nconf object (except "root")

const root = {
    "apiKeys" : { // leeave empty to disable API keys (public access)
        "KKASdh32j4hAHSD3wf23": true // set to false to disable a key
    },
    "updateUrl": "https://stnodecrawl:Asn2SDFhk3hklSDFl3r@staydown.co/updater/Sensor.json",
    // put your MongoDB connection URL in here: mongodb://user:password@host:port/database
    "mongoUrl": "mongodb://Brain:bkjHADKJh3wl4lASLd7ow5@localhost:27017/bitbrain",
    "searchHosts": ['localhost:9200'], // elasticsearch host:port - currently not used

    // proxy config. only needed if the exchange you want to trade on isn't accessible from your IP
    "proxy": "http://zordon4d20:8uTJi4TsGyi86oU@frankfurt.perfect-privacy.com:8080", // http://user:password@host:port
    "proxyAuth" : "http://zordon4d20:8uTJi4TsGyi86oU@DOMAIN:8080", // http://user:password@DOMAIN:port <- domain is a constant replaced by the app
    "ipCheckUrl" : "https://staydown.co/checkip" // a URL returning JSON: {ip: "my.ip"}
}

const DEFAULT_MARGIN_NOTIFICATION = 0.26
const DEFAULT_EXCHANGE_PROXY = ["http://zordon4d20:8uTJi4TsGyi86oU@frankfurt.perfect-privacy.com:8080",
    "http://zordon4d20:8uTJi4TsGyi86oU@erfurt.perfect-privacy.com:8080"] // an array of proxy strings. chosen randomly

class ServerConfig {
    // place any config from bit-models/serverConfig.ts in here to overwrite it with app-specific values

    public notificationMethod = "Pushover" // name of the notification class ("Pushover")

    // place all keys here. we don't run user specific configurations to keep the design simpler. each user has his own bot instance
    public apiKey = {
        // a class with the exact same name has to exist under /Exchanges/ resp /Notifications/
        exchange: {
            // remove an exchange here to disable trading on it
            // marginNotification,proxy are optional. leave empty to disable it
            Poloniex: [{
                key: "HOONG3VP-M6IVOM1X-DANNCP1P-MKC92UY9",
                secret: "5e8b1690509cfafdc6adafd790f286210515b96256f71d3a4c7bac0884253e112cece9a3752cdae3bfb30d33cb9c523c1d28ade37f13881ad059adbf8866f78a",
                marginNotification: DEFAULT_MARGIN_NOTIFICATION
            }, {
                key: "IN2EE424-WBLI3FQ9-V3VFJ2IN-4PX6ODWX",
                secret: "3cff0dda9222876bd6852214a4bf946f4ed15d30a72236bc4d891e3b93cecb3e181050ee90ff284da48ad81e4a76ccb4ab14e4bd4fef514e9c0cf442528c6227",
                marginNotification: DEFAULT_MARGIN_NOTIFICATION
            }, {
                key: "W9MGHJVQ-8J16WJEP-1FNGT0DU-Y6V5G423",
                secret: "e17e067d29a80d739c388629024fccd9731237417e8a3432d710f6d366aca7605c05b17ccb17458764887026277ffb13dafc9a3923ed752a768fdde13db4753d",
                marginNotification: DEFAULT_MARGIN_NOTIFICATION
            }, {
                key: "SYTXV3RA-VG7HVOZD-HTJDDORM-UP2S81WR",
                secret: "58560152d0b7895501561aee63aee9b45f0aee2e26f404176190b4423861d9f9743d7850f8161ff9691897f77df6f4fb214b3bd6244936a0798ce9418e98415f",
                marginNotification: DEFAULT_MARGIN_NOTIFICATION
            }, {
                key: "926CO56E-XUN1ZSAB-7LDVFX4H-FF1NUPBT",
                secret: "314fb8525284a7ffd96dfa4fa02519b0b0f4af2877c7f555d43f08cd67492aa99bde4c9b8eb61a7bc57a4c1d1094b08f01d5e366b9fda989c20a5b8ea1edd2f0",
                marginNotification: DEFAULT_MARGIN_NOTIFICATION
            }, {
                key: "MZ3ULCNA-WAZXGR8Q-UE9T8M9W-4WN4GAUS",
                secret: "9fb9fdf28f8851b1fa1f86024c4de83ccc4c938e8f0490766200c366e9773d0fa13df4eae13b656116a6608cefec9e7aab17e2c276647597036dbe6deb8af817",
                marginNotification: DEFAULT_MARGIN_NOTIFICATION
            }],
            OKEX: [{
                key: "2803f839-92d3-4f08-8c40-2b7b8a7634fa",
                secret: "F086148F036249CFF0D3D860B4535F8A",
                marginNotification: 0.03,
                proxy: DEFAULT_EXCHANGE_PROXY
            }, {
                key: "313bd9cb-3a92-4aa1-a0f7-c08b65c46404",
                secret: "9CEC782ED688832AF51F1997E0E68625",
                marginNotification: 0.03,
                proxy: DEFAULT_EXCHANGE_PROXY
            }, {
                key: "2e4173db-e9d1-4bbc-92f0-245e96b7d18c",
                secret: "A1C625759891E7FE997FC08E18D3291E",
                marginNotification: 0.03,
                proxy: DEFAULT_EXCHANGE_PROXY
            }],
            Kraken: [{
                key: "96l757oap3spar8Q1ej1zOwSodTd0NbKvLkZOCIiyTzDIt6gDLiyK001",
                secret: "IyYQIhdQ+PShqJu6baDsu3dlGNiZ5MK7btGFsprJOl02K7PwU9y4OyezUknQaZkEcF6cJ1N+5KRLc89u8nn7Yw==",
                marginNotification: 0.75
            }, {
                key: "k7H1agemqDO3plj3jl03SMbeqItq7KBaDxhmCK+ui95oFo2iFqV/0CIq",
                secret: "YC5VzxA40dWX4QXMWZyzYZoOgSKpR/IYVIKIkix/yyasiWywVS0qoaQRE3zZPNpuwwDpLBYENzJsjc1HNNZymw==",
                marginNotification: 0.75
            }, {
                key: "YRDQLtKldpJzUCidspWCmkOEIsvEO7RjG8BKwLrRjY7AA+cVhvCz4A/Q",
                secret: "uDIDQjSpa7QzYCYsavTi7Ua4YFZUOCdHdGHR04CQz0eY9otAEzJXAHdulCCiIdMbtwEc15g0ALIL1YGyg7jnFw==",
                marginNotification: 0.75
            }],
            // we need to 2 keys per array entry on bitfinex because we use API v2 and v1 currently
            Bitfinex: [{
                key: "nWHB2fuPkqwsKRampkCctqvbRVl1TTgKuO7Cg4hqzE4",
                secret: "mtKynUtlCSfotH6RO97HKxPm2ovnW0DRhJ471odgCtI",
                key2: "NA6sWfqOZ2SsvaIXlwyO1ag5ePPpFIm0KOo77F1BC3Q",
                secret2: "l7aglggoU1J3mvGrhWqLEwfS9Luhboxfhu7fMVS2cQY",
                marginNotification: 0.22 // min margin 0.13
            }, {
                key: "mZ3fn9t4oTjLbs7STjF3Yttf3VDlokl0PZCa5U6S794",
                secret: "1dnADFjwOCxCccltE8rVLmSLNQ0J47rYH7Q4UQykBn6",
                key2: "Ie3ei8w8j3XYTLJGPeRuAejG0gOEWrM1dSmgz2e3D88",
                secret2: "E4lFTD5KI2dH6d0QZTzQWR000aqPjSpmmibAeXcmQ2m",
                marginNotification: 0.22
            }, {
                key: "f9wO5NQxdRM1ifDfgmexFqTw79C8mhuYn1AcOPP1kHi",
                secret: "FftdL4g6kJeCPMSZm5kVmz9qk5VesVZqTwlqjx8UHbz",
                key2: "rQsA8EuE8vDkotzwd8lesawWcO7ynCorBLUdXhLFbfp",
                secret2: "VOZwl3aH2v7kW6ounFLpwnOmYfxCtztNPMCS2jPlGRT",
                marginNotification: 0.22
            }, {
                key: "ab1xYa0z4Ib2bpZbcXLicruWljvfrkFHWxaTxegIpAW",
                secret: "BxeIEyaH1PV0bcpTS5nirssGENTqiCd5MFAnqAEbOyS",
                key2: "GT7xSmqjiq9bQc6hQz2MLFXOPUWUOzl0TXY6QQuzafl",
                secret2: "b3pLFeqSIi3X5N5CsgfuEjufrEAqcmgzLn5v7RaxavQ",
                marginNotification: 0.22
            }],
            Bittrex: [{
                key: "f8e1fb53b8ea44b9bedf911621dc7252",
                secret: "6a76c9a6bd7f469d87eef105d64aa6e2",
                marginNotification: 0.5
            }, {
                key: "da3a15deba074a908ec2f7cdcf314e44",
                secret: "83a4366e53054e1a8a4261842a99be38",
                marginNotification: 0.5
            }],
            Binance: [{
                key: "DyPwXdY71YFQA6KPRjMOUczxaX36pXqRx47ho2ohIPTXmt53nHaQoMV6urPwT2Si",
                secret: "rkJFnQTNfnNQWoMbtUB8PqlwWg8Ln80MuwC7Pm0W9htykBASKY5hUYQPR6V0AJa3",
                marginNotification: 0.5
            }, {
                key: "cmguQStv7RQxy3D45OguXp2A5eVBTXjn6R45J2DW1Ech4DHOVThCVTKbqozRewUg",
                secret: "2o1t8h7ZFM954wqM0GFisc7B6FS1L9yDnXJwjLHWVJMv115MPD6xrOB8KUrS8Pxc",
                marginNotification: 0.5
            }],
            BitMEX: [/*{
                key: "ZiR4tEZyqO4W0AG4BfCpDujN",
                secret: "bR1cWRh_bU6CG7CUBbZIctm-SehldbmeusDC1XqlWEtL7Nbz",
                marginNotification: 0.03
            }, {
                key: "5HK4xst6iCLfM0mevJ_nSfMi",
                secret: "GBEB4BBy4AbHPjnugD76ImFnjsJdx2qU-Bt6USgCx3ZJlOp9",
                marginNotification: 0.03
            }*/
                // testnet keys
                {
                    key: "FpAyZ9ZQVt58x3ynMRTZuXv8", // key Ekliptor
                    secret: "YcB9-mdXd80LfpZzNu10hVtzgYVqtMi9yOizc3R3rfrVB0_s",
                    //key: "SOAhH_C0UjaNG0l-4OidUqfq", // key David
                    //secret: "6odW47X305E8k1Gn_3-ua3VYhSq3uIUXq5qnLx1m8Ozh5dbS",
                    marginNotification: 0.03,
                    testnet: true
                }
            ]
        },
        notify: {
            Pushover: {
                appToken: "au4vvvebuhpii382td1dk13c6v95sj",
                receiver: "upjq4hu72ecibteyredfr19onqmefe"
            }
        }
    }

    public twitterApi = {
        consumerKey: 'fmygabK8CXvCTkcAM6Xn7oo14',
        consumerSecret: 'surndjqU5NDoDgGTNdUDp0RXJYe0rX4rqIs49UFd9oxm4uSFEc',
        // we can get additional queries by removing this (limit per app instead of per user)
        accessTokenKey: '67397252-7FtPka7bC4Co1tIH0MCi2YY6Z0LuQZx0DMADvFVFy',
        accessTokenSecret: '2xq4QhdbUtA1seEPiaNsdjHR9XwxDTYJgK15pXtSvbqSc'
    }

    public backtest = {
        // interpreted as GMT 0
        //from: "2017-05-01 00:00:00",
        //to: "2017-06-01 00:00:00",

        // DASH spike
        //from: "2017-06-10 00:00:00",
        //to: "2017-06-12 00:00:00",

        // good ETH testing period with MACD 1 buy and 1 sell
        //from: "2017-05-03 00:00:00",
        //to: "2017-05-06 00:00:00",
        from: "2017-08-01 00:00:00",
        to: "2017-09-04 00:00:00",
        //to: "2017-08-10 00:00:00",

        // big LTC import with down trend
        //from: "2016-08-01 00:00:00",
        //to: "2017-06-01 00:00:00",
        //from: "2016-08-01 00:00:00",
        //to: "2016-09-15 00:00:00",

        // XRP import
        //from: "2017-03-01 00:00:00",
        //from: "2017-06-20 00:00:00",
        //to: "2017-07-04 00:00:00",
        // Bitfinex
        //from: "2017-12-13 00:00:00",
        //to: "2018-01-18 00:00:00",

        // ZEC import
        //from: "2017-05-26 00:00:00",
        //to: "2017-06-10 00:00:00",

        // SC import
        //from: "2017-06-04 00:00:00",
        //to: "2017-07-01 00:00:00",

        // OKEX BTC Futures
        // better use the weekly dates as "to" value because otherwise importing takes a long time (prices are almost the same)
        //from: "2017-07-04 00:00:00",
        //to: "2017-07-27 00:00:00",
        //from: "2017-12-16 00:00:00", // 2017-12-15 15:23:00
        //to: "2018-02-30 00:00:00", // 2018-02-10 06:23:00
        //from: "2018-01-01 00:00:00",
        //to: "2018-01-31 00:00:00",

        startBalance: 1.0, // for every coin (leveraged *2.5 when margin trading)
        slippage: 0.0, // in %, for example 0.05%
        cacheCandles: false,
        walk: true // Walk Forward Analysis: load previously optimized parameters and continue optimizing on them
    }

    public checkLoginUrl = "https://wolfbot.org/wp-json/tradebot/v1/login";
    public checkLoginApiKey = "lsdflwh34l2JASDhl3h4l3j4FPPQk234";
}

const serverConfig = new ServerConfig();
export {root, serverConfig}