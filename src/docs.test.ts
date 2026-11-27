import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Keeps docs/traceability.md honest: every referenced file, symbol and test title must exist, and
 * every requirement in docs/requirements.md must appear in the matrix.
 */
const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const matrix = read("docs/traceability.md");
const requirements = read("docs/requirements.md");

const rows = matrix
  .split("\n")
  .filter((l) => /^\| (FR|HR|IR)-/.test(l))
  .map((l) => {
    const [id, code, tests, status] = l.split("|").slice(1, -1).map((c) => c.trim());
    return { id, code, tests, status };
  });
const refs = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe("traceability matrix", () => {
  it("covers every requirement in the baseline, once", () => {
    const ids = [...requirements.matchAll(/^\| ((?:FR|HR|IR)-[\w]+) \|/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(30);
    expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it.each(rows.map((r) => [r.id, r] as const))("%s: code references exist", (_id, r) => {
    const list = refs(r.code);
    expect(list.length).toBeGreaterThan(0);
    for (const ref of list) {
      const [file, symbol] = ref.split("#");
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
      if (symbol) expect(read(file).includes(symbol), `${file} should contain "${symbol}"`).toBe(true);
    }
  });

  it.each(rows.map((r) => [r.id, r] as const))("%s: tests exist, or the row says there are none", (_id, r) => {
    const list = refs(r.tests);
    if (list.length === 0) {
      expect(r.tests).toBe("No automated test");
      expect(r.status).toMatch(/Not verified|by hand/);
      return;
    }
    for (const ref of list) {
      const [file, fragment] = ref.split(" :: ");
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
      expect(fragment, `${ref} needs a title fragment`).toBeTruthy();
      expect(read(file).includes(fragment), `${file} should contain a test titled like "${fragment}"`).toBe(true);
    }
  });

  it("the life-insurance PRD is not used as a source anywhere in code", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !p.endsWith("docs.test.ts") && /Life Insurance/i.test(read(p))) hits.push(p);
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });

  it("no browser code calls an external provider directly (all integrations go through the backend)", () => {
    // A provider URL in client code would mean a direct call (provider names in labels are fine).
    const hosts = /https?:\/\/[^\s"'`]*(frankfurter\.dev|currencyapi\.com|wise\.com|wise-sandbox\.com|stripe\.com|transferwise)/i;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!/[\\/]api$/.test(p)) walk(p); // route handlers (src/app/api) are server code
        } else if (/\.tsx?$/.test(e.name) && /^["']use client["']/m.test(read(p)) && hosts.test(read(p))) hits.push(p);
      }
    };
    walk("src/app");
    walk("src/components");
    walk("src/hooks");
    expect(hits).toEqual([]);
  });
});
