import { route, parseBody, type RouteArgs } from "@/server/http";
import { mutate, readDb } from "@/server/db";
import { getCheck, ServiceError } from "@/server/core";
import { authorize } from "@/server/auth/authz";
import type { Database } from "@/server/model";
import * as svc from "@/server/services/checks";
import { selectVerifier } from "@/server/verification";
import { cepSchema, choiceSchema, correctionSchema, noteSchema, outcomeSchema, planChangeSchema, quoteSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type P = { id: string; action: string };

/** Receipt check: the verifier runs first (it may use the network), then the result is recorded. */
async function receiptCheck({ req, params, auth, ctx }: RouteArgs<P>) {
  authorize(auth.access, "evidence:verify");
  const b = await parseBody(req, cepSchema);
  const db = await readDb(auth.scope);
  const check = getCheck(db, params.id); // 404 for other tenants; fails before any network call
  if (!check.choice) throw new ServiceError(409, "STATE", "Record the route you used first.");
  const verifier = selectVerifier(b.mode === "demo" ? { mode: "demo", fixture: b.demo! } : { mode: "live" }, db.workspace);
  const { beneficiaryAccount, mode: _mode, demo: _demo, ...rest } = b;
  void _mode;
  void _demo;
  const claim = { ...rest, trackingKey: rest.trackingKey ?? null };
  const result = await verifier.verify({ ...claim, beneficiaryAccount: beneficiaryAccount ?? null }, { checkId: check.id });
  // The beneficiary account is not passed on: it never reaches storage.
  const out = await mutate(auth.scope, (d) => svc.recordReceiptCheck(d, params.id, claim, result, ctx));
  return { evidence: out.evidence };
}

export const POST = route<P>("check:write", async (a) => {
  const { req, params, auth, ctx } = a;
  const { id, action } = params;
  const run = <T,>(fn: (db: Database) => T) => mutate(auth.scope, fn);
  switch (action) {
    case "recalculate":
      return run((db) => svc.recalculate(db, id, ctx)).then((x) => ({ id: x.id, calcError: x.calcError }));
    case "quote": {
      const b = await parseBody(req, quoteSchema);
      return run((db) => svc.addQuote(db, id, b, ctx)).then((x) => ({ id: x.id }));
    }
    case "choice": {
      const b = await parseBody(req, choiceSchema);
      return run((db) => svc.recordChoice(db, id, b, ctx)).then((x) => ({ id: x.id }));
    }
    case "outcome": {
      const b = await parseBody(req, outcomeSchema);
      return run((db) => svc.recordOutcome(db, id, b, ctx)).then((x) => ({ id: x.id, status: x.status }));
    }
    case "correction": {
      const b = await parseBody(req, correctionSchema);
      return run((db) => svc.correctOutcome(db, id, b, ctx)).then((x) => ({ id: x.id }));
    }
    case "cep":
      return receiptCheck(a);
    case "plan-change": {
      const b = await parseBody(req, planChangeSchema);
      return run((db) => svc.recordPlanChange(db, id, b.answer, ctx)).then((x) => ({ id: x.id }));
    }
    case "note": {
      const b = await parseBody(req, noteSchema);
      return run((db) => svc.addNote(db, id, b.text, ctx)).then((x) => ({ id: x.id }));
    }
    case "archive":
      return run((db) => svc.setArchived(db, id, true, ctx)).then((x) => ({ id: x.id }));
    case "restore":
      return run((db) => svc.setArchived(db, id, false, ctx)).then((x) => ({ id: x.id }));
    case "duplicate":
      return run((db) => svc.duplicateCheck(db, id, ctx)).then((x) => ({ id: x.id }));
    default:
      throw new ServiceError(404, "NOT_FOUND", `Unknown action "${action}".`);
  }
});
