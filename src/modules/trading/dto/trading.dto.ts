import { IsNumber, IsString, Min, IsIn, IsOptional } from 'class-validator';

export class PlaceOrderDto {
  @IsNumber()
  @Min(1)
  user_id: number;

  @IsString()
  symbol: string; // EXBT-USDT

  @IsIn(['buy', 'sell'])
  side: 'buy' | 'sell';

  @IsIn(['limit', 'market'])
  type: 'limit' | 'market';

  // Required for limit orders; ignored for market.
  @IsOptional()
  @IsString()
  price?: string;

  // Base amount (buy/sell limit, sell market) or quote amount (buy market — USDT to spend).
  @IsString()
  size: string;
}

export class CancelOrderDto {
  @IsNumber()
  @Min(1)
  user_id: number;
}

export class AccountFundingDto {
  @IsNumber()
  @Min(1)
  user_id: number;

  @IsIn(['EXBT', 'USDT'])
  asset: 'EXBT' | 'USDT';

  @IsString()
  amount: string;
}
