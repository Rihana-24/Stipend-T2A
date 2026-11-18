# Suivi des stipends — Associates Program (Mastercard Foundation × Talent2Africa)

Application web pour que chaque Associate confirme la réception de son stipend mensuel, dépose sa preuve et signe en ligne ; les TalentCorps (TC) valident leurs Associates ; les administrateurs pilotent placements, financement, virements et profil CFA.

100 % Cloudflare (Workers + D1 + R2 + Cron), gratuit à cette échelle, sans framework ni étape de build.

> Version : 18/11/2026. Mises à jour intégrées : liste déroulante des TC, placements & financement, PWD, virements avec preuve, ID au format CFA, profil des placés, suivi des liens, contrôle des preuves, charte graphique.

---

## 1. Architecture

| Élément | Rôle |
| --- | --- |
| `src/` (Worker) | L'API. Seules les routes `/api/*` exécutent du code. |
| `public/` (assets statiques) | Application web en JavaScript natif (modules ES). Servie sans passer par le Worker. |
| D1 (SQLite) | Toutes les données : Associates, mois, signatures, journal, file d'e-mails. |
| R2 (`FILES`) | Fichiers privés : preuves de réception, preuves de virement, signature du signataire. Jamais publics : chaque lecture passe par l'API. |
| Cron | `0 9 * * *` (envoi du 10, relances J+3/J+5, sauvegarde) et `*/5 * * * *` (vide la file d'e-mails). |
| Resend (facultatif) | Envoi des e-mails. Sans lui, l'outil fonctionne et propose les liens par WhatsApp. |

Contraintes du plan gratuit prises en compte : 10 ms de CPU par requête (l'attestation PDF est générée dans le navigateur avec `pdf-lib`), environ 50 requêtes D1 par invocation (opérations de masse en une seule requête SQL avec `json_each` / `INSERT…SELECT`, import par blocs de 100 lignes), Resend gratuit ≈ 100 e-mails par jour (file vidée par lots de 100).

## 2. Accès et comptes

| Qui | Entrée | Droits |
| --- | --- | --- |
| Associate | Lien personnel secret `/a/<jeton>` (32 caractères). Aucun compte, aucune recherche par nom. | Ses données uniquement |
| TC | `/staff`, lien de connexion par e-mail (20 min, usage unique, 5 demandes/heure) | Ses Associates (`tc_id`) |
| Administrateur | `/staff` : e-mail + mot de passe, ou lien par e-mail | Tout |

- **Il n'y a pas de mot de passe par défaut.** Le mot de passe administrateur est le secret défini par `npx wrangler secret put ADMIN_PASSWORD`. Il ne fonctionne que pour les adresses listées dans `ADMIN_EMAILS` (`wrangler.jsonc`), et seulement après un `npm run deploy` qui suit toute modification de cette liste.
- Page de connexion : remplir **l'e-mail ET le mot de passe**, puis cliquer sur le bouton. Avec l'e-mail seul, l'outil tente d'envoyer un lien (impossible sans Resend).
- Vérifier que le mot de passe est actif : `GET /api/auth/config` doit répondre `"password":true`.
- Les comptes équipe sont des lignes de la table `staff` (e-mail unique, rôle `admin` ou `tc`), créés dans l'onglet **Équipe** (ajout en masse : une ligne « nom ; e-mail »).
- Un administrateur peut aussi être TC : son nom doit correspondre **exactement** à la liste des TC (Paramètres), puis « Rattacher maintenant ». Rihanatou BANKOLE et Guy AHONAKPON sont créés ainsi par `npm run db:placements`.
- Session : cookie de 14 jours, empreinte stockée côté serveur ; la déconnexion l'invalide.
- Infrastructure : le compte Cloudflare est celui du propriétaire. Un développeur qui doit déployer est invité comme membre du compte, ou utilise un jeton d'API limité à Workers et D1. Pour **utiliser** l'outil, aucun accès Cloudflare n'est nécessaire.
- Si une personne quitte l'équipe : désactiver son compte (Équipe), la retirer de `ADMIN_EMAILS`, changer `ADMIN_PASSWORD`, la retirer du compte Cloudflare.

## 3. Installation pas à pas

Prérequis : Node.js LTS, compte Cloudflare gratuit avec R2 activé, terminal ouvert **dans le dossier du projet** (celui qui contient `package.json`).

Base vide :

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create stipends-t2a` → copier le `database_id` (répondre `n` si Wrangler propose d'ajouter le binding)
4. `npx wrangler r2 bucket create stipends-t2a-files` (même réponse `n`)
5. Éditer `wrangler.jsonc` : `database_id` (entre guillemets), `APP_URL`, `MAIL_FROM`, `ADMIN_EMAILS`. Aucun texte « REMPLACER » ne doit rester.
6. `npm run db:setup` (tables, Associates, placements, profil CFA)
7. `npx wrangler secret put ADMIN_PASSWORD`
8. `npm run deploy`
9. Ouvrir `<adresse>/staff`.

Mise à jour d'une installation existante :

1. Sauvegarder `wrangler.jsonc`, extraire le zip par-dessus. Le `wrangler.jsonc` du zip contient la configuration actuelle ; vérifiez-le quand même.
2. Migrations jamais lancées, **une seule fois chacune** : `npm run db:migrate` (002) puis `npm run db:migrate3` (003). « duplicate column » = déjà faite.
3. Onglet **Import** : importer le fichier Excel des Associates à jour.
4. `npm run db:placements` puis `npm run db:cfa` (rejouables sans doublon).
5. `npm run deploy`.

Local : copier `.dev.vars.example` en `.dev.vars`, `npm run db:init:local`, `npm run db:seed:local`, `npx wrangler dev` (le lien de connexion s'affiche au lieu d'être envoyé grâce à `DEV_LOGIN_LINKS=1`).

### Commandes npm

| Commande | Rôle | À rejouer ? |
| --- | --- | --- |
| `deploy` | Publie Worker et pages | Oui |
| `db:init` | Crée les tables (`schema.sql`) | Non |
| `db:seed` | Charge les Associates initiaux | Non |
| `db:migrate` | Migration 002 (placements, financement, PWD, virements) | Non, une fois |
| `db:migrate3` | Migration 003 (profil CFA, suivi des liens, empreinte des preuves) | Non, une fois |
| `db:placements` | Quotas entreprises, PWD, stipends déjà reçus, comptes admin | Oui |
| `db:cfa` | Genre, R/DP, alumni, rural/urbain, dates de placement, KPMG ID | Oui, après l'import |
| `db:setup` | Installation complète d'une base vide | Non |
| `db:init:local`, `db:seed:local` | Idem sur la base locale | Au besoin |

## 4. À quoi sert chaque fichier

### Racine
| Fichier | Rôle |
| --- | --- |
| `wrangler.jsonc` | Configuration Cloudflare : nom, bindings D1/R2, variables (`APP_URL`, `MAIL_FROM`, `ADMIN_EMAILS`), crons, assets. **Le seul fichier à adapter.** |
| `package.json` | Scripts npm (tableau ci-dessus) et dépendance `wrangler`. |
| `schema.sql` | Schéma complet de la base pour une installation neuve (déjà à jour des migrations). |
| `.dev.vars.example` | Modèle des variables de test local. `.dev.vars` n'est jamais déployé. |
| `.gitignore` | Exclut `node_modules`, `.wrangler`, `.dev.vars` et `seed/*.sql` (données personnelles). |

### `src/` — API (Worker)
| Fichier | Rôle |
| --- | --- |
| `index.js` | Point d'entrée : routeur, protection CSRF (en-tête `x-requested-with: t2a`), gestion d'erreurs, tâches cron (envoi du 10, relances, sauvegarde, file d'e-mails). |
| `auth.js` | Connexion équipe : lien magique, mot de passe administrateur, sessions, déconnexion. |
| `associate.js` | Routes de l'Associate (par jeton) : profil, déclaration par mois, dépôt de preuve (type, taille, doublons), signature, attestation, vérification. |
| `staff.js` | Routes équipe (TC/admin) : statistiques, liste et fiche, validation, import, assignation des TC, envois, liens, exports, paramètres, équipe, journal, sauvegarde, **placements, financement par entreprise, virements, suivi des liens**. |
| `mail.js` | Construction des e-mails, envoi via Resend (lots de 100), file d'attente, récapitulatif aux TC. |
| `util.js` | Utilitaires : réponses JSON, erreurs, hachage, dates/mois, paramètres par défaut (dont liste des TC), détection du type de fichier, journal d'audit, groupes de pays, ID au format CFA. |

### `public/` — application web
| Fichier | Rôle |
| --- | --- |
| `index.html` | Page unique (SPA), polices et métadonnées. |
| `_headers` | En-têtes de sécurité (CSP stricte, `nosniff`, pas de cadre). |
| `css/app.css` | Charte graphique : palette issue des logos, composants, mise en page mobile d'abord. |
| `js/app.js` | Routeur du navigateur : page d'accueil, espace Associate (`/a/…`), espace équipe (`/staff`). |
| `js/lib.js` | Briques communes : DOM sans `innerHTML`, appels API, formats, toasts, modales, en-tête de marque (logos), compression des photos. |
| `js/associate.js` | Parcours de l'Associate en 3 étapes : informations, stipends par mois, signature. |
| `js/sigpad.js` | Pavé de signature (dessin à la main, tactile). |
| `js/pdf.js` | Génération de l'attestation PDF dans le navigateur avec `pdf-lib`. |
| `js/staff.js` | Espace équipe : connexion, onglets, tableau de bord (dont suivi des liens), liste des Associates, fiche détaillée. |
| `js/placements.js` | Onglet « Placements & financement » : objectifs par zone, profil des placés, tableau par TC, financement par entreprise, virements. |
| `js/admin.js` | Onglets Envois, Équipe, Import, Paramètres, Journal (administrateur). |
| `vendor/pdf-lib.min.js` | Bibliothèque PDF embarquée (aucun CDN). |
| `logo-mcf.png`, `logo-t2a.png` | Logos de gauche (Mastercard Foundation · Associates Program) et de droite (Talent2Africa). `logo.png` : version combinée. |
| `favicon.svg` | Icône du site. |

### `migrations/`, `seed/`, `scripts/`
| Fichier | Rôle |
| --- | --- |
| `migrations/002_placements.sql` | Ajoute PWD, virements, preuves externes, table `employers`. |
| `migrations/003_cfa.sql` | Ajoute genre, R/DP, alumni, rural/urbain, dates de placement, KPMG ID, suivi des liens, empreinte des preuves. |
| `seed/associates.sql` | Associates initiaux avec leurs liens secrets (**données personnelles**). |
| `seed/placements.sql` | Données de placement/financement/stipends déjà reçus + comptes administrateurs. |
| `seed/cfa.sql` | Profil CFA des 742 Associates. |
| `scripts/build_seed.py` | Génère `associates.sql` depuis l'export Academy4Africa. |
| `scripts/build_placements.py` | Génère `placements.sql` depuis : liste des Associates, fichier Restants, suivi stipend. |
| `scripts/build_cfa.py` | Génère `cfa.sql` depuis : liste des Associates, rapport CFA, liste des candidats CFA. |

## 5. Base de données (D1)

Tables : `associates` (id = identifiant Academy4Africa, `ref` ASC-xxxx, `token` secret, coordonnées, pays, entreprise, `tc_id`, `declared_tc`, `start_date`, `pwd`, profil CFA, suivi du lien), `stipend_months` (un enregistrement par Associate et par mois : déclaré, montant, date, preuve, relecture TC, virement), `proofs` (fichiers R2 + empreinte SHA-256), `declarations` (signature, empreinte, IP, navigateur, instantané), `attestations`, `staff`, `employers` (financement, montant mensuel, quota), `email_queue` (unicité Associate+type+période), `login_tokens`, `sessions`, `events` (journal d'audit), `settings` (clé/valeur).

**ID au format CFA** : identifiant Academy4Africa sans tirets, en minuscules, suivi de `TA` (affiché partout, cherchable, utilisé dans les exports ; non stocké, recalculé).

## 6. Règles métier clés

- **Mois dus** : de `program_start` (Paramètres, défaut `2026-06`) jusqu'au mois précédent, pour tous les Associates (la date de démarrage n'est pas encore utilisée pour filtrer les mois).
- **Signature** : signature électronique simple intégrée (dessin + horodatage + IP + navigateur + empreinte SHA-256 de l'instantané). Ce n'est pas une signature qualifiée.
- **Preuves** : justificatif obligatoire pour signer un mois « reçu » ; refus d'un fichier déjà utilisé (autre mois ou autre Associate) ; refus des images trop petites ; types vérifiés sur le contenu (JPG, PNG, WebP, PDF), 6 Mo maximum ; le TC ne peut confirmer qu'un mois avec preuve. L'outil ne lit pas le contenu d'une image : la vérification du montant et de la date reste humaine (TC).
- **Financement** : par entreprise, `full` (la Fondation paie le montant mensuel) ou `shared` (50 % employeur, 50 % Fondation). Montant mensuel : 130 000 FCFA ; 125 000 FCFA pour CJES Nova Togo et CEMP.
- **Validés / restants (par TC)** : validés = Associates dont tous les stipends déclarés sont confirmés par le TC ; restants = placés − validés.
- **Virements** : enregistrés par l'administrateur pour une entreprise et/ou un TC, un mois, avec une preuve commune facultative.
- **E-mails** : invitation le 10 de chaque mois, relances à J+3 et J+5, récapitulatif aux TC. Une campagne mensuelle ne peut être mise en file qu'une fois par mois ; un renvoi délibéré à des Associates choisis reste possible.

## 7. Sécurité

Jetons aléatoires de 32 caractères, comparés en temps constant ; liens de connexion et sessions stockés hachés ; protection CSRF par en-tête personnalisé ; CSP stricte (`public/_headers`) ; aucun `innerHTML` avec des données ; fichiers R2 privés servis seulement après contrôle de droit ; journal d'audit de toutes les actions ; sauvegarde périodique dans R2. Ne jamais publier `seed/*.sql` ni `.dev.vars`.

## 8. Dépannage

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| « Identifiants incorrects » | Adresse absente de `ADMIN_EMAILS` déployé, ou mauvais mot de passe | Vérifier `wrangler.jsonc`, `wrangler secret put ADMIN_PASSWORD`, `npm run deploy` |
| `Invalid property: databaseId => Invalid uuid` | `database_id` encore « REMPLACER… » | Mettre le vrai identifiant |
| `InvalidSymbol` dans `wrangler.jsonc` | Guillemet manquant | Corriger la ligne indiquée |
| `duplicate column name` | Migration déjà lancée | Ignorer |
| Bandeau « Envoi d'e-mails non configuré » | Pas de clé Resend | `wrangler secret put RESEND_API_KEY`, domaine vérifié, `MAIL_FROM`, déployer |
| Chiffre d'e-mails en attente trop élevé (ex. 2 112) | Envois cumulés en file (Resend absent) | `DELETE FROM email_queue WHERE status='pending'` **avant** d'activer Resend |
| Associate sans TC | Compte TC absent ou nom différent de la liste | Créer le TC avec le nom exact, « Rattacher maintenant » |
| Profil CFA vide pour des nouveaux | `db:cfa` lancé avant l'import | Importer puis relancer `npm run db:cfa` |

## 9. Limites connues et suite

Les mois dus ne dépendent pas encore de la date de démarrage de chaque Associate ; les preuves ne sont pas lues automatiquement (option : vérification par IA) ; l'import des placements/quotas/PWD/CFA passe par les scripts Python, pas encore par l'interface ; les envois WhatsApp sont comptés au clic, pas à la livraison.
