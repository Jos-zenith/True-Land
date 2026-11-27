import { route, parseBody } from "@/server/http";
import { mutate } from "@/server/db";
import { publishDraft } from "@/server/services/fees";
import { publishSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const POST = route("fees:write", async ({ req, auth, ctx }) => {
  const b = await parseBody(req, publishSchema);
  return mutate(auth.scope, (db) => publishDraft(db, b.note, ctx));
});
