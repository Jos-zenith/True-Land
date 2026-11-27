"use client";

import { shortSupplierId } from "@/lib/pseudonym";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { Archive, ArchiveRestore, Copy, CopyPlus, FileText, Link2, MoreHorizontal, RotateCw } from "lucide-react";
import { PageHeader, PropertyList, PropertyRow } from "@/components/ui/layout";
import { Button, IconButton } from "@/components/ui/button";
import { EvidenceChip, Glyph } from "@/components/ui/chip";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { CheckContext, type Detail } from "@/components/checks/check-context";
import { RecordChoiceDialog } from "@/components/checks/record-choice";
import { ExportPopover } from "@/components/checks/export-popover";
import { QuotePanel } from "@/components/checks/quote-panel";
import { supplierRequestText, useCheckActions } from "@/components/checks/check-row";
import { useShell } from "@/components/shell/shell-context";
import { apiSend, ApiError, useApi } from "@/hooks/use-api";
import { useNicknames } from "@/hooks/use-nicknames";
import { fmtDate, fmtMoney, fmtRate } from "@/lib/format";
import { PAYOUT_LABEL } from "@/lib/labels";
import { providerNames } from "@/components/checks/util";

const TABS = [
  { seg: "compare", label: "Compare" },
  { seg: "evidence", label: "Evidence" },
  { seg: "outcome", label: "Outcome" },
  { seg: "reconciled", label: "Reconciled" },
] as const;

export default function CheckLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const seg = pathname.split("/")[3] ?? "";
  const { data, error, loading, reload } = useApi<Detail>(`/api/checks/${id}`);
  const { nameFor } = useNicknames();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const { openRateDialog } = useShell();
  const toast = useToast();

  useEffect(() => setFocusId(null), [id]);

  const updateRate = useCallback(async () => {
    const est = data?.estimate;
    const recalc = async () => {
      try {
        await apiSend("POST", `/api/checks/${id}/recalculate`);
        toast.success(`New estimate added for ${id} with the latest rate. The previous estimate is kept.`);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not recalculate.");
      }
    };
    if (est?.newerRateAvailable) await recalc();
    else openRateDialog(() => void recalc());
  }, [data?.estimate, id, openRateDialog, toast]);

  const ctx = useMemo(() => {
    if (!data) return null;
    const opts = data.estimate?.options ?? [];
    const fid = focusId && opts.some((o) => o.optionId === focusId) ? focusId : data.estimate?.focusOptionId ?? null;
    return {
      id: data.summary.id,
      detail: data,
      nickname: nameFor(data.summary.supplierHash),
      focusId: fid,
      setFocusId,
      focus: opts.find((o) => o.optionId === fid) ?? null,
      reload,
      openChoice: () => setChoiceOpen(true),
      updateRate,
    };
  }, [data, focusId, nameFor, reload, updateRate]);

  if (error && !data) {
    return (
      <>
        <PageHeader crumbs={[{ label: "All checks", href: "/checks" }, { label: id }]} />
        <ErrorState
          title={error.status === 404 ? `Check ${id} does not exist` : "We couldn't load this check"}
          message={error.status === 404 ? "It may have been created in another demo session. Search with Ctrl K." : error.message}
          onRetry={error.status === 404 ? undefined : reload}
        />
      </>
    );
  }
  if (loading || !ctx) {
    return (
      <>
        <PageHeader crumbs={[{ label: "My checks", href: "/my-checks" }, { label: id }]} />
        <div className="mx-auto w-full max-w-[760px] px-6 pt-10" aria-busy="true">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="mt-3 h-4 w-1/2" />
          <Skeleton className="mt-6 h-24 w-full" />
          <Skeleton className="mt-6 h-16 w-full" />
          <Skeleton className="mt-2 h-16 w-full" />
          <p className="mt-4 text-[13px] text-meta">Loading the saved estimate… No partial numbers are shown.</p>
        </div>
      </>
    );
  }

  const d = ctx.detail;
  const s = d.summary;
  const visibleTabs = TABS.filter((t) => t.seg === "compare" || t.seg === "evidence" || (t.seg === "outcome" && !!d.choice) || (t.seg === "reconciled" && s.status === "reconciled"));
  const listCrumb = s.mine ? { label: "My checks", href: "/my-checks" } : { label: "All checks", href: "/checks" };
  const tabLabel = TABS.find((t) => t.seg === seg)?.label;

  return (
    <CheckContext.Provider value={ctx}>
      <PageHeader crumbs={[listCrumb, { label: s.id, href: `/checks/${s.id}` }, ...(tabLabel && seg !== d.defaultView ? [{ label: tabLabel }] : [])]} actions={<HeaderActions seg={seg} />} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline px-3 no-scrollbar md:px-5" role="tablist" aria-label="Check stages">
          {visibleTabs.map((t) => (
            <Link
              key={t.seg}
              href={`/checks/${s.id}/${t.seg}`}
              role="tab"
              aria-selected={seg === t.seg}
              className={clsx(
                "relative flex h-10 items-center px-2.5 text-[13px] font-[510] transition-colors",
                seg === t.seg ? "text-figure after:absolute after:inset-x-2 after:bottom-[-1px] after:h-[2px] after:rounded-full after:bg-accent" : "text-meta hover:text-label",
              )}
            >
              {t.label}
            </Link>
          ))}
          <span className="ml-auto hidden shrink-0 items-center gap-2 pl-4 text-xs text-meta sm:flex">
            {s.isDemo && <span className="rounded-[4px] border border-hairline-strong px-1.5 py-px">Demo data</span>}
            {s.archived && <span className="rounded-[4px] border border-hairline-strong px-1.5 py-px">Archived</span>}
          </span>
        </div>
        <div className="grid flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 px-4 pb-16 pt-7 md:px-8">{children}</div>
          <aside className="border-t border-hairline px-4 py-6 md:px-8 xl:border-l xl:border-t-0 xl:px-6">
            <Properties />
          </aside>
        </div>
      </div>
      <RecordChoiceDialog open={choiceOpen} onOpenChange={setChoiceOpen} />
    </CheckContext.Provider>
  );
}

