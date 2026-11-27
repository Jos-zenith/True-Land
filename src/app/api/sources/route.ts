import { route } from "@/server/http";
import { readDb } from "@/server/db";
import { sources } from "@/server/views";

export const dynamic = "force-dynamic";
export const GET = route("read", async ({ auth, nowMs }) => sources(await readDb(auth.scope), nowMs));
