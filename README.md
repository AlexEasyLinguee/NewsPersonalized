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