function HeaderActions({ seg }: { seg: string }) {
  const ctx = useMemoCheck();
  const router = useRouter();
  const toast = useToast();
  const { openComposer } = useShell();
  const actions = useCheckActions();
  const [busy, setBusy] = useState(false);
  if (!ctx) return null;
  const { detail: d, focus, nickname, id } = ctx;
  const s = d.summary;

  const recalc = async () => {
    setBusy(true);
    try {
      const r = await apiSend<{ calcError: unknown }>("POST", `/api/checks/${id}/recalculate`);
      if (r.calcError) toast.error(`The calculation failed again for ${id}. Inputs are saved.`);
      else toast.success(`${id} estimated. No money was sent.`);
      router.push(`/checks/${id}/compare`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not calculate.");
    } finally {
      setBusy(false);
    }
  };

  const editInputs = () =>
    openComposer({
      mode: "edit",
      checkId: id,
      prefill: {
        nickname: s.supplierHash,
        invoiceAmount: d.inputs.invoiceAmount,
        invoiceCurrency: d.inputs.invoiceCurrency as "MXN" | "USD",
        sendAmount: d.inputs.sendAmount,
        payBy: d.inputs.payBy,
        payoutMethod: d.inputs.payoutMethod as "spei_mxn" | "usd_account",
        providers: d.inputs.providers,
        invoiceRef: d.inputs.invoiceRef,
        chargeCode: d.inputs.chargeCode,
      },
    });

  const request = supplierRequestText({ id, route: d.choice?.displayLabel ?? null, sendAmount: d.choice?.snapshot.sendAmount ?? d.inputs.sendAmount, currency: d.choice?.snapshot.currency ?? d.inputs.invoiceCurrency, paidOn: d.choice?.paidOn });

  let primary: ReactNode = null;
  if (s.status === "draft" || d.calcError) {
    primary = (
      <Button variant="primary" loading={busy} onClick={recalc} icon={<RotateCw size={13} />}>
        {d.calcError ? "Retry" : "Compare routes"}
      </Button>
    );
  } else if (s.status === "choose_route" && d.actions.canRecordChoice && focus) {
    primary = (
      <Button variant="primary" onClick={ctx.openChoice}>
        <span className="max-w-[260px] truncate">
          Record choice<span className="hidden sm:inline">: {focus.optionLabel ? `${focus.label.replace(/ USD wire$/, "")} ${focus.optionLabel}${focus.isTopUp ? `, send ${Number(focus.sendAmount).toLocaleString("en-US")}` : ""}` : focus.label.split(",")[0]}</span>
        </span>
      </Button>
    );
  } else if (d.actions.canRecordOutcome) {
    primary =
      seg === "outcome" ? (
        <Button variant="primary" type="submit" form="outcome-form">
          Save outcome
        </Button>
      ) : (
        <Button variant="primary" onClick={() => router.push(`/checks/${id}/outcome`)}>
          Record outcome
        </Button>
      );
  }

  return (
    <>
      <Tip content="Copy link">
        <IconButton
          label="Copy link"
          className="max-sm:hidden"
          onClick={async () => {
            await navigator.clipboard.writeText(`${location.origin}/checks/${id}`);
            toast.success("Link copied.");
          }}
        >
          <Link2 size={15} />
        </IconButton>
      </Tip>
      <div className="hidden sm:block">
        <ExportPopover id={id} nickname={nickname} />
      </div>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label="More actions">
            <MoreHorizontal size={15} />
          </IconButton>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<FileText size={14} />} onSelect={() => window.open(`/report/${id}`, "_blank")}>
            Open one-page report (PDF)
          </MenuItem>
          <MenuItem icon={<Copy size={14} />} onSelect={() => actions.copyRequest(request)} disabled={!d.choice}>
            Copy request to supplier
          </MenuItem>
          <MenuItem icon={<CopyPlus size={14} />} onSelect={() => actions.duplicate(id)}>
            Duplicate as new check
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={s.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} onSelect={() => actions.archive(id, s.archived)}>
            {s.archived ? "Restore" : "Archive (record is kept)"}
          </MenuItem>
        </MenuContent>
      </Menu>
      {d.actions.canEditInputs && s.status !== "draft" && !d.calcError && (
        <Button className="max-md:hidden" onClick={editInputs}>
          Edit inputs
        </Button>
      )}
      {s.status === "draft" && (
        <Button className="max-md:hidden" onClick={editInputs}>
          Edit inputs
        </Button>
      )}
      {d.actions.canRecordOutcome && seg === "outcome" && (
        <Button className="max-md:hidden" onClick={() => actions.copyRequest(request)}>
          Copy request to supplier
        </Button>
      )}
      {s.status === "reconciled" && (
        <>
          <ExportPopover id={id} nickname={nickname} trigger="csv" />
          <Button className="max-sm:hidden" onClick={() => window.open(`/report/${id}`, "_blank")}>
            Export PDF
          </Button>
        </>
      )}
      {primary}
    </>
  );
}

