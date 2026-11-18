# Suivi des stipends — Talent2Africa × Mastercard Foundation (Associates Program)

Application complète, déployable gratuitement sur Cloudflare (Workers + D1 + R2). Aucune dépendance côté navigateur, aucun serveur à gérer.

## Ce que fait l'outil

**Associates (704 déjà chargés)** — chacun reçoit un lien personnel (`/a/<jeton>`), sans mot de passe :
1. Vérifie ses infos (nom, e-mail, entreprise, TC pré-remplis) ; complète téléphone et date de démarrage.
2. Indique « Oui / Non » pour le stipend, puis, mois par mois (Juin 2026 → mois courant, la liste s'allonge seule) : Reçu / Pas encore reçu, montant en FCFA, date, **preuve** (photo directe, capture, PDF ; compressée avant envoi).
3. Lit la déclaration sur l'honneur, coche le consentement et **signe au doigt/souris**. Chaque signature est horodatée, empreinte (SHA-256) et conservée.
4. Suit l'état de chaque mois (à valider / confirmé / correction demandée) et télécharge son **attestation PDF** dès qu'un mois est confirmé.

**TalentCorps (TC)** — voient uniquement leurs Associates : preuves, historique, Confirmer / Demander une correction (avec message envoyé à l'Associate), « Tout confirmer (avec preuve) », exports CSV.

**Administrateurs Talent2Africa** — tableau de bord en temps réel (taux de signature, mois par mois, par TC, par entreprise, échéance du 15 novembre), assignation des TC (par sélection ou par entreprise), import CSV, campagnes d'e-mails, liens personnels + WhatsApp, journal d'audit, paramètres, signature du signataire des attestations.

**Automatique** : le 10 de chaque mois, e-mail à tous ; relances à J+3 et J+5 aux non-répondants ; récapitulatif aux TC ; sauvegarde complète dans R2 (le 11 et le 1ᵉʳ, 30 conservées).

## Déploiement (≈ 20 minutes)

Prérequis : un compte Cloudflare, Node 20+.

```bash
npm install
npx wrangler login

# 1. Base de données et stockage
npx wrangler d1 create stipends-t2a          # copier le database_id affiché dans wrangler.jsonc
npx wrangler r2 bucket create stipends-t2a-files

# 2. Tables puis les 704 Associates
npm run db:init
npm run db:seed

# 3. Première mise en ligne
npm run deploy                                # affiche l'URL https://stipends-t2a.<compte>.workers.dev
```

4. Dans `wrangler.jsonc` → `vars` : mettre `APP_URL` = l'URL réelle (ou votre domaine), `MAIL_FROM`, et `ADMIN_EMAILS` (déjà réglé sur rihanatoubankole1703@gmail.com ; plusieurs adresses séparées par des virgules). Puis `npm run deploy` à nouveau.
5. **E-mails** : créer un compte sur resend.com, vérifier votre domaine (ex. talent2africa.org), puis
   `npx wrangler secret put RESEND_API_KEY`. Sans clé, tout fonctionne, mais les messages restent en file : utilisez alors l'onglet *Envois → Liens personnels (CSV + WhatsApp)*. Le lien de connexion des administrateurs et des TC est lui aussi envoyé par e-mail ; en secours : `npx wrangler secret put ADMIN_PASSWORD` (réservé aux adresses de `ADMIN_EMAILS`).
6. Ouvrir `https://…/staff`, se connecter avec une adresse admin.

## Premiers pas (calendrier : échéance 15 novembre)

1. **Équipe** → ajouter chaque TC (nom + e-mail, rôle « TC »).
2. **Associates** → filtrer par entreprise, cocher, *Assigner à un TC* ; ou **Import** (CSV : `email` ou `associate_id` + `tc` (e-mail ou nom du TC), `start_date`, `entreprise`, `telephone`…). Les TC doivent exister avant l'import.
3. **Paramètres** → nom/titre du signataire et image de sa signature (PNG) pour les attestations ; e-mail de support ; nombre de mois par attestation (3 par défaut). La personne dont vous chargez la signature doit y avoir consenti.
4. **Envois** → *Invitation à tous* (un seul envoi par Associate et par mois : le double-clic est sans effet).
5. Suivre le tableau de bord ; relancer ; les TC valident.
6. **SharePoint** : *Associates → Export synthèse / Export historique (CSV)*. Pour automatiser : un flux Power Automate planifié qui récupère ces exports (ou dépôt manuel hebdomadaire).

## Limites du plan gratuit (à connaître)

- Workers gratuit : 100 000 requêtes/jour, **10 ms de CPU par requête**. L'attestation PDF est volontairement générée dans le navigateur pour rester dans cette limite. Si des erreurs « 1102 » apparaissaient sous forte charge, le plan Workers payant (5 $/mois) lève la contrainte.
- D1 gratuit : 5 Go ; R2 gratuit : 10 Go (Cloudflare demande une carte bancaire pour activer R2 ; rien n'est facturé sous le quota).
- Les e-mails partent par lots de 100 toutes les 5 minutes (≈ 40 min pour 704 messages).
- Resend gratuit : 100 e-mails/jour et 3 000/mois : **704 e-mails dépassent la limite quotidienne** → soit étaler l'envoi (la file continue le lendemain), soit passer au forfait Resend à 20 $/mois pour la campagne.

## Sécurité et données personnelles

- Seuls les champs utiles ont été importés (nom, e-mail, téléphone, pays, entreprise). Date de naissance, handicap, statut de réfugié, CV, etc. **ne sont pas** repris.
- `seed/associates.sql` contient les jetons secrets de tous les liens : ne pas le publier ni le conserver après import. *Équipe/Associates → régénérer le lien* invalide un jeton exposé.
- Les justificatifs et signatures sont dans R2 en accès privé, servis uniquement après contrôle des droits (jeton de l'Associate ou session TC/admin). Les fichiers sont vérifiés par leur contenu (JPG/PNG/WebP/HEIC/PDF, 6 Mo max).
- Connexion équipe par lien magique (20 min, usage unique, 5 demandes/heure), cookie HttpOnly, en-tête anti-CSRF, CSP stricte.
- Conservez le compte Cloudflare au nom de l'organisation et définissez une durée de conservation des données (ex. 12 mois après la fin du programme), conformément à la loi sénégalaise sur les données personnelles (CDP) et aux règles du Togo et du Bénin pour les Associates concernés.

## Développement local

```bash
cp .dev.vars.example .dev.vars
npm run db:init:local && npm run db:seed:local
npm run dev        # http://localhost:8787 ; les liens de connexion s'affichent à l'écran (DEV_LOGIN_LINKS)
```


## Mise à jour 2 — Placements, financement, virements (17/11/2026)
1. `npm run db:migrate` (une seule fois : nouvelles colonnes + table employers)
2. `npm run db:placements` (importe PWD, quotas employeurs, 136 mois déjà reçus juillet–novembre, TC déclarés)
3. `npm run deploy`
4. Onglet **Placements & financement** : objectifs par zone, tableau par TC (ordre alphabétique), type full/shared par entreprise (130 000 FCFA ; 125 000 pour CJES Nova Togo et CEMP), enregistrement des virements avec preuve.
Régénérer le SQL : `python3 scripts/build_placements.py associates.xlsx Restants.xlsx Suivi.xlsx`.

> Nouvelle installation (base vide) : `npm run db:setup` puis `npm run deploy` — `db:migrate` ne sert que pour une base créée avant la mise à jour 2.

## Mise à jour 3 — ID CFA, profil des placés, suivi des liens, contrôle des preuves (18/11/2026)
Ordre : 1) onglet **Import** : importer `associates_2026-11-17_2.xlsx` (742) → 2) `npm run db:migrate3` (une seule fois) → 3) `npm run db:cfa` → 4) `npm run deploy`.
- **ID au format CFA** : identifiant Academy4Africa sans tirets + « TA » (affiché partout, recherché dans la liste, utilisé dans les exports).
- **Profil des placés** (onglet Placements & financement) : femmes / hommes, réfugiés / déplacés, PWD, alumni / non alumni, rural / urbain, par zone et par TC. Source : rapport CFA + liste des candidats. Régénérer : `python3 scripts/build_cfa.py associates.xlsx cfa-report.xlsx cfa-candidates.csv`.
- **Suivi des liens** (Vue d'ensemble) : liens envoyés → ouverts → signés → confirmés. L'envoi par e-mail est enregistré automatiquement ; pour WhatsApp, le clic sur le bouton enregistre l'envoi.
- **Preuves** : justificatif obligatoire pour signer un mois « reçu » ; refus d'un fichier déjà utilisé (autre mois ou autre Associate) ; refus des images trop petites ; le TC ne peut confirmer qu'un mois avec preuve.

## Mise à jour 4 — Charte graphique (18/11/2026)
Logos séparés (`public/logo-mcf.png` à gauche, `public/logo-t2a.png` à droite), palette tirée des logos (rouge/orange Mastercard, azur Talent2Africa, vert Associates Program), bande tricolore, cartes d'indicateurs colorées selon le sens, bandeau d'accueil (cercles Mastercard + réseau T2A), attestation PDF avec les deux logos. Aucun changement de base de données : `npm run deploy` suffit.
