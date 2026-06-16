import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradingPair, TradeOrder, TradeFill, TradeBalance } from '../../entities';
import { LbankClient } from './lbank/lbank.client';
import { LbankWsClient } from './lbank/lbank-ws.client';
import { MarketDataService } from './market-data.service';
import { BalanceService } from './balance.service';
import { OrderService } from './order.service';
import { ReconciliationService } from './reconciliation.service';
import { TradingWebhookService } from './trading-webhook.service';
import { MarketController } from './market.controller';
import { TradingController } from './trading.controller';

/**
 * EXBT/USDT trading pair — LBank brokerage connector. Self-contained; does not touch the
 * existing wallet/listener/sweeper/withdrawal modules.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TradingPair, TradeOrder, TradeFill, TradeBalance])],
  controllers: [MarketController, TradingController],
  providers: [
    LbankClient,
    LbankWsClient,
    MarketDataService,
    BalanceService,
    OrderService,
    ReconciliationService,
    TradingWebhookService,
  ],
  exports: [MarketDataService, OrderService, BalanceService],
})
export class TradingModule {}
