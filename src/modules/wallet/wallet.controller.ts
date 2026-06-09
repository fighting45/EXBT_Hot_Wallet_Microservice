import { Controller, Post, Get, Body, HttpCode } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { ListenerService } from '../listener/listener.service';
import { GetAddressDto, ValidateAddressDto, ValidateMnemonicDto } from './dto/wallet.dto';

@Controller('api/wallet')
export class WalletController {
  constructor(
    private walletService: WalletService,
    private listenerService: ListenerService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', ts: new Date().toISOString(), service: 'exbt-wallet-service' };
  }

  /**
   * Generate a unique EVM address for a user.
   * Same interface as TRX wallet — Laravel sends encrypted_mnemonic + index + user_id.
   */
  @Post('get-address')
  async getAddress(@Body() dto: GetAddressDto) {
    const { walletAddress, isNew } = await this.walletService.getOrCreateAddress(
      dto.encrypted_mnemonic,
      dto.user_id,
      dto.index,
    );

    // Register with listener so deposits are monitored immediately
    if (isNew) {
      this.listenerService.registerAddress(dto.user_id, walletAddress.address);
    }

    return {
      success:          true,
      address:          walletAddress.address,
      index:            walletAddress.derivationIndex,
      derivation_path:  `m/44'/60'/0'/0/${walletAddress.derivationIndex}`,
      user_id:          dto.user_id,
      is_new:           isNew,
      monitoring:       true,
    };
  }

  @Post('validate-address')
  @HttpCode(200)
  validateAddress(@Body() dto: ValidateAddressDto) {
    return {
      address: dto.address,
      valid:   this.walletService.isValidAddress(dto.address),
    };
  }

  @Post('validate-mnemonic')
  @HttpCode(200)
  validateMnemonic(@Body() dto: ValidateMnemonicDto) {
    return {
      valid: this.walletService.validateMnemonic(dto.mnemonic),
    };
  }

  @Post('generate-mnemonic')
  @HttpCode(200)
  generateMnemonic() {
    return {
      mnemonic: this.walletService.generateMnemonic(),
      words:    12,
    };
  }
}
