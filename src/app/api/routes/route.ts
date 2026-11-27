import { route } from "@/server/http";
import { readDb } from "@/server/db";
import { routesView } from "@/server/views";

export const dynamic = "force-dynamic";
export const GET = route("read", async ({ auth, nowMs }) => ({ items: routesView(await readDb(auth.scope), nowMs) }));
