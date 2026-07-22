import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import {
  Candle,
  calcEMA,
  calcVWAP,
  calcATR,
  calcRSI,
  calcMACD,
  calcADX,
  calcSMA,
} from './indicators.utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfluenceFactors {
  aboveVwap: boolean;
  rsiAligned: boolean;
  macdAligned: boolean;
  emaAligned: boolean;
  adxWithTrend: boolean;
  volumeConfirmed: boolean;
  secondaryRsiAligned: boolean;
}

export interface MarketBias {
  bull: number;
  bear: number;
  difference: number;
  label: 'STRONG BULL' | 'MILD BULL' | 'NEUTRAL' | 'MILD BEAR' | 'STRONG BEAR';
}

export interface SignalPayload {
  event: 'trading_signal';
  signal: 'LONG' | 'SHORT';
  symbol: string;
  timeframe: string;
  timestamp: number;
  datetime: string;
  price: {
    entry: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number;
    takeProfit3: number;
    takeProfit4: number;
    takeProfit5: number;
  };
  risk: {
    atr: number;
    riskAmount: number;
    atrMultiplier: number;
  };
  confluence: {
    score: number;
    total: 7;
    percentage: number;
    factors: ConfluenceFactors;
  };
  marketBias: MarketBias;
}

export interface CheckResult {
  triggered: boolean;
  signal?: SignalPayload;
}

// ─── Interval maps ────────────────────────────────────────────────────────────

const TIMEFRAME_MS: Record<string, number> = {
  '1m':  60_000,
  '3m':  180_000,
  '5m':  300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h':  3_600_000,
  '2h':  7_200_000,
  '4h':  14_400_000,
  '6h':  21_600_000,
  '8h':  28_800_000,
  '12h': 43_200_000,
  '1d':  86_400_000,
};

