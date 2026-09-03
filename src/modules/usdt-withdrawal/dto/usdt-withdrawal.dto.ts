import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class UsdtWithdrawalRequestDto {
  @IsNumber()
  @Min(1)
  user_id: number;

  @IsString()
  @IsNotEmpty()
  to_address: string;

  @IsString()
  @IsNotEmpty()
  amount: string;
}
