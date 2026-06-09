export declare class EncryptedMnemonicDto {
    encrypted: string;
    iv: string;
    salt: string;
    authTag: string;
}
export declare class GetAddressDto {
    encrypted_mnemonic: EncryptedMnemonicDto;
    index: number;
    user_id: number;
}
export declare class ValidateAddressDto {
    address: string;
}
export declare class ValidateMnemonicDto {
    mnemonic: string;
}
