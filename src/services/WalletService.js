const { ethers } = require('ethers');
const config = require('../config');

class WalletService {
  constructor() {
    this._provider = null;
    this._wallet   = null;
  }

  _init() {
    if (this._wallet) return;

    const key = process.env.EXBT_HOT_WALLET_KEY;
    if (!key) throw new Error('EXBT_HOT_WALLET_KEY is not set');

    this._provider = new ethers.JsonRpcProvider(config.chain.rpcUrl, {
      chainId: config.chain.chainId,
      name:    'exbt-testnet',
    });

    this._wallet = new ethers.Wallet(key, this._provider);
  }

  get provider() {
    this._init();
    return this._provider;
  }

  get address() {
    this._init();
    return this._wallet.address;
  }

  async estimateGas(tx) {
    this._init();
    const estimate = await this._provider.estimateGas(tx);
    // +20% buffer
    return (estimate * 120n) / 100n;
  }

  async getGasPrice() {
    this._init();
    const feeData = await this._provider.getFeeData();
    return feeData.gasPrice;
  }

  async getNonce() {
    this._init();
    return this._provider.getTransactionCount(this._wallet.address, 'pending');
  }

  async sendTransaction(tx) {
    this._init();
    return this._wallet.sendTransaction(tx);
  }

  async getLatestBlockNumber() {
    this._init();
    return this._provider.getBlockNumber();
  }

  async getBlock(blockNumber) {
    this._init();
    return this._provider.getBlock(blockNumber, true);
  }
}

module.exports = new WalletService();
