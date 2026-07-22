import { Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { SignalService } from './signal.service';

@Controller('signal')
export class SignalController {
  constructor(private readonly signalService: SignalService) {}

  /** Returns current state and config for all active scanners. */
  @Get('status')
  getStatus() {
    return this.signalService.getStatus();
  }

  /**
   * Manually triggers an immediate signal check on the current closed bar.
   * Optional query params narrow the check to a specific scanner:
   *   POST /signal/trigger?symbol=BTCUSDT.P&interval=5m
   * Omit both to trigger all scanners at once.
   */
  @Post('trigger')
  @HttpCode(200)
  async trigger(
    @Query('symbol')   symbol?: string,
    @Query('interval') interval?: string,
  ) {
    return this.signalService.triggerCheck(symbol, interval);
  }
}
