import { ymd, addDays } from "@/lib/format";
import { iso } from "./core";
import { supplierIdForNickname } from "./pseudonym";
import { RULES_V4, rulesV3, sampleRate, withProvenance } from "./demo-data";
import type { Check, Database } from "./model";
import {
  createCheck,
  recordChoice,
  addQuote,
  recordOutcome,
  recordPlanChange,
  validateCep,
  addNote,
} from "./services/checks";

const H = 3_600_000;
const DAY = 24 * H;
const MIN = 60_000;

/** Illustrative supplier nicknames. In real use nicknames stay on the device; these are demo labels. */
export const DEMO_SUPPLIERS = [
  "Supplier A", "Supplier B", "Supplier C", "Supplier D", "Supplier E", "Supplier F", "Supplier G",
  "Supplier H", "Supplier J", "Supplier K", "Supplier L", "Supplier M", "Supplier N",
];

/** Map stored supplier ID -> demo label, for the illustrative suppliers only. */
export function demoNicknames(workspaceId: string, pseudonymKey: string): Record<string, string> {
  return Object.fromEntries(DEMO_SUPPLIERS.map((n) => [supplierIdForNickname(workspaceId, pseudonymKey, n), n]));
}

/** Fixed key used only when a seed is built without one (pure unit tests). Never used for a stored workspace. */
export const TEST_PSEUDONYM_KEY = "0".repeat(64);

export interface SeedPerson {
  id: string;
  name: string;
  initials: string;
  title: string;
}

export interface SeedOptions {
  workspaceId?: string;
  workspaceName?: string;
  pseudonymKey?: string;
  /** The signed-up user: the demo history is written as theirs ("AP clerk" persona). */
  owner?: SeedPerson;
  /** A second, sign-in-less persona (the controller) who authored some demo records. */
  persona?: SeedPerson;
}

export const DEFAULT_OWNER: SeedPerson = { id: "u_alex", name: "Alex Rivera", initials: "AR", title: "AP clerk" };
export const DEFAULT_PERSONA: SeedPerson = { id: "u_sam", name: "Sam Okafor", initials: "SO", title: "Controller" };

/**
 * Build the demo workspace. All timestamps are relative to `T` (first launch), so the
 * freshness rules behave the same whenever the demo is started.
 */
