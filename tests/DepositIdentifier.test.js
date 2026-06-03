const { ethers } = require('ethers');
const identifier = require('../src/services/DepositIdentifier');

// Dust divisor = 1e12 (18 decimals - 6 memo digits)
const DUST_DIVISOR = 10n ** 12n;

describe('DepositIdentifier', () => {
  describe('formatMemo', () => {
    it('zero-pads user_id to 6 digits', () => {
      expect(identifier.formatMemo(1)).toBe('000001');
      expect(identifier.formatMemo(1234)).toBe('001234');
      expect(identifier.formatMemo(999999)).toBe('999999');
    });
  });

  describe('extractDust', () => {
    it('extracts correct dustUserId and netWei', () => {
      // user_id=1234, send 100 EXBT → 100.001234 EXBT
      const gross = ethers.parseEther('100.001234');
      const { dustUserId, dustWei, netWei } = identifier.extractDust(gross);

      expect(dustUserId).toBe(1234n);
      expect(dustWei).toBe(1234n * DUST_DIVISOR);
      expect(netWei).toBe(gross - dustWei);
    });

    it('handles user_id=1 (minimum dust)', () => {
      const gross = ethers.parseEther('50.000001');
      const { dustUserId } = identifier.extractDust(gross);
      expect(dustUserId).toBe(1n);
    });

    it('handles user_id=999999 (maximum dust)', () => {
      const gross = ethers.parseEther('1.999999');
      const { dustUserId } = identifier.extractDust(gross);
      expect(dustUserId).toBe(999999n);
    });

    it('returns dustUserId=0 when amount has no dust', () => {
      const gross = ethers.parseEther('100.000000');
      const { dustUserId } = identifier.extractDust(gross);
      expect(dustUserId).toBe(0n);
    });
  });

  describe('identify', () => {
    it('correctly identifies a user from a tx amount', () => {
      const gross = ethers.parseEther('100.001234');
      const result = identifier.identify(gross);
      expect(result).not.toBeNull();
      expect(result.userId).toBe(1234);
      // Net credited should be gross minus dust
      const expectedNet = ethers.formatEther(gross - 1234n * DUST_DIVISOR);
      expect(result.netCreditedEth).toBe(expectedNet);
    });

    it('returns null for a round amount with no dust', () => {
      const gross = ethers.parseEther('100.000000');
      expect(identifier.identify(gross)).toBeNull();
    });

    it('returns null for zero-value tx', () => {
      expect(identifier.identify(0n)).toBeNull();
    });

    it('gross amount matches input', () => {
      const gross = ethers.parseEther('77.005678');
      const result = identifier.identify(gross);
      expect(result.grossAmountEth).toBe(ethers.formatEther(gross));
    });
  });
});
