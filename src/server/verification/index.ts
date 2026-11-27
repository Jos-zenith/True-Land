import { ServiceError } from "../core";
import { DemoCepVerifier, type DemoFixture } from "./demo";
import { RemoteCepVerifier } from "./remote";
import type { ReceiptVerifier } from "./types";

export * from "./types";
export { DemoCepVerifier, demoVerify } from "./demo";
export { RemoteCepVerifier, sign } from "./remote";

export function liveVerifierConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.LANDED_CEP_VERIFIER_URL && env.LANDED_CEP_VERIFIER_SECRET);
}

/**
 * Choose the verifier for a request. Demo fixtures are only allowed in demo workspaces; live
 * verification only when a provider is configured. There is no silent fallback from live to demo.
 */
export function selectVerifier(
  req: { mode: "demo"; fixture: DemoFixture } | { mode: "live" },
  workspace: { isDemo: boolean },
  env: NodeJS.ProcessEnv = process.env,
): ReceiptVerifier {
  if (req.mode === "demo") {
    if (!workspace.isDemo) throw new ServiceError(409, "DEMO_ONLY", "Demo receipt files can only be used in a demo workspace.");
    return new DemoCepVerifier(req.fixture);
  }
  if (!liveVerifierConfigured(env)) {
    throw new ServiceError(503, "VERIFIER_NOT_CONFIGURED", "Live receipt verification is not configured for this deployment. Nothing was recorded.");
  }
  return new RemoteCepVerifier({ endpoint: env.LANDED_CEP_VERIFIER_URL!, secret: env.LANDED_CEP_VERIFIER_SECRET! });
}
