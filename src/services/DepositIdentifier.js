const { ethers } = require('ethers');

// Dust uses 3 decimal places — format 0.0XX (e.g. 0.034 EXBT).
// DUST_DIVISOR = 10^15, memo range 10–99 (90 unique slots).
// Max dust = 0.099 EXBT.

const DUST_DIVISOR = 10n ** 15n;
const MAX_MEMO     = 99n;

class DepositIdentifier {
  /**
   * Generate a random 3-char memo "010"–"099".
   * Dust will display as 0.0XX to the user.
   */
  generateMemo() {
    const num = Math.floor(Math.random() * 90) + 10; // 10–99
    return String(num).padStart(3, '0');
  }

  /**
   * Extract dust from a wei amount.
   * Returns { dustMemo: string (3-char), dustWei: bigint, netWei: bigint }
   */
  extractDust(weiAmount) {
    const wei      = BigInt(weiAmount);
    const dustNum  = (wei % (DUST_DIVISOR * (MAX_MEMO + 1n))) / DUST_DIVISOR;
    const dustWei  = dustNum * DUST_DIVISOR;
    const netWei   = wei - dustWei;
    const dustMemo = String(Number(dustNum)).padStart(3, '0');
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
