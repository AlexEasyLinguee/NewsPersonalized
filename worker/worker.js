// Relais Cloudflare pour Clair.
// 1. POST /profile : transforme le texte « Parle-moi de toi » en profil structuré (via Gemini).
//    La clé Gemini reste ici (secret GEMINI_API_KEY), jamais dans l'app. Le texte n'est pas stocké.
// 2. /push/* : abonnements aux notifications, gardés dans le stockage KV « CLAIR ».
// 3. /speak : lit un morceau de texte à voix haute (MeloTTS, Workers AI).
// 3 bis. /me, /friends, /share, /inbox : amis et partage d'articles (voir friends.js).
// 4. Tâche planifiée : chaque matin, une notification « Ton édition est prête » à tous les abonnés ;
//    chaque heure, le rappel du soir (sur demande) à ceux dont c'est l'heure et qui n'ont pas fini leur édition.
// Déployé automatiquement par GitHub Actions (.github/workflows/worker.yml).

import { generateVapid, sendPush } from './webpush.js';
import { handleFriends, linkPush } from './friends.js';
import { handleRead } from './reader.js';

const ALLOWED_ORIGINS = ['https://alexeasylinguee.github.io'];
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_CHARS = 2000;
const EDITION_URL = 'https://alexeasylinguee.github.io/NewsPersonalized/edition.json';
const APP_URL = 'https://alexeasylinguee.github.io/NewsPersonalized/';
const PUSH_SUBJECT = 'mailto:noreply@alexeasylinguee.github.io';

const THEMES = ['inventions', 'sante', 'ia', 'espace', 'ecologie', 'animaux', 'reportages', 'sourires', 'sport', 'culture', 'tech', 'economie', 'autre'];
const TOPICS = ['monde', 'aviation', 'sante', 'ecologie', 'espace', 'ia', 'tech', 'economie', 'sport', 'culture'];

const SYSTEM = `Tu configures une app d'actualités qui met en avant les bonnes nouvelles sans cacher l'essentiel.
La personne décrit librement ce qui lui plaît, ses hobbies, son métier, les lieux qui comptent pour elle, ce dont elle veut être tenue au courant (même si c'est grave) et ce qu'elle ne veut plus voir.
Déduis-en un profil, en restant fidèle à ce qu'elle dit (n'invente pas de passions qu'elle n'a pas évoquées). Réponds uniquement en JSON :
{
  "resume": "une phrase en français qui résume le profil, en tutoyant (ex. « Tu aimes le surf et la photo, tu suis le Portugal… »)",
  "interests": [{"label": "Surf", "keywords": ["surf", "surfeur", "vagues", "surfing", "big wave"]}],
  "places": ["Portugal", "Lisbonne"],
  "keep_informed": [{"label": "Santé publique", "keywords": ["épidémie", "vaccin", "hôpital", "pandemic"]}],
  "avoid": [{"label": "Politique française", "keywords": ["assemblée nationale", "gouvernement", "élysée", "macron"]}],
  "themes": [],
  "topics": [],
  "level": "eq"
}
Règles :
- interests : jusqu'à 12 centres d'intérêt ; pour chacun 4 à 10 mots-clés en minuscules, en français ET en anglais, du plus précis au plus large, qui permettraient de reconnaître un article sur ce sujet.
- places : pays, régions ou villes qu'elle veut suivre, en français.
- keep_informed : sujets dont elle veut être informée même quand la nouvelle est mauvaise (même format que interests).
- avoid : sujets qu'elle ne veut plus voir (même format).
- themes : parmi ${THEMES.join(', ')} — ceux qu'elle aimerait voir dans un fil de bonnes nouvelles. En cas de doute, inclus-les.
- topics : parmi ${TOPICS.join(', ')} — grands sujets dont les infos importantes doivent lui parvenir même si elles sont mauvaises.
- level : "min" si elle veut le moins possible de mauvaises nouvelles, "full" si elle veut tout savoir de l'actualité importante, sinon "eq".`;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
}

