import { Controller, Post, Get, Body, Param, Query, HttpCode, UseGuards } from '@nestjs/common';
import { ServiceTokenGuard } from './guards/service-token.guard';
import { OrderService } from './order.service';
import { BalanceService } from './balance.service';
import { KucoinMapper } from './mappers/kucoin.mapper';
import { PlaceOrderDto, CancelOrderDto, AccountFundingDto } from './dto/trading.dto';

/**
 * Money-moving EXBT-USDT trading + account endpoints for the Laravel backend.
 * All routes require a valid inbound HMAC (ServiceTokenGuard). Responses are KuCoin-shaped.
 */
@Controller('api/trading')
@UseGuards(ServiceTokenGuard)
export class TradingController {
  constructor(
    private orders: OrderService,
    private balances: BalanceService,
  ) {}

  // ─── Orders ──────────────────────────────────────────────────────────────────

  @Post('orders')
  @HttpCode(200)
  async place(@Body() dto: PlaceOrderDto) {
    const order = await this.orders.place({
      userId: dto.user_id,
      symbol: dto.symbol,
      side: dto.side,
      type: dto.type,
      price: dto.price,
      size: dto.size,
    });
    return KucoinMapper.wrap({ orderId: order.id, status: order.status });
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    const order = await this.orders.cancel(id, dto.user_id);
    return KucoinMapper.wrap({ orderId: order.id, status: order.status });
  }

  @Get('orders/:id')
  async getOrder(@Param('id') id: string) {
    const o = await this.orders.getOrder(id);
    return KucoinMapper.wrap(KucoinMapper.order(o));
  }

  @Get('orders')
  async listOrders(@Query('user_id') userId: string, @Query('status') status?: 'open' | 'done') {
    const list = await this.orders.listOrders(parseInt(userId, 10), status);
    return KucoinMapper.wrap({ items: list.map(o => KucoinMapper.order(o)) });
  }

  // ─── Accounts ────────────────────────────────────────────────────────────────

  @Get('accounts/:user_id')
  async accounts(@Param('user_id') userId: string) {
    const balances = await this.balances.getBalances(parseInt(userId, 10));
    return KucoinMapper.wrap(balances);
  }

  @Post('accounts/credit')
  @HttpCode(200)
  async credit(@Body() dto: AccountFundingDto) {
    const row = await this.balances.credit(dto.user_id, dto.asset, dto.amount);
    return KucoinMapper.wrap({ asset: row.asset, available: row.available, locked: row.locked });
  }

  @Post('accounts/debit')
  @HttpCode(200)
  async debit(@Body() dto: AccountFundingDto) {
    const row = await this.balances.debit(dto.user_id, dto.asset, dto.amount);
    return KucoinMapper.wrap({ asset: row.asset, available: row.available, locked: row.locked });
  }
}
