import { hexToBytes, hmacSha256Hex } from "./sha256";

/**
 * Supplier pseudonymisation, browser side (shared with the server for the demo seed).
 *
 * The browser derives a supplier TOKEN = HMAC-SHA-256(workspace key, normalised nickname) and sends
 * only the token. The server never receives the nickname. The server then re-keys the token with a
 * secret pepper (see src/server/pseudonym.ts) before storing it, so the stored supplier ID cannot be
 * recomputed from the database alone.
 */
export function normaliseNickname(nickname: string): string {
  return nickname.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function supplierToken(workspaceKeyHex: string, nickname: string): string {
  return hmacSha256Hex(hexToBytes(workspaceKeyHex), `landed:supplier-token:v1:${normaliseNickname(nickname)}`);
}

/** Short form for display. The stored ID is 128 bits; the first 6 hex characters are shown. */
export function shortSupplierId(id: string): string {
  return id.slice(0, 6);
}
