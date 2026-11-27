import { estimateOption, type FeeRule } from "@/engine";
import { fmtRate } from "@/lib/format";
import { currentRate, currentSchedule, iso, nextId, ServiceError } from "../core";
import type { Database } from "../model";

interface Ctx {
  actor: string;
  nowMs: number;
}

function requireAdmin(db: Database, actor: string) {
  const u = db.users.find((x) => x.id === actor);
  if (!u?.isAdmin) throw new ServiceError(403, "FORBIDDEN", "Only a workspace administrator can change the fee schedule.");
}

export function getDraft(db: Database) {
  const current = currentSchedule(db);
  if (db.feeDraft && db.feeDraft.basedOn === current.version) return db.feeDraft;
  return { basedOn: current.version, rules: structuredClone(current.rules), updatedAt: current.publishedAt };
}

export function saveDraft(db: Database, rules: FeeRule[], ctx: Ctx) {
  requireAdmin(db, ctx.actor);
  const current = currentSchedule(db);
  const ids = new Set<string>();
  for (const r of rules) {
    if (ids.has(r.id)) throw new ServiceError(422, "VALIDATION", `Duplicate rule ID "${r.id}".`);
    ids.add(r.id);
  }
  db.feeDraft = { basedOn: current.version, rules: structuredClone(rules), updatedAt: iso(ctx.nowMs) };
  return db.feeDraft;
}

export function discardDraft(db: Database, ctx: Ctx) {
  requireAdmin(db, ctx.actor);
  db.feeDraft = null;
}

const FIELDS: [keyof FeeRule, string][] = [
  ["senderFee", "sender fee"],
  ["markupPct", "markup"],
  ["deduction", "deduction"],
  ["receivingFee", "receiving fee"],
  ["eligibility", "eligibility"],
  ["minAmount", "minimum"],
  ["maxAmount", "maximum"],
  ["speedDays", "speed"],
  ["routeName", "name"],
  ["feePayer", "fee payer"],
  ["eligibilityNote", "eligibility note"],
];

export function diffRules(before: FeeRule[], after: FeeRule[]): { ruleId: string; label: string; changes: string[] }[] {
  const out: { ruleId: string; label: string; changes: string[] }[] = [];
  for (const r of after) {
    const old = before.find((b) => b.id === r.id);
    const label = r.optionLabel ? `${r.routeName} (${r.optionLabel})` : r.routeName;
    if (!old) {
      out.push({ ruleId: r.id, label, changes: ["new rule"] });
      continue;
    }
    const changes = FIELDS.filter(([k]) => JSON.stringify(old[k]) !== JSON.stringify(r[k])).map(([, l]) => l);
    if (changes.length) out.push({ ruleId: r.id, label, changes });
  }
  for (const b of before) if (!after.find((r) => r.id === b.id)) out.push({ ruleId: b.id, label: b.routeName, changes: ["removed"] });
  return out;
}

/** Effect of each changed rule on a reference payment. Uses the engine; nothing is recalculated in the past. */
export function previewDraft(db: Database, nowMs: number) {
  const current = currentSchedule(db);
  const draft = getDraft(db);
  const rate = currentRate(db, nowMs);
  const changes = diffRules(current.rules, draft.rules);
  const effects = changes.map((c) => {
    const before = current.rules.find((r) => r.id === c.ruleId);
    const after = draft.rules.find((r) => r.id === c.ruleId);
    const ref = (r: FeeRule | undefined) => {
      if (!r || r.eligibility !== "approved") return null;
      const usd = r.destCurrency === "USD";
      try {
        const o = estimateOption({
          rule: r,
          rate,
          sendAmount: "15000",
          invoiceAmount: usd ? "15000" : "255000",
          invoiceCurrency: r.destCurrency,
        });
        return { typical: o.typical, low: o.low, high: o.high, currency: o.destCurrency };
      } catch {
        return null;
      }
    };
    return { ...c, before: ref(before), after: ref(after) };
  });
  return {
    basedOn: current.version,
    draftVersion: current.version + 1,
    reference: rate ? `USD 15,000 sent at the current sample rate ${fmtRate(rate.rate)}` : "USD 15,000 sent (no rate available)",
    changes: effects,
  };
}

export function publishDraft(db: Database, note: string, ctx: Ctx) {
  requireAdmin(db, ctx.actor);
  const current = currentSchedule(db);
  const draft = getDraft(db);
  const changes = diffRules(current.rules, draft.rules);
  if (changes.length === 0) throw new ServiceError(409, "NO_CHANGES", "The draft is identical to the published schedule.");
  const version = current.version + 1;
  const rules = draft.rules.map((r) => {
    const changed = changes.find((c) => c.ruleId === r.id);
    return {
      ...r,
      source: `Fee schedule v${version}`,
      lastVerifiedAt: changed ? iso(ctx.nowMs) : r.lastVerifiedAt,
      effectiveFrom: changed ? iso(ctx.nowMs).slice(0, 10) : r.effectiveFrom,
    };
  });
  db.feeVersions.push({ version, publishedAt: iso(ctx.nowMs), publishedBy: ctx.actor, note, rules });
  db.feeDraft = null;
  db.configEvents.push({
    id: nextId(db, "cfg"),
    at: iso(ctx.nowMs),
    actor: ctx.actor,
    type: "schedule_published",
    message: `Fee schedule v${version} published: ${note} (${changes.map((c) => `${c.label}: ${c.changes.join(", ")}`).join("; ")}). Saved checks keep the version they were computed with.`,
  });
  return { version };
}

