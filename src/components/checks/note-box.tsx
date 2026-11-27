"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError } from "@/hooks/use-api";
import { useCheck } from "./check-context";

/** Append-only note on the check's activity (wireframe: "Add a note for the controller…"). */
export function NoteBox() {
  const { id } = useCheck();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await apiSend("POST", `/api/checks/${id}/note`, { text });
      setText("");
      toast.success("Note added. Notes are kept in the audit history.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add the note.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor="note" className="sr-only">
        Add a note for the controller
      </label>
      <Textarea
        id="note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="Add a note for the controller…"
        maxLength={1000}
        className="min-h-[64px]"
      />
      {error && <p className="mt-1 text-xs text-bad-text">{error}</p>}
      {text.trim() && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="text-xs text-meta">Ctrl Enter</span>
          <Button type="submit" size="sm" loading={busy}>
            Comment
          </Button>
        </div>
      )}
    </form>
  );
}
