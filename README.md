# Clair — l'info qui éclaire

App d'actualités personnelle : chaque matin, une édition qui se termine.
Les mauvaises nouvelles n'apparaissent que si elles comptent vraiment ; le reste du fil est fait de bonnes nouvelles, d'inventions qui améliorent le monde, d'IA, d'espace, de nature et de beaux reportages.

## Comment ça marche

1. Tous les matins, GitHub Actions lance `scripts/build.mjs`.
2. Le script lit les flux RSS de `sources.json` (articles des dernières 30 h).
3. Une IA (Google Gemini, offre gratuite) note chaque article : importance (0-10), ton (positif / neutre / négatif), thème, fait divers ou non, lieux concernés, plus un titre et un résumé en français.
4. Le résultat (`docs/edition.json`) et l'app (`docs/`) sont publiés sur GitHub Pages.
5. L'app applique tes réglages, enregistrés sur ton téléphone : dosage des mauvaises nouvelles, lieux et sujets suivis, thèmes du fil, nombre de cartes.

Coût : 0 €. GitHub Actions, GitHub Pages et l'API Gemini (modèles Flash-Lite / Flash) sont dans des offres gratuites.

## Mise en route (une seule fois)

1. Créer une clé gratuite sur https://aistudio.google.com/apikey, puis l'ajouter dans **Settings › Secrets and variables › Actions › New repository secret** sous le nom `GEMINI_API_KEY`.
2. **Settings › Pages › Build and deployment › Source** : choisir **GitHub Actions**.
3. **Actions › Édition du jour › Run workflow** pour générer la première édition.
4. Ouvrir l'adresse affichée (du type `https://alexeasylinguee.github.io/newspersonalized/`) dans Safari sur l'iPhone, puis **Partager › Sur l'écran d'accueil**.

## Personnaliser

- **Sources** : ajouter ou retirer des flux dans `sources.json`.
- **Règles de notation** : le texte `SYSTEM` dans `scripts/build.mjs`.
- **Règles de sélection** : `docs/select.js`.
- **Nom de l'app** : « Clair » dans `docs/index.html` et `docs/manifest.webmanifest`.

## Tester sans IA

```
npm install
MOCK_AI=1 node scripts/build.mjs   # notes factices, pour vérifier l'affichage
```

## Profils personnalisés (« Parle-moi de toi »)

Au premier lancement, chaque personne décrit ce qu'elle aime ; l'IA en fait un profil (intérêts, lieux, sujets à suivre même s'ils sont graves, sujets à éviter, dosage), gardé uniquement sur son téléphone.

L'IA est appelée via un petit relais Cloudflare (`worker/`) pour que la clé Gemini ne soit jamais dans l'app. Le même relais gère les notifications du matin.

### Déploiement automatique du relais

Le relais est déployé par GitHub Actions (`.github/workflows/worker.yml`) à chaque modification de `worker/`. Une seule fois :

1. Cloudflare › Manage account › Account API tokens › Create token › modèle **Edit Cloudflare Workers** › Create.
2. GitHub › Settings › Secrets and variables › Actions : `CLOUDFLARE_API_TOKEN` (le jeton) et `CLOUDFLARE_ACCOUNT_ID` (l'identifiant du compte Cloudflare).
3. Le secret `GEMINI_API_KEY` du Worker (réglé dans le tableau de bord Cloudflare) est conservé à chaque déploiement.
4. Actions › Relais Cloudflare › Run workflow.

Le workflow crée au besoin le stockage KV `clair-push` (abonnements aux notifications et clés VAPID, générées automatiquement).

### Notifications

- L'app s'abonne depuis Mon dosage (sur iPhone : app ajoutée à l'écran d'accueil, iOS 16.4+).
- Chaque matin (5 h 35 et 6 h 35 UTC), le relais lit `edition.json` et, s'il y a une nouvelle édition, envoie « Ton édition est prête » à chaque abonné, dans sa langue.

### Amis et partage

Onglet **Amis** : chacun choisit un prénom et reçoit un code ami (ex. `K7P-3MX`), sans compte ni e-mail. On ajoute un ami avec son code ou son lien d'invitation (`…/#ami=CODE`) ; l'amitié est réciproque. Le bouton « Envoyer à un ami » sur chaque carte du fil envoie l'article (avec un petit mot) : il apparaît en tête du fil du destinataire et dans ses « Reçus », avec une notification s'il les a activées. Les articles partagés sont effacés du serveur après 30 jours.

### Articles complets hors ligne

Bouton « Télécharger les articles pour lire hors ligne » (Mon dosage › Hors ligne), et automatiquement pour les favoris : l'app demande au relais (`worker/reader.js`, route `/read`) le texte de chaque article, et le garde sur le téléphone (Cache API). Le relais n'accepte que les sites présents dans l'édition du jour et ne stocke rien. Hors ligne, toucher un article ouvre le lecteur intégré. Usage personnel : une version commerciale demanderait des accords avec les médias.

### Écouter (journal audio)

- Chaque matin, après l'édition, `scripts/audio.py` enregistre la version « radio » de chaque article (champ `radio`/`radio_en` écrit par l'IA) avec la voix open source Kokoro (FR : ff_siwis, EN : bf_emma), dans `docs/audio/<langue>/`, avec un sommaire `docs/audio/<langue>.json`. FR et EN tournent en parallèle dans GitHub Actions.
- Dans l'app (`docs/player.js`) : bouton « Écouter mon édition », playlist construite selon le profil (intro, l'essentiel, transition, le fil, conclusion), lecture écran verrouillé, commandes sur l'écran de verrouillage, vitesse.
- « Article complet » (en ligne) : après l'annonce, le texte complet (récupéré via `/read`) est lu par la voix MeloTTS de Cloudflare Workers AI (route `/speak` du relais), morceau par morceau. Hors ligne : résumés seulement (gardés sur le téléphone).
- Une modification du code de l'app republie le site en ~1 min en reprenant l'édition et l'audio déjà en ligne (`scripts/fetch-live.mjs`).
