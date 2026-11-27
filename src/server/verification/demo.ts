import { dec, isValidClabe } from "@/engine";
import { fmtMoney } from "@/lib/format";
import type { ReceiptClaim, ReceiptVerifier, VerificationResult } from "./types";

export type DemoFixture = "match" | "mismatch" | "unreadable";

/**
 * DEMO ONLY. No file is read and nothing is fetched from Banxico. The "official" fields come from a
 * labelled fixture chosen by the user. The comparison and the CLABE check-digit test are real.
 */
export function demoVerify(claim: ReceiptClaim, fixture: DemoFixture, checkId: string): VerificationResult {
  const fileName = `demo-cep-${checkId.slice(4)}-${fixture}.xml`;
  const base = { mode: "demo" as const, provider: "demo-fixture", fileName, providerRef: null, demo: fixture };
  if (fixture === "unreadable") {
    return { ...base, result: "unreadable", file: null, detail: "Demo file: unreadable. Upload failed, try again." };
  }
  const file = {
    amount: fixture === "match" ? claim.amount : dec(claim.amount).minus(200).toFixed(),
    date: claim.date,
    sendingBank: claim.sendingBank,
    receivingBank: claim.receivingBank,
  };
  if (claim.beneficiaryAccount && !isValidClabe(claim.beneficiaryAccount)) {
    return { ...base, result: "invalid_account", file, detail: "The beneficiary account is not a valid CLABE (check digit fails). Not verified." };
  }
  if (!dec(file.amount).eq(dec(claim.amount))) {
    return { ...base, result: "mismatch", file, detail: `Demo file: ${fmtMoney(file.amount, "MXN")}. Entered: ${fmtMoney(claim.amount, "MXN")}. Not verified.` };
  }
  return { ...base, result: "verified", file, detail: "Demo file matches the entered amount, date and banks. This is a demonstration, not a real receipt check." };
}

export class DemoCepVerifier implements ReceiptVerifier {
  readonly mode = "demo" as const;
  readonly provider = "demo-fixture";
  constructor(private fixture: DemoFixture) {}
  async verify(claim: ReceiptClaim, ctx: { checkId: string }) {
    return demoVerify(claim, this.fixture, ctx.checkId);
  }
}
