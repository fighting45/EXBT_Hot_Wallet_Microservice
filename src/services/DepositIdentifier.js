const { ethers } = require('ethers');

// Dust occupies the last 6 decimal places of the 18-decimal native amount.
// A random 6-digit memo is generated per deposit request and stored in
// exbt_deposit_references. The scanner matches incoming dust against stored
// memos — never against user_id directly.
//
// Dust divisor = 10^12 (18 decimals - 6 memo digits)

const DUST_DIVISOR  = 10n ** 12n;
const MAX_MEMO      = 999_999n;

class DepositIdentifier {
  /**
   * Generate a random 6-digit memo string (000001–999999).
   */
  generateMemo() {
    const num = Math.floor(Math.random() * 999999) + 1;
    return String(num).padStart(6, '0');
  }

  /**
   * Extract dust from a wei amount.
   * Returns { dustMemo: string (6-digit), dustWei: bigint, netWei: bigint }
   */
  extractDust(weiAmount) {
    const wei      = BigInt(weiAmount);
    const dustNum  = (wei % (DUST_DIVISOR * (MAX_MEMO + 1n))) / DUST_DIVISOR;
    const dustWei  = dustNum * DUST_DIVISOR;
    const netWei   = wei - dustWei;
    const dustMemo = String(Number(dustNum)).padStart(6, '0');
    return { dustMemo, dustWei, netWei };
  }

  /**
   * Given a tx amount in wei, return dust memo string and amounts.
   * Returns null if dust is zero (no memo).
   */
  identify(weiAmount) {
    const { dustMemo, dustWei, netWei } = this.extractDust(weiAmount);
    if (dustWei === 0n) return null;
    return {
      dustMemo,
      dustAmountEth:  ethers.formatEther(dustWei),
      netCreditedEth: ethers.formatEther(netWei),
      grossAmountEth: ethers.formatEther(BigInt(weiAmount)),
    };
  }
}

module.exports = new DepositIdentifier();
