// Logique de sélection : applique le profil et les réglages à l'édition du jour.
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
  { id: 'sport', label: 'Sport' },
  { id: 'culture', label: 'Culture, arts et gastronomie' },
  { id: 'tech', label: 'Technologie' },
  { id: 'economie', label: 'Économie et entreprises' },
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
  sport: 'Sport',
  culture: 'Culture',
  tech: 'Technologie',
  economie: 'Économie',
  monde: 'Monde',
  aviation: 'Aviation',
  autre: 'Actualité',
};

export const LEVELS = [
  { id: 'min', label: 'Minimum', desc: 'Uniquement les événements mondiaux majeurs, ceux que tout le monde doit connaître.' },
  { id: 'eq', label: 'Équilibré', desc: 'Les événements majeurs, plus ce qui touche tes lieux et sujets suivis. Le reste est filtré.' },
  { id: 'full', label: 'Complet', desc: 'Toute l’actualité importante, bonne ou mauvaise, toujours sans faits divers.' },
];

// Réglages neutres d'un nouveau profil (le texte « Parle-moi de toi » les remplit).
export const DEFAULT_SETTINGS = {
  level: 'eq',
  places: [],
  topics: ['monde'],
  themes: THEMES.map((t) => t.id),
  count: 20,
  interests: [],      // [{label, keywords[]}]
  keep_informed: [],  // [{label, keywords[]}] : à savoir même si c'est grave
  avoid: [],          // [{label, keywords[]}] : à ne plus voir
  resume: '',
  profileText: '',
};

// Catégories qui méritent leur place dans le fil même quand le ton est neutre
// (ex. un lancement de Starship, une annonce sur l'IA).
const NEUTRAL_OK = ['inventions', 'sante', 'ia', 'espace', 'ecologie', 'animaux', 'reportages', 'culture', 'tech', 'sport'];

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const words = (s) => ` ${norm(s).replace(/[^a-z0-9]+/g, ' ').trim()} `;

const textCache = new WeakMap();
function textOf(item) {
  if (!textCache.has(item)) textCache.set(item, words([...(item.tags || []), item.title, item.summary].join(' ')));
  return textCache.get(item);
}

// Groupes (intérêts, à suivre, à éviter) dont un mot-clé apparaît dans l'article.
export function matchGroups(item, groups) {
  const t = textOf(item);
  return (groups || []).filter((g) => (g.keywords || []).some((k) => {
    const kw = words(k);
    return kw.trim() && t.includes(kw);
  }));
}

// --- Doublons : la même histoire racontée par plusieurs médias ---
const STOP = new Set(('les des une pour par sur dans avec aux est sont qui que ses son leur plus apres avant entre lors face sans sous vers chez cette ces mais elle ils nous vous tout tous toute pas comme encore deja '
  + 'the and for with from that this into over after amid says said new will has have are was its their about than').split(' '));
const sigCache = new WeakMap();
function signature(item) {
  if (!sigCache.has(item)) {
    const set = new Set(words([item.title, ...(item.tags || []), ...(item.places || [])].join(' '))
      .trim().split(' ').filter((w) => w.length >= 3 && !STOP.has(w)));
    sigCache.set(item, set);
  }
  return sigCache.get(item);
}
export function sameStory(a, b) {
  const A = signature(a), B = signature(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared >= 3 && shared / Math.min(A.size, B.size) >= 0.45;
}
// Garde une seule version de chaque histoire : la plus importante, de préférence avec photo.
export function dedupe(items) {
  const sorted = [...items].sort((a, b) => b.importance - a.importance || (b.image ? 1 : 0) - (a.image ? 1 : 0));
  const kept = [];
  for (const i of sorted) if (!kept.some((k) => sameStory(k, i))) kept.push(i);
  return kept;
}

export function themeOf(category) {
  return THEMES.some((t) => t.id === category) ? category : 'autre';
}

function placeMatch(item, s) {
  for (const p of item.places || []) {
    const f = (s.places || []).find((x) => norm(p).includes(norm(x)) || norm(x).includes(norm(p)));
    if (f) return f;
  }
  // Le lieu peut aussi n'apparaître que dans les mots-clés ou le titre.
  return (s.places || []).find((x) => textOf(item).includes(words(x))) || null;
}

// Pourquoi une info grave passe le filtre : lieu suivi, sujet suivi, ou rien.
export function followedReason(item, s) {
  const place = placeMatch(item, s);
  if (place) return `Lieu suivi : ${place}`;
  const keep = matchGroups(item, s.keep_informed)[0];
  if (keep) return `Tu suis : ${keep.label}`;
  if ((s.topics || []).includes(item.category)) return `Sujet suivi : ${CATEGORY_LABELS[item.category].toLowerCase()}`;
  return null;
}

export function select(edition, s) {
  const avoided = (i) => i.importance < 9 && matchGroups(i, s.avoid).length > 0;
  const items = dedupe((edition.items || []).filter((i) => !i.fait_divers && !avoided(i)));
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

  // 2. Le fil : bonnes nouvelles et infos neutres utiles, dans tes thèmes ou tes centres d'intérêt.
  const pool = [];
  for (const i of items) {
    if (used.has(i.id) || i.tone === 'negative') continue;
    const loves = matchGroups(i, s.interests);
    const inTheme = s.themes.includes(themeOf(i.category));
    const toneOk = i.tone === 'positive' || (i.tone === 'neutral' && (loves.length ? i.importance >= 3 : NEUTRAL_OK.includes(i.category) && i.importance >= 4));
    if (!toneOk || (!inTheme && !loves.length)) continue;
    pool.push({
      ...i,
      score: i.importance + 4 * Math.min(2, loves.length),
      why: loves.length ? `Parce que tu aimes : ${loves[0].label}` : '',
      group: loves.length ? `i:${loves[0].label}` : `t:${themeOf(i.category)}`,
    });
  }
  pool.sort((a, b) => b.score - a.score);

  // On alterne les sujets pour éviter dix cartes d'affilée sur le même thème.
  const groups = new Map();
  for (const i of pool) {
    if (!groups.has(i.group)) groups.set(i.group, []);
    groups.get(i.group).push(i);
  }
  const fil = [];
  while (fil.length < s.count && [...groups.values()].some((g) => g.length)) {
    for (const g of groups.values()) {
      if (g.length && fil.length < s.count) fil.push(g.shift());
    }
  }
  return { essentiel, fil };
}
