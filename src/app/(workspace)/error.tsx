"use client";

import { ErrorState } from "@/components/ui/feedback";

export default function WorkspaceError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState title="This view failed to load" message={`${error.message || "Unexpected error."} Nothing was saved.`} onRetry={reset} />;
}
