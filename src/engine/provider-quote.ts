import { dec, str, EngineError } from "./decimal";

/**
 * Compare a provider's quote with the independent reference (benchmark) rate. Pure and deterministic.
 *
 * The provider's target amount already reflects its own rate and fee: NO markup from our fee schedule is
 * applied to it (that would double-count the spread). Everything is measured against what the same
 * source amount would buy at the benchmark rate with no costs at all:
 *
 *   benchmarkReceipt   = sourceAmount × benchmarkRate
 *   costVsBenchmark    = benchmarkReceipt − targetAmount           (destination currency; ≥ 0 means cost)
 *   allInCostPct       = costVsBenchmark ÷ benchmarkReceipt × 100
 *   effectiveRate      = targetAmount ÷ sourceAmount               (rate after all provider costs)
 *   rateVsBenchmarkPct = (providerRate ÷ benchmarkRate − 1) × 100  (the rate alone, before fees)
 *   feePct             = fee ÷ sourceAmount × 100                  (fee in source currency only)
 *   arithmeticCheck    = (sourceAmount − fee) × providerRate − targetAmount
 *                        Near zero means the provider's numbers are internally consistent with
 *                        "fee deducted before conversion". Anything else is reported, never corrected.
 *
 * Differences against a benchmark observed at another moment include market movement. They are not
 * a pure measure of the provider's margin.
 */
export interface ProviderQuoteInput {
  sourceAmount: string;
  targetAmount: string;
  providerRate: string | null;
  fee: string | null;
  feeCurrency: string | null;
  sourceCurrency: string;
  benchmarkRate: string;
}

export interface ProviderQuoteAnalysis {
  benchmarkReceipt: string;
  costVsBenchmark: string;
  allInCostPct: string;
  effectiveRate: string;
  rateVsBenchmarkPct: string | null;
  feePct: string | null;
  arithmeticCheck: string | null;
}

export function analyseProviderQuote(p: ProviderQuoteInput): ProviderQuoteAnalysis {
  const A = dec(p.sourceAmount);
  const T = dec(p.targetAmount);
  const m = dec(p.benchmarkRate);
  if (A.lte(0) || T.lte(0) || m.lte(0)) throw new EngineError("INVALID_INPUT", "Quote amounts and the benchmark rate must be greater than zero.");
  const benchmarkReceipt = A.times(m);
  const cost = benchmarkReceipt.minus(T);
  const feeInSource = p.fee !== null && p.feeCurrency === p.sourceCurrency ? dec(p.fee) : null;
  const rate = p.providerRate !== null ? dec(p.providerRate) : null;
  return {
    benchmarkReceipt: str(benchmarkReceipt),
    costVsBenchmark: str(cost),
    allInCostPct: str(cost.div(benchmarkReceipt).times(100)),
    effectiveRate: str(T.div(A)),
    rateVsBenchmarkPct: rate ? str(rate.div(m).minus(1).times(100)) : null,
    feePct: feeInSource ? str(feeInSource.div(A).times(100)) : null,
    arithmeticCheck: feeInSource && rate ? str(A.minus(feeInSource).times(rate).minus(T)) : null,
  };
}
