// Lecteur hors ligne : à la demande d'un utilisateur, récupère la page d'un article
// et en extrait le texte, pour qu'il le lise sur son téléphone sans réseau.
// Rien n'est stocké ici : le texte est renvoyé à l'appareil, qui le garde pour lui.
// Seuls les sites présents dans l'édition du jour sont acceptés.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const MAX_HTML = 2_000_000;
const MAX_TEXT = 40_000;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', euro: '€', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', Eacute: 'É' };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n] ?? ' ');
}
const text = (html) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function findInJson(node, key, depth = 0) {
  if (!node || depth > 6) return undefined;
  if (Array.isArray(node)) { for (const x of node) { const r = findInJson(x, key, depth + 1); if (r !== undefined) return r; } return undefined; }
  if (typeof node !== 'object') return undefined;
  if (node[key] !== undefined && node[key] !== null) return node[key];
  for (const v of Object.values(node)) { const r = findInJson(v, key, depth + 1); if (r !== undefined) return r; }
  return undefined;
}

const BOILER = /cookie|newsletter|subscribe|sign up|abonnez|inscrivez|all rights reserved|tous droits réservés|follow us|suivez-nous|advertisement|publicité/i;

export function extractArticle(html) {
  const out = { title: '', blocks: [], partial: false };
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (og) out.title = text(og[1]).slice(0, 200);

  // 1. Données structurées (JSON-LD) : souvent le texte complet, proprement.
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      if (findInJson(data, 'isAccessibleForFree') === false || findInJson(data, 'isAccessibleForFree') === 'False') out.partial = true;
      const body = findInJson(data, 'articleBody');
      if (typeof body === 'string' && body.length > 600 && !out.blocks.length) {
        out.blocks = decode(body).split(/\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 1).map((p) => ({ t: 'p', text: p }));
      }
    } catch { /* JSON invalide */ }
  }

  // 2. Sinon, les paragraphes de la page.
  if (!out.blocks.length) {
    let h = html.replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure|button|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ');
    const articles = [...h.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map((m) => m[0]).sort((a, b) => b.length - a.length);
    const main = h.match(/<main\b[\s\S]*<\/main>/i);
    if (articles[0] && articles[0].length > 1500) h = articles[0];
    else if (main) h = main[0];
    const seen = new Set();
    for (const m of h.matchAll(/<(p|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const tag = m[1].toLowerCase();
      const s = text(m[2]);
      if (!s || seen.has(s)) continue;
      if (tag === 'p') {
        if (s.length < 40 || (s.length < 200 && BOILER.test(s))) continue;
        out.blocks.push({ t: 'p', text: s });
      } else if (s.length >= 3 && s.length <= 120 && !BOILER.test(s)) {
        out.blocks.push({ t: 'h', text: s });
      }
      seen.add(s);
    }
    while (out.blocks.length && out.blocks[out.blocks.length - 1].t === 'h') out.blocks.pop(); // pas d'intertitre final orphelin
  }

  // Limite de taille
  let total = 0;
  out.blocks = out.blocks.filter((b) => (total += b.text.length) <= MAX_TEXT);
  out.length = out.blocks.filter((b) => b.t === 'p').reduce((n, b) => n + b.text.length, 0);
  return out;
}

let hostCache = { at: 0, hosts: new Set() };
async function allowedHosts(editionUrl) {
  if (Date.now() - hostCache.at < 10 * 60e3 && hostCache.hosts.size) return hostCache.hosts;
  try {
    const res = await fetch(editionUrl, { signal: AbortSignal.timeout(8000) });
    const ed = await res.json();
    const hosts = new Set();
    for (const i of ed.items || []) { try { hosts.add(new URL(i.url).hostname); } catch { /* */ } }
    if (hosts.size) hostCache = { at: Date.now(), hosts };
  } catch { /* on garde l'ancienne liste */ }
  return hostCache.hosts;
}

export async function handleRead(body, { editionUrl }) {
  let url;
  try { url = new URL(String(body.url || '')); } catch { return [400, { error: 'url' }]; }
  if (url.protocol !== 'https:' || url.port || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname)) return [400, { error: 'url' }];
  if (!(await allowedHosts(editionUrl)).has(url.hostname)) return [403, { error: 'host' }];
  if (url.hostname === 'news.google.com') return [422, { error: 'unavailable' }]; // lien de redirection, pas l'article

  let html;
  try {
    const res = await fetch(url.href, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return [422, { error: 'unavailable' }];
    const buf = await res.arrayBuffer();
    const charset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] || 'utf-8';
    let dec;
    try { dec = new TextDecoder(charset); } catch { dec = new TextDecoder(); }
    html = dec.decode(buf.slice(0, MAX_HTML));
  } catch {
    return [422, { error: 'unavailable' }];
  }
  const art = extractArticle(html);
  if (art.length < 500) return [422, { error: 'unavailable' }];
  return [200, { title: art.title, blocks: art.blocks, partial: art.partial, url: url.href, at: new Date().toISOString() }];
}
