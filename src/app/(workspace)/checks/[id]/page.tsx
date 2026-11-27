import { notFound, redirect } from "next/navigation";
import { readDb } from "@/server/db";
import { requirePageSession } from "@/server/auth/page";

export const dynamic = "force-dynamic";

/** One check, one page: open the stage that matches the check's status. */
export default async function CheckIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePageSession(`/checks/${id}`);
  const check = (await readDb(s.scope)).checks.find((c) => c.id.toLowerCase() === id.toLowerCase());
  if (!check) notFound();
  const view =
    check.status === "reconciled" ? "reconciled" : check.status === "awaiting_receipt" || check.status === "no_reply" || check.status === "refused" ? "outcome" : "compare";
  redirect(`/checks/${check.id}/${view}`);
}
