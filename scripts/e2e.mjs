// End-to-end test of the critical judge journey through the real UI.
// Requires the app running (npm run dev or npm start) and Microsoft Edge or Chrome installed.
// Usage: node scripts/e2e.mjs [screenshotDir]
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const channel = process.env.BROWSER_CHANNEL ?? "msedge";
const browser = await chromium.launch({ channel, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Download the React DevTools/.test(m.text())) errors.push(`console: ${m.text()}`);
});

let step = 0;
const results = [];
async function check(name, fn) {
  step += 1;
  const t = Date.now();
  try {
    await fn();
    results.push(`  ✓ ${step}. ${name} (${Date.now() - t} ms)`);
    if (OUT) await page.screenshot({ path: path.join(OUT, `e2e-${String(step).padStart(2, "0")}.png`) });
  } catch (e) {
    results.push(`  ✗ ${step}. ${name}\n      ${String(e.message).split("\n")[0]}`);
    if (OUT) await page.screenshot({ path: path.join(OUT, `e2e-${String(step).padStart(2, "0")}-FAILED.png`) });
    throw e;
  }
}
const see = (text, timeout = 15000) => page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });

let id = "";
try {
  await check("signed-out visitors are sent to sign-in; the API refuses them", async () => {
    await page.goto(`${BASE}/overview`);
    await page.waitForURL(/\/login\?next=/);
    const r = await page.request.get(`${BASE}/api/checks`);
    if (r.status() !== 401) throw new Error(`expected 401, got ${r.status()}`);
  });
  await check("sign up: a new workspace with labelled sample data", async () => {
    await page.goto(`${BASE}/signup`);
    await page.getByLabel("Your name").fill("Alex Rivera");
    await page.getByLabel("Workspace name").fill("Northstar Imports");
    await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.test`);
    await page.getByLabel("Password").fill("e2e correct horse battery");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.waitForURL(/\/overview/, { timeout: 30000 });
  });
  await check("open Overview", async () => {
    await page.goto(`${BASE}/overview`);
    await see("Northstar Imports");
    await see("Recent payment checks");
  });
  await check("start a new payment check with the C shortcut", async () => {
    await page.locator("body").click({ position: { x: 700, y: 120 } });
    await page.keyboard.press("c");
    await page.getByLabel("Supplier nickname").waitFor();
  });
  await check("validation: submitting empty shows inline errors and moves focus", async () => {
    await page.getByRole("button", { name: "Compare routes" }).click();
    await see("Give the supplier a nickname");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (focused !== "Supplier nickname") throw new Error(`focus on ${focused}`);
  });
  await check("enter the $15,000 USD → MXN payment and compare routes", async () => {
    await page.getByLabel("Supplier nickname").fill("Supplier Z");
    await page.getByRole("button", { name: "$15,000" }).click();
    await page.waitForFunction(() => (document.querySelector("#cmp-invoice")?.value ?? "") === "255,000", null, { timeout: 10000 });
    await see("is MXN 255,000 before any cost");
    await see("Unavailable: Bank A USD wire");
    await page.keyboard.press("Control+Enter");
    await page.waitForURL(/\/checks\/CHK-\d+\/compare/, { timeout: 20000 });
    id = page.url().match(/CHK-\d+/)[0];
  });
  await check(`compare routes for ${id || "new check"}`, async () => {
    await see("Supplier Z, MXN 255,000 invoice paid in USD");
    await see("About MXN 253,215, at least MXN 252,960 (modelled).");
    await see("Fintech B, peso payout is likely to deliver more");
    await see("MXN 246,938");
  });
  await check("inspect fee evidence", async () => {
    await page.getByRole("link", { name: /How MXN 253,215 is built/ }).click();
    await page.waitForURL(/evidence/);
    await see("How MXN 253,215 is built");
    await see("FX markup 0.7%");
    await see("Sending fee, paid on top");
    await page.getByRole("radio", { name: "Low" }).click();
    await see("How MXN 252,960 is built");
  });
  await check("enter a provider quote", async () => {
    await page.getByRole("tab", { name: "Compare" }).click();
    await page.waitForURL(/compare/);
    await page.locator("#quote-v").fill("253400");
    await page.getByRole("button", { name: "Save quote" }).click();
    await see("MXN 185 above our typical, inside our range");
  });
  await check("save the selected route", async () => {
    await page.getByRole("button", { name: /Record choice/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Record choice" }).click();
    await page.waitForURL(/outcome/, { timeout: 15000 });
    await see("what happened?");
    await see("Snapshot of the choice: Fintech B, peso payout");
  });
  await check("record the actual received amount (with a demo receipt mismatch first)", async () => {
    await page.locator("#o-amt").fill("253100");
    await page.getByRole("button", { name: "Demo file: mismatch" }).click();
    await see("Amount does not match", 10000);
    await page.locator("#o-amt").fill("253100");
    await page.getByRole("button", { name: "Save outcome" }).last().click();
    await see("Did this check change your plan?");
    await page.getByRole("button", { name: /^Nothing/ }).click();
    await page.waitForURL(/reconciled/, { timeout: 15000 });
  });
  await check("view reconciliation", async () => {
    await see("The supplier reports MXN 253,100: below our typical estimate, inside our range, and below the provider's quote.");
    await see("Ours, by 185");
    await see("No bank record or CEP has passed validation.");
  });
  await check("inspect the audit history", async () => {
    await see("Outcome recorded: Received MXN 253,100");
    await page.goto(`${BASE}/audit`);
    await see(`${id}`);
    await see("Route selected: Fintech B, peso payout. No money was sent.");
  });
  await check("command menu: Ctrl+K, search a check by reference, Enter opens it", async () => {
    await page.goto(`${BASE}/overview`);
    await see("Recent payment checks");
    await page.keyboard.press("Control+k");
    await page.getByLabel("Type a command or search").fill("CHK-015");
    await see("CHK-015 · Supplier"); // wait for the filtered result before pressing Enter
    await page.keyboard.press("Enter");
    await page.waitForURL(/CHK-015/, { timeout: 15000 });
    await see("will the full USD 15,000 arrive?");
  });
  await check("stale rate requires confirmation before recording", async () => {
    await page.goto(`${BASE}/checks/CHK-013/compare`);
    await see("hours old");
    await page.getByRole("button", { name: /Record choice/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Record choice" }).click();
    await see("-hour-old rate?");
    await page.keyboard.press("Escape");
  });
  await check("too close to call gives no rank", async () => {
    await page.goto(`${BASE}/checks/CHK-016/compare`);
    await see("Too close to call");
    if (await page.getByText("More favourable").count()) throw new Error("a rank was shown");
  });
  await check("all checks: filter, sort and paginate", async () => {
    await page.goto(`${BASE}/checks`);
    await see("Our error = actual − estimate");
    await page.getByRole("button", { name: "Next page" }).click();
    await page.getByRole("button", { name: /^Sent/ }).click();
    await page.getByPlaceholder("Search ID, supplier, ref").fill("Supplier Z");
    await see(id);
  });
  await check("fee configuration: edit, save draft, publish v5; saved estimates unchanged", async () => {
    await page.goto(`${BASE}/fees`);
    await see("Manually configured assumptions");
    const typical = page.getByLabel("Fintech B, peso payout markup, typical case");
    await typical.fill("0.75");
    await page.getByLabel("Fintech B, peso payout markup, low case").fill("0.85");
    await page.getByRole("button", { name: "Save draft" }).click();
    await see("Effect of the draft");
    await see("draft MXN 253,088"); // 255,000 × (1 − 0.0075) = 253,087.5, half-up
    await page.getByRole("button", { name: "Publish v5" }).click();
    await page.getByPlaceholder(/Fintech B markup confirmed/).fill("E2E: Fintech B markup raised");
    await page.getByRole("dialog").getByRole("button", { name: "Publish v5" }).click();
    await see("v5 ·");
    await page.goto(`${BASE}/checks/CHK-014/compare`);
    await see("About MXN 253,215, at least MXN 252,960 (modelled).");
  });
  await check("command menu: enter a manual rate", async () => {
    await page.keyboard.press("Control+k");
    await page.getByLabel("Type a command or search").fill("rate");
    await page.keyboard.press("Enter");
    await page.getByLabel("Where this rate came from").fill("E2E treasury desk");
    await page.getByRole("button", { name: "Save rate" }).click();
    await see("entered manually. Existing estimates are unchanged.");
  });
  if (process.env.E2E_LIVE === "1") {
    // Judge demo with REAL external data: Frankfurter + Wise unauthenticated quotes (network required).
    let liveId = "";
    await check("LIVE: fetch the Frankfurter reference rate and adopt it for new estimates", async () => {
      await page.goto(`${BASE}/sources`);
      await see("Reference FX rate (benchmark)");
      await page.getByRole("button", { name: "Fetch reference rate now" }).click();
      await see("adopted for new estimates", 30000);
      await see("Benchmark: USD/MXN");
      await see("selected");
    });
    await check("LIVE: new $15,000 check is estimated at the reference rate", async () => {
      await page.goto(`${BASE}/overview`);
      await see("Recent payment checks");
      await page.locator("body").click({ position: { x: 700, y: 120 } });
      await page.keyboard.press("c");
      await page.getByLabel("Supplier nickname").fill("Live Demo Supplier");
      await page.getByRole("button", { name: "$15,000" }).click();
      await see("At the reference rate"); // the invoice is prefilled from the adopted reference rate
      await page.getByRole("button", { name: "Compare routes" }).click();
      await page.waitForURL(/\/checks\/CHK-\d+\/compare/, { timeout: 20000 });
      liveId = page.url().match(/CHK-\d+/)[0];
    });
    await check("LIVE: request a Wise provider quote and compare it with the benchmark", async () => {
      await page.getByRole("button", { name: "Request Wise quote" }).click();
      await see("Wise provider quote (unauthenticated: illustrative pricing, not an offer)", 30000);
      await see("Supplier would receive (Wise)");
      await see("Compared with this estimate's reference rate");
    });
    await check("LIVE: evidence shows the benchmark provenance", async () => {
      await page.goto(`${BASE}/checks/${liveId}/evidence`);
      await see("reference FX rate");
      await see("selection policy fx-benchmark-v1");
    });
  }
  await check("mobile 390 px: outcome capture and no horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const p of ["/overview", "/my-checks", "/checks", "/inbox", `/checks/CHK-012/outcome`, `/checks/${id}/reconciled`, "/checks/CHK-014/compare", "/checks/CHK-014/evidence", "/fees", "/methodology"]) {
      await page.goto(`${BASE}${p}`);
      await page.waitForTimeout(900);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error(`${p} overflows by ${overflow}px`);
      if (p.endsWith("/outcome")) await see("what happened?");
      if (OUT) await page.screenshot({ path: path.join(OUT, `mobile${p.replace(/\//g, "_")}.png`) });
    }
  });
  await check("sign out ends the session", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const r = await page.request.post(`${BASE}/api/auth/logout`, { headers: { origin: BASE } });
    if (!r.ok()) throw new Error(`logout ${r.status()}`);
    await page.goto(`${BASE}/overview`);
    await page.waitForURL(/\/login/);
  });
} catch {
  // reported below
}

console.log(`\nLanded e2e (${BASE})\n${results.join("\n")}`);
if (errors.length) console.log(`\nBrowser errors:\n  ${[...new Set(errors)].join("\n  ")}`);
const failed = results.some((r) => r.includes("✗")) || errors.length > 0;
console.log(failed ? "\nFAILED" : "\nPASSED");
await browser.close();
process.exit(failed ? 1 : 0);
