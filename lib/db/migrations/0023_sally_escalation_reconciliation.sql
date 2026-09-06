ALTER TABLE sally_email_queue
  DROP CONSTRAINT IF EXISTS sally_email_queue_escalation_forward_status_check;

ALTER TABLE sally_email_queue
  ADD CONSTRAINT sally_email_queue_escalation_forward_status_check
  CHECK (escalation_forward_status IN (
    'forwarding', 'unconfirmed', 'resending', 'succeeded', 'confirmed', 'failed'
  ));

CREATE TABLE IF NOT EXISTS sally_escalation_reconciliation_audit (
  id                          SERIAL PRIMARY KEY,
  queue_item_id               INTEGER NOT NULL REFERENCES sally_email_queue(id) ON DELETE CASCADE,
  action                      TEXT NOT NULL,
  previous_status             TEXT,
  resulting_status            TEXT,
  actor                       TEXT NOT NULL,
  acknowledged_duplicate_risk BOOLEAN NOT NULL DEFAULT false,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT sally_escalation_reconciliation_action_check
    CHECK (action IN (
      'confirm_delivery', 'confirm_conflict',
      'resend_requested', 'resend_conflict',
      'resend_succeeded', 'resend_failed', 'resend_unconfirmed'
    ))
);

CREATE INDEX IF NOT EXISTS sally_escalation_reconciliation_audit_queue_idx
  ON sally_escalation_reconciliation_audit (queue_item_id, created_at DESC);