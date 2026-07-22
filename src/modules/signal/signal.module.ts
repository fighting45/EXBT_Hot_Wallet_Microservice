import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SignalService } from './signal.service';
import { SignalController } from './signal.controller';

@Module({
  imports:     [ConfigModule],
  providers:   [SignalService],
  controllers: [SignalController],
})
export class SignalModule {}
