import { z } from "zod";

/** Accepts "15,000.00" style input and normalises to a plain decimal string. */
const decimalString = (label: string, opts: { min?: number; max?: number; allowZero?: boolean; dp?: number } = {}) =>
  z
    .string({ error: `${label} is required.` })
    .transform((s) => s.replace(/[,\s]/g, ""))
    .refine((s) => s.length > 0, { message: `${label} is required.` })
    .refine((s) => /^-?\d+(\.\d+)?$/.test(s), { message: `${label} must be a number.` })
    .refine((s) => !s.startsWith("-"), { message: `${label} cannot be negative.` })
    .refine((s) => (opts.allowZero ? true : Number(s) > 0), { message: `${label} must be greater than zero.` })
    .refine((s) => (opts.dp === undefined ? true : (s.split(".")[1]?.length ?? 0) <= opts.dp), {
      message: `${label} can have at most ${opts.dp} decimal places.`,
    })
    .refine((s) => (opts.max === undefined ? true : Number(s) <= opts.max), {
      message: `${label} must be at most ${opts.max?.toLocaleString("en-US")}.`,
    })
    .refine((s) => (opts.min === undefined ? true : Number(s) >= opts.min), {
      message: `${label} must be at least ${opts.min?.toLocaleString("en-US")}.`,
    });

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");

/** HMAC token computed in the browser from the nickname (src/lib/pseudonym.ts). Never the nickname itself. */
export const supplierTokenSchema = z.string().regex(/^[0-9a-f]{64}$/, "Give the supplier a nickname. It stays on this device.");

