import { route } from "@/server/http";
import { readDb } from "@/server/db";
import { overview } from "@/server/views";

export const dynamic = "force-dynamic";
export const GET = route("read", async ({ auth, nowMs }) => overview(await readDb(auth.scope), nowMs));
