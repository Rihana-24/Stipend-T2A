#!/usr/bin/env python3
"""Génère seed/placements.sql à partir des 3 fichiers Excel (PWD, employeurs/quotas, stipends déjà reçus).
Usage : python3 scripts/build_placements.py <associates.xlsx> <Restants.xlsx> <Suivi_stipend.xlsx>
Le SQL produit est idempotent (peut être rejoué sans doublon) et ne contient aucun lien secret."""
import sys, re, pandas as pd
A, R, S = sys.argv[1:4]
q = lambda v: 'NULL' if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == '' else "'" + str(v).replace("'", "''").strip() + "'"
low = lambda e: str(e).strip().lower()
out = ['-- GÉNÉRÉ par scripts/build_placements.py — données personnelles : ne pas publier.']

# 1) Employeurs : quotas / placés (fichier Restants) + taux spécifiques
assoc = pd.read_excel(A)
rs = pd.read_excel(R, sheet_name='Summary', header=3).iloc[:, :13]
rs = rs[rs.Entreprise.notna() & ~rs.Entreprise.astype(str).str.upper().isin(['TOTAL', 'NON RENSEIGNÉ'])]
RATE125 = ('cjes nova togo', 'cemp consulting group', "cabinet d'expertise en management des projets (cemp)")
names = {}
for _, r in rs.iterrows():
    names[str(r.Entreprise).strip()] = (None if pd.isna(r.Quotas) else int(r.Quotas), None if pd.isna(r['Placés']) else int(r['Placés']))
for e in assoc['Employer Organization'].dropna().unique(): names.setdefault(str(e).strip(), (None, None))
for n, (quota, placed) in sorted(names.items()):
    rate = 125000 if any(low(n).startswith(x) for x in RATE125) else 130000
    out.append(f"INSERT INTO employers (name, rate, quota, placed_file) VALUES ({q(n)}, {rate}, {quota if quota is not None else 'NULL'}, {placed if placed is not None else 'NULL'}) "
               f"ON CONFLICT(name) DO UPDATE SET quota = excluded.quota, placed_file = excluded.placed_file, rate = excluded.rate;")

# 2) PWD
pwd = assoc[assoc['PWD'].astype(str).str.lower() == 'yes']
for e in pwd['Email'].dropna():
    out.append(f"UPDATE associates SET pwd = 1 WHERE lower(email) = {q(low(e))};")

# 3) Stipends déjà reçus (juillet–novembre) : uniquement les « Oui »
d = pd.read_excel(S, sheet_name='Données Néttoyés')
MONTHS = [('Juillet', '2026-07'), ('Août', '2026-08'), ('Septembre', '2026-09'), ('Octobre', '2026-10'), ('Novembre', '2026-11')]
n_rows = n_assoc = 0
for _, r in d.iterrows():
    em = low(r['Adresse email'])
    tc = r['TalentCorps (TC) référent']
    got = False
    for lab, ym in MONTHS:
        if str(r[f'Stipend {lab} 2026 – reçu ?']).strip() != 'Oui': continue
        got = True
        amt = r[f'{lab} – montant reçu (FCFA)']; dt = r[f'{lab} – date de réception']; url = r[f'{lab} – preuve de réception']
        amt = 'NULL' if pd.isna(amt) else int(amt)
        dt = 'NULL' if pd.isna(dt) else q(pd.Timestamp(dt).strftime('%Y-%m-%d'))
        url = q(url) if isinstance(url, str) and url.startswith('http') else 'NULL'
        out.append(f"INSERT INTO stipend_months (associate_id, month, declared, amount, received_date, ext_proof_url, source, review, updated_at) "
                   f"SELECT id, '{ym}', 'received', {amt}, {dt}, {url}, 'import_form', 'pending', datetime('now') FROM associates WHERE lower(email) = {q(em)} "
                   f"ON CONFLICT(associate_id, month) DO NOTHING;")
        n_rows += 1
    if got: n_assoc += 1; out.append(f"UPDATE associates SET has_received = 1 WHERE lower(email) = {q(em)} AND has_received IS NULL;")
    if isinstance(tc, str) and tc.strip() not in ('', 'Aucun'):
        out.append(f"UPDATE associates SET declared_tc = {q(tc)} WHERE lower(email) = {q(em)} AND declared_tc IS NULL;")
    st = r['Date de démarrage du stage']
    if not pd.isna(st):
        out.append(f"UPDATE associates SET start_date = {q(pd.Timestamp(st).strftime('%Y-%m-%d'))} WHERE lower(email) = {q(em)} AND start_date IS NULL;")

# 4) Réglages : objectifs de placement et placés officiels (ligne TOTAL du fichier Restants)
out.append("INSERT INTO settings (key, value) VALUES ('placement_targets', '{\"sn\":800,\"bjtg\":500,\"ci\":100,\"bfne\":100,\"cmcd\":100,\"other\":200}') ON CONFLICT(key) DO NOTHING;")
out.append("INSERT INTO settings (key, value) VALUES ('placed_file', '{\"sn\":548,\"bjtg\":232,\"ci\":4,\"bfne\":8,\"cmcd\":28,\"other\":5}') ON CONFLICT(key) DO NOTHING;")

# 5) Comptes équipe : administrateurs qui sont aussi TalentCorps (noms identiques à la liste des TC)
for name, em in [('Rihanatou BANKOLE', 'rihanatou.bankole@mfap.talent2africa.com'), ('Guy AHONAKPON', 'ahonakpon.gbaguidi@mfap.talent2africa.com')]:
    out.append(f"INSERT INTO staff (email, name, role) VALUES ({q(em)}, {q(name)}, 'admin') ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = 'admin', active = 1;")
open('seed/placements.sql', 'w').write('\n'.join(out) + '\n')
print(f'{len(names)} employeurs, {len(pwd)} PWD, {n_rows} mois reçus pour {n_assoc} Associates')