let cachedModel = null;
async function pickModel(env) {
  if (env.MODEL) return env.MODEL;
  if (cachedModel) return cachedModel;
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Clé Gemini refusée (HTTP ${res.status})`);
  const names = ((await res.json()).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
    .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n));
  const ver = (n) => parseFloat(n.split('-')[1]);
  // Flash-Lite : rapide, gratuit, et largement suffisant pour structurer un profil.
  const flash = names.filter((n) => !n.endsWith('-lite')).sort((a, b) => ver(b) - ver(a));
  const lite = names.filter((n) => n.endsWith('-lite')).sort((a, b) => ver(b) - ver(a));
  cachedModel = lite[0] || flash[0];
  if (!cachedModel) throw new Error('Aucun modèle Gemini disponible');
  return cachedModel;
}

const list = (v) => (Array.isArray(v) ? v : []);
function cleanGroups(v, max) {
  return list(v)
    .map((g) => ({
      label: String(g?.label || '').slice(0, 40),
      keywords: list(g?.keywords).map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 12),
    }))
    .filter((g) => g.label && g.keywords.length)
    .slice(0, max);
}
function cleanProfile(p) {
  return {
    resume: String(p.resume || '').slice(0, 300),
    interests: cleanGroups(p.interests, 12),
    places: list(p.places).map(String).filter(Boolean).slice(0, 12),
    keep_informed: cleanGroups(p.keep_informed, 8),
    avoid: cleanGroups(p.avoid, 8),
    themes: list(p.themes).filter((t) => THEMES.includes(t)),
    topics: list(p.topics).filter((t) => TOPICS.includes(t)),
    level: ['min', 'eq', 'full'].includes(p.level) ? p.level : 'eq',
  };
}

/* ---------- Traduction ---------- */
async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function gemini(env, system, user, timeout) {
  const model = await pickModel(env);
  const res = await fetch(`${GEMINI}/openai/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const content = (await res.json()).choices?.[0]?.message?.content || '{}';
  return JSON.parse(content.replace(/^```(json)?|```$/g, '').trim());
}
// Traduit le titre et les paragraphes d'un article, en gardant leur ordre et leur nombre.
async function translateArticle(env, art, to) {
  const lang = to === 'en' ? 'anglais' : 'français';
  const src = { title: art.title || '', blocks: art.blocks.map((b) => b.text) };
  const out = await gemini(env, `Traduis fidèlement cet article de presse en ${lang} naturel. Garde exactement le même nombre d'éléments dans "blocks", dans le même ordre, sans résumer ni ajouter. Réponds uniquement en JSON : {"title": "...", "blocks": ["...", "..."]}.`, JSON.stringify(src), 25000);
  if (!Array.isArray(out.blocks) || out.blocks.length !== art.blocks.length) throw new Error('traduction incomplète');
  return { title: String(out.title || art.title), blocks: art.blocks.map((b, k) => ({ ...b, text: String(out.blocks[k] || b.text) })) };
}

