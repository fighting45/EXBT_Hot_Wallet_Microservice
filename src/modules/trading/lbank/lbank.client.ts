import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import {
  LbankApiError,
  LbankTicker,
  LbankDepth,
  LbankKline,
  LbankTrade,
  LbankAccuracy,
  LbankCreateOrderResult,
  LbankOrderInfo,
  LbankSide,
} from './lbank.types';

/**
 * Low-level signed REST client for the LBank v2 API.
 *
 * Market endpoints are public (no signature). Private endpoints (orders, account)
 * are signed against the Exbotix LBank master account credentials.
 *
 * Signing (v2):
 *   1. Collect business params + { api_key, signature_method, timestamp(ms), echostr }.
 *   2. Sort keys ascending → "k=v&k=v" → MD5, uppercased = prepareStr.
 *   3. HmacSHA256: sign = hex( HMAC-SHA256(prepareStr, secret) )
 *      RSA:        sign = base64( RSA-SHA256(prepareStr, pemPrivateKey) )
 *   4. POST all params + sign as application/x-www-form-urlencoded.
 *
 * NOTE: LBank's public docs are thin on the exact signing byte-order. Validate with a
 * `userInfo()` smoke test before placing real orders (see plan verification step 4).
 */
@Injectable()
export class LbankClient {
  private _http: AxiosInstance;

  constructor(private config: ConfigService) {}

  private get http(): AxiosInstance {
    if (!this._http) {
      this._http = axios.create({
        baseURL: this.config.get<string>('LBANK_API_BASE', 'https://api.lbkex.com'),
        timeout: 15000,
      });
    }
    return this._http;
  }

  private get apiKey(): string {
    return this.config.get<string>('LBANK_API_KEY', '');
  }

  private get apiSecret(): string {
    return this.config.get<string>('LBANK_API_SECRET', '');
  }

  private get signMethod(): string {
    return this.config.get<string>('LBANK_SIGN_METHOD', 'HmacSHA256');
  }

  hasCredentials(): boolean {
    return !!this.apiKey && !!this.apiSecret;
  }

  // ─── Signing ───────────────────────────────────────────────────────────────

