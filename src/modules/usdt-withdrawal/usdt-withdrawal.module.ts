import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsdtWithdrawal } from '../../entities';
import { UsdtWithdrawalService } from './usdt-withdrawal.service';
import { UsdtWithdrawalController } from './usdt-withdrawal.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UsdtWithdrawal])],
  providers: [UsdtWithdrawalService],
  controllers: [UsdtWithdrawalController],
})
export class UsdtWithdrawalModule {}
