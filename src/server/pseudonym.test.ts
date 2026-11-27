import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fc from "fast-check";
import { normaliseNickname, shortSupplierId, supplierToken } from "@/lib/pseudonym";
import { newWorkspaceKey, pepper, supplierIdFor, supplierIdForNickname } from "./pseudonym";

const KEY = newWorkspaceKey();

describe("supplier pseudonymisation", () => {
  it("the browser token is a keyed HMAC of the normalised nickname (matches node:crypto)", () => {
    const expected = crypto.createHmac("sha256", Buffer.from(KEY, "hex")).update("landed:supplier-token:v1:proveedora ñandú").digest("hex");
    expect(supplierToken(KEY, "  Proveedora   Ñandú ")).toBe(expected);
  });

  it("is stable under case and whitespace, and the stored ID is 128-bit hex", () => {
    const a = supplierIdForNickname("ws_1", KEY, "Supplier A");
    expect(supplierIdForNickname("ws_1", KEY, " supplier   a ")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(shortSupplierId(a)).toBe(a.slice(0, 6));
  });

  it("property: the same nickname is unlinkable across workspaces and across workspace keys", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (name) => {
        fc.pre(normaliseNickname(name).length > 0);
        const k2 = newWorkspaceKey();
        expect(supplierIdForNickname("ws_1", KEY, name)).not.toBe(supplierIdForNickname("ws_2", KEY, name));
        expect(supplierIdForNickname("ws_1", KEY, name)).not.toBe(supplierIdForNickname("ws_1", k2, name));
      }),
      { numRuns: 200 },
    );
  });

  it("a database dump is not enough for a dictionary attack: without the pepper, guesses do not match", () => {
    // The attacker has the DB: workspace id, workspace key, stored IDs. They guess the right name.
    const stored = supplierIdForNickname("ws_1", KEY, "Proveedora del Norte SA de CV");
    const guess = "proveedora del norte sa de cv";
    const token = supplierToken(KEY, guess);
    const attempts = [
      token,
      token.slice(0, 32),
      crypto.createHash("sha256").update(`ws_1:${token}`).digest("hex").slice(0, 32),
      crypto.createHmac("sha256", "").update(`landed:supplier-id:v1:ws_1:${token}`).digest("hex").slice(0, 32),
      crypto.createHmac("sha256", KEY).update(`landed:supplier-id:v1:ws_1:${token}`).digest("hex").slice(0, 32),
    ];
    for (const a of attempts) expect(a).not.toBe(stored);
    // With the pepper (environment secret), the same guess does match: the pepper is the secret.
    expect(supplierIdFor("ws_1", token)).toBe(stored);
  });

  it("the old scheme was linkable and collision-prone; the new one is not (evidence for the change)", () => {
    const old = (n: string) => crypto.createHash("sha256").update(`northstar-imports:${n.trim().toLowerCase()}`).digest("hex").slice(0, 6);
    // Old: a public constant salt, so anyone can recompute IDs from a name list.
    expect(old("Supplier A")).toBe(crypto.createHash("sha256").update("northstar-imports:supplier a").digest("hex").slice(0, 6));
    // Old: 24 bits. Among 20,000 names there are collisions (two suppliers merged into one).
    const seen = new Map<string, string>();
    let collisions = 0;
    for (let i = 0; i < 20_000; i++) {
      const h = old(`supplier ${i}`);
      if (seen.has(h)) collisions++;
      seen.set(h, `supplier ${i}`);
    }
    expect(collisions).toBeGreaterThan(0);
    const fresh = new Set(Array.from({ length: 20_000 }, (_, i) => supplierIdForNickname("ws_1", KEY, `supplier ${i}`)));
    expect(fresh.size).toBe(20_000);
  });

  it("requires a strong pepper in production and rejects malformed tokens", () => {
    expect(() => pepper({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/required in production/);
    expect(() => pepper({ NODE_ENV: "production", LANDED_PSEUDONYM_PEPPER: "short" } as NodeJS.ProcessEnv)).toThrow(/at least 32/);
    expect(() => supplierIdFor("ws_1", "Supplier A")).toThrow(/Invalid supplier token/);
  });
});
