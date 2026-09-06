import { pool } from "@workspace/db";
import { logger } from "./logger";

/** Creates Sally CRM tables if they don't exist. Called once at server startup. */
export async function runSallyMigrations(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sally_leads (
        id                   SERIAL PRIMARY KEY,
        name                 TEXT NOT NULL,
        email                TEXT NOT NULL,
        product_interest_group TEXT NOT NULL DEFAULT '',
        first_contact_date   TEXT,
        training_registered  BOOLEAN NOT NULL DEFAULT false,
        is_cancelled         BOOLEAN NOT NULL DEFAULT false,
        created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sally_certified_doctors (
        id                 SERIAL PRIMARY KEY,
        name               TEXT NOT NULL,
        email              TEXT NOT NULL,
        last_purchase_date TEXT,
        avg_items_per_order REAL NOT NULL DEFAULT 0,
        is_cancelled       BOOLEAN NOT NULL DEFAULT false,
        portal_sessions_revoked_at TIMESTAMPTZ,
        created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sally_email_queue (
        id               SERIAL PRIMARY KEY,
        recipient_email  TEXT NOT NULL,
        subject          TEXT NOT NULL,
        body             TEXT NOT NULL,
        trigger_type     TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending',
        related_lead_id  INTEGER,
        related_doctor_id INTEGER,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    // Add deleted_at for soft-deletes (idempotent — IF NOT EXISTS)
    await pool.query(`
      ALTER TABLE sally_leads
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE sally_certified_doctors
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE sally_certified_doctors
        ADD COLUMN IF NOT EXISTS portal_sessions_revoked_at TIMESTAMPTZ;
    `);

    // Add email threading + AI reply columns to the queue
    await pool.query(`
      ALTER TABLE sally_email_queue
        ADD COLUMN IF NOT EXISTS message_id      TEXT,
        ADD COLUMN IF NOT EXISTS in_reply_to     TEXT,
        ADD COLUMN IF NOT EXISTS detected_language TEXT,
        ADD COLUMN IF NOT EXISTS detected_formality TEXT,
        ADD COLUMN IF NOT EXISTS inbound_from    TEXT,
        ADD COLUMN IF NOT EXISTS inbound_body    TEXT,
        ADD COLUMN IF NOT EXISTS inbound_message_id TEXT;

      -- One reply draft per inbound message (atomic dedupe across concurrent polls)
      CREATE UNIQUE INDEX IF NOT EXISTS sally_email_queue_inbound_msg_uniq
        ON sally_email_queue (inbound_message_id)
        WHERE trigger_type = 'inbound_reply' AND inbound_message_id IS NOT NULL;
    `);

    // Order review + lessons (learning loop)
    await pool.query(`
      ALTER TABLE sally_email_queue
        ADD COLUMN IF NOT EXISTS related_order_id INTEGER;

      ALTER TABLE iroc_orders
        ADD COLUMN IF NOT EXISTS contact_language        TEXT,
        ADD COLUMN IF NOT EXISTS sally_review_status     TEXT,
        ADD COLUMN IF NOT EXISTS sally_review_result     TEXT,
        ADD COLUMN IF NOT EXISTS sally_review_claimed_at TIMESTAMP;

      -- One active missing-info draft per order (DB-level dedupe; cancelled drafts don't block re-runs)
      CREATE UNIQUE INDEX IF NOT EXISTS sally_email_queue_order_missing_info_uniq
        ON sally_email_queue (related_order_id, trigger_type)
        WHERE trigger_type = 'order_missing_info' AND status IN ('pending', 'sent');

      -- Auto-drafted invoices from reviewed-complete orders (#496)
      ALTER TABLE iroc_invoices
        ADD COLUMN IF NOT EXISTS source_order_id INTEGER,
        ADD COLUMN IF NOT EXISTS sally_generated BOOLEAN NOT NULL DEFAULT false;

      -- One invoice per source order (DB-level dedupe for the auto-draft path)
      CREATE UNIQUE INDEX IF NOT EXISTS iroc_invoices_source_order_uniq
        ON iroc_invoices (source_order_id)
        WHERE source_order_id IS NOT NULL;

      ALTER TABLE sally_email_queue
        ADD COLUMN IF NOT EXISTS related_invoice_id INTEGER;

      -- One active dispatch email per invoice per recipient role
      -- (billing = 'invoice_dispatch', shipping = 'invoice_dispatch_shipping')
      DROP INDEX IF EXISTS sally_email_queue_invoice_dispatch_uniq;
      CREATE UNIQUE INDEX IF NOT EXISTS sally_email_queue_invoice_dispatch_uniq
        ON sally_email_queue (related_invoice_id, trigger_type)
        WHERE trigger_type IN ('invoice_dispatch', 'invoice_dispatch_shipping') AND status IN ('pending', 'sent');

      CREATE TABLE IF NOT EXISTS sally_lessons (
        id             SERIAL PRIMARY KEY,
        context        TEXT NOT NULL,
        original_text  TEXT NOT NULL,
        corrected_text TEXT NOT NULL,
        lesson         TEXT NOT NULL,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    // Treating doctor field on website_customers
    await pool.query(`
      ALTER TABLE website_customers
        ADD COLUMN IF NOT EXISTS treating_doctor_name TEXT;
    `);

    // Payment reminder tracking
    await pool.query(`
      -- Record when an invoice is first marked as sent (used for first-reminder threshold)
      ALTER TABLE iroc_invoices
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP;

      -- Suppress future reminders for a specific invoice (admin can toggle)
      ALTER TABLE iroc_invoices
        ADD COLUMN IF NOT EXISTS reminder_suppressed BOOLEAN NOT NULL DEFAULT false;

      -- Backfill existing sent invoices using updated_at as a conservative proxy
      UPDATE iroc_invoices
        SET sent_at = updated_at
       WHERE status = 'sent' AND sent_at IS NULL;

      -- At most one pending payment reminder per invoice at a time
      CREATE UNIQUE INDEX IF NOT EXISTS sally_email_queue_payment_reminder_uniq
        ON sally_email_queue (related_invoice_id)
        WHERE trigger_type = 'payment_reminder' AND status = 'pending';
    `);

    // DB-level guard: limit product_interest_group to the values declared in
    // ProductGroup (sally-groups.ts).  Any attempt to INSERT or UPDATE a row
    // with an unknown group string will be rejected by the DB before it ever
    // reaches TypeScript, so a developer who adds a new group to the DB must
    // also update the union + add the constraint value here (and the build's
    // exhaustiveness check in sally-reply.ts catches the TypeScript side).
    //
    // Step 1: backfill any legacy non-canonical values using the same keyword
    // mapping as specialtyToProductGroup() in sally-groups.ts.  Unknown values
    // that don't match any keyword are set to '' (general/unknown).
    // This runs unconditionally — it is safe to apply against already-canonical
    // rows because the WHERE clause filters those out.
    await pool.query(`
      UPDATE sally_leads
      SET product_interest_group = CASE
        WHEN product_interest_group ILIKE '%mfat%'
          OR product_interest_group ILIKE '%svf%'
          OR product_interest_group ILIKE '%micro fat%'
          OR product_interest_group ILIKE '%mikrofett%'
          OR product_interest_group ILIKE '%micro-fat%'
          OR product_interest_group ILIKE '%stromal vascular%'
          OR product_interest_group ILIKE '%stromal-vascular%'
          OR product_interest_group ILIKE '%fat transfer%'
          OR product_interest_group ILIKE '%fetttransfer%'
          OR product_interest_group ILIKE '%fat graft%'
          OR product_interest_group ILIKE '%ministem%'
          OR product_interest_group ILIKE '%mini stem%'
          OR product_interest_group ILIKE '%jointechlabs%'
          OR product_interest_group ILIKE '%joint tech%'
          OR product_interest_group ILIKE '%adipose%'
          OR product_interest_group ILIKE '%fettgewebe%'
          OR product_interest_group ILIKE '%stem cell%'
          OR product_interest_group ILIKE '%stammzell%'
          THEN 'ministem'
        WHEN product_interest_group ILIKE '%prp%'
          OR product_interest_group ILIKE '%prf%'
          OR product_interest_group ILIKE '%platelet-rich%'
          OR product_interest_group ILIKE '%platelet rich%'
          OR product_interest_group ILIKE '%thrombozyten%'
          OR product_interest_group ILIKE '%thrombo%'
          OR product_interest_group ILIKE '%exosome%'
          OR product_interest_group ILIKE '%exosom%'
          OR product_interest_group ILIKE '%cellenis%'
          OR product_interest_group ILIKE '%estar medical%'
          OR product_interest_group ILIKE '%estar-medical%'
          OR product_interest_group ILIKE '%regenerative%'
          OR product_interest_group ILIKE '%regenerativ%'
          OR product_interest_group ILIKE '%growth factor%'
          OR product_interest_group ILIKE '%wachstumsfaktor%'
          THEN 'cellenis'
        WHEN product_interest_group ILIKE '%hand surg%'
          OR product_interest_group ILIKE '%handchirur%'
          OR product_interest_group ILIKE '%hand chirur%'
          OR product_interest_group ILIKE '%spirecut%'
          OR product_interest_group ILIKE '%wrist%'
          OR product_interest_group ILIKE '%handgelenk%'
          OR product_interest_group ILIKE '%finger%'
          OR product_interest_group ILIKE '%hand surgeon%'
          THEN 'spirecut'
        ELSE ''
      END
      WHERE product_interest_group NOT IN ('spirecut', 'ministem', 'cellenis', '');
    `);

    // Step 2: add the CHECK constraint now that all rows are canonical.
    // Idempotent: the DO block skips the ALTER if the constraint already exists.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'sally_leads_product_interest_group_check'
            AND conrelid = 'sally_leads'::regclass
        ) THEN
          ALTER TABLE sally_leads
            ADD CONSTRAINT sally_leads_product_interest_group_check
            CHECK (product_interest_group IN ('spirecut', 'ministem', 'cellenis', ''));
        END IF;
      END
      $$;
    `);

    // Preserve the original free-text specialty that was used to classify a
    // lead at import time. Storing it here lets the reclassify/all endpoint
    // re-run specialtyToProductGroup() against the source text rather than
    // the already-derived canonical label, so keyword removals are detectable.
    await pool.query(`
      ALTER TABLE sally_leads
        ADD COLUMN IF NOT EXISTS specialty TEXT;
    `);

    // ── Expense & Invoice Reader ───────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS iroc_expenses (
        id               SERIAL PRIMARY KEY,
        vendor_name      TEXT,
        invoice_date     DATE,
        invoice_number   TEXT,
        category         TEXT,
        net_amount       NUMERIC(12,2),
        tax_amount       NUMERIC(12,2),
        gross_amount     NUMERIC(12,2),
        currency         TEXT NOT NULL DEFAULT 'EUR',
        source           TEXT NOT NULL DEFAULT 'manual',
        file_object_path TEXT,
        extraction_raw   JSONB,
        notes            TEXT,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // ── Duplicate-guard index for expense deduplication ───────────────────────
    // Covers the (invoice_number, vendor_name, invoice_date) triple used by the
    // POST /api/admin/expenses duplicate check.  The WHERE clause restricts the
    // index to rows that have all three fields populated so null-only rows are
    // excluded and the index stays compact.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS iroc_expenses_dedup_idx
        ON iroc_expenses (invoice_number, vendor_name, invoice_date)
        WHERE invoice_number IS NOT NULL
          AND vendor_name    IS NOT NULL
          AND invoice_date   IS NOT NULL;
    `);

    // ── Add shipping_cost column to iroc_expenses (idempotent) ───────────────
    await pool.query(`
      ALTER TABLE iroc_expenses
        ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(12,2);
    `);

    // Supplier country is extracted by Tori and determines the language of
    // future supplier reorder drafts.
    await pool.query(`
      ALTER TABLE iroc_expenses
        ADD COLUMN IF NOT EXISTS vendor_country TEXT;
    `);

    // Preserve the source invoice while recording a reviewable EUR conversion
    // snapshot. Existing non-EUR records are intentionally not revalued here.
    await pool.query(`
      ALTER TABLE iroc_expenses
        ADD COLUMN IF NOT EXISTS invoice_date_original TEXT,
        ADD COLUMN IF NOT EXISTS date_ambiguous BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS date_reviewed BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS net_amount_eur NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS tax_amount_eur NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS gross_amount_eur NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS shipping_cost_eur NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),
        ADD COLUMN IF NOT EXISTS exchange_rate_date DATE,
        ADD COLUMN IF NOT EXISTS conversion_status TEXT NOT NULL DEFAULT 'not_needed',
        ADD COLUMN IF NOT EXISTS conversion_checked_at TIMESTAMP;
    `);
    await pool.query(`
      UPDATE iroc_expenses
      SET net_amount_eur = COALESCE(net_amount_eur, net_amount),
          tax_amount_eur = COALESCE(tax_amount_eur, tax_amount),
          gross_amount_eur = COALESCE(gross_amount_eur, gross_amount),
          shipping_cost_eur = COALESCE(shipping_cost_eur, shipping_cost),
          exchange_rate = COALESCE(exchange_rate, 1),
          conversion_status = CASE
            WHEN conversion_status = 'not_needed' THEN 'not_needed'
            ELSE conversion_status
          END
      WHERE currency = 'EUR';
    `);

    // ── Expense line-item table ───────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS iroc_expense_items (
        id                  SERIAL PRIMARY KEY,
        expense_id          INTEGER NOT NULL REFERENCES iroc_expenses(id) ON DELETE CASCADE,
        product_name_raw    TEXT,
        product_name_local  TEXT,
        proposed_product_id INTEGER,
        lot_number          TEXT,
        quantity            NUMERIC(10,3),
        unit_price          NUMERIC(12,2),
        discount_rate       NUMERIC(5,2),
        line_total          NUMERIC(12,2),
        sort_order          INTEGER DEFAULT 0,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS iroc_expense_items_expense_idx
        ON iroc_expense_items (expense_id);
    `);

    // ── Inventory-lot status column (pending → in_house workflow) ────────────
    await pool.query(`
      ALTER TABLE iroc_inventory_lots
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'in_house';
    `);

    // ── Back-link: expense item → the inventory lot it spawned ──────────────
    await pool.query(`
      ALTER TABLE iroc_expense_items
        ADD COLUMN IF NOT EXISTS inventory_lot_id INTEGER
          REFERENCES iroc_inventory_lots(id) ON DELETE SET NULL;
    `);
    // Manual lots are usable immediately. Expense-derived lots explicitly set
    // status='pending'; preserve only those that are linked to an expense item.
    await pool.query(`
      ALTER TABLE iroc_inventory_lots
        ALTER COLUMN status SET DEFAULT 'in_house';
      UPDATE iroc_inventory_lots il
         SET status = 'in_house'
       WHERE il.status = 'pending'
         AND NOT EXISTS (
           SELECT 1
             FROM iroc_expense_items ei
            WHERE ei.inventory_lot_id = il.id
         );
    `);

    // Source measurements remain readable alongside their metric equivalents.
    await pool.query(`
      ALTER TABLE iroc_expense_items
        ADD COLUMN IF NOT EXISTS measurement_original TEXT,
        ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(10,3),
        ADD COLUMN IF NOT EXISTS length_cm NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS width_cm NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS height_cm NUMERIC(10,2);
    `);

    // Microsoft 365 mailbox registry. OAuth tokens are encrypted before they
    // are persisted here; Exchange passwords are never accepted or stored.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS iroc_microsoft_mailboxes (
        id                    SERIAL PRIMARY KEY,
        email                 TEXT NOT NULL,
        display_name          TEXT,
        purpose               TEXT NOT NULL DEFAULT 'general',
        access_level          TEXT NOT NULL DEFAULT 'read'
                              CHECK (access_level IN ('read', 'read_write')),
        enabled               BOOLEAN NOT NULL DEFAULT true,
        authorization_status  TEXT NOT NULL DEFAULT 'awaiting_authorization'
                              CHECK (authorization_status IN ('awaiting_authorization', 'connected', 'error', 'disabled')),
        oauth_connection_id   TEXT,
        oauth_access_token    TEXT,
        oauth_refresh_token   TEXT,
        oauth_expires_at      TIMESTAMP,
        authorization_error   TEXT,
        last_authorized_at    TIMESTAMP,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE iroc_microsoft_mailboxes
        DROP CONSTRAINT IF EXISTS iroc_microsoft_mailboxes_email_key;
      CREATE UNIQUE INDEX IF NOT EXISTS iroc_microsoft_mailboxes_email_purpose_key
        ON iroc_microsoft_mailboxes (LOWER(email), purpose);
      CREATE TABLE IF NOT EXISTS iroc_microsoft_oauth_states (
        id                    SERIAL PRIMARY KEY,
        state_hash            TEXT NOT NULL UNIQUE,
        mailbox_id            INTEGER NOT NULL REFERENCES iroc_microsoft_mailboxes(id) ON DELETE CASCADE,
        expires_at            TIMESTAMP NOT NULL,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS iroc_microsoft_oauth_states_expiry_idx
        ON iroc_microsoft_oauth_states (expires_at);
    `);
    await pool.query(`
      ALTER TABLE iroc_microsoft_mailboxes
        ADD COLUMN IF NOT EXISTS oauth_access_token TEXT,
        ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT,
        ADD COLUMN IF NOT EXISTS oauth_expires_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS authorization_error TEXT;
    `);

    // Recurring expense schedules are reminders only.  They keep a clean,
    // editable snapshot for the next manual expense and never create DATEV rows
    // or reuse a source invoice/document automatically.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS iroc_recurring_expense_schedules (
        id                SERIAL PRIMARY KEY,
        source_expense_id INTEGER NOT NULL REFERENCES iroc_expenses(id) ON DELETE CASCADE,
        cadence           TEXT NOT NULL,
        interval_count    INTEGER NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 999),
        interval_unit     TEXT NOT NULL DEFAULT 'month' CHECK (interval_unit IN ('day','week','month','quarter','year')),
        template          JSONB NOT NULL,
        next_due_date     DATE NOT NULL,
        enabled           BOOLEAN NOT NULL DEFAULT true,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS iroc_recurring_expense_due_idx
        ON iroc_recurring_expense_schedules (enabled, next_due_date);
    `);
    // Upgrade the first version of recurrence schedules (preset cadence values)
    // without losing existing reminder dates.
    await pool.query(`
      ALTER TABLE iroc_recurring_expense_schedules
        DROP CONSTRAINT IF EXISTS iroc_recurring_expense_schedules_cadence_check;
      ALTER TABLE iroc_recurring_expense_schedules
        ADD COLUMN IF NOT EXISTS interval_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE iroc_recurring_expense_schedules
        ADD COLUMN IF NOT EXISTS interval_unit TEXT NOT NULL DEFAULT 'month';
      UPDATE iroc_recurring_expense_schedules
      SET interval_count = CASE cadence
            WHEN 'twice_weekly' THEN 3 WHEN 'three_times_weekly' THEN 2
            WHEN 'every_2_weeks' THEN 2 WHEN 'every_3_weeks' THEN 3
            WHEN 'every_2_months' THEN 2 WHEN 'quarterly' THEN 1
            WHEN 'yearly' THEN 1 ELSE 1 END,
          interval_unit = CASE cadence
            WHEN 'daily' THEN 'day' WHEN 'weekly' THEN 'week'
            WHEN 'twice_weekly' THEN 'day' WHEN 'three_times_weekly' THEN 'day'
            WHEN 'every_2_weeks' THEN 'week' WHEN 'every_3_weeks' THEN 'week'
            WHEN 'monthly' THEN 'month' WHEN 'every_2_months' THEN 'month'
            WHEN 'quarterly' THEN 'quarter' WHEN 'yearly' THEN 'year'
            ELSE interval_unit END
      WHERE cadence IN ('daily','weekly','twice_weekly','three_times_weekly','every_2_weeks','every_3_weeks','monthly','every_2_months','quarterly','yearly');
    `);

    // ── Tori: learning logs ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tori_learning_logs (
        id                  SERIAL PRIMARY KEY,
        original_output     JSONB,
        admin_correction    TEXT,
        admin_notes         TEXT,
        learned_context     TEXT NOT NULL,
        is_universal_rule   BOOLEAN NOT NULL DEFAULT false,
        vendor_hint         TEXT,
        category_hint       TEXT,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // ── Tori: reorder approval queue ──────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tori_reorder_queue (
        id                         SERIAL PRIMARY KEY,
        product_id                 INTEGER REFERENCES iroc_products(id) ON DELETE SET NULL,
        product_name               TEXT,
        product_sku                TEXT,
        vendor_email               TEXT NOT NULL,
        vendor_country             TEXT,
        quantity_to_order          INTEGER,
        contract_price             NUMERIC(12,2),
        sales_milestone_achieved   BOOLEAN NOT NULL DEFAULT false,
        email_to                   TEXT NOT NULL,
        email_subject              TEXT NOT NULL,
        email_body_markdown        TEXT NOT NULL,
        status                     TEXT NOT NULL DEFAULT 'pending',
        email_send_error           TEXT,
        created_at                 TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      ALTER TABLE tori_reorder_queue
        ADD COLUMN IF NOT EXISTS vendor_country TEXT,
        ADD COLUMN IF NOT EXISTS email_send_error TEXT,
        ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS email_message_id TEXT,
        ADD COLUMN IF NOT EXISTS send_attempt_id UUID,
        ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS email_last_attempt_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS send_attempt_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS delivery_provider TEXT,
        ADD COLUMN IF NOT EXISTS email_content_sha256 TEXT,
        ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS reconciliation_action TEXT;
      CREATE INDEX IF NOT EXISTS tori_reorder_queue_status_created_idx
        ON tori_reorder_queue (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS tori_reorder_queue_attempt_idx
        ON tori_reorder_queue (send_attempt_id)
        WHERE send_attempt_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS tori_finance_expenses_history_idx
        ON iroc_expenses (invoice_date DESC, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS tori_finance_invoices_history_idx
        ON iroc_invoices (issue_date DESC, created_at DESC, id DESC);
      ALTER TABLE sally_email_queue
        ADD COLUMN IF NOT EXISTS escalation_forward_status TEXT
          CHECK (escalation_forward_status IN ('forwarding', 'succeeded', 'failed'));
      ALTER TABLE sally_email_queue
        DROP CONSTRAINT IF EXISTS sally_email_queue_escalation_forward_status_check;
      ALTER TABLE sally_email_queue
        ADD CONSTRAINT sally_email_queue_escalation_forward_status_check
          CHECK (escalation_forward_status IN ('forwarding', 'unconfirmed', 'resending', 'succeeded', 'confirmed', 'failed'));
      CREATE TABLE IF NOT EXISTS sally_escalation_reconciliation_audit (
        id                       SERIAL PRIMARY KEY,
        queue_item_id            INTEGER NOT NULL REFERENCES sally_email_queue(id) ON DELETE CASCADE,
        action                   TEXT NOT NULL,
        previous_status          TEXT,
        resulting_status         TEXT,
        actor                    TEXT NOT NULL,
        acknowledged_duplicate_risk BOOLEAN NOT NULL DEFAULT false,
        created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT sally_escalation_reconciliation_action_check
          CHECK (action IN (
            'confirm_delivery', 'confirm_conflict',
            'resend_requested', 'resend_conflict',
            'resend_succeeded', 'resend_failed', 'resend_unconfirmed'
          ))
      );
      CREATE INDEX IF NOT EXISTS sally_escalation_reconciliation_audit_queue_idx
        ON sally_escalation_reconciliation_audit (queue_item_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS sally_escalation_reconciliation_audit_actor_idx
        ON sally_escalation_reconciliation_audit (LOWER(BTRIM(actor)));
      CREATE INDEX IF NOT EXISTS sally_email_queue_status_created_idx
        ON sally_email_queue (status, created_at DESC);
      ALTER TABLE sally_escalation_reconciliation_audit
        DROP CONSTRAINT IF EXISTS sally_escalation_reconciliation_action_check;
      ALTER TABLE sally_escalation_reconciliation_audit
        ADD CONSTRAINT sally_escalation_reconciliation_action_check
          CHECK (action IN (
            'confirm_delivery', 'confirm_conflict',
            'resend_requested', 'resend_conflict',
            'resend_succeeded', 'resend_failed', 'resend_unconfirmed',
            'retry_succeeded', 'retry_failed', 'retry_unconfirmed'
          ));
    `);

    // ── Nav config reset: clear stored config so the new "Agents" group
    //    (replacing the old "Sally CRM" group) takes effect immediately.
    //    The frontend will rebuild from DEFAULT_NAV_CONFIG on the next load.
    await pool.query(`
      DELETE FROM settings
       WHERE key = 'nav_config'
         AND value::jsonb @> '[{"id":"sally"}]'::jsonb;
    `);

    // ── Nav config reset (phase 2): clear stored configs that still have the
    //    old "agents" group with per-tab sally sub-routes instead of unified /sally.
    //    Detected by checking for the /sally/leads slug inside any agents group item.
    await pool.query(`
      DELETE FROM settings
       WHERE key = 'nav_config'
         AND value ~ '^\\s*\\['
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(value::jsonb) AS grp
            WHERE grp->>'id' = 'agents'
              AND grp->'items' @> '[{"slug":"/sally/leads"}]'::jsonb
         );
    `);

    // ── Nav config cleanup: remove /web-design-agent from the 'tools' group
    //    (it belongs only in the 'agents' group).
    await pool.query(`
      UPDATE settings
      SET value = (
        SELECT jsonb_agg(
          CASE WHEN grp->>'id' = 'tools'
            THEN jsonb_set(
              grp, '{items}',
              (SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
               FROM jsonb_array_elements(grp->'items') AS item
               WHERE item->>'slug' != '/web-design-agent')
            )
          ELSE grp
          END
        )
        FROM jsonb_array_elements(value::jsonb) AS grp
      )
      WHERE key = 'nav_config'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(value::jsonb) AS grp2
          WHERE grp2->>'id' = 'tools'
            AND grp2->'items' @> '[{"slug":"/web-design-agent"}]'::jsonb
        );
    `);

    // ── Tori: pending-actions approval queue ─────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tori_pending_actions (
        id                  SERIAL PRIMARY KEY,
        invoice_text        TEXT,
        analysis_json       JSONB,
        proposed_expense    JSONB,
        proposed_items      JSONB,
        missing_fields      JSONB,
        compliance_summary  JSONB,
        status              TEXT NOT NULL DEFAULT 'pending',
        admin_notes         TEXT,
        executed_expense_id INTEGER REFERENCES iroc_expenses(id) ON DELETE SET NULL,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // ── Tori: supplier purchasing contracts ───────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tori_contracts (
        id               SERIAL PRIMARY KEY,
        vendor_name      TEXT NOT NULL,
        contract_text    TEXT NOT NULL,
        discount_tiers   JSONB,
        products_covered JSONB,
        effective_from   DATE,
        notes            TEXT,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      ALTER TABLE tori_contracts
        ADD COLUMN IF NOT EXISTS source_object_path TEXT,
        ADD COLUMN IF NOT EXISTS source_file_name TEXT,
        ADD COLUMN IF NOT EXISTS source_file_size BIGINT,
        ADD COLUMN IF NOT EXISTS source_page_count INTEGER,
        ADD COLUMN IF NOT EXISTS analysis_json JSONB,
        ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS analysis_status TEXT NOT NULL DEFAULT 'analyzed',
        ADD COLUMN IF NOT EXISTS analysis_error TEXT;
    `);

    // ── Pending-quote notification deduplication guard ────────────────────────
    // Both steps run inside a single explicit transaction so no new submission
    // can slip in between the duplicate cleanup and the index creation.
    // PostgreSQL DDL (CREATE INDEX) is transactional, so either both succeed or
    // neither is committed — leaving the database in a consistent state.
    //
    // Step 1: collapse any legacy duplicate unread pending_quote rows down to
    // one (keep the highest id — most recently inserted — delete the rest).
    // This must precede the UNIQUE index creation because CREATE UNIQUE INDEX
    // fails if the covered row set contains duplicates.
    //
    // Step 2: create the unique partial index so that concurrent patient
    // submissions are coalesced into a single bell notification by the DB.
    // The INSERT in patient-extras uses onConflictDoNothing() which relies on
    // this constraint to silently discard the second (and later) inserts.
    // IF NOT EXISTS makes the whole block idempotent on re-runs.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(`
        DELETE FROM iroc_notifications
         WHERE type    = 'pending_quote'
           AND is_read = false
           AND id NOT IN (
             SELECT MAX(id)
               FROM iroc_notifications
              WHERE type    = 'pending_quote'
                AND is_read = false
           );
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_unread_pending_quote
          ON iroc_notifications (type)
          WHERE is_read = false AND type = 'pending_quote';
      `);

      await client.query("COMMIT");
    } catch (indexErr) {
      await client.query("ROLLBACK");
      // Re-throw so the outer catch block surfaces the error and startup fails
      // rather than continuing without the deduplication guard in place.
      throw indexErr;
    } finally {
      client.release();
    }

    // Link legacy iROC customers to website customers only where the
    // normalized email identifies exactly one record in each table. The link
    // and invoice reassignment must be committed together before API routes
    // can rely on the mapping.
    const customerLinkClient = await pool.connect();
    try {
      await customerLinkClient.query("BEGIN");
      await customerLinkClient.query(`
        CREATE TABLE IF NOT EXISTS iroc_customer_website_links (
          website_customer_id integer PRIMARY KEY REFERENCES website_customers(id) ON DELETE CASCADE,
          iroc_customer_id integer NOT NULL UNIQUE REFERENCES iroc_customers(id) ON DELETE CASCADE,
          created_at timestamp NOT NULL DEFAULT now()
        );

        WITH website_email_counts AS (
          SELECT lower(btrim(email)) AS email, count(*) AS count
          FROM website_customers
          WHERE btrim(email) <> ''
          GROUP BY lower(btrim(email))
        ),
        legacy_email_counts AS (
          SELECT lower(btrim(email)) AS email, count(*) AS count
          FROM iroc_customers
          WHERE email IS NOT NULL AND btrim(email) <> ''
          GROUP BY lower(btrim(email))
        ),
        unambiguous_matches AS (
          SELECT wc.id AS website_customer_id, ic.id AS iroc_customer_id
          FROM website_customers wc
          JOIN iroc_customers ic
            ON lower(btrim(wc.email)) = lower(btrim(ic.email))
          JOIN website_email_counts wec
            ON wec.email = lower(btrim(wc.email)) AND wec.count = 1
          JOIN legacy_email_counts lec
            ON lec.email = lower(btrim(ic.email)) AND lec.count = 1
        )
        INSERT INTO iroc_customer_website_links (website_customer_id, iroc_customer_id)
        SELECT website_customer_id, iroc_customer_id
        FROM unambiguous_matches
        ON CONFLICT DO NOTHING;

        UPDATE iroc_invoices invoice
        SET website_customer_id = link.website_customer_id
        FROM iroc_customer_website_links link
        WHERE invoice.website_customer_id IS NULL
          AND invoice.customer_id = link.iroc_customer_id;
      `);
      await customerLinkClient.query("COMMIT");
    } catch (customerLinkErr) {
      await customerLinkClient.query("ROLLBACK");
      throw customerLinkErr;
    } finally {
      customerLinkClient.release();
    }

    logger.info("Sally CRM migrations completed");
  } catch (err) {
    logger.error({ err }, "Sally CRM migration failed");
    // Re-throw so the caller (index.ts) can treat migration failure as fatal
    // and refuse to accept traffic rather than serving with an incomplete schema.
    throw err;
  }
}