/* ---------- Notifications ---------- */
async function getVapid(env) {
  let vapid = await env.CLAIR.get('vapid', 'json');
  if (!vapid) {
    vapid = await generateVapid();
    await env.CLAIR.put('vapid', JSON.stringify(vapid));
  }
  return vapid;
}
async function subKey(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return `sub:${[...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
const PUSH_TEXT = {
  fr: { title: 'Ton édition est prête', lead: 'À la une des bonnes nouvelles : ', fallback: 'L\u2019essentiel du jour et de belles histoires t\u2019attendent.', test: 'Notifications activées : à demain matin !' },
  en: { title: 'Your edition is ready', lead: 'Top good news: ', fallback: 'Today\u2019s essentials and some good stories are waiting for you.', test: 'Notifications are on: see you tomorrow morning!' },
};
function morningMessage(edition, lang) {
  const tx = PUSH_TEXT[lang] || PUSH_TEXT.fr;
  const top = (edition.items || []).filter((i) => i.tone === 'positive' && !i.fait_divers && !i.search).sort((a, b) => b.importance - a.importance)[0];
  const headline = top ? (lang === 'en' && top.title_en) || top.title : '';
  return { title: tx.title, body: headline ? tx.lead + headline : tx.fallback, url: APP_URL };
}

/* ---------- Rappel du soir ---------- */
const nrm = (x) => ` ${String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
// Combien d'histoires du jour touchent chaque sujet prioritaire (mêmes règles que l'app).
function priorityHits(edition, priorities) {
  const items = (edition.items || []).filter((i) => !i.fait_divers && i.importance >= 2);
  const texts = items.map((i) => nrm([...(i.tags || []), i.title, i.summary, i.title_en, i.summary_en].join(' ')));
  const hits = [];
  const seen = new Set();
  for (const g of priorities || []) {
    let n = 0;
    texts.forEach((txt, k) => {
      if (seen.has(k)) return;
      if ((g.keywords || []).some((kw) => { const w = nrm(kw); return w.trim() && txt.includes(w); })) { n++; seen.add(k); }
    });
    if (n) hits.push({ label: g.label, n });
  }
  return hits;
}
const EVENING = {
  fr: {
    title: (h) => (h <= 1 ? 'Tes news se renouvellent dans moins d\u2019une heure' : `Tes news se renouvellent dans ${h} h`),
    hits: (n, labels) => (n === 1 ? `Dedans, une histoire qui devrait vraiment t\u2019intéresser : ${labels}.` : `Dedans, ${n} histoires qui devraient vraiment t\u2019intéresser : ${labels}.`),
    plain: 'Ton édition t\u2019attend encore, 3 minutes suffisent.',
    streak: (n) => ` Et ta série de ${n} jours continue ☀️`,
    and: ' et ',
  },
  en: {
    title: (h) => (h <= 1 ? 'Your news refreshes in under an hour' : `Your news refreshes in ${h} h`),
    hits: (n, labels) => (n === 1 ? `Inside, one story you\u2019ll really want to see: ${labels}.` : `Inside, ${n} stories you\u2019ll really want to see: ${labels}.`),
    plain: 'Your edition is still waiting, 3 minutes is all it takes.',
    streak: (n) => ` And your ${n}-day streak keeps going ☀️`,
    and: ' and ',
  },
};
const localDay = (ms) => new Date(ms).toISOString().slice(0, 10);
// Chaque heure : un rappel aux personnes qui l'ont demandé, à leur heure locale, si l'édition n'est pas finie.
async function notifyEvening(env) {
  const res = await fetch(`${EDITION_URL}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!res.ok) return;
  const edition = await res.json();
  const generated = Date.parse(edition.generated_at);
  if (!generated || Date.now() - generated > 26 * 3600e3) return; // pas d'édition récente : pas de rappel
  const now = Date.now();
  // La prochaine édition sort vers 6 h UTC.
  const next = new Date(now);
  next.setUTCHours(6, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  const hoursLeft = Math.max(1, Math.round((next.getTime() - now) / 3600e3));
  const vapid = await getVapid(env);
  let cursor;
  do {
    const page = await env.CLAIR.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const rec = await env.CLAIR.get(k.name, 'json');
      if (!rec?.evening?.on) continue;
      const local = now + (rec.tz || 0) * 60e3;
      if (new Date(local).getUTCHours() !== rec.evening.hour) continue;
      const today = localDay(local);
      const yesterday = localDay(local - 24 * 3600e3);
      if (rec.done === today || rec.lastEvening === today) continue; // déjà lu, ou déjà rappelé
      if ((rec.ignored || 0) >= 3) continue; // ignoré 3 soirs de suite : on se tait
      const tx = EVENING[rec.lang] || EVENING.fr;
      const hits = priorityHits(edition, rec.priorities);
      const total = hits.reduce((a, h) => a + h.n, 0);
      const labels = hits.slice(0, 3).map((h) => h.label);
      const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')}${tx.and}${labels.at(-1)}` : labels[0];
      let body = total ? tx.hits(total, list) : tx.plain;
      if (rec.done === yesterday && rec.streak >= 2) body += tx.streak(rec.streak);
      try {
        const status = await sendPush(rec.sub, { title: tx.title(hoursLeft), body, url: APP_URL }, vapid, PUSH_SUBJECT);
        if (status === 404 || status === 410) { await env.CLAIR.delete(k.name); continue; }
        rec.lastEvening = today;
        rec.ignored = (rec.ignored || 0) + 1;
        await env.CLAIR.put(k.name, JSON.stringify(rec));
      } catch { /* on passe au suivant */ }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

// Envoie la notification du matin si une nouvelle édition est sortie depuis le dernier envoi.
async function notifyMorning(env) {
  const res = await fetch(`${EDITION_URL}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!res.ok) return;
  const edition = await res.json();
  const generated = Date.parse(edition.generated_at);
  if (!generated || Date.now() - generated > 8 * 3600e3) return; // édition trop ancienne
  if (Number(await env.CLAIR.get('last_notified')) >= generated) return; // déjà envoyée
  await env.CLAIR.put('last_notified', String(generated));
  const vapid = await getVapid(env);
  const messages = { fr: morningMessage(edition, 'fr'), en: morningMessage(edition, 'en') };
  let cursor;
  do {
    const page = await env.CLAIR.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const rec = await env.CLAIR.get(k.name, 'json');
      if (!rec) continue;
      try {
        const status = await sendPush(rec.sub, messages[rec.lang] || messages.fr, vapid, PUSH_SUBJECT);
        if (status === 404 || status === 410) await env.CLAIR.delete(k.name); // abonnement expiré
      } catch { /* on passe au suivant */ }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function handlePush(path, request, env, origin) {
  if (!env.CLAIR) return json({ error: 'Stockage des notifications non configuré.' }, 503, origin);
  if (path === '/push/key') return json({ key: (await getVapid(env)).publicKey }, 200, origin);
  let body = {};
  try { body = await request.json(); } catch { /* corps invalide */ }
  if (path === '/push/subscribe') {
    const sub = body.subscription;
    if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: 'Abonnement invalide' }, 400, origin);
    const lang = body.lang === 'en' ? 'en' : 'fr';
    const key = await subKey(sub.endpoint);
    if (body.token) await linkPush(env, String(body.token), key, lang);
    const old = (await env.CLAIR.get(key, 'json')) || {};
    const rec = { ...old, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, lang, at: new Date().toISOString() };
    if (body.evening) rec.evening = { on: !!body.evening.on, hour: Math.min(23, Math.max(0, Number(body.evening.hour) || 20)) };
    if (Number.isFinite(Number(body.tz))) rec.tz = Math.max(-720, Math.min(840, Math.round(Number(body.tz))));
    // Sujets prioritaires : gardés seulement si le rappel du soir est activé.
    if (Array.isArray(body.priorities)) rec.priorities = rec.evening?.on ? cleanGroups(body.priorities, 5) : [];
    if (rec.evening?.on && !old.evening?.on) rec.ignored = 0;
    await env.CLAIR.put(key, JSON.stringify(rec));
    if (body.test) {
      const tx = PUSH_TEXT[lang];
      const status = await sendPush(sub, { title: 'Clair', body: tx.test, url: APP_URL }, await getVapid(env), PUSH_SUBJECT).catch(() => 0);
      return json({ ok: true, test: status }, 200, origin);
    }
    return json({ ok: true }, 200, origin);
  }
  if (path === '/push/progress') {
    // L'app signale qu'elle a été ouverte (seen) ou que l'édition du jour est finie (done).
    if (!body.endpoint) return json({ error: 'endpoint' }, 400, origin);
    const key = await subKey(String(body.endpoint));
    const rec = await env.CLAIR.get(key, 'json');
    if (!rec) return json({ ok: false }, 200, origin);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    let changed = false;
    if (day.test(body.done || '') && rec.done !== body.done) { rec.done = body.done; rec.streak = Math.max(0, Number(body.streak) || 0); changed = true; }
    if (day.test(body.seen || '') && rec.ignored) { rec.ignored = 0; changed = true; }
    if (changed) await env.CLAIR.put(key, JSON.stringify(rec));
    return json({ ok: true }, 200, origin);
  }
  if (path === '/push/unsubscribe') {
    if (body.endpoint) await env.CLAIR.delete(await subKey(String(body.endpoint)));
    return json({ ok: true }, 200, origin);
  }
  return json({ error: 'Introuvable' }, 404, origin);
}

/* ---------- Profil ---------- */
async function handleProfile(request, env, origin) {
    let text = '';
    let lang = 'fr';
    try {
      const body = await request.json();
      text = String(body.text || '').trim();
      if (body.lang === 'en') lang = 'en';
    } catch { /* corps invalide */ }
    if (text.length < 10) return json({ error: 'Écris au moins une phrase sur toi.' }, 400, origin);
    if (text.length > MAX_CHARS) return json({ error: `Texte trop long (${MAX_CHARS} caractères max).` }, 400, origin);

    try {
      const model = await pickModel(env);
      const res = await fetch(`${GEMINI}/openai/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM + (lang === 'en'
              ? '\nLa personne utilise l\'app en anglais : écris "resume" (en tutoyant → en anglais naturel, ex. « You love surfing… ») et tous les "label" en anglais. Les mots-clés restent en français ET en anglais.'
              : '\nÉcris "resume" et les "label" en français.') },
            { role: 'user', content: text },
          ],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429) return json({ error: 'L’IA est très sollicitée, réessaie dans une minute.' }, 429, origin);
      if (!res.ok) return json({ error: `L’IA a répondu une erreur (${res.status}).` }, 502, origin);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      const profile = cleanProfile(JSON.parse(content.replace(/^```(json)?|```$/g, '').trim()));
      return json({ profile }, 200, origin);
    } catch (e) {
      const msg = e.name === 'TimeoutError' ? 'l\u2019IA met trop de temps à répondre, réessaie.' : e.message;
      return json({ error: `Impossible de créer le profil : ${msg}` }, 502, origin);
    }
}

/* ---------- Sujet ajouté à la main ---------- */
const TOPIC_SYSTEM = `Une personne veut suivre un sujet dans une app d'actualités. À partir de ce qu'elle écrit, renvoie uniquement du JSON :
{"label": "nom court du sujet (3 à 5 mots) dans la langue demandée", "keywords": ["8 à 12 mots-clés en minuscules, en français ET en anglais, du plus précis au plus large, qui permettent de reconnaître un article sur ce sujet ; évite les mots trop généraux qui attraperaient des articles sans rapport"], "query": "une requête de recherche d'actualités en anglais, 2 à 5 mots, qui trouve les articles sur ce sujet"}`;
const topicKey = async (q) => {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(q.toLowerCase())));
  return `topic:${[...h.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};
async function handleTopic(request, env, origin) {
  let text = '';
  let lang = 'fr';
  try { const b = await request.json(); text = String(b.text || '').trim().slice(0, 200); if (b.lang === 'en') lang = 'en'; } catch { /* */ }
  if (text.length < 3) return json({ error: 'text' }, 400, origin);
  try {
    const model = await pickModel(env);
    const res = await fetch(`${GEMINI}/openai/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: `${TOPIC_SYSTEM}\nLangue du label : ${lang === 'en' ? 'anglais' : 'français'}.` }, { role: 'user', content: text }] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return json({ error: 'ai' }, 502, origin);
    const out = JSON.parse(((await res.json()).choices?.[0]?.message?.content || '{}').replace(/^```(json)?|```$/g, '').trim());
    const [group] = cleanGroups([{ label: out.label || text, keywords: out.keywords }], 1);
    const query = String(out.query || '').replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    // Le sujet (sans rien qui identifie la personne) devient une recherche ajoutée aux sources du matin, pendant 60 jours.
    if (query && env.CLAIR) await env.CLAIR.put(await topicKey(query), JSON.stringify({ q: query, at: new Date().toISOString() }), { expirationTtl: 60 * 24 * 3600 });
    return json({ group: group || { label: text.slice(0, 40), keywords: [text.toLowerCase()] }, query }, 200, origin);
  } catch {
    return json({ error: 'ai' }, 502, origin);
  }
}
async function listTopics(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.CLAIR.list({ prefix: 'topic:', cursor });
    for (const k of page.keys) { const v = await env.CLAIR.get(k.name, 'json'); if (v?.q) out.push(v.q); }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < 200);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    // Liste des sujets suivis (anonyme), lue par la tâche du matin sur GitHub.
    if (request.method === 'GET' && new URL(request.url).pathname === '/topics' && env.CLAIR) {
      return new Response(JSON.stringify({ topics: await listTopics(env) }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path.startsWith('/push/')) return handlePush(path, request, env, origin);
    if (path === '/topic' && request.method === 'POST') return handleTopic(request, env, origin);
    if (path === '/speak') {
      // Lecture à voix haute d'un morceau d'article (voix MeloTTS de Cloudflare Workers AI).
      if (!env.AI) return json({ error: 'Voix non configurée.' }, 503, origin);
      let body = {};
      try { body = await request.json(); } catch { /* corps invalide */ }
      const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
      const lang = body.lang === 'en' ? 'en' : 'fr';
      if (text.length < 2) return json({ error: 'text' }, 400, origin);
      try {
        const out = await env.AI.run('@cf/myshell-ai/melotts', { prompt: text, lang });
        const b64 = typeof out === 'string' ? out : out?.audio;
        if (!b64) return json({ error: 'voice' }, 502, origin);
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const wav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // « RIFF »
        return new Response(bytes, { headers: { 'Content-Type': wav ? 'audio/wav' : 'audio/mpeg', 'Cache-Control': 'no-store', ...cors(origin) } });
      } catch (e) {
        return json({ error: 'voice', detail: String(e.message || e).slice(0, 200) }, 502, origin);
      }
    }
    if (path === '/read') {
      let body = {};
      try { body = await request.json(); } catch { /* corps invalide */ }
      const [status, data] = await handleRead(body, { editionUrl: EDITION_URL });
      // Article dans une autre langue que celle du lecteur : traduit (et gardé 3 jours pour les suivants).
      const to = body.lang === 'en' ? 'en' : body.lang === 'fr' ? 'fr' : null;
      const from = /^[a-z]{2}$/.test(String(body.from || '')) ? String(body.from) : null;
      if (status === 200 && to && from && from !== to && env.GEMINI_API_KEY) {
        const key = `tr:${to}:${await sha(data.url)}`;
        const cached = env.CLAIR && (await env.CLAIR.get(key, 'json'));
        if (cached) return json({ ...data, ...cached, translated: from }, 200, origin);
        try {
          const tr = await translateArticle(env, data, to);
          if (env.CLAIR) await env.CLAIR.put(key, JSON.stringify(tr), { expirationTtl: 3 * 86400 });
          return json({ ...data, ...tr, translated: from }, 200, origin);
        } catch { /* on rend l'original */ }
      }
      return json(data, status, origin);
    }
    if (path === '/labels') {
      // Traduit les noms courts du profil (lieux, sujets) dans la langue du lecteur.
      let body = {};
      try { body = await request.json(); } catch { /* corps invalide */ }
      const to = body.lang === 'en' ? 'en' : 'fr';
      const items = list(body.items).map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 40);
      if (!items.length) return json({ labels: {} }, 200, origin);
      try {
        const out = await gemini(env, `Traduis chaque nom court (lieu, pays, ville, sujet d'intérêt) en ${to === 'en' ? 'anglais' : 'français'}, avec le nom usuel dans cette langue (ex. « Angleterre » → « England », « Singapour » → « Singapore »). Garde tel quel ce qui est déjà dans cette langue ou ne se traduit pas. Réponds uniquement en JSON : {"labels": {"original": "traduction"}}.`, JSON.stringify(items), 15000);
        const labels = {};
        for (const k of items) { const v = out?.labels?.[k]; if (typeof v === 'string' && v.trim()) labels[k] = v.trim().slice(0, 60); }
        return json({ labels }, 200, origin);
      } catch (e) {
        return json({ error: String(e.message || e).slice(0, 200) }, 502, origin);
      }
    }
    if (/^\/(me|friends|likes)\/|^\/(share|inbox)$/.test(path)) {
      if (!env.CLAIR) return json({ error: 'Stockage non configuré.' }, 503, origin);
      let body = {};
      try { body = await request.json(); } catch { /* corps invalide */ }
      const [status, data] = await handleFriends(path, body, env, ctx, { vapidOf: getVapid, subject: PUSH_SUBJECT, appUrl: APP_URL });
      return json(data, status, origin);
    }
    if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, origin);
    return handleProfile(request, env, origin);
  },
  async scheduled(event, env, ctx) {
    if (!env.CLAIR) return;
    if (event.cron === '7 * * * *') ctx.waitUntil(notifyEvening(env));
    else ctx.waitUntil(notifyMorning(env));
  },
};
