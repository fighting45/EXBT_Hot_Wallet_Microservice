import { IsArray, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class EncryptedMnemonicDto {
  @IsString() encrypted: string;
  @IsString() iv: string;
  @IsString() salt: string;
  @IsString() authTag: string;
}

export class EstimateSweepDto {
  @IsObject()
  encrypted_mnemonic: EncryptedMnemonicDto;

  @IsNumber() @Min(0)
  start_index: number;

  @IsNumber() @Min(1)
  end_index: number;

  @IsOptional() @IsString()
  min_balance?: string;
}

export class ExecuteSweepDto {
  @IsObject()
  encrypted_mnemonic: EncryptedMnemonicDto;

  @IsNumber() @Min(0)
  start_index: number;

  @IsNumber() @Min(1)
  end_index: number;

  @IsOptional() @IsString()
  min_balance?: string;
}
