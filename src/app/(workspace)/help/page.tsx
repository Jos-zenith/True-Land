"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { Kbd } from "@/components/ui/button";
import { useShell } from "@/components/shell/shell-context";

const SHORTCUTS: [string[], string][] = [
  [["Ctrl", "K"], "Open the command menu (⌘K on Mac)"],
  [["C"], "New payment check"],
  [["G", "H"], "Go to overview"],
  [["G", "I"], "Go to inbox"],
  [["G", "O"], "Go to my checks"],
  [["G", "A"], "Go to all checks"],
  [["G", "R"], "Go to route intelligence"],
  [["G", "M"], "Go to methodology"],
  [["G", "E"], "Go to evidence & audit"],
  [["G", "F"], "Go to fee configuration"],
  [["G", "D"], "Go to data sources"],
  [["/"], "Search the current list"],
  [["["], "Collapse or expand the sidebar"],
  [["Ctrl", "Enter"], "Submit the composer or a note"],
  [["Esc"], "Close a dialog, menu or sheet"],
];

export default function HelpPage() {
  const { openComposer } = useShell();
  return (
    <>
      <PageHeader crumbs={[{ label: "Help & shortcuts" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-4 pb-16 pt-8 md:px-8">
          <h1 className="text-[20px] font-[590] tracking-[-0.015em] text-figure">Help</h1>
          <p className="mt-2 text-[13px] text-meta">
            Landed answers one question before you pay an overseas supplier: how much is likely to arrive? It estimates, compares and later reconciles. It never moves money.
          </p>

          <h2 id="walkthrough" className="scroll-mt-16 pt-8 text-[14px] font-[590] text-figure">
            The 10-step walkthrough
          </h2>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-relaxed text-label marker:text-meta">
            <li>
              Open the <Link className="text-accent-hover hover:underline" href="/overview">Overview</Link>.
            </li>
            <li>
              Start a new payment check: press <Kbd>C</Kbd> or{" "}
              <button className="text-accent-hover hover:underline" onClick={() => openComposer()}>
                open the composer
              </button>
              .
            </li>
            <li>Name the supplier, pick the $15,000 ticket (USD → MXN, invoice MXN 255,000 at the sample rate), and keep Bank A and Fintech B.</li>
            <li>Compare routes: see the expected receipt, the low–high range and whether a route is more favourable or too close to call.</li>
            <li>Inspect fee evidence: “How MXN … is built” shows every component with its source, time and classification.</li>
            <li>Enter a provider quote in the Provider quote panel, for example MXN 253,400 for Fintech B.</li>
            <li>Record the selected route. No money moves; the estimate you saw is frozen.</li>
            <li>Record the actual amount received on the Outcome tab, for example MXN 253,100 reported by the supplier. Optionally run the demo receipt check.</li>
            <li>View the reconciliation: our error, the quote&apos;s error, and which was closer.</li>
            <li>
              Inspect the audit history on the check, or across the workspace in{" "}
              <Link className="text-accent-hover hover:underline" href="/audit">Evidence & audit</Link>.
            </li>
          </ol>

          <h2 className="pt-8 text-[14px] font-[590] text-figure">Seeded examples</h2>
          <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-label">
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-014">CHK-014</Link> <span className="text-meta">· one route more favourable, with a provider quote</span></li>
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-015">CHK-015</Link> <span className="text-meta">· dollar invoice by USD wire: SHA, OUR, BEN and a top-up</span></li>
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-016">CHK-016</Link> <span className="text-meta">· overlapping ranges: too close to call</span></li>
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-013">CHK-013</Link> <span className="text-meta">· stale rate, and a stablecoin route excluded as unverified</span></li>
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-018">CHK-018</Link> <span className="text-meta">· rough estimate: a receiving fee is unknown, so no rank</span></li>
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-017">CHK-017</Link> <span className="text-meta">· no eligible route by the deadline</span></li>
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-019">CHK-019</Link> <span className="text-meta">· calculation failed; retry works</span></li>
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-009">CHK-009</Link> <span className="text-meta">· reconciled, actual outside the range</span></li>
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-010">CHK-010</Link> <span className="text-meta">· reconciled and verified by a demo receipt check</span></li>
            <li><Link className="font-[510] hover:text-figure" href="/checks/CHK-011">CHK-011</Link> <span className="text-meta">· reply overdue</span></li>
          </ul>

          <h2 id="shortcuts" className="scroll-mt-16 pt-8 text-[14px] font-[590] text-figure">
            Keyboard shortcuts
          </h2>
          <p className="mt-1 text-[13px] text-meta">Single-key shortcuts are off while you are typing or while a dialog is open.</p>
          <table className="mt-3 w-full text-[13px]">
            <tbody>
              {SHORTCUTS.map(([keys, label]) => (
                <tr key={label} className="border-b border-hairline">
                  <td className="py-2 pr-4 text-label">{label}</td>
                  <td className="py-2 text-right">
                    <span className="inline-flex items-center gap-1">
                      {keys.map((k, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          {i > 0 && keys[0] === "G" && <span className="text-xs text-meta">then</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="pt-8 text-[14px] font-[590] text-figure">Glossary</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-[160px_1fr]">
            <dt className="font-[510] text-label">Landed amount</dt>
            <dd className="text-meta">What reaches the supplier&apos;s account after every cost on the way.</dd>
            <dt className="font-[510] text-label">SHA / OUR / BEN</dt>
            <dd className="text-meta">Wire charge codes: shared, you pay all, supplier pays all. Banks may not honour them exactly.</dd>
            <dt className="font-[510] text-label">SPEI and CEP</dt>
            <dd className="text-meta">Mexico&apos;s instant payment system and its electronic payment receipt, which can confirm an amount.</dd>
            <dt className="font-[510] text-label">Mid-market rate</dt>
            <dd className="text-meta">The midpoint benchmark rate, before any provider margin.</dd>
            <dt className="font-[510] text-label">Too close to call</dt>
            <dd className="text-meta">The ranges of two routes overlap, so neither is ranked above the other.</dd>
          </dl>
          <p className="mt-8 text-xs text-meta">
            More detail in <Link className="text-label hover:text-figure" href="/methodology">Methodology</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