/** HeaderActions and Properties render inside the provider, so they read the context directly. */
function useMemoCheck() {
  return useContext(CheckContext);
}

function Properties() {
  const ctx = useMemoCheck()!;
  const { detail: d, nickname } = ctx;
  const s = d.summary;
  const est = d.estimate;
  return (
    <div className="flex flex-col gap-6">
      <PropertyList>
        <PropertyRow label="Status">
          <span className="inline-flex items-center gap-1.5">
            <Glyph glyph={s.group === "reconciled" ? "dot" : s.group === "awaiting_receipt" ? "half" : s.group === "reply_overdue" ? "dot" : "ring"} tone={s.group === "reply_overdue" ? "short" : s.group === "calc_failed" ? "error" : s.group === "awaiting_receipt" ? "warn" : "neutral"} />
            {s.statusLabel}
          </span>
        </PropertyRow>
        <PropertyRow label="Supplier">
          {nickname.startsWith("Supplier #") ? nickname : <>{nickname} <span className="text-meta">#{shortSupplierId(s.supplierHash)}</span></>}
        </PropertyRow>
        <PropertyRow label="Selected route">{d.choice ? d.choice.displayLabel : <span className="text-meta">Not yet</span>}</PropertyRow>
        <PropertyRow label="Invoice">
          <span className="tnum">{fmtMoney(d.inputs.invoiceAmount, d.inputs.invoiceCurrency, 2).replace(/\.00$/, "")}</span>
        </PropertyRow>
        <PropertyRow label="You pay in">USD</PropertyRow>
        <PropertyRow label="Supplier receives">{PAYOUT_LABEL[d.inputs.payoutMethod as keyof typeof PAYOUT_LABEL]}</PropertyRow>
        <PropertyRow label="Pay by">{fmtDate(d.inputs.payBy)}</PropertyRow>
        <PropertyRow label="Providers">{providerNames(d.inputs.providers)}</PropertyRow>
        {d.choice && <PropertyRow label="Paid on">{fmtDate(d.choice.paidOn)}</PropertyRow>}
        <PropertyRow label="Reply due">{d.choice ? <span className={clsx(d.actions.replyOverdue && "text-short")}>{fmtDate(d.choice.replyDue)}{d.actions.replyOverdue && ", overdue"}</span> : <span className="text-meta">After payment</span>}</PropertyRow>
        <PropertyRow label="Evidence">
          <EvidenceChip level={s.evidence} />
        </PropertyRow>
        {d.inputs.invoiceRef && <PropertyRow label="Invoice ref">{d.inputs.invoiceRef}</PropertyRow>}
        {d.planChange && <PropertyRow label="Plan change">{d.planChange[0].toUpperCase() + d.planChange.slice(1)}</PropertyRow>}
      </PropertyList>

      {d.actions.canAddQuote && <QuotePanel />}
      {!d.actions.canAddQuote && d.quotes.length > 0 && (
        <div className="text-[13px]">
          <h2 className="mb-2 text-meta">Provider quote</h2>
          {d.quotes.filter((q) => q.current).map((q) => (
            <p key={q.id} className="text-label">
              <span className="tnum font-[590] text-figure">{fmtMoney(q.quotedReceipt, q.currency)}</span> from {q.routeLabel.split(",")[0]}. <span className="text-meta">{q.sentence}</span>
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-hairline pt-4">
        <PropertyList title="Calculation">
          <PropertyRow label="Version">{est ? `calc ${est.calcVersion} · schedule v${est.scheduleVersion}` : "—"}</PropertyRow>
          <PropertyRow label="Rate">
            {est?.mode === "cover" ? (
              <span className="text-meta">No conversion (USD to USD)</span>
            ) : est?.rate ? (
              <span className="flex flex-col gap-0.5">
                <span className={clsx("tnum", est.rateStale && "text-warn")}>
                  {fmtRate(est.rate.rate)} · {est.rateAgeLabel} old{est.rateStale ? ", stale" : ""}
                </span>
                <span className="text-meta">{est.rate.isDemo ? "Sample rate, manually entered (demo)" : est.rate.source}</span>
              </span>
            ) : est ? (
              <span className="text-meta">No conversion</span>
            ) : (
              "—"
            )}
          </PropertyRow>
          <PropertyRow label="Estimates">{d.estimateHistory.length} saved{d.estimateHistory.length > 1 ? ", none changed" : ""}</PropertyRow>
        </PropertyList>
      </div>
    </div>
  );
}
