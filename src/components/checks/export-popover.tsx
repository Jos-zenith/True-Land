"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger, Tip } from "@/components/ui/overlay";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { invalidateAll } from "@/hooks/use-api";
import { withNicknameRow } from "@/lib/csv";

/** Export popover (wireframe): choose what to include. The supplier nickname is left out by default. */
export function ExportPopover({ id, nickname, trigger = "icon" }: { id: string; nickname: string; trigger?: "icon" | "csv" }) {
  const toast = useToast();
  const [inc, setInc] = useState({ inputs: true, evidence: true, quote: true, nickname: false });
  const download = async () => {
    const include = Object.entries(inc)
      .filter(([k, v]) => v && k !== "nickname")
      .map(([k]) => k)
      .join(",");
    // The nickname never leaves this device: it is added to the downloaded file here, not by the server.
    const url = `/api/checks/${id}/export?include=${include}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const text = await res.text();
      const blob = new Blob([inc.nickname && nickname ? withNicknameRow(text, nickname) : text], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${id}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Export ready: ${id}.csv`);
      void invalidateAll();
    } catch {
      toast.error("The export failed. Nothing was downloaded.");
    }
  };
  return (
    <Popover>
      {trigger === "icon" ? (
        <Tip content="Export">
          <PopoverTrigger asChild>
            <IconButton label="Export">
              <Download size={15} />
            </IconButton>
          </PopoverTrigger>
        </Tip>
      ) : (
        <PopoverTrigger asChild>
          <Button>Export CSV</Button>
        </PopoverTrigger>
      )}
      <PopoverContent className="w-[260px]">
        <div className="mb-2 text-[13px] font-[590] text-figure">Include</div>
        <div className="flex flex-col gap-2">
          <Checkbox checked={inc.inputs} onChange={(v) => setInc({ ...inc, inputs: v })} label="Inputs and estimate" />
          <Checkbox checked={inc.evidence} onChange={(v) => setInc({ ...inc, evidence: v })} label="Evidence snapshot" />
          <Checkbox checked={inc.quote} onChange={(v) => setInc({ ...inc, quote: v })} label="Quote and both errors" />
          <Checkbox checked={inc.nickname} onChange={(v) => setInc({ ...inc, nickname: v })} label="Supplier nickname" />
        </div>
        <PopoverClose asChild>
          <Button variant="primary" className="mt-3" onClick={download}>
            Download CSV
          </Button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}
