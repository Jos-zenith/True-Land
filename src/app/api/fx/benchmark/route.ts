import { z } from "zod";
import { route, parseBody } from "@/server/http";
import { mutate } from "@/server/db";
import { ServiceError } from "@/server/core";
import { adoptReferenceRate } from "@/server/services/fees";
import { fetchBenchmark } from "@/server/integrations/service";
import { listSnapshots } from "@/server/integrations/store";

export const dynamic = "force-dynamic";

const PAIRS = ["MXN", "INR"] as const; // USD/MXN is the live corridor; USD/INR is the control corridor (display only)

/** Recorded benchmark snapshots (no network call). */
export const GET = route("read", async ({ req }) => {
  const quote = new URL(req.url).searchParams.get("quote") ?? "MXN";
  if (!PAIRS.includes(quote as (typeof PAIRS)[number])) throw new ServiceError(422, "VALIDATION", "Supported pairs: USD/MXN, USD/INR.");
  return { items: await listSnapshots("USD", quote, 10) };
});

const body = z.object({ quote: z.enum(PAIRS).default("MXN"), adopt: z.boolean().default(false) });

/**
 * Query the reference-rate sources now, apply the benchmark policy and record the snapshot. With
 * `adopt` (USD/MXN only), a usable benchmark becomes the workspace's current rate for NEW estimates.
 */
export const POST = route("rates:write", async ({ req, auth, ctx }) => {
  const b = await parseBody(req, body);
  const snapshot = await fetchBenchmark("USD", b.quote, ctx.nowMs);
  let adoptedRateId: string | null = null;
  let adoptError: string | null = null;
  if (b.adopt) {
    if (b.quote !== "MXN") adoptError = "USD/INR is a control corridor: it is recorded but never used for estimates.";
    else {
      try {
        adoptedRateId = (await mutate(auth.scope, (db) => adoptReferenceRate(db, snapshot, ctx))).id;
      } catch (e) {
        if (e instanceof ServiceError) adoptError = e.message;
        else throw e;
      }
    }
  }
  return { snapshot, adoptedRateId, adoptError };
});
