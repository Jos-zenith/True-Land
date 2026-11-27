import crypto from "node:crypto";
import { supplierToken } from "@/lib/pseudonym";

/**
 * Supplier pseudonymisation, server side.
 *
 *   token       = HMAC-SHA-256(workspace key, nickname)                computed in the browser
 *   supplier ID = HMAC-SHA-256(PEPPER, "<workspace id>:<token>")[0..128 bits]   computed here, stored
 *
 * Properties (see pseudonym.test.ts):
 *  - the nickname is never sent to or stored by the server;
 *  - the same nickname gives the same ID within a workspace and unlinkable IDs across workspaces;
 *  - the pepper lives only in the environment, so a database dump (which contains the workspace key)
 *    is not enough to run a dictionary attack on supplier names;
 *  - 128-bit IDs: collisions are negligible (the old 24-bit ID collided at a few thousand suppliers).
 * Limits: whoever holds BOTH the pepper and the database can test guesses. Pepper rotation is not
 * implemented (it would require re-keying stored IDs).
 */
const DEV_PEPPER = "landed-development-pepper-not-secret-do-not-use-in-production";
let warned = false;

export function pepper(env: NodeJS.ProcessEnv = process.env): string {
  const p = env.LANDED_PSEUDONYM_PEPPER;
  if (p && p.length >= 32) return p;
  if (p) throw new Error("LANDED_PSEUDONYM_PEPPER must be at least 32 characters.");
  if (env.NODE_ENV === "production") throw new Error("LANDED_PSEUDONYM_PEPPER is required in production.");
  if (!warned && env.NODE_ENV !== "test") {
    warned = true;
    console.warn("[landed] LANDED_PSEUDONYM_PEPPER is not set; using a development pepper.");
  }
  return DEV_PEPPER;
}

export const SUPPLIER_TOKEN_RE = /^[0-9a-f]{64}$/;
export const SUPPLIER_ID_RE = /^[0-9a-f]{32}$/;

export function supplierIdFor(workspaceId: string, token: string, env?: NodeJS.ProcessEnv): string {
  if (!SUPPLIER_TOKEN_RE.test(token)) throw new Error("Invalid supplier token.");
  return crypto.createHmac("sha256", pepper(env)).update(`landed:supplier-id:v1:${workspaceId}:${token}`).digest("hex").slice(0, 32);
}

/** Server-side derivation from a nickname. Only for illustrative demo suppliers, whose names are fixtures. */
export function supplierIdForNickname(workspaceId: string, workspaceKey: string, nickname: string): string {
  return supplierIdFor(workspaceId, supplierToken(workspaceKey, nickname));
}

export function newWorkspaceKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
