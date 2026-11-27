import { describe, it, expect } from "vitest";
import { connectFromEnv, pgConnectionConfig } from "./sql";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe("database connection configuration", () => {
  it("without a CA certificate, TLS settings come from the URL unchanged", () => {
    const url = "postgresql://u:p@db.example.test:6543/postgres?sslmode=verify-full";
    expect(pgConnectionConfig(url, env({}))).toEqual({ connectionString: url });
  });

  it("with DATABASE_CA_CERT, verifies against that CA and drops sslmode so the URL cannot override it", () => {
    const c = pgConnectionConfig("postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres?sslmode=require", env({ DATABASE_CA_CERT: PEM.replace(/\n/g, "\\n") }));
    expect(c.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(c.connectionString).not.toContain("sslmode");
  });

  it("rejects a CA value that is not a PEM certificate", () => {
    expect(() => pgConnectionConfig("postgresql://u:p@h/db", env({ DATABASE_CA_CERT: "sb_secret_xyz" }))).toThrow(/PEM/);
  });

  it("explains the Supabase API-key mistake when DATABASE_URL is missing in production", async () => {
    await expect(connectFromEnv(env({ NODE_ENV: "production", SUPABASE_URL: "https://x.supabase.co" }))).rejects.toThrow(/not a database connection/);
    await expect(connectFromEnv(env({ NODE_ENV: "production" }))).rejects.toThrow(/\.env\.example is never loaded/);
  });
});
