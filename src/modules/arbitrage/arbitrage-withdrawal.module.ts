import { Module } from '@nestjs/common';
import { ArbitrageWithdrawalService } from './arbitrage-withdrawal.service';
import { ArbitrageWithdrawalController } from './arbitrage-withdrawal.controller';

@Module({
  providers:   [ArbitrageWithdrawalService],
  controllers: [ArbitrageWithdrawalController],
})
export class ArbitrageWithdrawalModule {}
