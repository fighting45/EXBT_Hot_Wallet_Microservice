import { WalletService } from './wallet.service';
import { ListenerService } from '../listener/listener.service';
import { GetAddressDto, ValidateAddressDto, ValidateMnemonicDto } from './dto/wallet.dto';
export declare class WalletController {
    private walletService;
    private listenerService;
    constructor(walletService: WalletService, listenerService: ListenerService);
    health(): {
        status: string;
        ts: string;
        service: string;
    };
    getAddress(dto: GetAddressDto): Promise<{
        success: boolean;
        address: string;
        index: number;
        derivation_path: string;
        user_id: number;
        is_new: boolean;
        monitoring: boolean;
    }>;
    validateAddress(dto: ValidateAddressDto): {
        address: string;
        valid: boolean;
    };
    validateMnemonic(dto: ValidateMnemonicDto): {
        valid: boolean;
    };
    generateMnemonic(): {
        mnemonic: string;
        words: number;
    };
}
