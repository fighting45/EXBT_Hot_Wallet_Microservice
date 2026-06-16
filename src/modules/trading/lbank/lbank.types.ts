// Raw LBank API response/types. LBank v2 REST returns either a bare payload (market
// endpoints) or an envelope { result: 'true'|true, data, error_code, msg } (most v2).

export interface LbankEnvelope<T> {
  result: boolean | string;
  data?: T;
  error_code?: number;
  msg?: string;
  ts?: number;
}

export interface LbankTicker {
  symbol: string;
  ticker: {
    high: number;
    low: number;
    latest: number;
    vol: number;
    turnover: number;
    change: number; // 24h % change
  };
  timestamp: number;
}

export interface LbankDepth {
  asks: [number, number][]; // [price, amount], best ask first
  bids: [number, number][]; // [price, amount], best bid first
  timestamp?: number;
}

// kline: [timestamp(sec), open, high, low, close, volume]
export type LbankKline = [number, number, number, number, number, number];

export interface LbankTrade {
  date_ms: number;
  amount: number;
  price: number;
  type: 'buy' | 'sell' | 'buy_market' | 'sell_market';
  tid: string;
}

export interface LbankAccuracy {
  symbol: string;
  quantityAccuracy: string;
  priceAccuracy: string;
  minTranQua?: string;
}

export interface LbankCreateOrderResult {
  symbol: string;
  order_id: string;
}

export interface LbankOrderInfo {
  symbol: string;
  order_id: string;
  type: string;          // buy | sell | buy_market | sell_market
  price: number;
  amount: number;        // requested base amount (or quote for market buy)
  deal_amount: number;   // filled base amount
  avg_price: number;
  status: number;        // -1 cancelled, 0 unfilled, 1 partial, 2 filled, 4 cancelling
  create_time: number;
}

export type LbankSide = 'buy' | 'sell' | 'buy_market' | 'sell_market';

export class LbankApiError extends Error {
  constructor(public errorCode: number | undefined, message: string) {
    super(message);
    this.name = 'LbankApiError';
  }
}
