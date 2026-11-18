#!/usr/bin/env python3
"""Génère seed/cfa.sql : profil CFA (genre, R/DP, alumni, rural/urbain, dates de placement, KPMG ID employeur).
Usage : python3 scripts/build_cfa.py <associates.xlsx> <cfa-report.xlsx> <cfa-candidates.csv>
Clé de croisement : ID CFA = (Id Academy4Africa sans tirets, minuscules) + « TA ». Rejouable sans doublon."""
import sys, pandas as pd
A, R, C = sys.argv[1:4]
q = lambda v: 'NULL' if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == '' else "'" + str(v).replace("'", "''").strip() + "'"
iso = lambda v: None if pd.isna(v) else pd.to_datetime(v, dayfirst=True).strftime('%Y-%m-%d')
a = pd.read_excel(A); r = pd.read_excel(R, sheet_name=0)
a['cfa'] = a['Id'].str.replace('-', '').str.lower() + 'ta'; r['cfa'] = r['Associate ID'].str.lower()
c = pd.read_csv(C, low_memory=False, usecols=['ID', 'Refugee?', 'Internally displaced (IDP)?']).set_index('ID')
m = a.merge(r, on='cfa', how='left', suffixes=('', '_r'))
out = ['-- GÉNÉRÉ par scripts/build_cfa.py — à exécuter APRÈS l\'import des Associates.']
miss = int(m['Gender'].isna().sum())
for _, x in m.iterrows():
    if pd.isna(x['Gender']): continue
    g = {'Woman': 'F', 'Man': 'M'}.get(x['Gender'])
    ref = idp = False
    if x['Id'] in c.index: ref = c.loc[x['Id'], 'Refugee?'] == 'Yes'; idp = c.loc[x['Id'], 'Internally displaced (IDP)?'] == 'Yes'
    rdp = 'both' if ref and idp else 'refugee' if ref else 'idp' if idp else ('rdp' if x['R/DP?'] == 'Yes' else None)
    mcf = {'Scholars': 'scholar', 'Other MCF': 'other'}.get(x['Mastercard Foundation experience?'])
    area = {'Urban': 'urban', 'Rural': 'rural'}.get(x['Rural or Urban?'])
    pwd = 1 if x['Youth with Disability?'] == 'Yes' or x['PWD'] == 'Yes' else 0
    ps, pe = iso(x['Placement Start Date']), iso(x['Placement End Date'])
    out.append(f"UPDATE associates SET gender={q(g)}, rdp={q(rdp)}, mcf={q(mcf)}, area={q(area)}, placement_start={q(ps)}, placement_end={q(pe)}, "
               f"employer_kpmg_id={q(x['KPMG ID of Employer'])}, pwd={pwd}, start_date=COALESCE(start_date, {q(ps)}) WHERE id={q(x['Id'])};")
open('seed/cfa.sql', 'w').write('\n'.join(out) + '\n')
print(len(out) - 1, 'Associates mis à jour,', miss, 'sans correspondance')
