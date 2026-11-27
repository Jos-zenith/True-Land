import { route } from "@/server/http";
import { listCurrencies } from "@/server/integrations/store";
import { refreshCurrencyCoverage } from "@/server/integrations/service";
import { CURRENCIES } from "@/server/integrations/currency";

export const dynamic = "force-dynamic";

/** Canonical currency metadata with per-provider availability (as last verified). */
export const GET = route("read", async () => {
  const stored = await listCurrencies();
  return { items: stored.length ? stored : CURRENCIES.map((c) => ({ ...c, availability: {}, lastVerifiedAt: null })) };
});

/** Re-verify provider coverage (queries the providers' currency lists). Administrators only. */
export const POST = route("fees:write", async ({ nowMs }) => ({ items: await refreshCurrencyCoverage(nowMs) }));
