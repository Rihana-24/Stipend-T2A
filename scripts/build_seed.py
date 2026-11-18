#!/usr/bin/env python3
"""Génère seed/associates.sql depuis la liste des Associates (xlsx).
Minimisation des données : seuls les champs utiles au suivi sont importés
(pas de date de naissance, handicap, statut de réfugié, etc.).
Usage : python3 scripts/build_seed.py chemin/vers/associates.xlsx
"""
import re, secrets, sys
import pandas as pd

src = sys.argv[1]
df = pd.read_excel(src, dtype=str).fillna("")

def clean(v): return re.sub(r"\s+", " ", str(v)).strip()
def q(v):
    v = clean(v)
    return "NULL" if v == "" else "'" + v.replace("'", "''") + "'"
def phone(v):
    d = re.sub(r"\D", "", str(v))
    return d

seen_email, rows = set(), []
for i, r in enumerate(df.to_dict("records"), start=1):
    email = clean(r["Email"]).lower()
    if not email or email in seen_email:
        continue
    seen_email.add(email)
    first, last = clean(r["Prénom"]), clean(r["Nom"])
    full = clean(f"{first} {last}")
    rows.append(
        "INSERT OR IGNORE INTO associates (id, ref, token, first_name, last_name, full_name, email, alt_email, phone, country, employer) VALUES "
        f"({q(r['Id'])}, 'ASC-{i:04d}', '{secrets.token_urlsafe(24)}', {q(first)}, {q(last)}, {q(full)}, {q(email)}, "
        f"{q(r['Alternative Email'].lower())}, {q(phone(r['Téléphone']))}, {q(r['Pays de Résidence'])}, {q(r['Employer Organization'])});"
    )

with open("seed/associates.sql", "w", encoding="utf-8") as f:
    f.write("-- GÉNÉRÉ : contient des données personnelles et des liens secrets. Ne pas publier.\n")
    f.write("\n".join(rows) + "\n")
print(f"{len(rows)} associates -> seed/associates.sql")
