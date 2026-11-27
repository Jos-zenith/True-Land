import { route } from "@/server/http";
import { readDb } from "@/server/db";
import { audit } from "@/server/views";

export const dynamic = "force-dynamic";
export const GET = route("read", async ({ auth }) => ({ items: audit(await readDb(auth.scope)) }));
