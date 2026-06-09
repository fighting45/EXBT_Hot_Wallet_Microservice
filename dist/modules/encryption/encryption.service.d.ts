export declare class EncryptionService {
    private readonly ALGORITHM;
    private readonly KEY_LENGTH;
    private readonly IV_LENGTH;
    private readonly SALT_LENGTH;
    private readonly TAG_LENGTH;
    encrypt(plaintext: string, password: string): EncryptedData;
    decrypt(encryptedData: EncryptedData, password: string): string;
    generatePassword(length?: number): string;
}
export interface EncryptedData {
    encrypted: string;
    iv: string;
    salt: string;
    authTag: string;
}
