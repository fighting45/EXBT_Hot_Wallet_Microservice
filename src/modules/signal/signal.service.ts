import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { TradingSignal } from '../../entities';
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

// Isolated state per (symbol × interval) scanner
interface ScannerState {
  symbol: string;
  interval: string;
  activeDirection: 0 | 1 | -1;
  lastSignalBarTime: number | null;
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

const KUCOIN_SPOT_INTERVAL: Record<string, string> = {
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

const KUCOIN_FUTURES_GRANULARITY: Record<string, number> = {
  '1m':  1,
  '5m':  5,
  '15m': 15,
  '30m': 30,
  '1h':  60,
  '2h':  120,
  '4h':  240,
  '8h':  480,
  '12h': 720,
  '1d':  1440,
};

const KUCOIN_FUTURES_SYMBOL_MAP: Record<string, string> = {
  'BTCUSDT.P':  'XBTUSDTM',
  'ETHUSDT.P':  'ETHUSDTM',
  'SOLUSDT.P':  'SOLUSDTM',
  'BNBUSDT.P':  'BNBUSDTM',
  'XRPUSDT.P':  'XRPUSDTM',
  'ADAUSDT.P':  'ADAUSDTM',
  'DOGEUSDT.P': 'DOGEUSDTM',
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SignalService implements OnModuleInit {
  private readonly logger = new Logger(SignalService.name);
  private readonly scanners: ScannerState[] = [];

  private readonly symbols: string[];
  private readonly intervals: string[];
  private readonly secondaryInterval: string;
  private readonly fastEmaPeriod: number;
  private readonly slowEmaPeriod: number;
  private readonly minConfluenceScore: number;
  private readonly atrPeriod: number;
  private readonly atrSlMultiplier: number;
  private readonly tpCount: number;
  private readonly webhookUrl: string;
  private readonly webhookSecret: string;
  private readonly kucoinSpotUrl: string;
  private readonly kucoinFuturesUrl: string;

  constructor(
    @InjectRepository(TradingSignal)
    private readonly signalRepo: Repository<TradingSignal>,
    private readonly config: ConfigService,
  ) {
    this.symbols            = config.get('SIGNAL_SYMBOLS', 'BTC-USDT').split(',').map(s => s.trim()).filter(Boolean);
    this.intervals          = config.get('SIGNAL_INTERVALS', '1h').split(',').map(s => s.trim()).filter(Boolean);
    this.secondaryInterval  = config.get('SIGNAL_SECONDARY_INTERVAL', '5m');
    this.fastEmaPeriod      = parseInt(config.get('SIGNAL_FAST_EMA', '9'));
    this.slowEmaPeriod      = parseInt(config.get('SIGNAL_SLOW_EMA', '21'));
    this.minConfluenceScore = parseInt(config.get('SIGNAL_MIN_CONFLUENCE', '4'));
    this.atrPeriod          = parseInt(config.get('SIGNAL_ATR_PERIOD', '14'));
    this.atrSlMultiplier    = parseFloat(config.get('SIGNAL_ATR_SL_MULTIPLIER', '1.5'));
    this.tpCount            = parseInt(config.get('SIGNAL_TP_COUNT', '5'));
    this.kucoinSpotUrl      = config.get('SIGNAL_KUCOIN_URL', 'https://api.kucoin.com');
    this.kucoinFuturesUrl   = config.get('SIGNAL_KUCOIN_FUTURES_URL', 'https://api-futures.kucoin.com');

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

    const total = this.symbols.length * this.intervals.length;
    this.logger.log(
      `[Signal] Starting ${total} scanner(s)\n` +
      `  Symbols:        ${this.symbols.join(', ')}\n` +
      `  Intervals:      ${this.intervals.join(', ')}\n` +
      `  Secondary TF:   ${this.secondaryInterval}\n` +
      `  Fast/Slow EMA:  ${this.fastEmaPeriod}/${this.slowEmaPeriod}\n` +
      `  Min confluence: ${this.minConfluenceScore}/7 | ATR×${this.atrSlMultiplier}`,
    );

    for (const symbol of this.symbols) {
      for (const interval of this.intervals) {
        const state: ScannerState = {
          symbol,
          interval,
          activeDirection:   0,
          lastSignalBarTime: null,
        };
        this.scanners.push(state);

        this.runLoop(state).catch(err =>
          this.logger.error(`[Signal][${symbol}/${interval}] Loop crashed: ${err.message}`),
        );
      }
    }

    // Retry loop — checks every 60s for undelivered webhooks
    this.startRetryLoop().catch(err =>
      this.logger.error(`[Signal] Retry loop crashed: ${err.message}`),
    );
  }

  // ─── Per-scanner loop ─────────────────────────────────────────────────────

  private async runLoop(state: ScannerState): Promise<void> {
    await this.sleepUntilNextBarClose(state.interval);

    while (true) {
      try {
        await this.checkSignal(state);
      } catch (err) {
        this.logger.error(`[Signal][${state.symbol}/${state.interval}] Check error: ${err.message}`);
      }
      await this.sleepUntilNextBarClose(state.interval);
    }
  }

  // ─── Webhook retry loop ───────────────────────────────────────────────────

  private async startRetryLoop(): Promise<void> {
    while (true) {
      await this.sleep(60_000);
      try {
        await this.retryPendingWebhooks();
      } catch (err) {
        this.logger.error(`[Signal] Retry error: ${err.message}`);
      }
    }
  }

  private async retryPendingWebhooks(): Promise<void> {
    const pending = await this.signalRepo.find({
      where: { webhookStatus: 'pending' },
    });

    if (pending.length === 0) return;

    this.logger.log(`[Signal] Retrying ${pending.length} undelivered webhook(s)...`);

    for (const record of pending) {
      const payload = this.buildPayloadFromRecord(record);
      await this.deliverWebhook(record.id, payload);
    }
  }

  // ─── Core signal logic ────────────────────────────────────────────────────

  async checkSignal(state: ScannerState): Promise<CheckResult> {
    const tag = `[${state.symbol}/${state.interval}]`;

    const [mainCandles, secCandles] = await Promise.all([
      this.fetchCandles(state.symbol, state.interval, 300),
      this.fetchCandles(state.symbol, this.secondaryInterval, 100),
    ]);

    if (mainCandles.length < 60) {
      this.logger.warn(`[Signal]${tag} Not enough main candles (${mainCandles.length}) — skipping`);
      return { triggered: false };
    }
    if (secCandles.length < 20) {
      this.logger.warn(`[Signal]${tag} Not enough secondary candles (${secCandles.length}) — skipping`);
      return { triggered: false };
    }

    const n = mainCandles.length - 2;

    const closes  = mainCandles.map(c => c.close);
    const volumes = mainCandles.map(c => c.volume);

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
      this.logger.warn(`[Signal]${tag} Indicators warming up (NaN) — skipping`);
      return { triggered: false };
    }

    const bullCross = bar.prevFastEMA <= bar.prevSlowEMA && bar.fastEMA > bar.slowEMA;
    const bearCross = bar.prevFastEMA >= bar.prevSlowEMA && bar.fastEMA < bar.slowEMA;

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

    const bullScore  = Object.values(bullFactors).filter(Boolean).length;
    const bearScore  = Object.values(bearFactors).filter(Boolean).length;
    const marketBias = this.calcMarketBias(bullScore, bearScore);

    const longSignal  = bullCross && state.activeDirection <= 0 && bullScore >= this.minConfluenceScore;
    const shortSignal = bearCross && state.activeDirection >= 0 && bearScore >= this.minConfluenceScore;

    this.logger.log(
      `[Signal]${tag} ` +
      `EMA: ${bar.fastEMA.toFixed(4)}/${bar.slowEMA.toFixed(4)} | ` +
      `Bull: ${bullScore}/7 | Bear: ${bearScore}/7 | Bias: ${marketBias.label} | ` +
      `Cross: ${bullCross ? 'BULL' : bearCross ? 'BEAR' : 'none'} | ` +
      `Signal: ${longSignal ? 'LONG' : shortSignal ? 'SHORT' : 'none'}`,
    );

    if (!longSignal && !shortSignal) return { triggered: false };

    if (state.lastSignalBarTime === bar.openTime) {
      this.logger.warn(`[Signal]${tag} Duplicate suppressed for bar ${new Date(bar.openTime).toISOString()}`);
      return { triggered: false };
    }

    const isBull     = longSignal;
    const entry      = bar.close;
    const riskAmount = bar.atr * this.atrSlMultiplier;
    const sl         = isBull ? entry - riskAmount : entry + riskAmount;
    const tp         = (mult: number) => isBull ? entry + riskAmount * mult : entry - riskAmount * mult;
    const score      = isBull ? bullScore : bearScore;
    const factors    = isBull ? bullFactors : bearFactors;

    const payload: SignalPayload = {
      event:     'trading_signal',
      signal:    isBull ? 'LONG' : 'SHORT',
      symbol:    state.symbol,
      timeframe: state.interval,
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

    // Update state before DB save so a crash can't re-trigger on next bar
    state.activeDirection   = isBull ? 1 : -1;
    state.lastSignalBarTime = bar.openTime;

    this.logger.log(
      `[Signal]${tag} *** ${payload.signal} *** | ` +
      `Entry: ${entry} | SL: ${sl.toFixed(4)} | TP1: ${tp(1).toFixed(4)} | TP5: ${tp(5).toFixed(4)} | ` +
      `Score: ${score}/7 | Bias: ${marketBias.label}`,
    );

    // Save to DB first — webhook delivery tracked via webhookStatus column
    const record = await this.signalRepo.save(
      this.signalRepo.create({
        symbol:          state.symbol,
        timeframe:       state.interval,
        signal:          payload.signal,
        barTimestamp:    bar.openTime,
        barDatetime:     new Date(bar.openTime),
        entry:           String(payload.price.entry),
        stopLoss:        String(payload.price.stopLoss),
        takeProfit1:     String(payload.price.takeProfit1),
        takeProfit2:     String(payload.price.takeProfit2),
        takeProfit3:     String(payload.price.takeProfit3),
        takeProfit4:     String(payload.price.takeProfit4),
        takeProfit5:     String(payload.price.takeProfit5),
        confluenceScore: score,
        confluencePct:   String(payload.confluence.percentage),
        biasLabel:       marketBias.label,
        biasBull:        String(marketBias.bull),
        biasBear:        String(marketBias.bear),
        webhookStatus:   'pending',
      }),
    );

    await this.deliverWebhook(record.id, payload);
    return { triggered: true, signal: payload };
  }

  // ─── Market Bias ─────────────────────────────────────────────────────────

  private calcMarketBias(bullScore: number, bearScore: number): MarketBias {
    const bull       = parseFloat(((bullScore / 7) * 100).toFixed(2));
    const bear       = parseFloat(((bearScore / 7) * 100).toFixed(2));
    const difference = parseFloat(Math.abs(bull - bear).toFixed(2));

    let label: MarketBias['label'];
    if (bull === bear)    label = 'NEUTRAL';
    else if (bull > bear) label = difference >= 40 ? 'STRONG BULL' : 'MILD BULL';
    else                  label = difference >= 40 ? 'STRONG BEAR' : 'MILD BEAR';

    return { bull, bear, difference, label };
  }

  // ─── Webhook delivery (used by both live fire and retry loop) ────────────

  private async deliverWebhook(recordId: string, payload: SignalPayload): Promise<void> {
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
      `[Signal][WEBHOOK] Sending ${payload.signal} ${payload.symbol}/${payload.timeframe} → ${this.webhookUrl}`,
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

      await this.signalRepo.update(recordId, { webhookStatus: 'delivered', webhookError: null });

      this.logger.log(
        `[Signal][WEBHOOK] Delivered — ${resp.status} ${resp.statusText} | ` +
        `Response: ${JSON.stringify(resp.data)}`,
      );
    } catch (err) {
      const status = err.response?.status;
      const body   = err.response?.data;

      await this.signalRepo.update(recordId, {
        webhookStatus: 'pending',
        webhookError:  err.message,
      });

      this.logger.error(
        `[Signal][WEBHOOK] FAILED — will retry in 60s\n` +
        `  URL:    ${this.webhookUrl}\n` +
        `  Error:  ${err.message}\n` +
        `  Status: ${status ?? 'no response'}\n` +
        `  Body:   ${JSON.stringify(body ?? null)}`,
      );
    }
  }

  // Rebuilds a SignalPayload from a saved DB record for retry delivery
  private buildPayloadFromRecord(record: TradingSignal): SignalPayload {
    return {
      event:     'trading_signal',
      signal:    record.signal as 'LONG' | 'SHORT',
      symbol:    record.symbol,
      timeframe: record.timeframe,
      timestamp: Number(record.barTimestamp),
      datetime:  record.barDatetime.toISOString(),
      price: {
        entry:       parseFloat(record.entry),
        stopLoss:    parseFloat(record.stopLoss),
        takeProfit1: parseFloat(record.takeProfit1),
        takeProfit2: parseFloat(record.takeProfit2),
        takeProfit3: parseFloat(record.takeProfit3),
        takeProfit4: parseFloat(record.takeProfit4),
        takeProfit5: parseFloat(record.takeProfit5),
      },
      risk: {
        atr:           0,
        riskAmount:    0,
        atrMultiplier: this.atrSlMultiplier,
      },
      confluence: {
        score:      record.confluenceScore,
        total:      7,
        percentage: parseFloat(record.confluencePct),
        factors: {
          aboveVwap:           false,
          rsiAligned:          false,
          macdAligned:         false,
          emaAligned:          false,
          adxWithTrend:        false,
          volumeConfirmed:     false,
          secondaryRsiAligned: false,
        },
      },
      marketBias: {
        bull:       parseFloat(record.biasBull),
        bear:       parseFloat(record.biasBear),
        difference: parseFloat(Math.abs(parseFloat(record.biasBull) - parseFloat(record.biasBear)).toFixed(2)),
        label:      record.biasLabel as MarketBias['label'],
      },
    };
  }

  // ─── KuCoin candle fetch ──────────────────────────────────────────────────

  private fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    return symbol.endsWith('.P')
      ? this.fetchFuturesCandles(symbol, interval, limit)
      : this.fetchSpotCandles(symbol, interval, limit);
  }

  // KuCoin Spot — newest-first, strings: [time(sec), open, close, high, low, volume, turnover]
  private async fetchSpotCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const kucoinSymbol   = this.toKucoinSpotSymbol(symbol);
    const kucoinInterval = KUCOIN_SPOT_INTERVAL[interval] ?? '1hour';
    const intervalSec    = this.tfToMs(interval) / 1000;
    const endAt          = Math.floor(Date.now() / 1000);
    const startAt        = endAt - limit * intervalSec;

    const resp = await axios.get<{ code: string; data: string[][] }>(
      `${this.kucoinSpotUrl}/api/v1/market/candles`,
      { params: { symbol: kucoinSymbol, type: kucoinInterval, startAt, endAt }, timeout: 10_000 },
    );

    if (resp.data.code !== '200000') {
      throw new Error(`KuCoin Spot API error: ${resp.data.code}`);
    }

    return resp.data.data.reverse().map(k => ({
      openTime: parseInt(k[0]) * 1000,
      open:     parseFloat(k[1]),
      close:    parseFloat(k[2]),
      high:     parseFloat(k[3]),
      low:      parseFloat(k[4]),
      volume:   parseFloat(k[5]),
    }));
  }

