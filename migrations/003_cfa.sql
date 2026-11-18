-- Migration 003 — profil CFA, suivi des liens, contrôle des preuves. À exécuter UNE SEULE fois : npm run db:migrate3
ALTER TABLE associates ADD COLUMN gender TEXT;            -- F | M
ALTER TABLE associates ADD COLUMN rdp TEXT;               -- refugee | idp | both | rdp (réfugié / déplacé)
ALTER TABLE associates ADD COLUMN mcf TEXT;               -- scholar | other (alumni Mastercard Foundation) ; NULL = non alumni
ALTER TABLE associates ADD COLUMN area TEXT;              -- urban | rural
ALTER TABLE associates ADD COLUMN placement_start TEXT;   -- date de placement officielle (rapport CFA)
ALTER TABLE associates ADD COLUMN placement_end TEXT;
ALTER TABLE associates ADD COLUMN employer_kpmg_id TEXT;  -- KPMG ID of Employer
ALTER TABLE associates ADD COLUMN link_sent_at TEXT;      -- dernier envoi du lien personnel
ALTER TABLE associates ADD COLUMN link_channel TEXT;      -- email | whatsapp | manual
ALTER TABLE proofs ADD COLUMN sha256 TEXT;                -- empreinte du fichier (détection des doublons)
CREATE INDEX IF NOT EXISTS idx_proofs_sha ON proofs(sha256);
