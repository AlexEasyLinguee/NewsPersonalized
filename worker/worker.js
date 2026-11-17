// Relais Cloudflare pour Clair.
// 1. POST /profile : transforme le texte « Parle-moi de toi » en profil structuré (via Gemini).
//    La clé Gemini reste ici (secret GEMINI_API_KEY), jamais dans l'app. Le texte n'est pas stocké.
// 2. /push/* : abonnements aux notifications, gardés dans le stockage KV « CLAIR ».
// 3. /speak : lit un morceau de texte à voix haute (MeloTTS, Workers AI).
// 3 bis. /me, /friends, /share, /inbox : amis et partage d'articles (voir friends.js).
// 4. Tâche planifiée : chaque matin, une notification « Ton édition est prête » à tous les abonnés.
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
  const top = (edition.items || []).filter((i) => i.tone === 'positive' && !i.fait_divers).sort((a, b) => b.importance - a.importance)[0];
  const headline = top ? (lang === 'en' && top.title_en) || top.title : '';
  return { title: tx.title, body: headline ? tx.lead + headline : tx.fallback, url: APP_URL };
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
    await env.CLAIR.put(key, JSON.stringify({ sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, lang, at: new Date().toISOString() }));
    if (body.test) {
      const tx = PUSH_TEXT[lang];
      const status = await sendPush(sub, { title: 'Clair', body: tx.test, url: APP_URL }, await getVapid(env), PUSH_SUBJECT).catch(() => 0);
      return json({ ok: true, test: status }, 200, origin);
    }
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

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path.startsWith('/push/')) return handlePush(path, request, env, origin);
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
        return new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', ...cors(origin) } });
      } catch (e) {
        return json({ error: 'voice', detail: String(e.message || e).slice(0, 200) }, 502, origin);
      }
    }
    if (path === '/read') {
      let body = {};
      try { body = await request.json(); } catch { /* corps invalide */ }
      const [status, data] = await handleRead(body, { editionUrl: EDITION_URL });
      return json(data, status, origin);
    }
    if (/^\/(me|friends)\/|^\/(share|inbox)$/.test(path)) {
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
    if (env.CLAIR) ctx.waitUntil(notifyMorning(env));
  },
};
