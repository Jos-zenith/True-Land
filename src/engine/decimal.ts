import DecimalBase from "decimal.js";

/**
 * Isolated Decimal constructor for all monetary arithmetic.
 * 40 significant digits internally; rounding happens only via the explicit
 * helpers below, which are used at documented boundaries.
 */
export const Dec = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

export const ZERO = new Dec(0);
export const ONE = new Dec(1);
export const HUNDRED = new Dec(100);

/** Parse a decimal string strictly. Throws on anything that is not a finite number. */
export function dec(value: string | number | Dec): Dec {
  if (value instanceof Dec) return value;
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new EngineError("INVALID_NUMBER", `Not a finite number: ${value}`);
  }
  if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    throw new EngineError("INVALID_NUMBER", `Not a decimal number: "${value}"`);
  }
  return new Dec(value);
}

/** Full-precision serialisation (never exponent notation). */
export function str(value: Dec): string {
  return value.toFixed();
}

/** Round half-up (away from zero) to `dp` decimal places. Display/storage boundary only. */
export function roundHalfUp(value: Dec, dp: number): Dec {
  return value.toDecimalPlaces(dp, Dec.ROUND_HALF_UP);
}

/** Round up (towards +infinity) to `dp` places. Used for "send at least" amounts so the target is always covered. */
export function ceilTo(value: Dec, dp: number): Dec {
  return value.toDecimalPlaces(dp, Dec.ROUND_CEIL);
}

export class EngineError extends Error {
  constructor(
    public code:
      | "INVALID_NUMBER"
      | "INVALID_INPUT"
      | "UNSUPPORTED_CURRENCY_PAIR"
      | "RATE_MISSING"
      | "DEDUCTION_EXCEEDS_PRINCIPAL"
      | "NEGATIVE_RECEIPT",
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
