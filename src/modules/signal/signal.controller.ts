import { Controller, Get, Post, HttpCode } from '@nestjs/common';
import { SignalService } from './signal.service';

@Controller('signal')
export class SignalController {
  constructor(private readonly signalService: SignalService) {}

  /** Returns current scanner state and configuration. */
  @Get('status')
  getStatus() {
    return this.signalService.getStatus();
  }

  /**
   * Manually triggers an immediate signal check on the current closed bar.
   * Useful for testing the strategy logic and webhook delivery without waiting
   * for the next bar close.
   */
  @Post('trigger')
  @HttpCode(200)
  async trigger() {
    const result = await this.signalService.checkSignal();
    return {
      triggered: result.triggered,
      signal:    result.signal ?? null,
    };
  }
}
