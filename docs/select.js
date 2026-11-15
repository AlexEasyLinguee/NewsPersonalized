// Logique de sélection : applique le profil et les réglages à l'édition du jour.
// Fichier sans dépendance, utilisé par l'app (et testable avec Node).

export const THEMES = [
  { id: 'inventions', fr: 'Inventions qui changent le monde', en: 'World-changing inventions' },
  { id: 'sante', fr: 'Santé et médecine', en: 'Health and medicine' },
  { id: 'ia', fr: 'Intelligence artificielle', en: 'Artificial intelligence' },
  { id: 'espace', fr: 'Espace et Starship', en: 'Space and Starship' },
  { id: 'ecologie', fr: 'Écologie et climat', en: 'Ecology and climate' },
  { id: 'animaux', fr: 'Animaux et nature', en: 'Animals and nature' },
  { id: 'reportages', fr: 'Beaux reportages', en: 'Beautiful stories' },
  { id: 'sourires', fr: 'Histoires qui font sourire', en: 'Feel-good stories' },
  { id: 'sport', fr: 'Sport', en: 'Sport' },
  { id: 'culture', fr: 'Culture, arts et gastronomie', en: 'Culture, arts and food' },
  { id: 'tech', fr: 'Technologie', en: 'Technology' },
  { id: 'economie', fr: 'Économie et entreprises', en: 'Business and economy' },
  { id: 'autre', fr: 'Autres bonnes nouvelles', en: 'Other good news' },
];

export const CATEGORY_LABELS = {
  inventions: { fr: 'Inventions qui changent le monde', en: 'World-changing inventions' },
  sante: { fr: 'Santé', en: 'Health' },
  ia: { fr: 'Intelligence artificielle', en: 'Artificial intelligence' },
  espace: { fr: 'Espace', en: 'Space' },
  ecologie: { fr: 'Écologie', en: 'Ecology' },
  animaux: { fr: 'Animaux et nature', en: 'Animals and nature' },
  reportages: { fr: 'Reportage', en: 'Story' },
  sourires: { fr: 'Histoire qui fait sourire', en: 'Feel-good story' },
  sport: { fr: 'Sport', en: 'Sport' },
  culture: { fr: 'Culture', en: 'Culture' },
  tech: { fr: 'Technologie', en: 'Technology' },
  economie: { fr: 'Économie', en: 'Business' },
  monde: { fr: 'Monde', en: 'World' },
  aviation: { fr: 'Aviation', en: 'Aviation' },
  autre: { fr: 'Actualité', en: 'News' },
};

export const LEVELS = [
  { id: 'min', fr: { label: 'Minimum', desc: 'Uniquement les événements mondiaux majeurs, ceux que tout le monde doit connaître.' },
    en: { label: 'Minimum', desc: 'Only major world events, the ones everyone should know about.' } },
  { id: 'eq', fr: { label: 'Équilibré', desc: 'Les événements majeurs, plus ce qui touche tes lieux et sujets suivis. Le reste est filtré.' },
    en: { label: 'Balanced', desc: 'Major events, plus anything touching the places and topics you follow. The rest is filtered out.' } },
  { id: 'full', fr: { label: 'Complet', desc: 'Toute l\u2019actualité importante, bonne ou mauvaise, toujours sans faits divers.' },
    en: { label: 'Full', desc: 'All the important news, good or bad, still without minor incidents and gossip.' } },
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
  lang: 'fr',
  articleLang: 'translated', // 'translated' = dans la langue de l'app, 'original' = version d'origine
  sound: true,
  haptics: true,
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

// Pourquoi une info grave passe le filtre : {kind: 'place'|'keep'|'topic', name}, ou null.
export function followedReason(item, s) {
  const place = placeMatch(item, s);
  if (place) return { kind: 'place', name: place };
  const keep = matchGroups(item, s.keep_informed)[0];
  if (keep) return { kind: 'keep', name: keep.label };
  if ((s.topics || []).includes(item.category)) return { kind: 'topic', name: item.category };
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
      why: loves.length ? loves[0].label : '',
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
