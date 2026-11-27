import { NextResponse } from "next/server";
import { getSql } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness + database connectivity. Reveals no configuration beyond the driver kind. */
export async function GET() {
  try {
    const sql = await getSql();
    await sql.query("SELECT 1");
    const m = await sql.query<{ v: number }>("SELECT max(version)::int AS v FROM schema_migrations");
    return NextResponse.json({ ok: true, db: sql.kind, schema: m.rows[0]?.v ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
