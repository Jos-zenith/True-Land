/**
 * Receipt verification boundary.
 *
 * A verifier answers one question: "does an official SPEI receipt (CEP) exist for this payment, and
 * what amount does it show?" The service layer records the answer; it never decides how it was obtained.
 *
 *   DemoCepVerifier   mode "demo"  Labelled fixtures. Nothing real is checked. Only allowed in demo
 *                                  workspaces. A pass gives evidence level "demo_verified", shown as
 *                                  "Verified (demo)", never "Verified".
 *   RemoteCepVerifier mode "live"  Calls a deployer-operated verification service over HTTPS and
 *                                  authenticates its signed answer. A pass gives "verified".
 *                                  The service that actually queries Banxico is NOT part of this
 *                                  repository (see docs/verification.md).
 */
export interface ReceiptClaim {
  amount: string; // MXN, as entered
  date: string; // YYYY-MM-DD
  sendingBank: string;
  receivingBank: string;
  trackingKey: string | null; // clave de rastreo
  /** CLABE. Passed to the verifier for this call only. Never persisted, never logged. */
  beneficiaryAccount: string | null;
}

export interface ReceiptFields {
  amount: string;
  date: string;
  sendingBank: string;
  receivingBank: string;
}

export interface VerificationResult {
  mode: "demo" | "live";
  provider: string;
  result: "verified" | "mismatch" | "unreadable" | "invalid_account" | "not_found";
  /** What the official record says, when one was found. Never includes an account number. */
  file: ReceiptFields | null;
  fileName: string;
  providerRef: string | null;
  demo: "match" | "mismatch" | "unreadable" | null;
  detail: string;
}

export interface ReceiptVerifier {
  readonly mode: "demo" | "live";
  readonly provider: string;
  verify(claim: ReceiptClaim, ctx: { checkId: string }): Promise<VerificationResult>;
}
