// Construit l'édition du jour : récupère les flux RSS, fait noter chaque article
// par une IA (importance + ton + thème), puis écrit docs/edition.json.
// L'app (docs/index.html) applique ensuite TES réglages (dosage, lieux, thèmes).

import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const SOURCES = JSON.parse(await fs.readFile(new URL('sources.json', ROOT), 'utf8'));

const MAX_AGE_HOURS = 30;     // on ne garde que les articles récents
const PER_SOURCE = 10;        // max d'articles lus par source
const MAX_ITEMS = 330;        // plafond total envoyé à l'IA (limites de l'offre gratuite)
const BATCH = 15;             // articles par requête IA
const PAUSE_MS = 4500;        // pause entre deux requêtes IA
// IA : Google Gemini, offre gratuite (clé dans le secret GEMINI_API_KEY du dépôt).
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const ENDPOINT = `${GEMINI}/openai/chat/completions`;
const TOKEN = process.env.GEMINI_API_KEY;
let MODEL = process.env.MODEL || '';

export const CATEGORIES = ['inventions', 'sante', 'ia', 'espace', 'ecologie', 'animaux', 'reportages', 'sourires', 'sport', 'culture', 'tech', 'economie', 'monde', 'aviation', 'autre'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function txt(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === 'object') return txt(v['#text'] ?? '');
  return '';
}