  // KuCoin Futures — oldest-first, numbers: [time(ms), open, high, low, close, volume]
  private async fetchFuturesCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const kucoinSymbol = this.toKucoinFuturesSymbol(symbol);
    const granularity  = KUCOIN_FUTURES_GRANULARITY[interval] ?? 60;
    const intervalMs   = this.tfToMs(interval);
    const to           = Date.now();
    const from         = to - limit * intervalMs;

    const resp = await axios.get<{ code: string; data: number[][] }>(
      `${this.kucoinFuturesUrl}/api/v1/kline/query`,
      { params: { symbol: kucoinSymbol, granularity, from, to }, timeout: 10_000 },
    );

    if (resp.data.code !== '200000') {
      throw new Error(`KuCoin Futures API error: ${resp.data.code} — symbol: ${kucoinSymbol}`);
    }

    return resp.data.data.map(k => ({
      openTime: k[0],
      open:     k[1],
      high:     k[2],
      low:      k[3],
      close:    k[4],
      volume:   k[5],
    }));
  }

  private toKucoinSpotSymbol(symbol: string): string {
    if (symbol.includes('-')) return symbol;
    const quotes = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'BUSD'];
    for (const q of quotes) {
      if (symbol.endsWith(q)) return `${symbol.slice(0, -q.length)}-${q}`;
    }
    return symbol;
  }

  private toKucoinFuturesSymbol(symbol: string): string {
    if (KUCOIN_FUTURES_SYMBOL_MAP[symbol]) return KUCOIN_FUTURES_SYMBOL_MAP[symbol];
    return symbol.replace('.P', '') + 'M';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private round(v: number, dp = 8): number {
    return parseFloat(v.toFixed(dp));
  }

  private tfToMs(tf: string): number {
    return TIMEFRAME_MS[tf] ?? 3_600_000;
  }

  private async sleepUntilNextBarClose(interval: string): Promise<void> {
    const intervalMs   = this.tfToMs(interval);
    const now          = Date.now();
    const msUntilClose = intervalMs - (now % intervalMs) + 5_000;
    this.logger.log(`[Signal][${interval}] Next check in ${Math.round(msUntilClose / 1000)}s`);
    await this.sleep(msUntilClose);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  // ─── Status & manual trigger (for controller) ─────────────────────────────

  getStatus() {
    return {
      scanners: this.scanners.map(s => ({
        symbol:            s.symbol,
        interval:          s.interval,
        activeDirection:   s.activeDirection === 1 ? 'LONG' : s.activeDirection === -1 ? 'SHORT' : 'NONE',
        lastSignalBarTime: s.lastSignalBarTime ? new Date(s.lastSignalBarTime).toISOString() : null,
      })),
      config: {
        secondaryInterval:  this.secondaryInterval,
        fastEmaPeriod:      this.fastEmaPeriod,
        slowEmaPeriod:      this.slowEmaPeriod,
        minConfluenceScore: this.minConfluenceScore,
        atrPeriod:          this.atrPeriod,
        atrSlMultiplier:    this.atrSlMultiplier,
        tpCount:            this.tpCount,
      },
    };
  }

  async triggerCheck(
    symbol?: string,
    interval?: string,
  ): Promise<{ scanner: string; triggered: boolean; signal?: SignalPayload }[]> {
    const targets = this.scanners.filter(s =>
      (!symbol || s.symbol === symbol) && (!interval || s.interval === interval),
    );

    if (targets.length === 0) return [];

    const results = await Promise.all(
      targets.map(async state => {
        const result = await this.checkSignal(state);
        return { scanner: `${state.symbol}/${state.interval}`, ...result };
      }),
    );

    return results;
  }
}
