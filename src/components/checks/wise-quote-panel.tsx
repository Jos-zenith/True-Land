"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { SectionTitle } from "@/components/ui/layout";
import { useShell } from "@/components/shell/shell-context";
import { apiSend, ApiError, useApi } from "@/hooks/use-api";
import { fmtMoney, fmtPct, fmtRate, fmtStamp } from "@/lib/format";

interface QuoteView {
  id: string;
  provider: string;
  status: "available" | "no_enabled_option" | "blocked" | "requires_recipient" | "expired";
  current: boolean;
  classificationLabel: string;
  evidenceClassification: string;
  sourceAmount?: string;
  targetAmount?: string;
  exchangeRate?: string;
  totalFee?: string;
  feeCurrency?: string;
  feeBreakdown: { label: string; amount: string; currency: string }[];
  deliveryEstimate?: string;
  payInMethod?: string;
  payOutMethod?: string;
  quoteExpiresAt?: string;
  retrievedAt: string;
  disabledOptions: { payIn: string; reason: string }[];
  notices: { type: string; text: string }[];
  benchmarkRate: string | null;
  benchmarkReference: string | null;
  rawResponseReference?: string;
  analysis: { benchmarkReceipt: string; costVsBenchmark: string; allInCostPct: string; effectiveRate: string; rateVsBenchmarkPct: string | null; feePct: string | null; arithmeticCheck: string | null } | null;
}

const STATUS: Record<QuoteView["status"], string> = {
  available: "Available",
  expired: "Expired: kept as evidence, not used",
  no_enabled_option: "No bank-transfer option available for this amount",
  blocked: "Blocked by the provider",
  requires_recipient: "Needs recipient details (not requested)",
};

