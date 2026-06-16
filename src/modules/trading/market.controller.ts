import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { MarketDataService } from './market-data.service';

/**
 * Public EXBT-USDT market data, KuCoin-shaped. No auth — read-only.
 */
@Controller('api/trading')
export class MarketController {
  constructor(private marketData: MarketDataService) {}

  @Get('symbols')
  symbols() {
    return this.marketData.getSymbols();
  }

  @Get('ticker')
  ticker(@Query('symbol') symbol: string) {
    this.requireSymbol(symbol);
    return this.marketData.getTicker(symbol);
  }

  @Get('orderbook')
  orderbook(@Query('symbol') symbol: string, @Query('depth') depth?: string) {
    this.requireSymbol(symbol);
    return this.marketData.getOrderbook(symbol, depth ? parseInt(depth, 10) : 20);
  }

  @Get('klines')
  klines(
    @Query('symbol') symbol: string,
    @Query('type') type?: string,
    @Query('size') size?: string,
    @Query('startAt') startAt?: string,
  ) {
    this.requireSymbol(symbol);
    return this.marketData.getKlines(
      symbol,
      type || '1min',
      size ? parseInt(size, 10) : 200,
      startAt ? parseInt(startAt, 10) : undefined,
    );
  }

  @Get('trades')
  trades(@Query('symbol') symbol: string, @Query('size') size?: string) {
    this.requireSymbol(symbol);
    return this.marketData.getTrades(symbol, size ? parseInt(size, 10) : 100);
  }

  private requireSymbol(symbol: string) {
    if (!symbol) throw new BadRequestException('symbol query param is required (e.g. EXBT-USDT)');
  }
}
