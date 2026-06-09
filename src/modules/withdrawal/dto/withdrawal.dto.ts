import { IsNumber, IsString, Min } from 'class-validator';

export class WithdrawalRequestDto {
  @IsNumber()
  @Min(1)
  user_id: number;

  @IsString()
  to_address: string;

  @IsString()
  amount: string;
}
