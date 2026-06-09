import { IsNumber, IsObject, IsString, IsOptional, Min } from 'class-validator';

export class EncryptedMnemonicDto {
  @IsString()
  encrypted: string;

  @IsString()
  iv: string;

  @IsString()
  salt: string;

  @IsString()
  authTag: string;
}

export class GetAddressDto {
  @IsObject()
  encrypted_mnemonic: EncryptedMnemonicDto;

  @IsNumber()
  @Min(1)
  user_id: number;
}

export class ValidateAddressDto {
  @IsString()
  address: string;
}

export class ValidateMnemonicDto {
  @IsString()
  mnemonic: string;
}
