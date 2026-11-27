"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/layout";
import { Glyph, SourceBadge } from "@/components/ui/chip";
import { useShell } from "@/components/shell/shell-context";
import type { SourceClass } from "@/engine/types";
import { SOURCE_LABEL } from "@/lib/labels";

const TOC = [
  ["landed", "What landed amount means"],
  ["formula", "How an estimate is made"],
  ["rate", "Benchmark rate"],
  ["fees", "Fees and deductions"],
  ["range", "Low, typical and high"],
  ["evidence", "Estimates and observations"],
  ["freshness", "Freshness"],
  ["exclusion", "Excluded routes"],
  ["ranking", "Ranking and “too close to call”"],
  ["rounding", "Rounding"],
  ["limits", "Limitations"],
] as const;

function H({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-16 pt-7 text-[14px] font-[590] text-figure">
      {children}
    </h2>
  );
}
function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] leading-relaxed text-label">{children}</p>;
}

export default function MethodologyPage() {
  const { meta } = useShell();
  const f = meta?.freshness;
  return (
    <>
      <PageHeader crumbs={[{ label: "Methodology" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1040px] gap-10 px-4 pb-16 pt-8 md:px-8 xl:grid-cols-[minmax(0,1fr)_200px]">
          <article className="min-w-0 max-w-[720px]">
            <h1 className="text-[20px] font-[590] tracking-[-0.015em] text-figure">How an estimate is made</h1>
            <p className="mt-2 text-[13px] text-meta">
              Calculation {meta?.calcVersion ?? "v0.3"} · fee schedule v{meta?.schedule.version ?? "—"}. Every figure in Landed can be traced to the inputs, rate and fee rule below.
            </p>

            <div className="mt-5 rounded-[9px] border border-hairline bg-group/50 px-4 py-3.5 text-[13px] text-label">
              <b className="font-[590] text-figure">Not a guarantee.</b> An estimate is what we expect to arrive before you pay, built from assumptions. Banks, intermediaries and providers can charge differently. Landed never initiates, holds or moves money, and no route pays to be ranked higher.
            </div>

            <H id="landed">What landed amount means</H>
            <P>The landed amount is what reaches the supplier&apos;s account after every cost taken along the way: intermediary deductions, the exchange-rate markup and any receiving fee. It is not what you send, and it is not what a provider&apos;s headline rate suggests.</P>

            <H id="formula">How an estimate is made</H>
            <pre className="mt-3 overflow-x-auto rounded-[9px] border border-hairline bg-window px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-label">
{`R = (A − D) × m × (1 − s) − F
A  amount sent       D  deductions taken from it (USD)
m  mid-market rate   s  markup, as a fraction
F  fixed receiving fee (destination currency)
For a dollar wire to a dollar invoice, m = 1 and s = 0.
Sender fees paid on top are added to your cost, never subtracted from R.`}
            </pre>
            <P>
              Costs are applied in the order money moves: deductions come out of the principal before conversion, the markup applies at conversion, and the receiving fee comes out of what arrives. Each cost is applied once. Worked example (a golden test): sending USD 10,000 with a USD 25 deduction and a 3% markup gives (10,000 − 25) × 0.97 = USD 9,675.75 equivalent, shown as about USD 9,676.
            </P>
            <P>To cover an invoice, the amount to send is the formula solved for A, rounded up to the cent so the target is always met: A = (invoice + F) ÷ (m × (1 − s)) + D.</P>

            <H id="rate">Benchmark rate and provider rates</H>
            <P>
              The benchmark m is the latest USD/MXN rate recorded in Data sources. It is either a <b className="font-[590]">reference FX rate</b> retrieved from a public data source, a rate entered by hand (labelled “Manually entered”), or the demo value 17.0000 (illustrative, not a market quote). Each estimate stores the exact rate it used, with where it came from, when the source observed it and when it was retrieved.
            </P>
            <P>
              <b className="font-[590]">Reference rate versus provider quote.</b> A reference rate is an independent benchmark published by central banks and other institutions. Frankfurter&apos;s default is a blend of many such sources, not an official fixing. Nobody will transact at it. A provider quote, for example from Wise, is that provider&apos;s own price: its rate, its fees and its delivery estimate, for this amount, at that moment. The difference between them is the cost of using the provider, plus any market movement between the two observations.
            </P>
            <P>
              <b className="font-[590]">Why two FX sources, and how one is chosen.</b> Frankfurter is the primary source and currencyapi.com is an independent secondary source. Selection policy fx-benchmark-v1 is deterministic. A source is usable only if it answered with the right pair and a positive rate, and its observation is not stale. The primary is used when usable. Otherwise the secondary is used, and that fallback is recorded. The two are never averaged. A difference of more than 0.5% is flagged. If neither is usable, no rate is produced and no estimate is computed from it.
            </P>
            <P>
              <b className="font-[590]">Stale data.</b> Freshness is judged on when the source observed the rate, not when we fetched it. A daily rate dated today counts from 00:00 UTC. It is fresh for 48 hours, aging up to 96 hours (to cover a weekend) and stale after that. Stale observations are never used. A cached response is labelled as cached and keeps its original timestamps.
            </P>
            <P>
              <b className="font-[590]">What a Wise quote represents.</b> Without Wise credentials, the quote is an unauthenticated example: illustrative pricing that cannot be used to pay. With credentials, it is a profile-specific quote whose rate is locked for 30 minutes. In both cases fees and delivery can change once recipient details or the funding method change, and an expired quote is kept as evidence but never reused. Landed never creates a recipient or a transfer.
            </P>
            <P>A provider quote is stored separately and never replaces the estimate. A quoted amount is compared with our range, and we show the markup it implies. A quoted rate already contains the provider&apos;s margin, so it is applied directly with no second markup. A Wise quote is compared with the reference rate on the same principle: none of our fee-schedule markup is ever applied to it.</P>
            <P>
              <b className="font-[590]">Why a reference rate does not guarantee what the supplier receives.</b> The landed amount depends on the rate your provider actually applies, its fees, any intermediary deductions and any receiving fee, and these are often not known until afterwards. That is why every estimate shows a range, and why reconciliation compares it with what actually arrived.
            </P>

            <H id="fees">Fees and deductions</H>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-label marker:text-deco">
              <li><b className="font-[590]">Sending fee</b>: paid by you on top of the amount sent. Part of your cost, not the supplier&apos;s receipt.</li>
              <li><b className="font-[590]">Intermediary deductions</b>: taken from the principal in USD by correspondent banks before conversion. Depends on the charge code (SHA, OUR, BEN) and is never certain.</li>
              <li><b className="font-[590]">FX markup</b>: the gap between the provider&apos;s rate and mid-market, as a percentage of the converted amount.</li>
              <li><b className="font-[590]">Receiving fee</b>: a fixed fee in the destination currency taken from what arrives.</li>
            </ul>
            <P>If a component is not known, it is treated as zero and the estimate is marked <i>rough</i>. A rough figure is an upper bound: the supplier may receive less. Its floor is shown as unknown.</P>

            <H id="range">Low, typical and high</H>
            <P>Low, typical and high come from configured scenarios in the fee schedule: the low case uses the largest markup and deduction, the high case the smallest. They are modelled, not statistically calibrated, and are never stated as probabilities. We make no claim about how often actual amounts fall inside the range until enough outcomes are recorded.</P>

            <H id="evidence">Estimates and observations are different things</H>
            <P>An estimate is what we expect before payment. An observation is what someone reports or a record shows afterwards. The two are stored separately and never overwrite each other.</P>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-label">
              <li className="flex items-center gap-2"><Glyph glyph="ring" tone="neutral" /><b className="font-[590]">Modelled</b>: estimate only.</li>
              <li className="flex items-center gap-2"><Glyph glyph="dot" tone="neutral" /><b className="font-[590]">Reported</b>: stated by the supplier, by you, or typed from a statement.</li>
              <li className="flex items-center gap-2"><Glyph glyph="square" tone="neutral" /><b className="font-[590]">Tax record</b>: payment complement; may show the full rather than the net amount.</li>
              <li className="flex items-center gap-2"><Glyph glyph="dot" tone="ok" /><b className="font-[590]">Verified</b>: a CEP or bank record passed validation. Set by the system only.</li>
            </ul>
            <p className="mt-4 text-[13px] text-meta">Every input also carries a source classification:</p>
            <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
              {(Object.keys(SOURCE_LABEL) as SourceClass[]).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <SourceBadge cls={k} />
                  <span className="text-meta">{SOURCE_NOTE[k]}</span>
                </div>
              ))}
            </div>

            <H id="freshness">Freshness</H>
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-meta">
                  <th className="py-2 font-[510]">Data</th>
                  <th className="py-2 font-[510]">Source</th>
                  <th className="py-2 font-[510]">Stale after</th>
                </tr>
              </thead>
              <tbody className="text-label">
                <tr className="border-b border-hairline"><td className="py-2.5">Rate</td><td>Entered (or a licensed feed, later)</td><td className="tnum">{f?.rateStaleAfterHours ?? 24} hours</td></tr>
                <tr className="border-b border-hairline"><td className="py-2.5">Fees and markup</td><td>Versioned schedule</td><td className="tnum">{f?.scheduleStaleAfterDays ?? 30} days (proposed)</td></tr>
                <tr className="border-b border-hairline"><td className="py-2.5">Provider quote</td><td>Customer</td><td>Quote validity</td></tr>
                <tr><td className="py-2.5">Supplier reply</td><td>Supplier</td><td className="tnum">{f?.replyWindowDays ?? 3} days after payment</td></tr>
              </tbody>
            </table>
            <P>A stale rate does not hide the estimate; amounts are labelled stale, and recording a choice asks you to confirm or update. Updating adds a new estimate and keeps the old one.</P>

            <H id="exclusion">Why a route may be excluded</H>
            <P>A route is excluded, with its reason, when it cannot settle this invoice&apos;s currency, does not pay the supplier the way they accept, may not arrive by the pay-by date, falls outside its amount limits, is disabled, or has not passed eligibility review. Routes whose eligibility is unverified (for example stablecoin settlement) are never estimated or ranked.</P>

            <H id="ranking">Ranking and “too close to call”</H>
            <P>A route is called more favourable only when its low estimate is above the high estimate of every other eligible route. If the ranges overlap, the result is “too close to call” and no rank is given. Rough estimates are ranked only when even their upper figure is below the leader&apos;s floor; otherwise no route can be ranked confidently. Ranking compares what arrives for the same amount sent; what you pay is shown alongside.</P>

            <H id="rounding">Rounding</H>
            <P>Calculations keep full precision (40 significant digits). Rounding happens only for display: receipts, estimates and variances to whole currency units (half-up), amounts you send and fees to the cent, rates to four decimals. “Send at least” figures are rounded up so they always cover the target. The same inputs and schedule always give the same result.</P>

            <H id="limits">Limitations</H>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-label marker:text-deco">
              <li>US to Mexico only. US to India is a test fixture, not a product corridor.</li>
              <li>Fee figures in this demo are illustrative assumptions, not any provider&apos;s published schedule.</li>
              <li>A CEP confirms a known amount on SPEI; it cannot discover an unknown shortfall.</li>
              <li>Estimates are not guarantees. We never move money.</li>
              <li>No route pays to be ranked higher.</li>
            </ul>
          </article>
          <nav aria-label="On this page" className="hidden xl:block">
            <div className="sticky top-6">
              <div className="mb-2 text-xs text-meta">On this page</div>
              <ul className="flex flex-col gap-1 text-[13px]">
                {TOC.map(([id, l]) => (
                  <li key={id}>
                    <a href={`#${id}`} className="text-meta transition-colors hover:text-label">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>
      </div>
    </>
  );
}

const SOURCE_NOTE: Record<SourceClass, string> = {
  live: "from a connected feed (none in this demo)",
  published: "a provider's published schedule",
  provider_quote: "typed from a provider's screen",
  manual: "entered by hand",
  modelled: "an assumption in the fee schedule",
  supplier_reported: "stated by the supplier",
  payer_reported: "stated by you",
  bank_confirmed: "a validated bank record or CEP",
  unavailable: "not known",
};
