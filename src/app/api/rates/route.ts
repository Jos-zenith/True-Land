import { route, parseBody } from "@/server/http";
import { mutate } from "@/server/db";
import { enterRate } from "@/server/services/fees";
import { rateEntrySchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const POST = route("rates:write", async ({ req, auth, ctx }) => {
  const b = await parseBody(req, rateEntrySchema);
  return mutate(auth.scope, (db) => enterRate(db, b, ctx));
});
