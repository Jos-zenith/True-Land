"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader, PropertyList, PropertyRow } from "@/components/ui/layout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { useShell } from "@/components/shell/shell-context";
import { apiSend, ApiError } from "@/hooks/use-api";
import { clearNicknames, mergeDemoNicknames, useNicknames } from "@/hooks/use-nicknames";
import { fmtStamp } from "@/lib/format";
import { MembersSection } from "@/components/shell/members";

export default function SettingsPage() {
  const { meta } = useShell();
  const { map } = useNicknames();
  const toast = useToast();
  const router = useRouter();
  const [reset, setReset] = useState(false);
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const f = meta?.freshness;

  const doReset = async () => {
    setBusy(true);
    try {
      await apiSend("POST", "/api/demo/reset");
      if (meta?.demoNicknames) mergeDemoNicknames(meta.demoNicknames);
      toast.success("Demo data reset. Timestamps now start from this moment.");
      setReset(false);
      router.push("/overview");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not reset the demo data.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader crumbs={[{ label: "Settings" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-10 px-4 pb-16 pt-8 md:px-8">
          <section>
            <h1 className="text-[20px] font-[590] tracking-[-0.015em] text-figure">Settings</h1>
            <div className="mt-5">
              <PropertyList title="Workspace">
                <PropertyRow label="Name">{meta?.workspace.name}</PropertyRow>
                <PropertyRow label="Type">{meta?.workspace.isDemo ? "Demo workspace (illustrative data)" : "Workspace"}</PropertyRow>
                <PropertyRow label="Corridor">United States → Mexico</PropertyRow>
                <PropertyRow label="You">
                  {meta?.user.name} · {meta?.user.role}
                  {` · ${meta?.user.access ?? ""}`}
                </PropertyRow>
                <PropertyRow label="Demo started">{meta ? fmtStamp(meta.seededAt) : "—"}</PropertyRow>
              </PropertyList>
            </div>
          </section>

          <section>
            <PropertyList title="Rules in force (read-only)">
              <PropertyRow label="Calculation">{meta?.calcVersion}</PropertyRow>
              <PropertyRow label="Fee schedule">v{meta?.schedule.version}</PropertyRow>
              <PropertyRow label="Rate stale after">{f?.rateStaleAfterHours} hours</PropertyRow>
              <PropertyRow label="Schedule stale">{f?.scheduleStaleAfterDays} days (proposed)</PropertyRow>
              <PropertyRow label="Reply window">{f?.replyWindowDays} days after payment</PropertyRow>
            </PropertyList>
          </section>

          <section aria-labelledby="privacy">
            <h2 id="privacy" className="mb-2 text-[13px] text-meta">Privacy on this device</h2>
            <p className="text-[13px] text-label">
              Supplier nicknames stay in this browser. The server receives only a keyed hash of the nickname and stores a second, server-keyed pseudonym. This device knows {Object.keys(map).length} nickname{Object.keys(map).length === 1 ? "" : "s"}. Beneficiary account numbers are used for one receipt check and are never stored.
            </p>
            <Button className="mt-3" onClick={() => setClear(true)}>
              Forget nicknames on this device
            </Button>
          </section>

          <MembersSection canManage={!!meta?.permissions["members:manage"]} />

          {meta?.workspace.isDemo && meta.permissions["demo:reset"] && (
          <section id="reset" aria-labelledby="reset-h" className="scroll-mt-16">
            <h2 id="reset-h" className="mb-2 text-[13px] text-meta">Demo data</h2>
            <p className="text-[13px] text-label">Restore the sample data: 13 illustrative checks, sample rates and fee schedules v3 and v4. Checks you created are removed. Timestamps are re-based on now, so freshness behaves the same whenever you start.</p>
            <Button variant="danger" className="mt-3" onClick={() => setReset(true)}>
              Reset demo data…
            </Button>
          </section>
          )}
        </div>
      </div>
      <Dialog
        open={reset}
        onOpenChange={setReset}
        title="Reset the demo data?"
        description="All checks, quotes, outcomes, configuration changes and their audit history in this demo workspace are purged and replaced by the original sample data. This cannot be undone."
        footer={
          <>
            <Button onClick={() => setReset(false)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={doReset}>
              Reset demo data
            </Button>
          </>
        }
      />
      <Dialog
        open={clear}
        onOpenChange={setClear}
        title="Forget nicknames on this device?"
        description="Checks will show the hashed supplier ID instead. Demo nicknames return the next time the page loads."
        footer={
          <>
            <Button onClick={() => setClear(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                clearNicknames();
                setClear(false);
                toast.success("Nicknames removed from this device.");
              }}
            >
              Forget nicknames
            </Button>
          </>
        }
      />
    </>
  );
}
