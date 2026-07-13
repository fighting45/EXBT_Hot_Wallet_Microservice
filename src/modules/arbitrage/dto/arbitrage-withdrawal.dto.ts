import { IsString, IsNotEmpty } from 'class-validator';

export class ArbitrageWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  to_address: string;

  @IsString()
  @IsNotEmpty()
  amount: string;
}
