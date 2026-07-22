// Pure technical indicator implementations matching TradingView Pine Script v6 behaviour.
// All functions return NaN for indices where the indicator has insufficient history.

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── EMA ───────────────────────────────────────────────────────────────────────
// Seeded with SMA of first `period` values, then exponential smoothing.
export function calcEMA(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return result;

  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  result[period - 1] = seed / period;

  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ── SMA ───────────────────────────────────────────────────────────────────────
export function calcSMA(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result[i] = sum / period;
  }
  return result;
}

// ── VWAP (daily reset at UTC midnight, matches TradingView ta.vwap) ───────────
export function calcVWAP(candles: Candle[]): number[] {
  const result = new Array<number>(candles.length).fill(NaN);
  let cumPV = 0;
  let cumVol = 0;
  let lastDay = -1;

  for (let i = 0; i < candles.length; i++) {
    const day = Math.floor(candles[i].openTime / 86_400_000);
    if (day !== lastDay) {
      cumPV = 0;
      cumVol = 0;
      lastDay = day;
    }
    const hlc3 = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPV += hlc3 * candles[i].volume;
    cumVol += candles[i].volume;
    result[i] = cumVol > 0 ? cumPV / cumVol : NaN;
  }
  return result;
}

// ── ATR (Wilder's smoothing, matches TradingView ta.atr) ─────────────────────
export function calcATR(candles: Candle[], period: number): number[] {
  const n = candles.length;
  const tr = new Array<number>(n).fill(NaN);
  const result = new Array<number>(n).fill(NaN);

  for (let i = 1; i < n; i++) {
    const { high, low } = candles[i];
    const pc = candles[i - 1].close;
    tr[i] = Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc));
  }

  if (n <= period) return result;

  // Seed: average of first `period` TR values
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i];
  result[period] = seed / period;

  // Wilder's smoothing: RMA
  for (let i = period + 1; i < n; i++) {
    result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
  }
  return result;
}

// ── RSI (Wilder's smoothing, matches TradingView ta.rsi) ─────────────────────
export function calcRSI(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return result;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain += Math.max(diff, 0);
    avgLoss += Math.max(-diff, 0);
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
  }
  return result;
}

// ── MACD (matches TradingView ta.macd) ───────────────────────────────────────
export interface MACDResult {
  macd: number[];
  signal: number[];
}

export function calcMACD(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  const fastEMA = calcEMA(closes, fast);
  const slowEMA = calcEMA(closes, slow);

  const macd = closes.map((_, i) =>
    !isNaN(fastEMA[i]) && !isNaN(slowEMA[i]) ? fastEMA[i] - slowEMA[i] : NaN,
  );

  const firstValid = macd.findIndex(v => !isNaN(v));
  const signalArr = new Array<number>(closes.length).fill(NaN);

  if (firstValid >= 0) {
    const sigSlice = calcEMA(macd.slice(firstValid), signalPeriod);
    for (let i = 0; i < sigSlice.length; i++) {
      signalArr[firstValid + i] = sigSlice[i];
    }
  }

  return { macd, signal: signalArr };
}

// ── ADX (Wilder's smoothing, matches TradingView ta.dmi) ─────────────────────
export interface ADXResult {
  adx: number[];
}

export function calcADX(candles: Candle[], period: number): ADXResult {
  const n = candles.length;
  const dmPlus  = new Array<number>(n).fill(0);
  const dmMinus = new Array<number>(n).fill(0);
  const tr      = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove   = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    dmPlus[i]  = upMove > downMove && upMove > 0 ? upMove : 0;
    dmMinus[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const { high, low } = candles[i];
    const pc = candles[i - 1].close;
    tr[i] = Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc));
  }

  // Wilder cumulative seed then rolling subtract-add
  const sTR    = new Array<number>(n).fill(NaN);
  const sPlus  = new Array<number>(n).fill(NaN);
  const sMinus = new Array<number>(n).fill(NaN);

  if (n > period) {
    let sumTR = 0, sumP = 0, sumM = 0;
    for (let i = 1; i <= period; i++) { sumTR += tr[i]; sumP += dmPlus[i]; sumM += dmMinus[i]; }
    sTR[period] = sumTR; sPlus[period] = sumP; sMinus[period] = sumM;
    for (let i = period + 1; i < n; i++) {
      sTR[i]    = sTR[i - 1]    - sTR[i - 1] / period    + tr[i];
      sPlus[i]  = sPlus[i - 1]  - sPlus[i - 1] / period  + dmPlus[i];
      sMinus[i] = sMinus[i - 1] - sMinus[i - 1] / period + dmMinus[i];
    }
  }

  const dx  = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) {
    if (sTR[i] > 0) {
      const diP = 100 * sPlus[i]  / sTR[i];
      const diM = 100 * sMinus[i] / sTR[i];
      const sum = diP + diM;
      dx[i] = sum > 0 ? 100 * Math.abs(diP - diM) / sum : 0;
    }
  }

  const adx = new Array<number>(n).fill(NaN);
  let dxSum = 0;
  let dxCount = 0;
  let firstAdx = -1;

  for (let i = period; i < n; i++) {
    if (!isNaN(dx[i])) {
      dxSum += dx[i];
      dxCount++;
      if (dxCount === period) {
        adx[i] = dxSum / period;
        firstAdx = i;
        break;
      }
    }
  }

  if (firstAdx >= 0) {
    for (let i = firstAdx + 1; i < n; i++) {
      adx[i] = !isNaN(dx[i])
        ? (adx[i - 1] * (period - 1) + dx[i]) / period
        : adx[i - 1];
    }
  }

  return { adx };
}
