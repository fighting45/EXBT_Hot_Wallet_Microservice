import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradingSignal } from '../../entities';
import { SignalService } from './signal.service';
import { SignalController } from './signal.controller';

@Module({
  imports:     [ConfigModule, TypeOrmModule.forFeature([TradingSignal])],
  providers:   [SignalService],
  controllers: [SignalController],
})
export class SignalModule {}
