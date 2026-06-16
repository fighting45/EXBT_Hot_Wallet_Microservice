import { TradingPair } from '../../../entities';
import { LbankTicker, LbankDepth, LbankKline, LbankTrade, LbankOrderInfo } from '../lbank/lbank.types';

/**
 * Translates LBank payloads into KuCoin-spot-compatible shapes so the Exbotix Laravel
 * backend can treat EXBT-USDT identically to every other (KuCoin) spot pair.
 *
 * KuCoin convention: external symbols are BASE-QUOTE (e.g. EXBT-USDT); LBank uses
 * lowercase base_quote (e.g. exbt_usdt). Responses are wrapped in { code, data }.
 */
export class KucoinMapper {
  static readonly OK = '200000';

  static wrap<T>(data: T): { code: string; data: T } {
    return { code: KucoinMapper.OK, data };
  }

  static toLbankSymbol(symbol: string): string {
    return symbol.replace('-', '_').toLowerCase();
  }

  static toKucoinSymbol(lbankSymbol: string): string {
    return lbankSymbol.replace('_', '-').toUpperCase();
  }

  // KuCoin kline type → LBank kline type
  static klineType(kucoinType: string): string {
    const map: Record<string, string> = {
      '1min': 'minute1',
      '5min': 'minute5',
      '15min': 'minute15',
      '30min': 'minute30',
      '1hour': 'hour1',
      '4hour': 'hour4',
      '8hour': 'hour8',
      '12hour': 'hour12',
      '1day': 'day1',
      '1week': 'week1',
    };
    return map[kucoinType] || 'minute1';
  }

  // ─── Symbols ─────────────────────────────────────────────────────────────────

  static symbol(pair: TradingPair): any {
    const priceIncrement = KucoinMapper.increment(pair.pricePrecision);
    const baseIncrement = KucoinMapper.increment(pair.amountPrecision);
    return {
      symbol: pair.symbol,
      name: pair.symbol,
      baseCurrency: pair.baseAsset,
      quoteCurrency: pair.quoteAsset,
      feeCurrency: pair.quoteAsset,
      market: pair.quoteAsset,
      baseMinSize: pair.minAmount,
      quoteMinSize: pair.minFunds,
      baseMaxSize: '10000000000',
      quoteMaxSize: '99999999',
      baseIncrement,
      quoteIncrement: priceIncrement,
      priceIncrement,
      priceLimitRate: '0.1',
      enableTrading: pair.enabled,
      isMarginEnabled: false,
    };
  }

  private static increment(precision: number): string {
    if (precision <= 0) return '1';
    return '0.' + '0'.repeat(precision - 1) + '1';
  }

  // ─── Ticker (KuCoin /market/stats shape) ─────────────────────────────────────

  static ticker(symbol: string, t: LbankTicker, depth?: LbankDepth): any {
    const bestBid = depth?.bids?.[0]?.[0];
    const bestAsk = depth?.asks?.[0]?.[0];
    return {
      symbol,
      time: t.timestamp ?? Date.now(),
      buy: bestBid !== undefined ? String(bestBid) : null,
      sell: bestAsk !== undefined ? String(bestAsk) : null,
      last: String(t.ticker.latest),
      high: String(t.ticker.high),
      low: String(t.ticker.low),
      vol: String(t.ticker.vol),
      volValue: String(t.ticker.turnover),
      // LBank `change` is a percent (e.g. 5.2 → 5.2%); KuCoin changeRate is a fraction.
      changeRate: String((t.ticker.change ?? 0) / 100),
      changePrice: null,
      averagePrice: null,
    };
  }

  // ─── Orderbook (KuCoin level2 shape) ─────────────────────────────────────────

  static orderbook(d: LbankDepth): any {
    return {
      time: d.timestamp ?? Date.now(),
      sequence: String(d.timestamp ?? Date.now()),
      bids: (d.bids || []).map(([p, s]) => [String(p), String(s)]),
      asks: (d.asks || []).map(([p, s]) => [String(p), String(s)]),
    };
  }

  // ─── Klines (KuCoin /market/candles shape) ───────────────────────────────────
  // KuCoin candle: [time(sec), open, close, high, low, volume, turnover], newest first.
  static klines(rows: LbankKline[]): string[][] {
    return (rows || [])
      .map(([ts, open, high, low, close, volume]) => [
        String(ts),
        String(open),
        String(close),
        String(high),
        String(low),
        String(volume),
        String(volume), // turnover not provided by LBank kline; reuse volume as best-effort
      ])
      .reverse();
  }

  // ─── Trades (KuCoin /market/histories shape) ─────────────────────────────────

  static trades(rows: LbankTrade[]): any[] {
    return (rows || []).map(tr => ({
      sequence: String(tr.tid),
      time: tr.date_ms * 1_000_000, // KuCoin uses nanoseconds
      price: String(tr.price),
      size: String(tr.amount),
      side: tr.type.startsWith('buy') ? 'buy' : 'sell',
    }));
  }

  // ─── Order (KuCoin order detail shape) ───────────────────────────────────────

  static order(o: {
    id: string;
    userId: number;
    symbol: string;
    side: string;
    type: string;
    price: string;
    amount: string;
    filledAmount: string;
    avgPrice: string;
    fee: string;
    status: string;
    createdAt: Date;
  }): any {
    const active = o.status === 'open' || o.status === 'pending' || o.status === 'partially_filled';
    return {
      id: o.id,
      symbol: o.symbol,
      type: o.type,
      side: o.side,
      price: o.price ?? '0',
      size: o.amount,
      dealSize: o.filledAmount,
      dealFunds: o.avgPrice && o.filledAmount
        ? String(Number(o.avgPrice) * Number(o.filledAmount))
        : '0',
      fee: o.fee,
      status: o.status,
      isActive: active,
      cancelExist: o.status === 'canceled',
      createdAt: o.createdAt ? new Date(o.createdAt).getTime() : Date.now(),
    };
  }

  /** Map LBank numeric order status → internal order status string. */
  static lbankStatus(status: number): string {
    switch (status) {
      case -1: return 'canceled';
      case 0: return 'open';
      case 1: return 'partially_filled';
      case 2: return 'filled';
      case 4: return 'open'; // cancelling
      default: return 'open';
    }
  }
}
