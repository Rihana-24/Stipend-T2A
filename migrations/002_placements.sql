-- Migration 002 — placements, financement, PWD, virements.
-- À exécuter UNE SEULE fois sur une base existante :  npm run db:migrate
ALTER TABLE associates ADD COLUMN pwd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stipend_months ADD COLUMN sent_amount INTEGER;      -- montant viré
ALTER TABLE stipend_months ADD COLUMN sent_date TEXT;           -- date du virement
ALTER TABLE stipend_months ADD COLUMN sent_proof_id TEXT;       -- preuve de virement (déposée par l'équipe)
ALTER TABLE stipend_months ADD COLUMN ext_proof_url TEXT;       -- lien de preuve importé (Google Drive)
ALTER TABLE stipend_months ADD COLUMN source TEXT;              -- NULL = saisi par l'Associate ; import_form = repris du formulaire Google
ALTER TABLE proofs ADD COLUMN kind TEXT NOT NULL DEFAULT 'reception';
CREATE TABLE IF NOT EXISTS employers (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  funding TEXT CHECK (funding IN ('full','shared')),             -- NULL = à définir
  rate INTEGER NOT NULL DEFAULT 130000,                          -- stipend mensuel par Associate (FCFA)
  quota INTEGER,
  placed_file INTEGER,
  note TEXT
);
