const { ethers } = require('ethers');

// Dust occupies the last 6 decimal places of the 18-decimal ERC-20/native amount.
// user_id is zero-padded to 6 digits and appended after the decimal point of the
// round number the user wishes to send.
//
// Example: user_id=1234, send 100 EXBT → 100.001234 EXBT
//   dust = 0.001234 EXBT = 1234000000000000 wei  (6 sig decimals × 10^12)
//
// Dust range: 000001–999999 → user_id 1–999999

const DUST_DECIMALS    = 6n;
const DUST_DIVISOR     = 10n ** (18n - DUST_DECIMALS); // 1_000_000_000_000 (1e12)
const MAX_USER_ID_DUST = 999_999n;

class DepositIdentifier {
  /**
   * Extract the 6-decimal-place dust from a wei amount.
   * Returns { dustUserId: bigint, netWei: bigint }
   */
  extractDust(weiAmount) {
    const wei = BigInt(weiAmount);
    const dustUnits = wei % (DUST_DIVISOR * (MAX_USER_ID_DUST + 1n)); // remainder in 1e12 increments
    // Normalize to 6-digit user_id space
    const dustUserId = wei % (DUST_DIVISOR * (MAX_USER_ID_DUST + 1n)) / DUST_DIVISOR;
    const dustWei    = dustUserId * DUST_DIVISOR;
    const netWei     = wei - dustWei;
    return { dustUserId, dustWei, netWei };
  }

  /**
   * Format memo string for a user_id: zero-padded to 6 digits.
   */
  formatMemo(userId) {
    return String(userId).padStart(6, '0');
  }

  /**
   * Given a tx amount in wei (as bigint or string), return the identified
   * user_id or null, plus net credited amount in ETH string.
   */
  identify(weiAmount) {
    const { dustUserId, dustWei, netWei } = this.extractDust(weiAmount);
    if (dustUserId === 0n) return null;
    return {
      userId:         Number(dustUserId),
      dustAmountEth:  ethers.formatEther(dustWei),
      netCreditedEth: ethers.formatEther(netWei),
      grossAmountEth: ethers.formatEther(BigInt(weiAmount)),
    };
  }
}

module.exports = new DepositIdentifier();
