import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { SweeperService } from './sweeper.service';
import { EstimateSweepDto, ExecuteSweepDto } from './dto/sweeper.dto';

@Controller('api/sweeper')
export class SweeperController {
  constructor(private sweeperService: SweeperService) {}

  @Post('estimate')
  estimate(@Body() dto: EstimateSweepDto) {
    return this.sweeperService.estimateSweep(dto.encrypted_mnemonic, dto.min_balance);
  }

  @Post('execute')
  execute(@Body() dto: ExecuteSweepDto) {
    return this.sweeperService.executeSweep(dto.encrypted_mnemonic, dto.min_balance);
  }

  @Get('hot-wallet/balance')
  hotWalletBalance() {
    return this.sweeperService.getHotWalletBalance();
  }

  @Get('status/:txHash')
  status(@Param('txHash') txHash: string) {
    return this.sweeperService.getSweepStatus(txHash);
  }
}
