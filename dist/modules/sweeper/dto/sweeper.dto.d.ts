export declare class EncryptedMnemonicDto {
    encrypted: string;
    iv: string;
    salt: string;
    authTag: string;
}
export declare class EstimateSweepDto {
    encrypted_mnemonic: EncryptedMnemonicDto;
    start_index: number;
    end_index: number;
    min_balance?: string;
}
export declare class AddressToSweepDto {
    address: string;
    index: number;
    balance: string;
}
export declare class ExecuteSweepDto {
    encrypted_mnemonic: EncryptedMnemonicDto;
    addresses: AddressToSweepDto[];
}
