import Database from 'better-sqlite3'
import { resolve } from 'path'

const DB_PATH = process.env.ACTIONFLOW_DB_PATH || resolve(process.cwd(), 'actionflow.db')
export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inputs (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_text TEXT NOT NULL,
      processing_consent INTEGER NOT NULL DEFAULT 0,
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
      approved INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (input_id) REFERENCES inputs(id)
    );
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      action_ids TEXT NOT NULL,
      output_type TEXT NOT NULL,
      generated_at_utc TEXT NOT NULL
    );
  `)
}

export interface Input { id: string; source_type: string; source_text: string; processing_consent: boolean; received_utc: string }
export interface Action { id: string; input_id: string; title: string; due_utc: string | null; source_span: string | null; timezone: string | null; ambiguity: string | null; status: string; reviewed_at_utc: string | null; edit_fields: string | null; approved: boolean }
export interface Export { id: string; action_ids: string; output_type: string; generated_at_utc: string }

export function seed(db: Database.Database) {
  // No-op by default; synthetic samples live in fixtures/samples.json
}

export function createInput(db: Database.Database, input: Input) {
  const stmt = db.prepare(`INSERT INTO inputs (id, source_type, source_text, processing_consent, received_utc) VALUES (?,?,?,?,?)`)
  stmt.run(input.id, input.source_type, input.source_text, input.processing_consent ? 1 : 0, input.received_utc)
}

export function listActionsByInput(db: Database.Database, inputId: string): Action[] {
  return db.prepare(`SELECT * FROM actions WHERE input_id = ? ORDER BY id`).all(inputId) as Action[]
}

export function upsertAction(db: Database.Database, action: Action) {
  const stmt = db.prepare(`INSERT OR REPLACE INTO actions (id, input_id, title, due_utc, source_span, timezone, ambiguity, status, reviewed_at_utc, edit_fields, approved) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  stmt.run(action.id, action.input_id, action.title, action.due_utc, action.source_span, action.timezone, action.ambiguity, action.status, action.reviewed_at_utc, action.edit_fields, action.approved ? 1 : 0)
}

export function getAction(db: Database.Database, id: string): Action | undefined {
  return db.prepare(`SELECT * FROM actions WHERE id = ?`).get(id) as Action | undefined
}

export function listExports(db: Database.Database): Export[] {
  return db.prepare(`SELECT * FROM exports ORDER BY generated_at_utc DESC`).all() as Export[]
}

export function insertExport(db: Database.Database, exportRow: Export) {
  const stmt = db.prepare(`INSERT INTO exports (id, action_ids, output_type, generated_at_utc) VALUES (?,?,?,?)`)
  stmt.run(exportRow.id, exportRow.action_ids, exportRow.output_type, exportRow.generated_at_utc)
}