  private randomEchostr(len = 35): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    const bytes = crypto.randomBytes(len);
    for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
    return out;
  }

  private buildSignedBody(params: Record<string, string | number>): URLSearchParams {
    const signMethod = this.signMethod;
    const all: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) all[k] = String(v);
    }
    all.api_key         = this.apiKey;
    all.signature_method = signMethod;
    all.timestamp       = String(Date.now());
    all.echostr         = this.randomEchostr();

    const prepareStr = Object.keys(all)
      .sort()
      .map(k => `${k}=${all[k]}`)
      .join('&');

    const md5 = crypto.createHash('md5').update(prepareStr, 'utf8').digest('hex').toUpperCase();

    let sign: string;
    if (signMethod === 'RSA') {
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(md5, 'utf8');
      sign = signer.sign(this.normalizeRsaKey(this.apiSecret), 'base64');
    } else {
      sign = crypto.createHmac('sha256', this.apiSecret).update(md5, 'utf8').digest('hex');
    }

    const body = new URLSearchParams(all);
    body.append('sign', sign);
    return body;
  }

  private normalizeRsaKey(secret: string): string {
    if (secret.includes('BEGIN')) return secret;
    return `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`;
  }

  // ─── Transport ───────────────────────────────────────────────────────────────

  private unwrap<T>(data: any): T {
    // Market endpoints often return the payload directly; v2 private/most endpoints
    // wrap it in { result, data, error_code, msg }.
    if (data && typeof data === 'object' && 'result' in data) {
      const ok = data.result === true || data.result === 'true';
      if (!ok) {
        throw new LbankApiError(data.error_code, data.msg || `LBank error_code ${data.error_code}`);
      }
      return (data.data !== undefined ? data.data : data) as T;
    }
    return data as T;
  }

  private async get<T>(path: string, params: Record<string, any>): Promise<T> {
    try {
      const res = await this.http.get(path, { params });
      return this.unwrap<T>(res.data);
    } catch (err) {
      throw this.toError(err, path);
    }
  }

  private async signedPost<T>(path: string, params: Record<string, string | number>): Promise<T> {
    if (!this.hasCredentials()) {
      throw new LbankApiError(undefined, 'LBANK_API_KEY/LBANK_API_SECRET are not configured');
    }
    try {
      const body = this.buildSignedBody(params);
      const res = await this.http.post(path, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return this.unwrap<T>(res.data);
    } catch (err) {
      throw this.toError(err, path);
    }
  }

  private toError(err: any, path: string): Error {
    if (err instanceof LbankApiError) return err;
    const body = err.response?.data;
    if (body && typeof body === 'object' && 'error_code' in body) {
      return new LbankApiError(body.error_code, `${path}: ${body.msg || 'LBank error'} (${body.error_code})`);
    }
    return new LbankApiError(undefined, `${path}: ${err.message}`);
  }

  // ─── Market (public) ─────────────────────────────────────────────────────────

  ticker(symbol: string): Promise<LbankTicker | LbankTicker[]> {
    return this.get<LbankTicker | LbankTicker[]>('/v2/ticker/24hr.do', { symbol });
  }

  depth(symbol: string, size = 60): Promise<LbankDepth> {
    return this.get<LbankDepth>('/v2/depth.do', { symbol, size });
  }

  kline(symbol: string, size: number, type: string, time: number): Promise<LbankKline[]> {
    return this.get<LbankKline[]>('/v2/kline.do', { symbol, size, type, time });
  }

  trades(symbol: string, size = 100, time?: number): Promise<LbankTrade[]> {
    const params: Record<string, any> = { symbol, size };
    if (time) params.time = time;
    return this.get<LbankTrade[]>('/v2/trades.do', params);
  }

  accuracy(): Promise<LbankAccuracy[]> {
    return this.get<LbankAccuracy[]>('/v2/accuracy.do', {});
  }

  currencyPairs(): Promise<string[]> {
    return this.get<string[]>('/v2/currencyPairs.do', {});
  }

  // ─── Private (signed) ──────────────────────────────────────────────────────

  /**
   * Create an order on the master account.
   * For limit: pass price + amount (base). For market buy: type=buy_market, amount=quote(USDT).
   * For market sell: type=sell_market, amount=base.
   */
  createOrder(args: {
    symbol: string;
    type: LbankSide;
    amount: number | string;
    price?: number | string;
  }): Promise<LbankCreateOrderResult> {
    const params: Record<string, string | number> = {
      symbol: args.symbol,
      type: args.type,
      amount: String(args.amount),
    };
    if (args.price !== undefined) params.price = String(args.price);
    return this.signedPost<LbankCreateOrderResult>('/v2/create_order.do', params);
  }

  cancelOrder(symbol: string, orderId: string): Promise<any> {
    return this.signedPost('/v2/cancel_order.do', { symbol, order_id: orderId });
  }

  /** Query one or more orders by id (comma-separated, up to 3). */
  ordersInfo(symbol: string, orderId: string): Promise<LbankOrderInfo | LbankOrderInfo[]> {
    return this.signedPost<LbankOrderInfo | LbankOrderInfo[]>('/v2/orders_info.do', {
      symbol,
      order_id: orderId,
    });
  }

  /** Open (not fully filled) orders, paginated. */
  openOrders(symbol: string, currentPage = 1, pageLength = 100): Promise<LbankOrderInfo[]> {
    return this.signedPost<LbankOrderInfo[]>('/v2/orders_info_no_deal.do', {
      symbol,
      current_page: currentPage,
      page_length: pageLength,
    });
  }

  /** Master account balances. */
  userInfo(): Promise<any> {
    return this.signedPost('/v2/user_info.do', {});
  }
}
