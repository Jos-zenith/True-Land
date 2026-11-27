import { route } from "@/server/http";
import { readDb } from "@/server/db";
import { integrationStatus } from "@/server/integrations/service";
import { billingFor, listSnapshots, recentFailures } from "@/server/integrations/store";

export const dynamic = "force-dynamic";

/** Integration health for the Data sources page and the Overview card. No external calls. */
export const GET = route("read", async ({ auth, nowMs }) => {
  const db = await readDb(auth.scope);
  const estimates = db.checks.flatMap((c) => c.estimates);
  const byClass = (cls: string) => estimates.filter((e) => e.rate?.classification === cls).length;
  const [providers, failures, mxn, inr, billing] = await Promise.all([
    integrationStatus(),
    recentFailures(new Date(nowMs - 24 * 3_600_000).toISOString()),
    listSnapshots("USD", "MXN", 1),
    listSnapshots("USD", "INR", 1),
    billingFor(auth.workspaceId),
  ]);
  return {
    providers,
    failures24h: failures,
    latestBenchmark: { MXN: mxn[0] ?? null, INR: inr[0] ?? null },
    estimates: {
      total: estimates.length,
      referenceRate: byClass("published"),
      manualRate: byClass("manual"),
      sampleRate: estimates.filter((e) => e.rate?.isDemo).length,
      noRate: estimates.filter((e) => !e.rate).length,
    },
    billing,
  };
});
