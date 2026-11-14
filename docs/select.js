// Logique de sélection : applique tes réglages à l'édition du jour.
// Fichier sans dépendance, utilisé par l'app (et testable avec Node).

export const THEMES = [
  { id: 'inventions', label: 'Inventions qui changent le monde' },
  { id: 'sante', label: 'Santé et médecine' },
  { id: 'ia', label: 'Intelligence artificielle' },
  { id: 'espace', label: 'Espace et Starship' },
  { id: 'ecologie', label: 'Écologie et climat' },
  { id: 'animaux', label: 'Animaux et nature' },
  { id: 'reportages', label: 'Beaux reportages' },
  { id: 'sourires', label: 'Histoires qui font sourire' },
  { id: 'autre', label: 'Autres bonnes nouvelles' },
];

export const CATEGORY_LABELS = {
  inventions: 'Inventions qui changent le monde',
  sante: 'Santé',
  ia: 'Intelligence artificielle',
  espace: 'Espace',
  ecologie: 'Écologie',
  animaux: 'Animaux et nature',
  reportages: 'Reportage',
  sourires: 'Histoire qui fait sourire',
  monde: 'Monde',
  aviation: 'Aviation',
  autre: 'Actualité',
};

export const LEVELS = [
  { id: 'min', label: 'Minimum', desc: 'Uniquement les événements mondiaux majeurs, ceux que tout le monde doit connaître.' },
  { id: 'eq', label: 'Équilibré', desc: 'Les événements majeurs, plus ce qui touche tes lieux et sujets suivis. Le reste est filtré.' },
  { id: 'full', label: 'Complet', desc: 'Toute l’actualité importante, bonne ou mauvaise, toujours sans faits divers.' },
];

export const DEFAULT_SETTINGS = {
  level: 'eq',
  places: ['Bali', 'Indonésie', 'Népal', 'France'],
  topics: ['aviation'],
  themes: THEMES.map((t) => t.id),
  count: 20,
};

// Catégories qui méritent leur place dans le fil même quand le ton est neutre
// (ex. un lancement de Starship, une annonce sur l'IA).
const NEUTRAL_OK = ['inventions', 'sante', 'ia', 'espace', 'ecologie', 'animaux', 'reportages'];

export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function themeOf(category) {
  return THEMES.some((t) => t.id === category) ? category : 'autre';
}

// Renvoie le lieu ou le sujet suivi qui concerne cette info, ou null.
export function followedReason(item, s) {
  const place = (item.places || []).find((p) => s.places.some((f) => norm(p).includes(norm(f)) || norm(f).includes(norm(p))));
  if (place) {
    const f = s.places.find((x) => norm(place).includes(norm(x)) || norm(x).includes(norm(place)));
    return `Lieu suivi : ${f}`;
  }
  if (s.topics.includes(item.category)) return `Sujet suivi : ${CATEGORY_LABELS[item.category].toLowerCase()}`;
  return null;
}

export function select(edition, s) {
  const items = (edition.items || []).filter((i) => !i.fait_divers);
  const threshold = s.level === 'full' ? 6 : 8;

  // 1. L'essentiel : infos graves ou neutres, seulement si elles comptent vraiment.
  const serious = items.filter((i) => {
    if (i.tone === 'positive') return false;
    if (i.importance >= threshold) return true;
    return s.level !== 'min' && i.importance >= 5 && followedReason(i, s) !== null;
  });
  const essentiel = serious.sort((a, b) => b.importance - a.importance).slice(0, s.level === 'full' ? 7 : 4);
  const topGood = items.filter((i) => i.tone === 'positive' && i.importance >= 6).sort((a, b) => b.importance - a.importance)[0];
  if (topGood) essentiel.push(topGood);
  const used = new Set(essentiel.map((i) => i.id));

  // 2. Le fil : bonnes nouvelles (et infos neutres utiles) dans tes thèmes.
  const pool = items
    .filter((i) => !used.has(i.id))
    .filter((i) => s.themes.includes(themeOf(i.category)))
    .filter((i) => i.tone === 'positive' || (i.tone === 'neutral' && NEUTRAL_OK.includes(i.category) && i.importance >= 4))
    .sort((a, b) => b.importance - a.importance);

  // On alterne les thèmes pour éviter dix cartes d'affilée sur le même sujet.
  const groups = new Map();
  for (const i of pool) {
    const k = themeOf(i.category);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const fil = [];
  while (fil.length < s.count && [...groups.values()].some((g) => g.length)) {
    for (const g of groups.values()) {
      if (g.length && fil.length < s.count) fil.push(g.shift());
    }
  }
  return { essentiel, fil };
}