/**
 * Adopt an FX benchmark snapshot as the workspace's current USD/MXN rate. Appends a new rate (the
 * provenance travels with it into every estimate that uses it); existing estimates are unchanged.
 * Unlike manual entry, there is no 10% typo guard: a large move is recorded as a warning instead.
 */
export function adoptReferenceRate(
  db: Database,
  snap: { id: string; base: string; quote: string; selectedRate: string | null; selectedProvider: string | null; observedAt: string | null; policyVersion: string; freshness: string; warnings: string[] },
  ctx: Ctx,
) {
  if (snap.base !== "USD" || snap.quote !== "MXN") throw new ServiceError(422, "VALIDATION", "Only a USD/MXN benchmark can become the workspace rate (the only live corridor).");
  if (!snap.selectedRate || !snap.selectedProvider || snap.freshness === "unavailable" || snap.freshness === "stale") {
    throw new ServiceError(409, "NO_USABLE_RATE", "The benchmark has no usable reference rate, so no rate was adopted and no estimate will use it.");
  }
  const observed = snap.observedAt?.slice(0, 10) ?? "unknown date";
  const provider = snap.selectedProvider === "frankfurter" ? "Frankfurter" : snap.selectedProvider === "currencyapi" ? "currencyapi.com" : snap.selectedProvider;
  const rate = {
    id: nextId(db, "rate"),
    base: "USD" as const,
    quote: "MXN" as const,
    rate: snap.selectedRate,
    source: `Reference FX rate · ${provider} · observed ${observed} · benchmark ${snap.id} (${snap.policyVersion})`,
    classification: "published" as const,
    retrievedAt: iso(ctx.nowMs),
    isDemo: false,
    observedAt: snap.observedAt ?? undefined,
    benchmarkId: snap.id,
    benchmarkProvider: snap.selectedProvider,
    benchmarkPolicy: snap.policyVersion,
  };
  const prev = currentRate(db);
  const move = prev ? Math.abs(Number(snap.selectedRate) / Number(prev.rate) - 1) : 0;
  db.rates.push(rate);
  db.configEvents.push({
    id: nextId(db, "cfg"),
    at: iso(ctx.nowMs),
    actor: ctx.actor,
    type: "rate_entered",
    message:
      `Reference FX rate USD/MXN ${snap.selectedRate} adopted from ${provider} (observed ${observed}, benchmark ${snap.id}, policy ${snap.policyVersion}). ` +
      `This is a reference rate, not a provider's offered rate. Existing estimates are unchanged.` +
      (move > 0.1 && prev ? ` Note: ${(move * 100).toFixed(1)}% away from the previous rate ${prev.rate}.` : "") +
      (snap.warnings.length ? ` Warnings: ${snap.warnings.join(" ")}` : ""),
  });
  return rate;
}

export function enterRate(db: Database, body: { rate: string; sourceNote: string }, ctx: Ctx) {
  const rate = {
    id: nextId(db, "rate"),
    base: "USD" as const,
    quote: "MXN" as const,
    rate: body.rate,
    source: `Manually entered: ${body.sourceNote}`,
    classification: "manual" as const,
    retrievedAt: iso(ctx.nowMs),
    isDemo: false,
  };
  const prev = currentRate(db);
  if (prev) {
    const move = Math.abs(Number(body.rate) / Number(prev.rate) - 1);
    if (move > 0.1) {
      throw new ServiceError(422, "VALIDATION", `That is ${(move * 100).toFixed(1)}% away from the last rate (${prev.rate}). Check the figure.`, {
        rate: "More than 10% away from the last rate. Check the figure.",
      });
    }
  }
  db.rates.push(rate);
  db.configEvents.push({
    id: nextId(db, "cfg"),
    at: iso(ctx.nowMs),
    actor: ctx.actor,
    type: "rate_entered",
    message: `USD/MXN rate ${body.rate} entered manually (${body.sourceNote}). Existing estimates are unchanged.`,
  });
  return rate;
}

export function scheduleSummary(db: Database) {
  return db.feeVersions
    .slice()
    .sort((a, b) => b.version - a.version)
    .map((v) => ({ version: v.version, publishedAt: v.publishedAt, publishedBy: v.publishedBy, note: v.note, ruleCount: v.rules.length }));
}

