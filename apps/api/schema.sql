CREATE TABLE IF NOT EXISTS inputs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_text TEXT NOT NULL,
  processing_consent INTEGER DEFAULT 0,
  received_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  input_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_utc TEXT,
  source_span TEXT,
  timezone TEXT,
  ambiguity TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at_utc TEXT,
  edit_fields TEXT,
  approved INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS samples (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL
);

INSERT OR IGNORE INTO samples (id, title, text) VALUES
  ('sample-1', 'Interview invitation', 'You are invited to interview for the Product Engineer role on Friday, November 20 at 2:00pm EST. Please bring a photo ID.'),
  ('sample-2', 'Library notice', 'Your book is due on 11/25/2026. Please return or renew it before the due date to avoid fines.'),
  ('sample-3', 'Dentist reminder', 'Dentist appointment with Dr. Lee on Tuesday, December 2 at 10:30am. Please arrive 15 minutes early.');
