import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

const BSC_CHAIN_ID = 56;

// Tether USDT BEP-20 on BSC mainnet (18 decimals)
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const USDT_DECIMALS = 18;

const USDT_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

@Injectable()
export class ArbitrageWithdrawalService implements OnModuleInit {
  private readonly logger = new Logger(ArbitrageWithdrawalService.name);
  private _provider: ethers.JsonRpcProvider;
  private _hotWallet: ethers.Wallet;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const key    = this.configService.get<string>('ARBITRAGE_WALLET_HOT_KEY');
    const rpcUrl = this.configService.get<string>('BSC_RPC_URL');

    if (!rpcUrl) {
      this.logger.warn('BSC_RPC_URL not configured — arbitrage USDT withdrawals will not work');
      return;
    }
    if (!key) {
      this.logger.warn('ARBITRAGE_WALLET_HOT_KEY not configured — arbitrage USDT withdrawals will not work');
      return;
    }

    this.logger.log(`Arbitrage wallet ready: ${this.hotWallet.address} (BSC)`);
  }

  private get provider(): ethers.JsonRpcProvider {
    if (!this._provider) {
      const rpcUrl = this.configService.get<string>('BSC_RPC_URL');
      if (!rpcUrl) throw new ServiceUnavailableException('BSC_RPC_URL is not configured');
      this._provider = new ethers.JsonRpcProvider(
        rpcUrl,
        { chainId: BSC_CHAIN_ID, name: 'bsc' },
        { staticNetwork: true },
      );
    }
    return this._provider;
  }

  private get hotWallet(): ethers.Wallet {
    if (!this._hotWallet) {
      const key = this.configService.get<string>('ARBITRAGE_WALLET_HOT_KEY');
      if (!key) throw new ServiceUnavailableException('ARBITRAGE_WALLET_HOT_KEY is not configured');
      this._hotWallet = new ethers.Wallet(key, this.provider);
    }
    return this._hotWallet;
  }

  async sendUsdt(toAddress: string, amount: string): Promise<{
    tx_hash: string;
    amount: string;
    to_address: string;
    gas_fee: string;
    wallet: string;
  }> {
    if (!ethers.isAddress(toAddress)) {
      throw new BadRequestException('Invalid to_address');
    }

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      throw new BadRequestException('Invalid amount: must be a positive number');
    }

    const amountWei = ethers.parseUnits(amount, USDT_DECIMALS);
    const wallet    = this.hotWallet;
    const usdt      = new ethers.Contract(USDT_CONTRACT, USDT_ABI, wallet);

    // ── Check RPC + balances ──────────────────────────────────────────────────
    let feeData: ethers.FeeData;
    let bnbBalance: bigint;
    let usdtBalance: bigint;

    try {
      [feeData, bnbBalance, usdtBalance] = await Promise.all([
        this.provider.getFeeData(),
        this.provider.getBalance(wallet.address),
        usdt.balanceOf(wallet.address),
      ]);
    } catch (err) {
      this.throwIfRpcError(err);
      throw err;
    }

    // ── USDT balance check ────────────────────────────────────────────────────
    if (usdtBalance < amountWei) {
      const have = ethers.formatUnits(usdtBalance, USDT_DECIMALS);
      throw new BadRequestException(
        `Insufficient USDT balance: arbitrage wallet has ${have} USDT but transfer requires ${amount} USDT`,
      );
    }

    // ── Estimate gas + BNB balance check ─────────────────────────────────────
    let gasEstimate: bigint;
    try {
      gasEstimate = await usdt.transfer.estimateGas(toAddress, amountWei);
    } catch (err) {
      this.throwIfRpcError(err);
      throw err;
    }

    const gasLimit   = (gasEstimate * 120n) / 100n;
    const gasPrice   = feeData.gasPrice ?? feeData.maxFeePerGas;
    const gasCostWei = gasLimit * gasPrice;

    if (bnbBalance < gasCostWei) {
      const have = ethers.formatEther(bnbBalance);
      const need = ethers.formatEther(gasCostWei);
      throw new BadRequestException(
        `Insufficient BNB for gas: arbitrage wallet has ${have} BNB but estimated gas cost is ${need} BNB`,
      );
    }

    // ── Send ──────────────────────────────────────────────────────────────────
    let tx: ethers.ContractTransactionResponse;
    let receipt: ethers.ContractTransactionReceipt;

    try {
      tx      = await usdt.transfer(toAddress, amountWei, { gasLimit, gasPrice });
      receipt = await tx.wait(1);
    } catch (err) {
      this.throwIfRpcError(err);
      throw err;
    }

    const actualGasFee = ethers.formatEther(BigInt(receipt.gasUsed) * gasPrice);

    this.logger.log(
      `[ArbitrageWithdrawal] Sent ${amount} USDT → ${toAddress} | tx ${tx.hash}`,
    );

    return {
      tx_hash:    tx.hash,
      amount,
      to_address: toAddress,
      gas_fee:    actualGasFee,
      wallet:     wallet.address,
    };
  }

  private throwIfRpcError(err: any): void {
    const msg: string  = err?.message ?? '';
    const code: string = err?.code ?? '';

    const isRpcError =
      code === 'NETWORK_ERROR' ||
      code === 'SERVER_ERROR'  ||
      code === 'TIMEOUT'       ||
      msg.includes('ECONNREFUSED')       ||
      msg.includes('ETIMEDOUT')          ||
      msg.includes('ENOTFOUND')          ||
      msg.includes('could not detect network') ||
      msg.includes('failed to meet quorum');

    if (isRpcError) {
      throw new ServiceUnavailableException(
        `BSC RPC is unavailable — please try again later. (${msg})`,
      );
    }
  }
}
