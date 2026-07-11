import { Controller, Post, Get, Body, Param, HttpCode, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalRequestDto } from './dto/withdrawal.dto';

@Controller('api/withdrawal')
export class WithdrawalController {
  constructor(
    private withdrawalService: WithdrawalService,
    private configService: ConfigService,
  ) {}

  @Post('request')
  @HttpCode(202)
  async request(@Body() dto: WithdrawalRequestDto) {
    if (this.configService.get<string>('WITHDRAWAL_ENABLED') === 'false') {
      throw new ServiceUnavailableException(
        'Withdrawals are currently disabled due to maintenance work. Please try again later.',
      );
    }

    const withdrawal = await this.withdrawalService.request(
      dto.user_id,
      dto.to_address,
      dto.amount,
    );
    return { withdrawal_id: withdrawal.id, status: withdrawal.status };
  }

  @Get(':id/status')
  async status(@Param('id') id: string) {
    const withdrawal = await this.withdrawalService.getStatus(id);
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    return withdrawal;
  }
}
