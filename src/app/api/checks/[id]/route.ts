import { route, parseBody } from "@/server/http";
import { mutate, readDb } from "@/server/db";
import { getCheck } from "@/server/core";
import { updateInputs } from "@/server/services/checks";
import { checkDetail } from "@/server/views";
import { updateInputsSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>("read", async ({ params, auth, nowMs }) => {
  const db = await readDb(auth.scope);
  return checkDetail(db, getCheck(db, params.id), nowMs);
});

export const PATCH = route<{ id: string }>("check:write", async ({ req, params, auth, ctx }) => {
  const body = await parseBody(req, updateInputsSchema);
  const check = await mutate(auth.scope, (db) => updateInputs(db, params.id, body, ctx));
  return { id: check.id };
});
