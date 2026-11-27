// Screenshot helper for visual QA: node scripts/shot.mjs <outDir> <width> <path> [path...]
// Uses the locally installed Microsoft Edge through playwright-core (no browser download).
import { chromium } from "playwright-core";
import path from "node:path";

const [outDir, width, ...paths] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: Number(width), height: Number(process.env.H ?? 900) }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()}`));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
for (const p of paths) {
  await page.goto(base + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(Number(process.env.WAIT ?? 600));
  const name = `${p.replace(/[/?=&]+/g, "_").replace(/^_/, "") || "root"}-${width}.png`;
  await page.screenshot({ path: path.join(outDir, name), fullPage: process.env.FULL === "1" });
  console.log("shot", name);
}
if (errors.length) console.log("CONSOLE ERRORS:\n" + [...new Set(errors)].join("\n"));
await browser.close();
