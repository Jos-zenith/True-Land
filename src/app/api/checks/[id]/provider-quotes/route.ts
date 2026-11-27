import { z } from "zod";
import { route, parseBody } from "@/server/http";
import { mutate, readDb } from "@/server/db";
import { addEvent, getCheck, latestEstimate, ServiceError } from "@/server/core";
import { analyseProviderQuote, EngineError } from "@/engine";
import { fmtMoney } from "@/lib/format";
import { requestWiseQuote } from "@/server/integrations/service";
import { listProviderQuotes, saveProviderQuote, type StoredProviderQuote } from "@/server/integrations/store";
import { effectiveQuoteStatus } from "@/server/integrations/quotes/types";
import { IntegrationError } from "@/server/integrations/http";

export const dynamic = "force-dynamic";

const CLASS_LABEL = {
  authenticated_quote: "Wise provider quote (authenticated, profile-specific)",
  unauthenticated_quote: "Wise provider quote (unauthenticated: illustrative pricing, not an offer)",
  manual: "Manually entered quote",
  unavailable: "Quote unavailable",
} as const;

function view(q: StoredProviderQuote, nowMs: number) {
  const status = effectiveQuoteStatus(q, nowMs);
  let analysis = null;
  let analysisError: string | null = null;
  if (q.sourceAmount && q.targetAmount && q.benchmarkRate) {
    try {
      analysis = analyseProviderQuote({
        sourceAmount: q.sourceAmount,
        targetAmount: q.targetAmount,
        providerRate: q.exchangeRate ?? null,
        fee: q.totalFee ?? null,
        feeCurrency: q.feeCurrency ?? null,
        sourceCurrency: q.sourceCurrency,
        benchmarkRate: q.benchmarkRate,
      });
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      analysisError = e.message;
    }
  }
  return {
    ...q,
    status,
    // Expired, blocked or disabled quotes are kept as evidence but are never used as a current comparison.
    current: status === "available",
    classificationLabel: CLASS_LABEL[q.evidenceClassification],
    analysis,
    analysisError,
  };
}

export const GET = route<{ id: string }>("read", async ({ params, auth, nowMs }) => {
  const db = await readDb(auth.scope);
  const check = getCheck(db, params.id); // 404 outside the caller's workspace
  return { items: (await listProviderQuotes(auth.workspaceId, check.id)).map((q) => view(q, nowMs)) };
});

const body = z.object({ provider: z.literal("wise") });

/** Request a Wise quote for this check's amount. Quote retrieval only: nothing is executed. */
export const POST = route<{ id: string }>("check:write", async ({ req, params, auth, ctx, nowMs }) => {
  await parseBody(req, body);
  const db = await readDb(auth.scope);
  const check = getCheck(db, params.id);
  if (check.archived) throw new ServiceError(409, "ARCHIVED", `${check.id} is archived.`);
  if (check.status !== "choose_route") throw new ServiceError(409, "STATE", "Provider quotes are gathered before a route is recorded.");
  if (check.inputs.payoutMethod !== "spei_mxn") throw new ServiceError(422, "VALIDATION", "Wise quotes are requested for peso (MXN) payouts only in this release.");
  const est = latestEstimate(check);
  if (!est?.rate) throw new ServiceError(409, "NO_ESTIMATE", "Compare routes first: the quote is compared with the estimate's benchmark rate.");

  let q;
  try {
    q = await requestWiseQuote({ sourceCurrency: "USD", targetCurrency: "MXN", sourceAmount: check.inputs.sendAmount, payIn: "BANK_TRANSFER", payOut: "BANK_TRANSFER" }, nowMs);
  } catch (e) {
    if (e instanceof IntegrationError) {
      const status = e.kind === "not_configured" ? 503 : e.kind === "invalid_request" || e.kind === "unsupported_currency" ? 422 : e.kind === "rate_limit" ? 429 : 502;
      throw new ServiceError(status, `WISE_${e.kind.toUpperCase()}`, `${e.message} No quote was recorded. You can still enter a quote manually.`);
    }
    throw e;
  }
  const stored = await saveProviderQuote({
    workspaceId: auth.workspaceId,
    checkId: check.id,
    q,
    benchmarkRate: est.rate.rate,
    benchmarkReference: est.rate.benchmarkId ? `benchmark ${est.rate.benchmarkId}` : `${est.rate.source} (rate ${est.rate.id})`,
    requestedBy: auth.userId,
  });
  const v = view(stored, nowMs);
  const what =
    v.status === "available" && q.targetAmount
      ? `${fmtMoney(q.targetAmount, "MXN", 2)} for ${fmtMoney(q.sourceAmount ?? check.inputs.sendAmount, "USD", 2)} at rate ${q.exchangeRate}, fee ${q.totalFee} ${q.feeCurrency}`
      : `status ${v.status}`;
  await mutate(auth.scope, (d) =>
    addEvent(d, getCheck(d, check.id), ctx.actor, "quote_added", `${CLASS_LABEL[q.evidenceClassification]} retrieved: ${what}. Evidence ${q.rawResponseReference?.slice(0, 12) ?? "n/a"}. Nothing was sent.`, nowMs),
  );
  return { quote: v };
});