/** Wise provider quote. Distinct from the reference FX rate; never a guaranteed supplier receipt. */
export function WiseQuotePanel({ checkId, canRequest }: { checkId: string; canRequest: boolean }) {
  const { meta } = useShell();
  const { data, reload } = useApi<{ items: QuoteView[] }>(`/api/checks/${checkId}/provider-quotes`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = canRequest && !!meta?.permissions["check:write"];
  const quotes = data?.items ?? [];
  const q = quotes[0] ?? null;

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/api/checks/${checkId}/provider-quotes`, { provider: "wise" });
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The Wise quote could not be retrieved. Nothing was recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8" aria-label="Wise provider quote">
      <SectionTitle aside="Provider quote · not a reference rate · nothing is sent">Wise provider quote</SectionTitle>
      <p className="max-w-[760px] text-[13px] text-meta">
        Wise's own price for this amount: its rate, its fees and its delivery estimate. It is compared below with the reference rate this estimate used. Without Wise credentials, quotes are <b className="font-[590] text-label">illustrative</b>: they cannot be used to pay, and the price can change when recipient details or funding methods change.
      </p>
      {allowed && (
        <Button className="mt-3" size="sm" loading={busy} onClick={request}>
          {busy ? "Requesting Wise quote…" : q ? "Request a new Wise quote" : "Request Wise quote"}
        </Button>
      )}
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      {!q && !busy && <p className="mt-3 text-[13px] text-meta">No Wise quote recorded for this check. Manual quote entry remains available above.</p>}

      {q && (
        <div className={clsx("mt-4 max-w-[900px] rounded-[9px] border border-hairline px-4 py-4", !q.current && "opacity-80")}>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-[590] text-figure">{q.classificationLabel}</span>
            <span className="inline-flex items-center gap-1.5 text-label">
              <span className={clsx("h-1.5 w-1.5 rounded-full", q.current ? "bg-ok" : "bg-warn")} />
              {STATUS[q.status]}
            </span>
          </div>
          {q.targetAmount && q.sourceAmount ? (
            <dl className="tnum mt-3 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="text-meta">Supplier would receive (Wise)</dt>
                <dd className="text-[15px] font-[590] text-figure">{fmtMoney(q.targetAmount, "MXN", 2)}</dd>
              </div>
              <div>
                <dt className="text-meta">You send</dt>
                <dd className="text-label">{fmtMoney(q.sourceAmount, "USD", 2)} (fees included)</dd>
              </div>
              <div>
                <dt className="text-meta">Wise rate</dt>
                <dd className="text-label">{q.exchangeRate ? fmtRate(q.exchangeRate) : "—"}</dd>
              </div>
              <div>
                <dt className="text-meta">Wise fees</dt>
                <dd className="text-label">
                  {q.totalFee ? fmtMoney(q.totalFee, q.feeCurrency ?? "USD", 2) : "—"}
                  {q.feeBreakdown.length > 0 && <span className="block text-xs text-meta">{q.feeBreakdown.map((f) => `${f.label} ${fmtMoney(f.amount, f.currency, 2)}`).join(" · ")}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-meta">Delivery estimate</dt>
                <dd className="text-label">{q.deliveryEstimate ? fmtStamp(q.deliveryEstimate) : "—"}</dd>
              </div>
              <div>
                <dt className="text-meta">Quote expires</dt>
                <dd className="text-label">{q.quoteExpiresAt ? fmtStamp(q.quoteExpiresAt) : "not stated"}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-[13px] text-label">No amount is shown because the quote is not usable for a bank transfer of this amount.</p>
          )}

          {q.analysis && q.benchmarkRate && (
            <div className="tnum mt-4 border-t border-hairline pt-3 text-[13px]">
              <div className="font-[590] text-figure">Compared with this estimate's reference rate {fmtRate(q.benchmarkRate)}</div>
              <ul className="mt-1.5 flex flex-col gap-1 text-label">
                <li>
                  At the reference rate with no costs, {fmtMoney(q.sourceAmount!, "USD", 2)} would be {fmtMoney(q.analysis.benchmarkReceipt, "MXN", 2)}. Wise delivers{" "}
                  {Number(q.analysis.costVsBenchmark) >= 0 ? `${fmtMoney(q.analysis.costVsBenchmark, "MXN", 2)} less` : `${fmtMoney(String(-Number(q.analysis.costVsBenchmark)), "MXN", 2)} more`} (all-in {fmtPct(q.analysis.allInCostPct, 2)}).
                </li>
                {q.analysis.rateVsBenchmarkPct !== null && <li>Wise's rate is {fmtPct(q.analysis.rateVsBenchmarkPct, 3)} versus the reference rate, before fees.</li>}
                {q.analysis.feePct !== null && <li>Fees are {fmtPct(q.analysis.feePct, 2)} of the amount sent.</li>}
              </ul>
              <p className="mt-2 text-xs text-meta">
                The reference rate was observed at a different moment ({q.benchmarkReference}), so part of the difference may be market movement, not cost. Our fee-schedule markup is never applied on top of a provider quote.
              </p>
            </div>
          )}

          {(q.disabledOptions.length > 0 || q.notices.length > 0) && (
            <details className="mt-3 text-xs text-meta">
              <summary className="cursor-pointer">
                {q.disabledOptions.length} unavailable payment option{q.disabledOptions.length === 1 ? "" : "s"}
                {q.notices.length ? `, ${q.notices.length} notice${q.notices.length === 1 ? "" : "s"}` : ""}
              </summary>
              <ul className="mt-1 list-disc pl-4">
                {q.notices.map((n) => (
                  <li key={n.text}>
                    {n.type}: {n.text}
                  </li>
                ))}
                {q.disabledOptions.map((d) => (
                  <li key={d.payIn}>
                    {d.payIn}: {d.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="mt-3 text-xs text-meta">
            Retrieved {fmtStamp(q.retrievedAt)}
            {q.rawResponseReference && (
              <>
                {" · "}
                <a className="text-accent-hover underline" href={`/api/integrations/payloads/${q.rawResponseReference}`} target="_blank" rel="noreferrer">
                  original response {q.rawResponseReference.slice(0, 10)}
                </a>
              </>
            )}
            {quotes.length > 1 && ` · ${quotes.length - 1} earlier quote${quotes.length === 2 ? "" : "s"} kept`}
          </p>
        </div>
      )}
    </section>
  );
}
