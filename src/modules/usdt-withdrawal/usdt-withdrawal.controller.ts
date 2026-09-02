import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsdtWithdrawalService } from './usdt-withdrawal.service';
import { UsdtWithdrawalRequestDto } from './dto/usdt-withdrawal.dto';

@Controller('api/usdt-withdrawal')
export class UsdtWithdrawalController {
  constructor(
    private service: UsdtWithdrawalService,
    private configService: ConfigService,
  ) {}

  @Post('request')
  @HttpCode(202)
  async request(@Body() dto: UsdtWithdrawalRequestDto) {
    if (this.configService.get<string>('USDT_WITHDRAWAL_ENABLED') === 'false') {
      throw new ServiceUnavailableException(
        'USDT withdrawals are currently disabled. Please try again later.',
      );
    }

    const record = await this.service.request(dto.to_address, dto.amount);
    return { withdrawal_id: record.id, status: record.status };
  }

  @Get(':id/status')
  async status(@Param('id') id: string) {
    return this.service.getStatus(id);
  }
}
