import { IsString, IsNotEmpty } from 'class-validator';

export class UsdtWithdrawalRequestDto {
  @IsString()
  @IsNotEmpty()
  to_address: string;

  @IsString()
  @IsNotEmpty()
  amount: string;
}
