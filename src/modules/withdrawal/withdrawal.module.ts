import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Withdrawal } from '../../entities';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalController } from './withdrawal.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Withdrawal])],
  providers: [WithdrawalService],
  controllers: [WithdrawalController],
})
export class WithdrawalModule {}
