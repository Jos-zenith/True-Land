import type { Access } from "../model";
import { ServiceError } from "../core";

/**
 * Server-side authorization. Every API route declares ONE permission; `route()` in http.ts checks it
 * against the caller's membership before any service runs. Tenant isolation is structural: the store
 * only ever loads the caller's own workspace, so a check in another workspace is simply "not found".
 */
export type Permission =
  | "read"
  | "check:export"
  | "check:write"
  | "evidence:verify"
  | "rates:write"
  | "fees:write"
  | "members:manage"
  | "demo:reset";

export const MATRIX: Record<Permission, readonly Access[]> = {
  read: ["admin", "member", "viewer"],
  "check:export": ["admin", "member", "viewer"],
  "check:write": ["admin", "member"],
  "evidence:verify": ["admin", "member"],
  "rates:write": ["admin", "member"],
  "fees:write": ["admin"],
  "members:manage": ["admin"],
  "demo:reset": ["admin"],
};

export function can(access: Access, permission: Permission): boolean {
  return MATRIX[permission].includes(access);
}

export function authorize(access: Access, permission: Permission): void {
  if (!can(access, permission)) {
    throw new ServiceError(403, "FORBIDDEN", "Your role in this workspace does not allow this action.");
  }
}
