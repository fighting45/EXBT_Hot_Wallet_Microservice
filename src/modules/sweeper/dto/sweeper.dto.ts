import { IsObject, IsOptional, IsString } from 'class-validator';

export class EncryptedMnemonicDto {
  @IsString() encrypted: string;
  @IsString() iv: string;
  @IsString() salt: string;
  @IsString() authTag: string;
}

export class EstimateSweepDto {
  @IsObject()
  encrypted_mnemonic: EncryptedMnemonicDto;

  @IsOptional() @IsString()
  min_balance?: string;
}

export class ExecuteSweepDto {
  @IsObject()
  encrypted_mnemonic: EncryptedMnemonicDto;

  @IsOptional() @IsString()
  min_balance?: string;
}
