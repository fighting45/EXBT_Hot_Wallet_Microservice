/**
 * Minimal fixed-point decimal helpers scaled to 18 places, backed by BigInt.
 * Avoids floating-point error in balance math without pulling in a new dependency.
 * All inputs/outputs are decimal strings (matching numeric(36,18) DB columns).
 */
const SCALE = 18n;
const ONE = 10n ** SCALE;

export class Dec {
  static toScaled(value: string | number): bigint {
    const s = String(value).trim();
    if (s === '' || s === 'null' || s === 'undefined') return 0n;
    const neg = s.startsWith('-');
    const body = neg ? s.slice(1) : s;
    const [intPart, fracPartRaw = ''] = body.split('.');
    const fracPart = (fracPartRaw + '0'.repeat(Number(SCALE))).slice(0, Number(SCALE));
    const scaled = BigInt(intPart || '0') * ONE + BigInt(fracPart || '0');
    return neg ? -scaled : scaled;
  }

  static fromScaled(scaled: bigint): string {
    const neg = scaled < 0n;
    const abs = neg ? -scaled : scaled;
    const intPart = abs / ONE;
    const fracPart = (abs % ONE).toString().padStart(Number(SCALE), '0').replace(/0+$/, '');
    const out = fracPart ? `${intPart}.${fracPart}` : `${intPart}`;
    return neg ? `-${out}` : out;
  }

  static add(a: string, b: string): string {
    return Dec.fromScaled(Dec.toScaled(a) + Dec.toScaled(b));
  }

  static sub(a: string, b: string): string {
    return Dec.fromScaled(Dec.toScaled(a) - Dec.toScaled(b));
  }

  static mul(a: string | number, b: string | number): string {
    return Dec.fromScaled((Dec.toScaled(a) * Dec.toScaled(b)) / ONE);
  }

  static gte(a: string, b: string): boolean {
    return Dec.toScaled(a) >= Dec.toScaled(b);
  }

  static gt(a: string, b: string): boolean {
    return Dec.toScaled(a) > Dec.toScaled(b);
  }

  static isPositive(a: string | number): boolean {
    return Dec.toScaled(String(a)) > 0n;
  }

  static isZeroOrLess(a: string): boolean {
    return Dec.toScaled(a) <= 0n;
  }
}
