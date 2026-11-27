import type { SqlClient } from "./sql";

/**
 * Versioned, forward-only migrations. Applied under a transaction-scoped advisory lock so concurrent
 * cold starts (several Vercel instances) cannot apply the same migration twice.
 *
 * Design:
 *  - `checks.doc` holds the MUTABLE part of a check (status, inputs, archived, calcError, choice).
 *  - Everything historical is APPEND-ONLY and lives in `records` (estimates, quotes, outcomes,
 *    evidence, plan changes, rates, fee schedule versions) or `audit_events` (activity + config log).
 *  - Triggers reject UPDATE/DELETE/TRUNCATE on append-only tables. The only exception is purging a
 *    DEMO workspace (demo reset), which must be requested explicitly inside the transaction.
 *  - A recorded route choice can never be changed once set (trigger on `checks`).
 *  - `audit_events` form a per-workspace SHA-256 hash chain (tamper evidence, verified in code).
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "initial",
    sql: `
CREATE TABLE workspaces (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  is_demo        boolean NOT NULL,
  corridor       text NOT NULL,
  seeded_at      timestamptz NOT NULL,
  check_counter  integer NOT NULL DEFAULT 0 CHECK (check_counter >= 0),
  id_counter     integer NOT NULL DEFAULT 0 CHECK (id_counter >= 0),
  pseudonym_key  text NOT NULL CHECK (pseudonym_key ~ '^[0-9a-f]{64}$'),
  fee_draft      jsonb,
  audit_seq      bigint NOT NULL DEFAULT 0,
  audit_head     text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             text PRIMARY KEY,
  email          text UNIQUE CHECK (email IS NULL OR email = lower(email)),
  name           text NOT NULL,
  initials       text NOT NULL,
  password_hash  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id        text NOT NULL REFERENCES users(id),
  access         text NOT NULL CHECK (access IN ('admin', 'member', 'viewer')),
  title          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE sessions (
  token_hash     text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id        text NOT NULL REFERENCES users(id),
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  email          text NOT NULL,
  at             timestamptz NOT NULL,
  ok             boolean NOT NULL
);
CREATE INDEX login_attempts_email_at ON login_attempts(email, at);

CREATE TABLE checks (
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id             text NOT NULL,
  doc            jsonb NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE records (
  workspace_id   text NOT NULL REFERENCES workspaces(id),
  collection     text NOT NULL CHECK (collection IN ('estimate', 'quote', 'outcome', 'evidence', 'plan_change', 'rate', 'fee_version')),
  parent_id      text NOT NULL,           -- check id, or '' for workspace-level collections
  seq            integer NOT NULL CHECK (seq >= 0),
  doc            jsonb NOT NULL,
  PRIMARY KEY (workspace_id, collection, parent_id, seq)
);

CREATE TABLE audit_events (
  workspace_id   text NOT NULL REFERENCES workspaces(id),
  seq            bigint NOT NULL CHECK (seq >= 1),
  check_id       text,                    -- NULL for workspace configuration events
  id             text NOT NULL,
  at             timestamptz NOT NULL,
  actor          text NOT NULL,
  type           text NOT NULL,
  message        text NOT NULL,
  prev_hash      text NOT NULL,
  hash           text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (workspace_id, seq)
);
CREATE INDEX audit_events_check ON audit_events(workspace_id, check_id, seq);

-- Append-only enforcement. DELETE is allowed only while purging a DEMO workspace that the
-- transaction has named explicitly via set_config('landed.purge_workspace', <id>, true).
CREATE FUNCTION landed_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('landed.purge_workspace', true) = OLD.workspace_id
     AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = OLD.workspace_id AND w.is_demo) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'append-only table "%": % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END $$;

CREATE FUNCTION landed_forbid_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table "%": TRUNCATE is not allowed', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER records_append_only BEFORE UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION landed_forbid_mutation();
CREATE TRIGGER records_no_truncate BEFORE TRUNCATE ON records FOR EACH STATEMENT EXECUTE FUNCTION landed_forbid_truncate();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION landed_forbid_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION landed_forbid_truncate();

-- A recorded route choice is frozen: once set it can never change or be removed.
-- Checks themselves can only be deleted as part of a demo purge.
CREATE FUNCTION landed_check_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('landed.purge_workspace', true) = OLD.workspace_id
       AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = OLD.workspace_id AND w.is_demo) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'checks cannot be deleted (archive instead)' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id THEN
    RAISE EXCEPTION 'check identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(OLD.doc->'choice') = 'object' AND (NEW.doc->'choice') IS DISTINCT FROM (OLD.doc->'choice') THEN
    RAISE EXCEPTION 'recorded choice on check % is frozen', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checks_guard BEFORE UPDATE OR DELETE ON checks FOR EACH ROW EXECUTE FUNCTION landed_check_guard();
`,
  },
  {
    version: 2,
    name: "external_integrations",
    sql: `
-- Market data is global (not tenant data). Provider quotes belong to a workspace's check.
-- Monetary values and rates are NUMERIC (exact decimal), never floating point.

CREATE FUNCTION landed_forbid_any() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table "%": % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END $$;

-- Raw provider responses, content-addressed by SHA-256 of the exact bytes received.
CREATE TABLE integration_payloads (
  hash           text PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
  provider       text NOT NULL,
  content_type   text NOT NULL,
  body           text NOT NULL,
  received_at    timestamptz NOT NULL
);

CREATE TABLE fx_provider_observations (
  id                 text PRIMARY KEY,
  provider           text NOT NULL,
  dataset            text NOT NULL,             -- e.g. "blend", "ECB", "latest"
  base_currency      text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency     text NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  rate               numeric CHECK (rate IS NULL OR rate > 0),
  observed_at        timestamptz,               -- when the SOURCE observed the rate
  observed_date      date,
  retrieved_at       timestamptz NOT NULL,      -- when we received it
  cached             boolean NOT NULL DEFAULT false,
  source_reference   text NOT NULL,             -- endpoint without credentials
  attribution        jsonb,
  raw_response_hash  text REFERENCES integration_payloads(hash),
  status             text NOT NULL CHECK (status IN ('ok', 'failed')),
  error_code         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'ok') = (rate IS NOT NULL))
);
CREATE INDEX fx_obs_pair ON fx_provider_observations(base_currency, quote_currency, retrieved_at DESC);

CREATE TABLE fx_benchmark_snapshots (
  id                        text PRIMARY KEY,
  base_currency             text NOT NULL,
  quote_currency            text NOT NULL,
  selected_rate             numeric CHECK (selected_rate IS NULL OR selected_rate > 0),
  selected_provider         text,
  secondary_rate            numeric,
  secondary_provider        text,
  difference_percentage     numeric,
  observed_at               timestamptz,
  retrieved_at              timestamptz,
  freshness                 text NOT NULL CHECK (freshness IN ('fresh', 'aging', 'stale', 'unavailable')),
  fallback_used             boolean NOT NULL DEFAULT false,
  warnings                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence                  jsonb NOT NULL,       -- observation ids considered
  selection_policy_version  text NOT NULL,
  created_at                timestamptz NOT NULL,
  CHECK ((freshness = 'unavailable') = (selected_rate IS NULL))
);
CREATE INDEX fx_bench_pair ON fx_benchmark_snapshots(base_currency, quote_currency, created_at DESC);

CREATE TABLE provider_quotes (
  id                       text PRIMARY KEY,
  workspace_id             text NOT NULL REFERENCES workspaces(id),
  payment_check_id         text NOT NULL,
  provider                 text NOT NULL,
  provider_quote_id        text,
  source_currency          text NOT NULL,
  target_currency          text NOT NULL,
  source_amount            numeric,
  target_amount            numeric,
  exchange_rate            numeric,
  total_fee                numeric,
  fee_currency             text,
  fee_breakdown            jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_estimate        text,
  pay_in_method            text,
  pay_out_method           text,
  quote_status             text NOT NULL,
  evidence_classification  text NOT NULL CHECK (evidence_classification IN ('authenticated_quote', 'unauthenticated_quote', 'manual', 'unavailable')),
  notices                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  disabled_options         jsonb NOT NULL DEFAULT '[]'::jsonb,
  benchmark_rate           numeric,               -- benchmark it was compared with, frozen
  benchmark_reference      text,
  raw_response_reference   text REFERENCES integration_payloads(hash),
  created_at               timestamptz NOT NULL,  -- provider's quote creation time, or retrieval time
  retrieved_at             timestamptz NOT NULL,
  expires_at               timestamptz,
  rate_expires_at          timestamptz,
  requested_by             text NOT NULL
);
CREATE INDEX provider_quotes_check ON provider_quotes(workspace_id, payment_check_id, retrieved_at);

CREATE TABLE provider_integrations (
  id                  text PRIMARY KEY,
  provider            text NOT NULL UNIQUE,
  integration_status  text NOT NULL,
  environment         text NOT NULL,
  last_success_at     timestamptz,
  last_failure_at     timestamptz,
  last_error_code     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integration_events (
  id                  text PRIMARY KEY,
  provider            text NOT NULL,
  event_type          text NOT NULL,
  request_reference   text NOT NULL,      -- method + endpoint, never credentials
  response_reference  text,               -- payload hash
  status              text NOT NULL CHECK (status IN ('success', 'failure', 'cached')),
  error_code          text,
  duration_ms         integer,
  attempts            integer NOT NULL DEFAULT 1,
  occurred_at         timestamptz NOT NULL
);
CREATE INDEX integration_events_provider ON integration_events(provider, occurred_at DESC);

CREATE TABLE currency_metadata (
  currency_code          text PRIMARY KEY CHECK (currency_code ~ '^[A-Z]{3}$'),
  currency_name          text NOT NULL,
  symbol                 text NOT NULL,
  decimal_precision      integer NOT NULL CHECK (decimal_precision BETWEEN 0 AND 4),
  countries              jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_availability  jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at       timestamptz
);

-- Stripe: Landed's OWN SaaS billing. Entirely separate from supplier payment checks.
CREATE TABLE stripe_events (
  id            text PRIMARY KEY,           -- Stripe event id: duplicate deliveries are no-ops
  type          text NOT NULL,
  livemode      boolean NOT NULL,
  received_at   timestamptz NOT NULL,
  outcome       text NOT NULL
);
CREATE TABLE billing_subscriptions (
  workspace_id            text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_customer_id      text UNIQUE,
  stripe_subscription_id  text,
  status                  text NOT NULL,
  current_period_end      timestamptz,
  last_event_id           text,
  updated_at              timestamptz NOT NULL
);

CREATE TRIGGER integration_payloads_append_only BEFORE UPDATE OR DELETE ON integration_payloads FOR EACH ROW EXECUTE FUNCTION landed_forbid_any();
CREATE TRIGGER fx_obs_append_only BEFORE UPDATE OR DELETE ON fx_provider_observations FOR EACH ROW EXECUTE FUNCTION landed_forbid_any();
CREATE TRIGGER fx_bench_append_only BEFORE UPDATE OR DELETE ON fx_benchmark_snapshots FOR EACH ROW EXECUTE FUNCTION landed_forbid_any();
CREATE TRIGGER integration_events_append_only BEFORE UPDATE OR DELETE ON integration_events FOR EACH ROW EXECUTE FUNCTION landed_forbid_any();
CREATE TRIGGER stripe_events_append_only BEFORE UPDATE OR DELETE ON stripe_events FOR EACH ROW EXECUTE FUNCTION landed_forbid_any();
-- Provider quotes: append-only, purgeable only with their DEMO workspace (same rule as other history).
CREATE TRIGGER provider_quotes_append_only BEFORE UPDATE OR DELETE ON provider_quotes FOR EACH ROW EXECUTE FUNCTION landed_forbid_mutation();

-- Every saved estimate already freezes its inputs, rate (with benchmark provenance), fee rules,
-- calculation version and output. This view exposes them as calculation snapshots, so there is one
-- source of truth rather than a second copy that could drift.
CREATE VIEW calculation_snapshots AS
  SELECT r.workspace_id,
         r.parent_id                       AS payment_check_id,
         r.doc->>'id'                      AS id,
         r.doc->'inputs'                   AS payment_input,
         r.doc->'rate'                     AS benchmark_snapshot,
         r.doc->'rate'->>'benchmarkId'     AS benchmark_snapshot_id,
         r.doc->'rules'                    AS fee_configuration,
         (r.doc->>'scheduleVersion')::int  AS fee_schedule_version,
         r.doc->>'calcVersion'             AS calculation_version,
         r.doc->'result'                   AS calculation_output,
         r.doc->'result'->'excluded'       AS warnings,
         (r.doc->>'computedAt')::timestamptz AS created_at
    FROM records r
   WHERE r.collection = 'estimate';
`,
  },
];

export async function migrate(sql: SqlClient): Promise<void> {
  await sql.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(724501)");
    await tx.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await tx.query<{ version: number }>("SELECT version FROM schema_migrations")).rows.map((r) => Number(r.version)));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await tx.exec(m.sql);
      await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [m.version, m.name]);
    }
  });
}
