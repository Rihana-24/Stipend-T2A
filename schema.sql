-- Suivi des stipends — Talent2Africa x Mastercard Foundation (Associates Program)
-- Base D1 (SQLite). Exécuter : npm run db:init

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','tc')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS associates (
  id TEXT PRIMARY KEY,                 -- Associate ID (identifiant Academy4Africa / ATS)
  ref TEXT NOT NULL UNIQUE,            -- référence lisible : ASC-0001
  token TEXT NOT NULL UNIQUE,          -- secret du lien personnel
  first_name TEXT,
  last_name TEXT,
  full_name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  alt_email TEXT,
  phone TEXT,
  country TEXT,
  employer TEXT,
  tc_id INTEGER,                       -- TalentCorps référent assigné
  declared_tc TEXT,                    -- nom du TC saisi par l'associate
  start_date TEXT,                     -- date effective de démarrage du stage
  has_received INTEGER,                -- NULL inconnu, 1 oui, 0 non
  first_month TEXT,
  consent_at TEXT,
  last_submitted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,    -- modifications non signées
  last_opened_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  pwd INTEGER NOT NULL DEFAULT 0,      -- personne en situation de handicap
  gender TEXT, rdp TEXT, mcf TEXT, area TEXT,                 -- profil CFA
  placement_start TEXT, placement_end TEXT, employer_kpmg_id TEXT,
  link_sent_at TEXT, link_channel TEXT,                       -- suivi des liens
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assoc_tc ON associates(tc_id);
CREATE INDEX IF NOT EXISTS idx_assoc_employer ON associates(employer);
CREATE INDEX IF NOT EXISTS idx_assoc_email ON associates(email);

CREATE TABLE IF NOT EXISTS proofs (
  id TEXT PRIMARY KEY,
  associate_id TEXT NOT NULL,
  month TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'reception',  -- reception | transfer
  sha256 TEXT
);
CREATE INDEX IF NOT EXISTS idx_proofs_sha ON proofs(sha256);
CREATE INDEX IF NOT EXISTS idx_proofs_assoc ON proofs(associate_id);

CREATE TABLE IF NOT EXISTS stipend_months (
  associate_id TEXT NOT NULL,
  month TEXT NOT NULL,                 -- YYYY-MM
  declared TEXT CHECK (declared IN ('received','not_received')),
  amount INTEGER,                      -- FCFA
  received_date TEXT,
  proof_id TEXT,
  review TEXT NOT NULL DEFAULT 'pending' CHECK (review IN ('pending','confirmed','disputed')),
  review_comment TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL,
  sent_amount INTEGER, sent_date TEXT, sent_proof_id TEXT,   -- virement (équipe)
  ext_proof_url TEXT, source TEXT,
  PRIMARY KEY (associate_id, month)
);

CREATE TABLE IF NOT EXISTS declarations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  associate_id TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  has_received INTEGER NOT NULL,
  snapshot TEXT NOT NULL,              -- JSON des mois déclarés au moment de la signature
  signature_key TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  text_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decl_assoc ON declarations(associate_id);

CREATE TABLE IF NOT EXISTS events (       -- historique complet + journal d'audit
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  associate_id TEXT,
  actor TEXT NOT NULL,                 -- associate | staff:email | system
  type TEXT NOT NULL,
  month TEXT,
  data TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_assoc ON events(associate_id, id);

CREATE TABLE IF NOT EXISTS attestations (
  code TEXT PRIMARY KEY,
  associate_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_att_assoc ON attestations(associate_id);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  associate_id TEXT NOT NULL,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- invite | reminder | dispute | link
  period TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (associate_id, kind, period)
);
CREATE INDEX IF NOT EXISTS idx_mail_status ON email_queue(status, id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employers (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  funding TEXT CHECK (funding IN ('full','shared')),
  rate INTEGER NOT NULL DEFAULT 130000,
  quota INTEGER,
  placed_file INTEGER,
  note TEXT
);