// KuCoin uses different interval identifiers to Binance
const KUCOIN_INTERVAL: Record<string, string> = {
  '1m':  '1min',
  '3m':  '3min',
  '5m':  '5min',
  '15m': '15min',
  '30m': '30min',
  '1h':  '1hour',
  '2h':  '2hour',
  '4h':  '4hour',
  '6h':  '6hour',
  '8h':  '8hour',
  '12h': '12hour',
  '1d':  '1day',
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SignalService implements OnModuleInit {
  private readonly logger = new Logger(SignalService.name);
  private isRunning = false;

  // Stateful tracking (mirrors Pine Script vars activeDirection / lastSignalBarTime)
  private activeDirection: 0 | 1 | -1 = 0;
  private lastSignalBarTime: number | null = null;

  // Resolved config
  private readonly symbol: string;
  private readonly interval: string;
  private readonly secondaryInterval: string;
  private readonly fastEmaPeriod: number;
  private readonly slowEmaPeriod: number;
  private readonly minConfluenceScore: number;
  private readonly atrPeriod: number;
  private readonly atrSlMultiplier: number;
  private readonly tpCount: number;
  private readonly webhookUrl: string;
  private readonly webhookSecret: string;
  private readonly kucoinBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.symbol             = config.get('SIGNAL_SYMBOL', 'BTC-USDT');
    this.interval           = config.get('SIGNAL_INTERVAL', '1h');
    this.secondaryInterval  = config.get('SIGNAL_SECONDARY_INTERVAL', '5m');
    this.fastEmaPeriod      = parseInt(config.get('SIGNAL_FAST_EMA', '9'));
    this.slowEmaPeriod      = parseInt(config.get('SIGNAL_SLOW_EMA', '21'));
    this.minConfluenceScore = parseInt(config.get('SIGNAL_MIN_CONFLUENCE', '4'));
    this.atrPeriod          = parseInt(config.get('SIGNAL_ATR_PERIOD', '14'));
    this.atrSlMultiplier    = parseFloat(config.get('SIGNAL_ATR_SL_MULTIPLIER', '1.5'));
    this.tpCount            = parseInt(config.get('SIGNAL_TP_COUNT', '5'));
    this.kucoinBaseUrl      = config.get('SIGNAL_KUCOIN_URL', 'https://api.kucoin.com');

    const laravelBase   = config.get('LARAVEL_URL', '');
    this.webhookUrl     = config.get('SIGNAL_WEBHOOK_URL', `${laravelBase}/api/v1/signals/webhook`);
    const defaultSecret = config.get<string>('LARAVEL_API_SECRET') ?? '';
    this.webhookSecret  = config.get('SIGNAL_WEBHOOK_SECRET', defaultSecret);
  }

  async onModuleInit() {
    const enabled = this.config.get('SIGNAL_ENABLED', 'false') === 'true';
    if (!enabled) {
      this.logger.log('SIGNAL_ENABLED=false — signal scanner not started');
      return;
    }

    this.logger.log(
      `[Signal] Starting — ${this.symbol} ${this.interval} | Secondary TF: ${this.secondaryInterval} | ` +
      `Fast EMA: ${this.fastEmaPeriod} | Slow EMA: ${this.slowEmaPeriod} | ` +
      `Min confluence: ${this.minConfluenceScore}/7 | ATR×${this.atrSlMultiplier}`,
    );

    this.runLoop().catch(err => {
      this.logger.error(`[Signal] Loop crashed: ${err.message}`);
    });
  }

  // ─── Main polling loop ────────────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    this.isRunning = true;
    await this.sleepUntilNextBarClose();

    while (this.isRunning) {
      try {
        await this.checkSignal();
      } catch (err) {
        this.logger.error(`[Signal] Check error: ${err.message}`);
      }
      await this.sleepUntilNextBarClose();
    }
  }

  // ─── Core signal logic ────────────────────────────────────────────────────

  async checkSignal(): Promise<CheckResult> {
    const [mainCandles, secCandles] = await Promise.all([
      this.fetchCandles(this.symbol, this.interval, 300),
      this.fetchCandles(this.symbol, this.secondaryInterval, 100),
    ]);

    if (mainCandles.length < 60) {
      this.logger.warn('[Signal] Not enough main candles — skipping');
      return { triggered: false };
    }
    if (secCandles.length < 20) {
      this.logger.warn('[Signal] Not enough secondary candles — skipping');
      return { triggered: false };
    }

    // Last KuCoin candle is the still-forming bar; work with the closed one before it.
    const n = mainCandles.length - 2;

    const closes  = mainCandles.map(c => c.close);
    const volumes = mainCandles.map(c => c.volume);

    // ── Indicators ──
    const fastEMA = calcEMA(closes, this.fastEmaPeriod);
    const slowEMA = calcEMA(closes, this.slowEmaPeriod);
    const vwap    = calcVWAP(mainCandles);
    const atr     = calcATR(mainCandles, this.atrPeriod);
    const rsi     = calcRSI(closes, 14);
    const macd    = calcMACD(closes, 12, 26, 9);
    const adx     = calcADX(mainCandles, 14);
    const volSMA  = calcSMA(volumes, 20);

    const secCloses = secCandles.map(c => c.close);
    const secRSI    = calcRSI(secCloses, 14);
    const secRsiVal = secRSI[secRSI.length - 2];

    const bar = {
      close:       mainCandles[n].close,
      open:        mainCandles[n].open,
      high:        mainCandles[n].high,
      volume:      mainCandles[n].volume,
      openTime:    mainCandles[n].openTime,
      fastEMA:     fastEMA[n],
      slowEMA:     slowEMA[n],
      prevFastEMA: fastEMA[n - 1],
      prevSlowEMA: slowEMA[n - 1],
      vwap:        vwap[n],
      atr:         atr[n],
      rsi:         rsi[n],
      macd:        macd.macd[n],
      macdSig:     macd.signal[n],
      adx:         adx.adx[n],
      volSMA:      volSMA[n],
      secRsi:      isNaN(secRsiVal) ? 50 : secRsiVal,
    };

    const warm = [bar.fastEMA, bar.slowEMA, bar.prevFastEMA, bar.prevSlowEMA,
                  bar.vwap, bar.atr, bar.rsi, bar.macd, bar.macdSig, bar.adx, bar.volSMA];
    if (warm.some(v => isNaN(v))) {
      this.logger.warn('[Signal] Indicators still warming up (NaN) — skipping');
      return { triggered: false };
    }

    // ── Crossover detection ──
    const bullCross = bar.prevFastEMA <= bar.prevSlowEMA && bar.fastEMA > bar.slowEMA;
    const bearCross = bar.prevFastEMA >= bar.prevSlowEMA && bar.fastEMA < bar.slowEMA;

    // ── Confluence scoring (7 factors each direction) ──
    const bullFactors: ConfluenceFactors = {
      aboveVwap:           bar.close > bar.vwap,
      rsiAligned:          bar.rsi > 50,
      macdAligned:         bar.macd > bar.macdSig,
      emaAligned:          bar.fastEMA > bar.slowEMA,
      adxWithTrend:        bar.adx > 25 && bar.close > bar.fastEMA,
      volumeConfirmed:     bar.volume > bar.volSMA && bar.close > bar.open,
      secondaryRsiAligned: bar.secRsi > 50,
    };
    const bearFactors: ConfluenceFactors = {
      aboveVwap:           bar.close < bar.vwap,
      rsiAligned:          bar.rsi < 50,
      macdAligned:         bar.macd < bar.macdSig,
      emaAligned:          bar.fastEMA < bar.slowEMA,
      adxWithTrend:        bar.adx > 25 && bar.close < bar.fastEMA,
      volumeConfirmed:     bar.volume > bar.volSMA && bar.close < bar.open,
      secondaryRsiAligned: bar.secRsi < 50,
    };

    const bullScore = Object.values(bullFactors).filter(Boolean).length;
    const bearScore = Object.values(bearFactors).filter(Boolean).length;

    // ── Market Bias ──
    const marketBias = this.calcMarketBias(bullScore, bearScore);

    const longSignal  = bullCross && this.activeDirection <= 0 && bullScore >= this.minConfluenceScore;
    const shortSignal = bearCross && this.activeDirection >= 0 && bearScore >= this.minConfluenceScore;

    this.logger.log(
      `[Signal][${this.symbol}/${this.interval}] ` +
      `Fast: ${bar.fastEMA.toFixed(4)} | Slow: ${bar.slowEMA.toFixed(4)} | ` +
      `Bull: ${bullScore}/7 | Bear: ${bearScore}/7 | Bias: ${marketBias.label} | ` +
      `Cross: ${bullCross ? 'BULL' : bearCross ? 'BEAR' : 'none'} | ` +
      `Signal: ${longSignal ? 'LONG' : shortSignal ? 'SHORT' : 'none'}`,
    );

    if (!longSignal && !shortSignal) return { triggered: false };

    if (this.lastSignalBarTime === bar.openTime) {
      this.logger.warn(`[Signal] Duplicate suppressed — already fired for bar ${new Date(bar.openTime).toISOString()}`);
      return { triggered: false };
    }

    const isBull     = longSignal;
    const entry      = bar.close;
    const riskAmount = bar.atr * this.atrSlMultiplier;
    const sl         = isBull ? entry - riskAmount : entry + riskAmount;
    const tp         = (mult: number) => isBull ? entry + riskAmount * mult : entry - riskAmount * mult;

    const score   = isBull ? bullScore : bearScore;
    const factors = isBull ? bullFactors : bearFactors;

    const payload: SignalPayload = {
      event:     'trading_signal',
      signal:    isBull ? 'LONG' : 'SHORT',
      symbol:    this.symbol,
      timeframe: this.interval,
      timestamp: bar.openTime,
      datetime:  new Date(bar.openTime).toISOString(),
      price: {
        entry:       this.round(entry),
        stopLoss:    this.round(sl),
        takeProfit1: this.round(tp(1)),
        takeProfit2: this.round(tp(2)),
        takeProfit3: this.round(tp(3)),
        takeProfit4: this.round(tp(4)),
        takeProfit5: this.round(tp(5)),
      },
      risk: {
        atr:           this.round(bar.atr),
        riskAmount:    this.round(riskAmount),
        atrMultiplier: this.atrSlMultiplier,
      },
      confluence: {
        score,
        total:      7,
        percentage: parseFloat(((score / 7) * 100).toFixed(2)),
        factors,
      },
      marketBias,
    };

    this.activeDirection   = isBull ? 1 : -1;
    this.lastSignalBarTime = bar.openTime;

    this.logger.log(
      `[Signal] *** ${payload.signal} *** ${this.symbol} | ` +
      `Entry: ${entry} | SL: ${sl.toFixed(4)} | TP1: ${tp(1).toFixed(4)} | TP5: ${tp(5).toFixed(4)} | ` +
      `Score: ${score}/7 | Bias: ${marketBias.label} (${marketBias.bull}% Bull / ${marketBias.bear}% Bear)`,
    );

    await this.sendWebhook(payload);
    return { triggered: true, signal: payload };
  }

  // ─── Market Bias ─────────────────────────────────────────────────────────

  private calcMarketBias(bullScore: number, bearScore: number): MarketBias {
    const bull       = parseFloat(((bullScore / 7) * 100).toFixed(2));
    const bear       = parseFloat(((bearScore / 7) * 100).toFixed(2));
    const difference = parseFloat(Math.abs(bull - bear).toFixed(2));

    let label: MarketBias['label'];
    if (bull === bear) {
      label = 'NEUTRAL';
    } else if (bull > bear) {
      label = difference >= 40 ? 'STRONG BULL' : 'MILD BULL';
    } else {
      label = difference >= 40 ? 'STRONG BEAR' : 'MILD BEAR';
    }

    return { bull, bear, difference, label };
  }

  // ─── KuCoin candle fetch ──────────────────────────────────────────────────

  private async fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const kucoinSymbol   = this.toKucoinSymbol(symbol);
    const kucoinInterval = KUCOIN_INTERVAL[interval] ?? '1hour';
    const intervalSec    = this.tfToMs(interval) / 1000;

    // KuCoin requires explicit time range to control how many candles are returned
    const endAt   = Math.floor(Date.now() / 1000);
    const startAt = endAt - limit * intervalSec;

    const url  = `${this.kucoinBaseUrl}/api/v1/market/candles`;
    const resp = await axios.get<{ code: string; data: string[][] }>(url, {
      params:  { symbol: kucoinSymbol, type: kucoinInterval, startAt, endAt },
      timeout: 10_000,
    });

    if (resp.data.code !== '200000') {
      throw new Error(`KuCoin API error: ${resp.data.code}`);
    }

    // KuCoin returns newest-first; reverse to chronological order.
    // Candle format: [time(sec), open, close, high, low, volume, turnover]
    return resp.data.data.reverse().map(k => ({
      openTime: parseInt(k[0]) * 1000,  // seconds → ms
      open:     parseFloat(k[1]),
      close:    parseFloat(k[2]),
      high:     parseFloat(k[3]),
      low:      parseFloat(k[4]),
      volume:   parseFloat(k[5]),
    }));
  }

  // Converts Binance-style symbol (BTCUSDT) to KuCoin format (BTC-USDT)
  private toKucoinSymbol(symbol: string): string {
    if (symbol.includes('-')) return symbol;
    const quotes = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'BUSD'];
    for (const q of quotes) {
      if (symbol.endsWith(q)) return `${symbol.slice(0, -q.length)}-${q}`;
    }
    return symbol;
  }

  // ─── Webhook ──────────────────────────────────────────────────────────────

  private async sendWebhook(payload: SignalPayload): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn('[Signal][WEBHOOK] SIGNAL_WEBHOOK_URL not set — skipping');
      return;
    }

    const body      = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex');

    this.logger.log(
      `[Signal][WEBHOOK] Sending ${payload.signal} to ${this.webhookUrl}\n` +
      `  Payload: ${body}`,
    );

    try {
      const resp = await axios.post(this.webhookUrl, body, {
        headers: {
          'Content-Type':   'application/json',
          'X-Signature':    signature,
          'X-Signal-Event': 'trading_signal',
        },
        timeout: 10_000,
      });

      this.logger.log(
        `[Signal][WEBHOOK] Success — ${resp.status} ${resp.statusText}\n` +
        `  Response: ${JSON.stringify(resp.data)}`,
      );
    } catch (err) {
      this.logger.error(
        `[Signal][WEBHOOK] FAILED — ${err.message}\n` +
        `  URL:    ${this.webhookUrl}\n` +
        `  Status: ${err.response?.status ?? 'no response'}\n` +
        `  Body:   ${JSON.stringify(err.response?.data ?? null)}\n` +
        `  Signal: ${body}`,
      );
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private round(v: number, dp = 8): number {
    return parseFloat(v.toFixed(dp));
  }

  private tfToMs(tf: string): number {
    return TIMEFRAME_MS[tf] ?? 3_600_000;
  }

  // Sleeps until 5 seconds after the next bar-close boundary
  private async sleepUntilNextBarClose(): Promise<void> {
    const intervalMs   = this.tfToMs(this.interval);
    const now          = Date.now();
    const msUntilClose = intervalMs - (now % intervalMs) + 5_000;
    this.logger.log(`[Signal] Next check in ${Math.round(msUntilClose / 1000)}s (bar close + 5s buffer)`);
    await this.sleep(msUntilClose);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  // ─── Status (for controller) ──────────────────────────────────────────────

  getStatus() {
    return {
      running:            this.isRunning,
      symbol:             this.symbol,
      interval:           this.interval,
      secondaryInterval:  this.secondaryInterval,
      fastEmaPeriod:      this.fastEmaPeriod,
      slowEmaPeriod:      this.slowEmaPeriod,
      minConfluenceScore: this.minConfluenceScore,
      atrPeriod:          this.atrPeriod,
      atrSlMultiplier:    this.atrSlMultiplier,
      tpCount:            this.tpCount,
      activeDirection:    this.activeDirection === 1 ? 'LONG' : this.activeDirection === -1 ? 'SHORT' : 'NONE',
      lastSignalBarTime:  this.lastSignalBarTime
        ? new Date(this.lastSignalBarTime).toISOString()
        : null,
    };
  }
}
