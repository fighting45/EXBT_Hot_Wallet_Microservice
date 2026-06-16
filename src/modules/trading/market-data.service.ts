import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LbankClient } from './lbank/lbank.client';
import { KucoinMapper } from './mappers/kucoin.mapper';
import { TradingPair } from '../../entities';
import { LbankTicker } from './lbank/lbank.types';

interface CacheEntry { value: any; expires: number; }

/**
 * Serves EXBT-USDT market data sourced from LBank, reshaped to KuCoin format.
 * Ticker/orderbook are cached briefly to absorb UI polling without hammering LBank.
 */
@Injectable()
export class MarketDataService {
  private cache = new Map<string, CacheEntry>();
  private liveDepth = new Map<string, { value: LbankDepth; ts: number }>();
  private readonly TICKER_TTL = 1500;
  private readonly DEPTH_TTL = 1000;
  private readonly LIVE_DEPTH_TTL = 3000;

  constructor(
    private lbank: LbankClient,
    @InjectRepository(TradingPair)
    private pairRepo: Repository<TradingPair>,
  ) {}

  private async cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await fn();
    this.cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  }

  /** Resolve a KuCoin-style symbol (EXBT-USDT) to its enabled pair config. */
  async resolvePair(symbol: string): Promise<TradingPair> {
    const pair = await this.pairRepo.findOne({ where: { symbol: symbol.toUpperCase() } });
    if (!pair || !pair.enabled) throw new NotFoundException(`Trading pair ${symbol} not available`);
    return pair;
  }

  async getSymbols(): Promise<any> {
    const pairs = await this.pairRepo.find({ where: { enabled: true } });
    return KucoinMapper.wrap(pairs.map(p => KucoinMapper.symbol(p)));
  }

  async getTicker(symbol: string): Promise<any> {
    const pair = await this.resolvePair(symbol);
    const [ticker, depth] = await Promise.all([
      this.cached(`ticker:${pair.lbankSymbol}`, this.TICKER_TTL, async () => {
        const res = await this.lbank.ticker(pair.lbankSymbol);
        return Array.isArray(res) ? res[0] : res;
      }) as Promise<LbankTicker>,
      this.cached(`depth1:${pair.lbankSymbol}`, this.DEPTH_TTL, () => this.lbank.depth(pair.lbankSymbol, 1)),
    ]);
    return KucoinMapper.wrap(KucoinMapper.ticker(pair.symbol, ticker, depth));
  }

  async getOrderbook(symbol: string, depth = 20): Promise<any> {
    const pair = await this.resolvePair(symbol);
    const size = Math.min(Math.max(depth, 1), 60);

    // Prefer a fresh WebSocket-pushed book if available; fall back to cached REST.
    const live = this.liveDepth.get(pair.lbankSymbol);
    const book = live && Date.now() - live.ts < this.LIVE_DEPTH_TTL
      ? { asks: live.value.asks.slice(0, size), bids: live.value.bids.slice(0, size), timestamp: live.ts }
      : await this.cached(`depth:${pair.lbankSymbol}:${size}`, this.DEPTH_TTL, () =>
          this.lbank.depth(pair.lbankSymbol, size),
        );
    return KucoinMapper.wrap(KucoinMapper.orderbook(book));
  }

  /** Push a real-time order book snapshot from the WebSocket feed. */
  setLiveDepth(lbankSymbol: string, depth: LbankDepth): void {
    this.liveDepth.set(lbankSymbol, { value: depth, ts: Date.now() });
  }

  async getKlines(symbol: string, type = '1min', size = 200, time?: number): Promise<any> {
    const pair = await this.resolvePair(symbol);
    const lbankType = KucoinMapper.klineType(type);
    const bars = Math.min(Math.max(size, 1), 2000);
    // LBank requires a `time` (start, unix seconds). Default: window back from now.
    const startTime = time ?? Math.floor(Date.now() / 1000) - bars * this.barSeconds(lbankType);
    const rows = await this.lbank.kline(pair.lbankSymbol, bars, lbankType, startTime);
    return KucoinMapper.wrap(KucoinMapper.klines(rows));
  }

  async getTrades(symbol: string, size = 100): Promise<any> {
    const pair = await this.resolvePair(symbol);
    const rows = await this.lbank.trades(pair.lbankSymbol, Math.min(Math.max(size, 1), 600));
    return KucoinMapper.wrap(KucoinMapper.trades(rows));
  }

  private barSeconds(lbankType: string): number {
    const map: Record<string, number> = {
      minute1: 60, minute5: 300, minute15: 900, minute30: 1800,
      hour1: 3600, hour4: 14400, hour8: 28800, hour12: 43200,
      day1: 86400, week1: 604800, month1: 2592000,
    };
    return map[lbankType] ?? 60;
  }
}