export const checkInputsSchema = z.object({
  invoiceAmount: decimalString("Invoice amount", { max: 100_000_000, dp: 2 }),
  invoiceCurrency: z.enum(["MXN", "USD"], { error: "Choose MXN or USD." }),
  sourceCountry: z.literal("US", { error: "Only the United States is supported as the paying country." }),
  destCountry: z.literal("MX", { error: "Only Mexico is supported. India is a test fixture only." }),
  sourceCurrency: z.literal("USD", { error: "You can only pay in USD." }),
  sendAmount: decimalString("Amount to send", { max: 5_000_000, dp: 2 }),
  payBy: ymd,
  payoutMethod: z.enum(["spei_mxn", "usd_account"], { error: "Choose how the supplier receives the money." }),
  providers: z.array(z.string()).min(1, "Choose at least one provider you hold an account with."),
  invoiceRef: z
    .string()
    .max(40, "Keep the reference under 40 characters.")
    .regex(/^[\w\-./ #]*$/, "Use letters, numbers and - . / # only.")
    .nullable()
    .optional()
    .transform((v) => (v ? v.trim() || null : null)),
  chargeCode: z.enum(["SHA", "OUR", "BEN"]).default("SHA"),
});

export const createCheckSchema = checkInputsSchema.extend({
  supplierToken: supplierTokenSchema,
  draft: z.boolean().optional().default(false),
  quote: z
    .object({ ruleId: z.string(), kind: z.enum(["amount", "rate"]), value: decimalString("Quote", { dp: 6 }) })
    .nullable()
    .optional(),
});
export type CreateCheckBody = z.input<typeof createCheckSchema>;

export const previewSchema = checkInputsSchema.partial().extend({
  invoiceAmount: z.string().optional(),
  sendAmount: z.string().optional(),
});

export const updateInputsSchema = checkInputsSchema.partial();

export const quoteSchema = z.object({
  ruleId: z.string().min(1, "Choose the route that was quoted."),
  kind: z.enum(["amount", "rate"]),
  value: decimalString("Quote", { dp: 6, max: 1_000_000_000 }),
  validUntil: ymd.nullable().optional(),
});

export const choiceSchema = z.object({
  optionId: z.string().min(1),
  paidOn: ymd,
  confirmStale: z.boolean().optional().default(false),
});

export const outcomeSchema = z.discriminatedUnion("result", [
  z.object({
    result: z.literal("received"),
    amount: decimalString("Amount received", { dp: 2, max: 1_000_000_000 }),
    date: ymd,
    reportedBy: z.enum(["supplier", "payer", "provider_statement"], { error: "Say who reported the amount." }),
    reference: z.string().max(60).nullable().optional(),
    level: z.enum(["reported", "tax_record"], { error: "Choose the evidence you hold." }),
    evidenceId: z.string().nullable().optional(),
  }),
  z.object({ result: z.literal("no_reply"), date: ymd }),
  z.object({ result: z.literal("refused"), date: ymd, reference: z.string().max(60).nullable().optional() }),
]);

export const correctionSchema = z.object({
  amount: decimalString("Corrected amount", { dp: 2, max: 1_000_000_000 }),
});

export const cepSchema = z.object({
  /** "demo": labelled fixture (demo workspaces only). "live": the configured verification provider. */
  mode: z.enum(["demo", "live"]).default("demo"),
  demo: z.enum(["match", "mismatch", "unreadable"]).optional(),
  amount: decimalString("Amount", { dp: 2 }),
  date: ymd,
  sendingBank: z.string().min(1, "Enter the sending bank.").max(60),
  receivingBank: z.string().min(1, "Enter the receiving bank.").max(60),
  trackingKey: z.string().max(40).nullable().optional(),
  /** Used for this check only and discarded. Never persisted. */
  beneficiaryAccount: z.string().regex(/^\d{18}$/, "A CLABE has 18 digits.").nullable().optional(),
}).refine((b) => b.mode === "live" || !!b.demo, { message: "Choose a demo file.", path: ["demo"] });

export const planChangeSchema = z.object({ answer: z.enum(["route", "amount", "timing", "nothing"]) });
export const noteSchema = z.object({ text: z.string().trim().min(1, "Write a note first.").max(1000) });

const triple = z.object({ low: z.string(), typical: z.string(), high: z.string() });

export const feeRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/, "Use lower-case letters, numbers and _ only."),
    routeId: z.string().min(1),
    providerId: z.string().min(1, "Choose a provider."),
    providerName: z.string().min(1),
    routeName: z.string().min(2, "Name the route.").max(60),
    optionLabel: z.string().nullable(),
    method: z.enum(["local_payout", "bank_fx_wire", "usd_wire"]),
    sourceCurrency: z.literal("USD"),
    destCurrency: z.enum(["MXN", "USD"]),
    invoiceCurrencies: z.array(z.enum(["MXN", "USD"])).min(1),
    payoutMethod: z.enum(["spei_mxn", "usd_account"]),
    chargeCode: z.enum(["SHA", "OUR", "BEN"]).nullable(),
    senderFee: z.string().nullable(),
    markupPct: triple.nullable(),
    deduction: triple.nullable(),
    receivingFee: z.string().nullable(),
    feePayer: z.enum(["sender", "shared", "beneficiary"]),
    minAmount: z.string().nullable(),
    maxAmount: z.string().nullable(),
    speedDays: z.object({ min: z.number().int().min(0).max(10), max: z.number().int().min(0).max(10) }),
    speedLabel: z.string().min(1),
    eligibility: z.enum(["approved", "unverified", "disabled"]),
    eligibilityNote: z.string().max(160),
    source: z.string(),
    classification: z.enum(["live", "published", "provider_quote", "manual", "modelled", "unavailable"]),
    lastVerifiedAt: z.string(),
    effectiveFrom: ymd,
  })
  .superRefine((r, ctx) => {
    const num = (v: string | null, path: string, label: string, max = Infinity) => {
      if (v === null) return;
      if (!/^\d+(\.\d+)?$/.test(v)) ctx.addIssue({ code: "custom", path: [path], message: `${label} must be a non-negative number, or left blank if unknown.` });
      else if (Number(v) > max) ctx.addIssue({ code: "custom", path: [path], message: `${label} must be at most ${max}.` });
    };
    num(r.senderFee, "senderFee", "Sender fee");
    num(r.receivingFee, "receivingFee", "Receiving fee");
    num(r.minAmount, "minAmount", "Minimum amount");
    num(r.maxAmount, "maxAmount", "Maximum amount");
    for (const [key, label, max] of [
      ["markupPct", "Markup", 20],
      ["deduction", "Deduction", 1000],
    ] as const) {
      const t = r[key];
      if (!t) continue;
      for (const c of ["low", "typical", "high"] as const) num(t[c], key, `${label} (${c})`, max);
      if (/^\d/.test(t.low) && /^\d/.test(t.high) && /^\d/.test(t.typical)) {
        const [lo, ty, hi] = [Number(t.low), Number(t.typical), Number(t.high)];
        if (!(lo >= ty && ty >= hi)) {
          ctx.addIssue({ code: "custom", path: [key], message: `${label}: the low case must carry the largest cost (low ≥ typical ≥ high).` });
        }
      }
    }
    if (r.minAmount && r.maxAmount && Number(r.minAmount) > Number(r.maxAmount)) {
      ctx.addIssue({ code: "custom", path: ["maxAmount"], message: "Maximum must be at least the minimum." });
    }
    if (r.speedDays.min > r.speedDays.max) ctx.addIssue({ code: "custom", path: ["speedDays"], message: "Fastest must not exceed slowest." });
    if (r.method === "usd_wire" && r.destCurrency !== "USD") ctx.addIssue({ code: "custom", path: ["destCurrency"], message: "A USD wire pays out in USD." });
    if (r.method !== "usd_wire" && r.destCurrency === "USD") ctx.addIssue({ code: "custom", path: ["destCurrency"], message: "Peso routes pay out in MXN." });
  });

export const feeDraftSchema = z.object({ rules: z.array(feeRuleSchema).min(1) });
export const publishSchema = z.object({ note: z.string().trim().min(3, "Describe what changed.").max(200) });
export const rateEntrySchema = z.object({
  rate: decimalString("Rate", { dp: 6, min: 1, max: 100 }),
  sourceNote: z.string().trim().min(3, "Say where this rate came from.").max(80),
});

export type FieldErrors = Record<string, string>;

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const password = z.string().min(12, "Use at least 12 characters.").max(200, "Use at most 200 characters.");

export const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password.").max(200) });
export const signupSchema = z.object({
  email,
  password,
  name: z.string().trim().min(2, "Enter your name.").max(60),
  workspaceName: z.string().trim().min(2, "Name your workspace.").max(60),
});
export const memberSchema = z.object({
  email,
  password,
  name: z.string().trim().min(2, "Enter a name.").max(60),
  title: z.string().trim().min(2, "Enter a job title.").max(40),
  access: z.enum(["admin", "member", "viewer"]),
});