function strip(html) {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findImage(it) {
  for (const k of ['media:content', 'media:thumbnail', 'enclosure']) {
    for (const m of arr(it[k])) {
      const u = m?.['@_url'];
      const t = m?.['@_type'] || '';
      if (u && (!t || t.startsWith('image'))) return u;
    }
  }
  for (const g of arr(it['media:group'])) {
    for (const m of arr(g?.['media:content'])) if (m?.['@_url']) return m['@_url'];
  }
  const html = txt(it['content:encoded']) + txt(it.description) + txt(it.content) + txt(it.summary);
  const m = html.replace(/&lt;/g, '<').replace(/&quot;/g, '"').match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function linkOf(it) {
  const l = it.link;
  if (typeof l === 'string') return l;
  for (const x of arr(l)) {
    if (typeof x === 'string') return x;
    if (x?.['@_href'] && (!x['@_rel'] || x['@_rel'] === 'alternate')) return x['@_href'];
  }
  return txt(it.guid);
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
// Certains flux (The Guardian) dépassent la limite d'entités du parseur : on les lit sans décodage.
const rawParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: false });

export function parseFeed(xml, src) {
  let doc;
  try { doc = parser.parse(xml); } catch { doc = rawParser.parse(xml); }
  const raw = arr(doc?.rss?.channel?.item).concat(arr(doc?.feed?.entry), arr(doc?.['rdf:RDF']?.item));
  const now = Date.now();
  const out = [];
  for (const it of raw) {
    const title = strip(txt(it.title));
    const url = linkOf(it);
    if (!title || !url) continue;
    const dateStr = txt(it.pubDate) || txt(it.published) || txt(it.updated) || txt(it['dc:date']);
    const published = dateStr ? new Date(dateStr) : null;
    if (published && !isNaN(published) && now - published.getTime() > MAX_AGE_HOURS * 3600e3) continue;
    const desc = strip(txt(it.description) || txt(it.summary) || txt(it['content:encoded']) || txt(it.content)).slice(0, 300);
    out.push({
      title,
      desc,
      url,
      image: findImage(it),
      published: published && !isNaN(published) ? published.toISOString() : null,
      source: src.name,
    });
    if (out.length >= PER_SOURCE) break;
  }
  return out;
}

async function fetchSource(src) {
  if (process.env.FIXTURE_DIR) {
    const file = new URL(`${process.env.FIXTURE_DIR}/${encodeURIComponent(src.name)}.xml`, 'file://');
    try { return parseFeed(await fs.readFile(file, 'utf8'), src); } catch { return []; }
  }
  try {
    const res = await fetch(src.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseFeed(await res.text(), src);
    console.log(`✓ ${src.name}: ${items.length}`);
    return items;
  } catch (e) {
    console.log(`✗ ${src.name}: ${e.message}`);
    return [];
  }
}

const SYSTEM = `Tu tries l'actualité pour une app d'infos qui met en avant les bonnes nouvelles sans cacher l'essentiel.
Juge chaque article pour un lecteur citoyen du monde : sa pertinence et sa portée comptent, pas le pays ni le média d'origine. Une avancée majeure rapportée par un journal indien, africain ou sud-américain vaut autant que si elle venait d'un grand média européen ou américain ; ne privilégie pas l'Europe ni les États-Unis.
Pour chaque article reçu, renvoie un objet avec :
- "id" : l'id reçu
- "importance" : entier 0-10. 10 = événement historique mondial. 8-9 = info mondiale majeure que tout le monde devrait connaître (catastrophe naturelle de grande ampleur, crash d'avion de ligne, escalade d'une guerre, élection majeure, découverte scientifique majeure). 5-7 = info significative à l'échelle d'un pays ou d'une région. 0-4 = info mineure, locale, anecdotique. 0 = publicité, bon plan, contenu promotionnel.
- "tone" : "positive" (progrès, découverte, solution, invention utile, réussite écologique, histoire humaine qui fait du bien, belle nature), "neutral" (information factuelle sans charge négative, ex. un lancement de fusée, une annonce d'IA), ou "negative" (drame, conflit, crise, catastrophe, polémique).
- "category" : un seul parmi ${CATEGORIES.join(', ')}. inventions = inventions et innovations qui améliorent le monde ; sante = santé et médecine ; ia = intelligence artificielle ; espace = spatial, astronomie, SpaceX/Starship ; ecologie = climat, énergie, environnement ; animaux = animaux et nature ; reportages = beaux reportages, culture, voyages ; sourires = histoires humaines touchantes ; sport = sport ; culture = cinéma, musique, arts, livres, gastronomie ; tech = technologie hors IA ; economie = économie, entreprises, finance ; monde = politique et géopolitique internationale ; aviation = aviation et transport aérien ; autre = le reste.
- "fiable" : false si l'article ne vient pas d'une rédaction sérieuse (blog, site partisan ou complotiste, presse à scandale, contenu sponsorisé, simple communiqué de presse, agrégateur douteux), sinon true. Le nom du média est indiqué dans "source" ou à la fin du titre.
- "fait_divers" : true pour les faits divers (crime local, petit accident, people et ragots, faits isolés sans portée générale), sinon false. Le sport n'est pas un fait divers.
- "places" : liste des pays, régions ou villes principalement concernés, en français (ex. ["Bali", "Indonésie"]). Liste vide si aucun.
- "tags" : 4 à 8 mots-clés en minuscules qui décrivent précisément le sujet (personnes, entreprises, activités, objets, lieux), en français et, pour les termes courants, aussi en anglais (ex. ["surf", "océan", "portugal", "nazaré", "big wave"]).
- "title_fr" : titre clair et factuel en français, sans sensationnalisme, 90 caractères max.
- "summary_fr" : résumé en français en une ou deux phrases (220 caractères max), qui dit pourquoi c'est intéressant ou important. N'invente aucun fait absent de l'article.
- "title_en" et "summary_en" : les mêmes titre et résumé, en anglais naturel.
- "radio_fr" : la même info racontée à l'oral par un présentateur de radio chaleureux et posé, en 2 ou 3 phrases (350 caractères max), avec une courte accroche qui situe le sujet (ex. « Direction le Pacifique, avec une très bonne nouvelle pour les océans. »). Phrases simples, faciles à suivre à l'oreille : pas de parenthèses, d'abréviations, de liens ni de listes ; écris les sigles comme ils se prononcent si besoin. N'invente aucun fait.
- "radio_en" : le même texte radio, en anglais naturel.
Réponds uniquement en JSON : {"items": [ ... ]}.`;

// Choisit automatiquement le meilleur modèle gratuit disponible (Flash-Lite, sinon Flash).
async function pickModel() {
  if (MODEL || process.env.MOCK_AI) return;
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': TOKEN } });
  if (!res.ok) throw new Error(`Clé Gemini refusée (HTTP ${res.status}) : ${(await res.text()).slice(0, 200)}`);
  const names = ((await res.json()).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
    .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n));
  const ver = (n) => parseFloat(n.split('-')[1]);
  const lite = names.filter((n) => n.endsWith('-lite')).sort((a, b) => ver(b) - ver(a));
  const flash = names.filter((n) => !n.endsWith('-lite')).sort((a, b) => ver(b) - ver(a));
  MODEL = lite[0] || flash[0];
  if (!MODEL) throw new Error('Aucun modèle Gemini Flash disponible pour cette clé.');
}

async function callModel(batch) {
  if (process.env.MOCK_AI) return mockScore(batch);
  const body = {
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(batch.map((b) => ({ id: b.id, source: b.source, title: b.title, desc: b.desc }))) },
    ],
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(90, Number(res.headers.get('retry-after')) || 20 * attempt);
      console.log(`  IA occupée (${res.status}), nouvel essai dans ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`IA HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Réponse IA illisible : ${raw.slice(0, 200)}`); }
    const content = data.choices?.[0]?.message?.content || '{}';
    const json = JSON.parse(content.replace(/^```(json)?|```$/g, '').trim());
    return arr(json.items);
  }
  throw new Error('IA indisponible après 4 essais');
}

// Notation factice, uniquement pour tester l'app sans IA (MOCK_AI=1).
function mockScore(batch) {
  return batch.map((b, i) => ({
    id: b.id,
    importance: (b.id * 7) % 11,
    tone: ['positive', 'positive', 'neutral', 'negative'][b.id % 4],
    category: CATEGORIES[b.id % CATEGORIES.length],
    fait_divers: b.id % 9 === 0,
    places: b.id % 5 === 0 ? ['Bali', 'Indonésie'] : [],
    tags: b.id % 3 === 0 ? ['surf', 'océan'] : ['guitare', 'musique'],
    title_fr: b.title,
    summary_fr: b.desc.slice(0, 200),
    radio_fr: `À la une. ${b.title}. ${b.desc.slice(0, 120)}`,
    radio_en: `Top story. ${b.title}.`,
    title_en: `EN ${b.title}`,
    summary_en: `EN ${b.desc.slice(0, 180)}`,
  }));
}

// Résumé d'origine : vide s'il ne fait que répéter le titre (cas de Google News),
// sinon coupé proprement en fin de phrase ou de mot.
function cleanSummary(title, desc) {
  const n = (x) => x.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ').trim();
  if (!desc || n(desc).startsWith(n(title).slice(0, 40))) return '';
  if (desc.length <= 280) return desc;
  const cut = desc.slice(0, 280);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 120 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

function clean(r, src) {
  const imp = Math.max(0, Math.min(10, Math.round(Number(r.importance) || 0)));
  const tone = ['positive', 'neutral', 'negative'].includes(r.tone) ? r.tone : 'neutral';
  const category = CATEGORIES.includes(r.category) ? r.category : 'autre';
  return {
    id: src.id,
    title: String(r.title_fr || src.title).slice(0, 140),
    summary: String(r.summary_fr || src.desc).slice(0, 300),
    title_en: r.title_en ? String(r.title_en).slice(0, 140) : undefined,
    orig_title: src.title.slice(0, 160),
    orig_summary: cleanSummary(src.title, src.desc),
    summary_en: r.summary_en ? String(r.summary_en).slice(0, 300) : undefined,
    radio: r.radio_fr ? String(r.radio_fr).slice(0, 450) : undefined,
    radio_en: r.radio_en ? String(r.radio_en).slice(0, 450) : undefined,
    url: src.url,
    image: src.image,
    source: src.source,
    published: src.published,
    importance: imp,
    tone,
    category,
    fait_divers: Boolean(r.fait_divers),
    fiable: r.fiable !== false,
    places: arr(r.places).map(String).slice(0, 6),
    tags: arr(r.tags).map((t) => String(t).toLowerCase()).slice(0, 10),
  };
}

async function main() {
  if (!TOKEN && !process.env.MOCK_AI) throw new Error('Secret GEMINI_API_KEY manquant : ajoute ta clé Gemini dans Settings › Secrets and variables › Actions.');
  await pickModel();

  // Sujets ajoutés à la main par les utilisateurs : une recherche d'actualités chacun.
  const extra = [];
  try {
    const res = await fetch('https://clair-profil.alexis-lecussan.workers.dev/topics', { signal: AbortSignal.timeout(10000) });
    const { topics = [] } = await res.json();
    for (const q of topics.slice(0, 40)) {
      extra.push({ name: `Recherche – ${q}`, url: `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:3d&hl=en-US&gl=US&ceid=US:en` });
    }
    console.log(`${extra.length} sujets suivis ajoutés aux sources`);
  } catch (e) { console.log(`Sujets suivis indisponibles : ${e.message}`); }
  const lists = await Promise.all([...SOURCES, ...extra].map(fetchSource));
  // On alterne les sources pour qu'aucune ne monopolise le plafond.
  const merged = [];
  for (let i = 0; i < PER_SOURCE; i++) for (const l of lists) if (l[i]) merged.push(l[i]);

  const seen = new Set();
  const items = [];
  for (const it of merged) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
    if (seen.has(key) || seen.has(it.url)) continue;
    seen.add(key); seen.add(it.url);
    items.push({ ...it, id: items.length + 1 });
    if (items.length >= MAX_ITEMS) break;
  }
  console.log(`\n${items.length} articles à noter avec ${MODEL}`);
  if (!items.length) throw new Error('Aucun article récupéré.');

  const byId = new Map(items.map((i) => [i.id, i]));
  const scored = [];
  let failures = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    try {
      let results;
      try { results = await callModel(batch); }
      catch (e) { console.log(`  lot ${i / BATCH + 1} : nouvel essai (${e.message.slice(0, 80)})`); await sleep(PAUSE_MS); results = await callModel(batch); }
      for (const r of results) {
        const src = byId.get(Number(r.id));
        if (src) scored.push(clean(r, src));
      }
      console.log(`  lot ${i / BATCH + 1}: ${results.length} notés`);
    } catch (e) {
      failures++;
      console.log(`  lot ${i / BATCH + 1} ignoré: ${e.message}`);
    }
    if (!process.env.MOCK_AI) await sleep(PAUSE_MS);
  }
  if (!scored.length) throw new Error(`Aucun article noté (${failures} lots en échec).`);

  const kept = scored.filter((s) => s.importance > 0 && s.fiable !== false).sort((a, b) => b.importance - a.importance);
  const edition = { generated_at: new Date().toISOString(), model: MODEL, count: kept.length, items: kept };
  await fs.mkdir(new URL('docs/', ROOT), { recursive: true });
  await fs.writeFile(new URL('docs/edition.json', ROOT), JSON.stringify(edition));
  console.log(`\nÉdition écrite : ${kept.length} articles (${failures} lots en échec).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
