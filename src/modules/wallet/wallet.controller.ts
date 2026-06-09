import { Controller, Post, Get, Body, HttpCode } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { ListenerService } from '../listener/listener.service';
import { EncryptionService } from '../encryption/encryption.service';
import { ConfigService } from '@nestjs/config';
import { GetAddressDto, ValidateAddressDto, ValidateMnemonicDto } from './dto/wallet.dto';


@Controller('api/wallet')
export class WalletController {
  constructor(
    private walletService: WalletService,
    private listenerService: ListenerService,
    private encryptionService: EncryptionService,
    private configService: ConfigService,
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
    try {
      const { walletAddress, isNew } = await this.walletService.getOrCreateAddress(
        dto.encrypted_mnemonic,
        dto.user_id,
        dto.user_id,  // index = user_id
      );

      if (isNew) {
        this.listenerService.registerAddress(dto.user_id, walletAddress.address);
      }

      return {
        success:         true,
        address:         walletAddress.address,
        index:           walletAddress.derivationIndex,
        derivation_path: `m/44'/60'/0'/0/${walletAddress.derivationIndex}`,
        user_id:         dto.user_id,
        is_new:          isNew,
        monitoring:      true,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
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

  /**
   * Generate a new mnemonic and return it encrypted.
   * Laravel calls this once per user on registration.
   * Laravel stores encrypted_mnemonic in its DB.
   * Laravel shows plain mnemonic to user as backup phrase — never stores it plain.
   */
  /**
   * ONE-TIME platform setup call.
   * Generates a mnemonic, encrypts it immediately, returns only the encrypted blob.
   * Plain mnemonic is never exposed. Laravel stores the blob and sends it
   * back on every get-address call.
   */
  @Post('generate-mnemonic')
  @HttpCode(200)
  generateMnemonic() {
    const mnemonic          = this.walletService.generateMnemonic();
    const masterPassword    = this.configService.get<string>('MASTER_PASSWORD');
    const encryptedMnemonic = this.encryptionService.encrypt(mnemonic, masterPassword);

    return {
      encrypted_mnemonic: encryptedMnemonic,
    };
  }
}
