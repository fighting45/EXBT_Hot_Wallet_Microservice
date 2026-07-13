import { Controller, Post, Body, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArbitrageWithdrawalService } from './arbitrage-withdrawal.service';
import { ArbitrageWithdrawalDto } from './dto/arbitrage-withdrawal.dto';

@Controller('api/arbitrage')
export class ArbitrageWithdrawalController {
  constructor(
    private arbitrageService: ArbitrageWithdrawalService,
    private configService: ConfigService,
  ) {}

  @Post('usdt-withdrawal')
  @HttpCode(200)
  async withdraw(@Body() dto: ArbitrageWithdrawalDto) {
    if (this.configService.get<string>('ARBITRAGE_WITHDRAWAL_ENABLED') === 'false') {
      throw new ServiceUnavailableException(
        'Arbitrage USDT withdrawals are currently disabled.',
      );
    }

    return this.arbitrageService.sendUsdt(dto.to_address, dto.amount);
  }
}
