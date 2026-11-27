import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { buildSeed } from "../seed";
import * as svc from "../services/checks";
import { assertDatabaseInvariants } from "../invariants";
import { demoVerify, RemoteCepVerifier, selectVerifier, sign, type ReceiptClaim } from "./index";

const SECRET = "s".repeat(40);
const NOW = 1_800_000_000_000;
const CLAIM: ReceiptClaim = {
  amount: "253100",
  date: "2026-11-27",
  sendingBank: "BANK1",
  receivingBank: "BANK2",
  trackingKey: "TRK123",
  beneficiaryAccount: "002010077777777771",
};

/** A fake provider: verifies OUR signature, then answers with a body signed by `respSecret`. */
function provider(answer: unknown, opts: { respSecret?: string; ts?: number; status?: number; raw?: string } = {}) {
  const calls: { body: string; ok: boolean }[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    const h = new Headers(init.headers);
    const ts = h.get("x-landed-timestamp")!;
    calls.push({ body, ok: h.get("x-landed-signature") === sign(SECRET, ts, body) });
    const text = opts.raw ?? JSON.stringify(answer);
    const rts = String(opts.ts ?? NOW);
    return new Response(text, { status: opts.status ?? 200, headers: { "x-landed-timestamp": rts, "x-landed-signature": sign(opts.respSecret ?? SECRET, rts, text) } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const live = (f: typeof fetch) => new RemoteCepVerifier({ endpoint: "https://verifier.example.test/cep", secret: SECRET, fetch: f, now: () => NOW });
const found = (amount = "253100", date = "2026-11-27") => ({ status: "found", reference: "BX-1", cep: { amount, date, sendingBank: "BANK1", receivingBank: "BANK2" } });

describe("demo verifier (labelled fixtures)", () => {
  it("is always mode 'demo' and says so in its detail", () => {
    for (const fx of ["match", "mismatch", "unreadable"] as const) {
      const r = demoVerify(CLAIM, fx, "CHK-014");
      expect(r.mode).toBe("demo");
      expect(r.provider).toBe("demo-fixture");
      expect(r.fileName).toMatch(/^demo-cep-/);
    }
    expect(demoVerify(CLAIM, "match", "CHK-014").detail).toMatch(/demonstration, not a real receipt check/);
    expect(demoVerify({ ...CLAIM, beneficiaryAccount: "002010077777777770" }, "match", "CHK-014").result).toBe("invalid_account");
  });
});

describe("verifier selection", () => {
  it("refuses demo fixtures in a real workspace and never falls back from live to demo", () => {
    expect(() => selectVerifier({ mode: "demo", fixture: "match" }, { isDemo: false }, {} as NodeJS.ProcessEnv)).toThrow(/demo workspace/);
    expect(() => selectVerifier({ mode: "live" }, { isDemo: true }, {} as NodeJS.ProcessEnv)).toThrow(/not configured/);
    const env = { LANDED_CEP_VERIFIER_URL: "https://v.example.test", LANDED_CEP_VERIFIER_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
    expect(selectVerifier({ mode: "live" }, { isDemo: false }, env).mode).toBe("live");
  });

  it("refuses insecure endpoints and weak secrets", () => {
    expect(() => new RemoteCepVerifier({ endpoint: "http://verifier.example.test", secret: SECRET })).toThrow(/HTTPS/);
    expect(() => new RemoteCepVerifier({ endpoint: "https://verifier.example.test", secret: "short" })).toThrow(/at least 32/);
  });
});

describe("live verifier (remote provider contract)", () => {
  it("signs its request and accepts an authentic, matching answer", async () => {
    const p = provider(found());
    const r = await live(p.f).verify(CLAIM, { checkId: "CHK-014" });
    expect(p.calls[0].ok).toBe(true);
    expect(r).toMatchObject({ mode: "live", result: "verified", providerRef: "BX-1", file: { amount: "253100" } });
  });

  it.each([
    ["a different amount", found("253000"), "mismatch"],
    ["a different date", found("253100", "2026-11-26"), "mismatch"],
    ["no receipt", { status: "not_found", reference: "BX-2" }, "not_found"],
    ["an unreadable receipt", { status: "unreadable", reference: "BX-3", reason: "corrupt" }, "unreadable"],
  ])("reports %s honestly", async (_n, answer, result) => {
    expect((await live(provider(answer).f).verify(CLAIM, { checkId: "CHK-014" })).result).toBe(result);
  });

  it.each([
    ["a forged signature", provider(found(), { respSecret: "x".repeat(40) }).f, /not authentic/],
    ["a stale answer (replay)", provider(found(), { ts: NOW - 10 * 60_000 }).f, /stale/],
    ["a malformed answer", provider(null, { raw: '{"status":"found"}' }).f, /malformed/],
    ["an HTTP error", provider(found(), { status: 500 }).f, /HTTP 500/],
    ["a network failure", (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch, /did not respond/],
  ])("refuses %s and records nothing", async (_n, f, msg) => {
    await expect(live(f).verify(CLAIM, { checkId: "CHK-014" })).rejects.toMatchObject({ status: 502, message: expect.stringMatching(msg) });
  });

  it("does not call the provider for an invalid CLABE, and requires a tracking key", async () => {
    const p = provider(found());
    expect((await live(p.f).verify({ ...CLAIM, beneficiaryAccount: "002010077777777770" }, { checkId: "CHK-014" })).result).toBe("invalid_account");
    expect(p.calls).toHaveLength(0);
    await expect(live(p.f).verify({ ...CLAIM, trackingKey: null }, { checkId: "CHK-014" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("recording verification results", () => {
  const T = new Date("2026-11-26T12:00:00Z").getTime();
  const ctx = { actor: "u_alex", nowMs: T + 3 * 86_400_000 };
  const claim = { amount: "83900", date: "2026-11-18", sendingBank: "BANK1", receivingBank: "BANK2", trackingKey: "TRK" };

  it("a live pass upgrades the outcome to Verified; the account never reaches the record", async () => {
    const db = buildSeed(T);
    const r = await live(provider({ status: "found", reference: "BX-9", cep: { amount: "83900", date: "2026-11-18", sendingBank: "BANK1", receivingBank: "BANK2" } }).f).verify(
      { ...claim, beneficiaryAccount: "002010077777777771" },
      { checkId: "CHK-009" },
    );
    svc.recordReceiptCheck(db, "CHK-009", claim, r, ctx);
    const c = db.checks.find((x) => x.id === "CHK-009")!;
    expect(svc.currentOutcome(c)?.level).toBe("verified");
    expect(c.evidence.at(-1)).toMatchObject({ mode: "live", provider: "remote:verifier.example.test", providerRef: "BX-9" });
    expect(JSON.stringify(c)).not.toContain("002010077777777771");
    assertDatabaseInvariants(db);
  });

  it("a later demo pass never downgrades a live Verified outcome", async () => {
    const db = buildSeed(T);
    const r = await live(provider({ status: "found", reference: "BX-9", cep: { amount: "83900", date: "2026-11-18", sendingBank: "BANK1", receivingBank: "BANK2" } }).f).verify({ ...claim, beneficiaryAccount: null }, { checkId: "CHK-009" });
    svc.recordReceiptCheck(db, "CHK-009", claim, r, ctx);
    svc.validateCep(db, "CHK-009", { ...claim, demo: "match" }, ctx);
    expect(svc.currentOutcome(db.checks.find((x) => x.id === "CHK-009")!)?.level).toBe("verified");
  });

  it("an outcome recorded against demo evidence is demo_verified, never verified", () => {
    const db = buildSeed(T);
    const { evidence } = svc.validateCep(db, "CHK-011", { amount: "118000", date: "2026-11-24", sendingBank: "B1", receivingBank: "B2", demo: "match" }, ctx);
    svc.recordOutcome(db, "CHK-011", { result: "received", amount: "118000", date: "2026-11-24", reportedBy: "supplier", level: "reported", evidenceId: evidence.id }, ctx);
    expect(svc.currentOutcome(db.checks.find((x) => x.id === "CHK-011")!)?.level).toBe("demo_verified");
  });

  it("refuses demo evidence in a non-demo workspace at the service layer too", () => {
    const db = buildSeed(T);
    db.workspace.isDemo = false;
    expect(() => svc.validateCep(db, "CHK-011", { amount: "1", date: "2026-11-24", sendingBank: "B1", receivingBank: "B2", demo: "match" }, ctx)).toThrow(/demo workspace/);
  });

  it("request bodies are signed over timestamp and body together", () => {
    const body = '{"a":1}';
    expect(sign(SECRET, "123", body)).toBe(crypto.createHmac("sha256", SECRET).update(`123.${body}`).digest("hex"));
  });
});
