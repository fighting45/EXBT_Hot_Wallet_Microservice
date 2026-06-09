import { Controller, Post, Get, Body, Param, HttpCode, NotFoundException } from '@nestjs/common';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalRequestDto } from './dto/withdrawal.dto';

@Controller('api/withdrawal')
export class WithdrawalController {
  constructor(private withdrawalService: WithdrawalService) {}

  @Post('request')
  @HttpCode(202)
  async request(@Body() dto: WithdrawalRequestDto) {
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
