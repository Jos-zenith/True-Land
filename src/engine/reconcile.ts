import { dec, str, EngineError } from "./decimal";

export interface ReconcileInput {
  typical: string;
  low: string | null;
  high: string;
  actual: string;
  invoice: string | null; // invoice in the receipt currency, when comparable
  quote: string | null; // provider quote of the receipt, if given before paying
}

export interface ReconcileResult {
  /** actual − estimate. Negative: arrived below our typical estimate. */
  ourError: string;
  ourErrorPct: string | null;
  /** quote − actual. Positive: the quote was too high. */
  quoteError: string | null;
  closer: "ours" | "quote" | "tie" | null;
  closerBy: string | null;
  insideRange: boolean | null;
  againstInvoice: string | null;
  actualVsTypical: "below" | "equal" | "above";
  actualVsQuote: "below" | "equal" | "above" | null;
}

/** Sign conventions follow the All checks wireframe: Our error = actual − estimate; Quote error = quote − actual. */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const actual = dec(input.actual);
  if (actual.lt(0)) throw new EngineError("INVALID_INPUT", "Received amount cannot be negative.");
  const typical = dec(input.typical);
  const ourError = actual.minus(typical);
  const ourErrorPct = typical.isZero() ? null : str(ourError.div(typical).times(100));
  let quoteError: string | null = null;
  let closer: ReconcileResult["closer"] = null;
  let closerBy: string | null = null;
  let actualVsQuote: ReconcileResult["actualVsQuote"] = null;
  if (input.quote !== null) {
    const q = dec(input.quote);
    const qe = q.minus(actual);
    quoteError = str(qe);
    const a = ourError.abs();
    const b = qe.abs();
    closer = a.lt(b) ? "ours" : a.gt(b) ? "quote" : "tie";
    closerBy = str(a.minus(b).abs());
    const c = actual.cmp(q);
    actualVsQuote = c < 0 ? "below" : c > 0 ? "above" : "equal";
  }
  const insideRange = input.low === null ? null : actual.gte(dec(input.low)) && actual.lte(dec(input.high));
  const c = actual.cmp(typical);
  return {
    ourError: str(ourError),
    ourErrorPct,
    quoteError,
    closer,
    closerBy,
    insideRange,
    againstInvoice: input.invoice === null ? null : str(actual.minus(dec(input.invoice))),
    actualVsTypical: c < 0 ? "below" : c > 0 ? "above" : "equal",
    actualVsQuote,
  };
}