export function buildSeed(T: number, opts: SeedOptions = {}): Database {
  const owner = opts.owner ?? DEFAULT_OWNER;
  const persona = opts.persona ?? DEFAULT_PERSONA;
  const ALEX = owner.id;
  const SAM = persona.id;
  const workspaceId = opts.workspaceId ?? "ws_northstar";
  const key = opts.pseudonymKey ?? TEST_PSEUDONYM_KEY;
  const db: Database = {
    schema: 1,
    seededAt: iso(T),
    workspace: { id: workspaceId, name: opts.workspaceName ?? "Northstar Imports", isDemo: true, corridor: "US→MX" },
    currentUserId: ALEX,
    users: [
      { id: ALEX, name: owner.name, role: owner.title, initials: owner.initials, isAdmin: true, access: "admin" },
      { id: SAM, name: persona.name, role: persona.title, initials: persona.initials, isAdmin: true, access: "admin" },
    ],
    checks: [],
    // A sample rate entered shortly before each historical check, as a team entering a daily rate would.
    rates: [
      sampleRate("rate_1", "17.0000", iso(T - 11 * DAY - 2 * H)),
      sampleRate("rate_2", "17.0000", iso(T - 10 * DAY - 2 * H)),
      sampleRate("rate_3", "17.0000", iso(T - 7 * DAY - 2 * H)),
      sampleRate("rate_4", "17.0000", iso(T - 5 * DAY - 2 * H)),
      sampleRate("rate_5", "17.0000", iso(T - 42 * H)),
      sampleRate("rate_6", "16.9800", iso(T - 31 * H)),
      sampleRate("rate_7", "17.0000", iso(T - 2 * H)),
    ],
    feeVersions: [
      {
        version: 3,
        publishedAt: iso(T - 15 * DAY),
        publishedBy: SAM,
        note: "Bank A deduction range added",
        rules: withProvenance(rulesV3(), 3, iso(T - 15 * DAY)),
      },
      {
        version: 4,
        publishedAt: iso(T - 19 * H),
        publishedBy: SAM,
        note: "Fintech B markup band narrowed (0.9 / 0.7 / 0.5 → 0.8 / 0.7 / 0.6)",
        rules: withProvenance(RULES_V4, 4, iso(T - 19 * H)),
      },
    ],
    feeDraft: null,
    configEvents: [],
    counters: { check: 7, id: 0 },
  };
  db.configEvents.push(
    { id: "cfg_v3", at: iso(T - 15 * DAY), actor: SAM, type: "schedule_published", message: "Fee schedule v3 published: Bank A deduction range added." },
    { id: "cfg_v4", at: iso(T - 19 * H), actor: SAM, type: "schedule_published", message: "Fee schedule v4 published: Fintech B markup band narrowed (0.9 / 0.7 / 0.5 → 0.8 / 0.7 / 0.6)." },
    ...db.rates.map((r) => ({
      id: `cfg_${r.id}`,
      at: r.retrievedAt,
      actor: SAM,
      type: "rate_entered" as const,
      message: `USD/MXN sample rate ${r.rate} entered (demo data, not a live feed).`,
    })),
  );

  const sup = (n: string) => supplierIdForNickname(workspaceId, key, n);
  const base = (t: number, o: Partial<Parameters<typeof createCheck>[1]> & { supplier: string }) => {
    const { supplier, ...rest } = o;
    return {
      invoiceAmount: "255000",
      invoiceCurrency: "MXN" as const,
      sourceCountry: "US" as const,
      destCountry: "MX" as const,
      sourceCurrency: "USD" as const,
      sendAmount: "15000",
      payBy: addDays(ymd(t), 4),
      payoutMethod: "spei_mxn" as const,
      providers: ["bank_a", "fintech_b"],
      invoiceRef: null,
      chargeCode: "SHA" as const,
      supplierHash: sup(supplier),
      draft: false,
      quote: null,
      ...rest,
    };
  };
  const make = (t: number, actor: string, o: Parameters<typeof base>[1]): Check =>
    createCheck(db, base(t, o), { actor, nowMs: t });
  const at = (t: number, actor = ALEX) => ({ actor, nowMs: t });

  // CHK-008 · Refused: the supplier declined to share the amount.
  {
    const t = T - 11 * DAY;
    const c = make(t, ALEX, { supplier: "Supplier L", invoiceAmount: "51000", sendAmount: "3000", invoiceRef: "INV-2291" });
    recordChoice(db, c.id, { optionId: "fintech_b_mxn", paidOn: ymd(t), confirmStale: false }, at(t + 6 * MIN));
    recordOutcome(db, c.id, { result: "refused", date: ymd(t + 3 * DAY) }, at(t + 3 * DAY));
  }

  // CHK-009 · Reconciled, actual outside the modelled range (reported by supplier).
  {
    const t = T - 10 * DAY;
    const c = make(t, ALEX, { supplier: "Supplier J", invoiceAmount: "85000", sendAmount: "5000", invoiceRef: "INV-2304" });
    recordChoice(db, c.id, { optionId: "fintech_b_mxn", paidOn: ymd(t), confirmStale: false }, at(t + 5 * MIN));
    recordOutcome(
      db,
      c.id,
      { result: "received", amount: "83900", date: ymd(t + 2 * DAY), reportedBy: "supplier", level: "reported", reference: null },
      at(t + 2 * DAY),
    );
    recordPlanChange(db, c.id, "amount", at(t + 2 * DAY + 2 * MIN));
  }

  // CHK-010 · Reconciled and verified by a (demo) CEP check. Created by the controller.
  {
    const t = T - 7 * DAY;
    const c = make(t, SAM, { supplier: "Supplier K", invoiceAmount: "204000", sendAmount: "12000", invoiceRef: "INV-2318" });
    addQuote(db, c.id, { ruleId: "fintech_b_mxn", kind: "amount", value: "202800", validUntil: null }, at(t + 3 * MIN, SAM));
    recordChoice(db, c.id, { optionId: "fintech_b_mxn", paidOn: ymd(t), confirmStale: false }, at(t + 8 * MIN, SAM));
    const { evidence } = validateCep(
      db,
      c.id,
      { demo: "match", amount: "202612", date: ymd(t + DAY), sendingBank: "Sample bank 1", receivingBank: "Sample bank 2", trackingKey: "DEMO2318", beneficiaryAccount: "002010077777777771" },
      at(t + DAY + 2 * H, SAM),
    );
    recordOutcome(
      db,
      c.id,
      { result: "received", amount: "202612", date: ymd(t + DAY), reportedBy: "supplier", level: "reported", evidenceId: evidence.id, reference: "DEMO2318" },
      at(t + DAY + 2 * H + 3 * MIN, SAM),
    );
    recordPlanChange(db, c.id, "nothing", at(t + DAY + 2 * H + 4 * MIN, SAM));
  }

  // CHK-011 · Awaiting receipt, reply overdue.
  {
    const t = T - 5 * DAY;
    const c = make(t, ALEX, { supplier: "Supplier C", invoiceAmount: "119000", sendAmount: "7000", invoiceRef: "INV-2330" });
    recordChoice(db, c.id, { optionId: "fintech_b_mxn", paidOn: ymd(t), confirmStale: false }, at(t + 10 * MIN));
  }

  // CHK-012 · Awaiting receipt, reply not yet due.
  {
    const t = T - 40 * H;
    const c = make(t, ALEX, { supplier: "Supplier B", invoiceAmount: "170000", sendAmount: "10000", invoiceRef: "INV-2342" });
    recordChoice(db, c.id, { optionId: "fintech_b_mxn", paidOn: ymd(T - DAY), confirmStale: false }, at(t + 12 * MIN));
  }

  // CHK-013 · Choose route with a stale (31-hour-old) rate; an unverified stablecoin route is excluded.
  {
    const t = T - 30 * H;
    make(t, ALEX, { supplier: "Supplier F", invoiceAmount: "340000", sendAmount: "20000", providers: ["bank_a", "fintech_b", "fintech_x"], invoiceRef: "INV-2350" });
  }

  // CHK-014 · The hero: peso invoice, Fintech B favoured, provider quote entered.
  {
    const t = T - 2 * H + 2 * MIN;
    const c = make(t, ALEX, { supplier: "Supplier A", invoiceRef: "INV-2361" });
    addQuote(db, c.id, { ruleId: "fintech_b_mxn", kind: "amount", value: "253400", validUntil: null }, at(t + 2 * MIN));
  }

  // CHK-015 · Dollar invoice paid by USD wire: will the full amount arrive?
  {
    const t = T - 60 * MIN;
    make(t, ALEX, { supplier: "Supplier D", invoiceAmount: "15000", invoiceCurrency: "USD", payoutMethod: "usd_account", providers: ["bank_a"], invoiceRef: "INV-2365" });
  }

  // CHK-016 · Two fintech routes whose ranges overlap: too close to call.
  {
    const t = T - 50 * MIN;
    make(t, ALEX, { supplier: "Supplier E", invoiceAmount: "85000", sendAmount: "5000", providers: ["fintech_a", "fintech_b"], payBy: addDays(ymd(t), 3) });
  }

  // CHK-017 · No eligible route: the only provider cannot arrive by tomorrow.
  {
    const t = T - 40 * MIN;
    make(t, ALEX, { supplier: "Supplier H", invoiceAmount: "85000", sendAmount: "5000", providers: ["bank_a"], payBy: addDays(ymd(t), 1) });
  }

  // CHK-018 · Rough estimate: Bank B's receiving fee is unknown, so no rank is given. Controller's check.
  {
    const t = T - 35 * MIN;
    const c = make(t, SAM, { supplier: "Supplier M", invoiceAmount: "170000", sendAmount: "10000", providers: ["bank_b", "fintech_b"] });
    addNote(db, c.id, "Asked Bank B for their receiving-bank fee schedule.", at(t + 3 * MIN, SAM));
  }

  // CHK-019 · Calculation failed when submitted (seeded demo of the failure state). Retry works.
  {
    const t = T - 25 * MIN;
    const c = make(t, SAM, { supplier: "Supplier N", invoiceAmount: "850000", sendAmount: "50000", draft: true });
    c.status = "choose_route";
    c.events = [];
    c.events.push({ id: "ev_seed_19a", at: iso(t), actor: SAM, type: "created", message: "created the check" });
    c.calcError = {
      at: iso(t),
      code: "RATE_MISSING",
      message: "The rate store did not respond when this check was submitted (seeded demo of the failure state).",
    };
    c.events.push({ id: "ev_seed_19b", at: iso(t), actor: "system", type: "calc_failed", message: `Calculation failed: ${c.calcError.message} Inputs are saved; no amounts are shown.` });
  }

  // CHK-020 · Draft, not yet compared. $50,000 ticket.
  {
    const t = T - 20 * MIN;
    make(t, ALEX, { supplier: "Supplier G", invoiceAmount: "850000", sendAmount: "50000", draft: true, invoiceRef: "INV-2370" });
  }

  for (const c of db.checks) c.isDemo = true;
  return db;
}
