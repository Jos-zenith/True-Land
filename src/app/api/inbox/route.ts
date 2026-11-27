import { route } from "@/server/http";
import { readDb } from "@/server/db";
import { inbox } from "@/server/views";

export const dynamic = "force-dynamic";
export const GET = route("read", async ({ auth, nowMs }) => ({ items: inbox(await readDb(auth.scope), nowMs) }));
