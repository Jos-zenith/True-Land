import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fc from "fast-check";
import { hexToBytes, hmacSha256Hex, sha256Hex } from "./sha256";

describe("on-device SHA-256 / HMAC-SHA-256", () => {
  it("SHA-256 matches node:crypto for ASCII, unicode and long input", () => {
    for (const s of ["", "abc", "Supplier A", "Proveedora Ñandú SA de CV", "x".repeat(1000)]) {
      expect(sha256Hex(s)).toBe(crypto.createHash("sha256").update(s).digest("hex"));
    }
  });

  it("property: SHA-256 and HMAC match node:crypto for arbitrary strings and keys", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 300 }), fc.uint8Array({ minLength: 0, maxLength: 130 }), (msg, key) => {
        expect(sha256Hex(msg)).toBe(crypto.createHash("sha256").update(msg).digest("hex"));
        expect(hmacSha256Hex(key, msg)).toBe(crypto.createHmac("sha256", Buffer.from(key)).update(msg).digest("hex"));
      }),
      { numRuns: 300 },
    );
  });

  it("hexToBytes round-trips and rejects non-hex", () => {
    expect(Buffer.from(hexToBytes("00ff10")).toString("hex")).toBe("00ff10");
    expect(() => hexToBytes("zz")).toThrow();
  });
});
