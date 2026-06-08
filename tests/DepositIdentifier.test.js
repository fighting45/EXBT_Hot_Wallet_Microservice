const { ethers } = require("ethers");
const identifier = require("../src/services/DepositIdentifier");

// Dust divisor = 1e15 (3 decimal place memo, format 0.0XX)
const DUST_DIVISOR = 10n ** 15n;

describe("DepositIdentifier", () => {
  describe("generateMemo", () => {
    it("returns a 3-char string", () => {
      const memo = identifier.generateMemo();
      expect(memo).toHaveLength(3);
    });

    it("always starts with 0 (range 010–099)", () => {
      for (let i = 0; i < 50; i++) {
        const memo = identifier.generateMemo();
        expect(memo[0]).toBe("0");
      }
    });

    it("numeric value is always between 10 and 99", () => {
      for (let i = 0; i < 50; i++) {
        const num = parseInt(identifier.generateMemo(), 10);
        expect(num).toBeGreaterThanOrEqual(10);
        expect(num).toBeLessThanOrEqual(99);
      }
    });
  });

  describe("extractDust", () => {
    it('extracts correct dustMemo and netWei for memo "034"', () => {
      // memo=34, send 100.034 EXBT
      const gross = ethers.parseEther("100.034");
      const { dustMemo, dustWei, netWei } = identifier.extractDust(gross);

      expect(dustMemo).toBe("034");
      expect(dustWei).toBe(34n * DUST_DIVISOR);
      expect(netWei).toBe(gross - dustWei);
    });

    it('handles minimum memo "010"', () => {
      const gross = ethers.parseEther("50.010");
      const { dustMemo, dustWei } = identifier.extractDust(gross);
      expect(dustMemo).toBe("010");
      expect(dustWei).toBe(10n * DUST_DIVISOR);
    });

    it('handles maximum memo "099"', () => {
      const gross = ethers.parseEther("1.099");
      const { dustMemo, dustWei } = identifier.extractDust(gross);
      expect(dustMemo).toBe("099");
      expect(dustWei).toBe(99n * DUST_DIVISOR);
    });

    it("returns dustWei=0 for a round amount with no dust", () => {
      const gross = ethers.parseEther("100.000");
      const { dustWei } = identifier.extractDust(gross);
      expect(dustWei).toBe(0n);
    });

    it("net = gross minus dust", () => {
      const gross = ethers.parseEther("77.056");
      const { dustWei, netWei } = identifier.extractDust(gross);
      expect(netWei).toBe(gross - dustWei);
    });
  });

  describe("identify", () => {
    it("returns correct dustMemo and amounts for a valid tx", () => {
      const gross = ethers.parseEther("100.034");
      const result = identifier.identify(gross);

      expect(result).not.toBeNull();
      expect(result.dustMemo).toBe("034");
      expect(result.grossAmountEth).toBe(ethers.formatEther(gross));

      const expectedNet = ethers.formatEther(gross - 34n * DUST_DIVISOR);
      expect(result.netCreditedEth).toBe(expectedNet);
    });

    it("returns null for a round amount with no dust", () => {
      expect(identifier.identify(ethers.parseEther("100.000"))).toBeNull();
    });

    it("returns null for zero-value tx", () => {
      expect(identifier.identify(0n)).toBeNull();
    });

    it("dust amount + net credited = gross amount", () => {
      const gross = ethers.parseEther("50.072");
      const result = identifier.identify(gross);

      // Use ethers.parseEther for BigInt-safe conversion
      const dustWei = ethers.parseEther(result.dustAmountEth);
      const netWei = ethers.parseEther(result.netCreditedEth);
      expect(dustWei + netWei).toBe(gross);
    });
  });
});
