"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError } from "@/hooks/use-api";

const ANSWERS = [
  { value: "route", label: "Route", hint: "We used a different route because of the check" },
  { value: "amount", label: "Amount", hint: "We sent a different amount" },
  { value: "timing", label: "Timing", hint: "We paid earlier or later" },
  { value: "nothing", label: "Nothing", hint: "We would have done the same" },
] as const;

/** Asked on save (wireframe): "Did this change your plan?" Route, Amount, Timing, Nothing. */
export function PlanChangeDialog({ checkId, open, onDone }: { checkId: string; open: boolean; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const answer = async (a: string) => {
    setBusy(a);
    try {
      await apiSend("POST", `/api/checks/${checkId}/plan-change`, { answer: a });
      toast.success("Thanks. Your answer is saved to the audit history.");
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save the answer.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onDone()}
      title="Did this check change your plan?"
      description="This helps judge whether checking before paying is useful. You can skip it."
      footer={
        <Button variant="ghost" onClick={onDone}>
          Skip
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {ANSWERS.map((a) => (
          <button
            key={a.value}
            onClick={() => answer(a.value)}
            disabled={!!busy}
            className="flex min-h-[64px] flex-col items-start rounded-[8px] border border-hairline-strong px-3 py-2.5 text-left transition-colors hover:border-control hover:bg-hover disabled:opacity-50"
          >
            <span className="text-[13px] font-[590] text-figure">{a.label}</span>
            <span className="mt-0.5 text-xs text-meta">{a.hint}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
