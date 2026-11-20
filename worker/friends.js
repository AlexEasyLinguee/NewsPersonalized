// Amis et partage d'articles, sans compte : chaque appareil reçoit un jeton secret (gardé sur le téléphone)
// et un code ami public (ex. « K7P-3MX ») à donner à ses amis.
//
// Stockage KV :
//   user:<jeton>  → { name, code, lang, friends: [jeton…], push: <clé d'abonnement> }
//   code:<code>   → <jeton>
//   inbox:<jeton>:<horodatage> → { from, fromCode, note, item, at }   (effacé après 30 jours)
//   likes:<jeton> → [{ item, at }]   favoris montrés aux amis (seulement si la personne l'a activé, 7 jours)
//   liked:<hash url> → [jeton…]      qui a aimé cet article (7 jours), pour prévenir quand 2 amis l'aiment

import { sendPush } from './webpush.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INBOX_TTL = 30 * 24 * 3600;
const MAX_FRIENDS = 100;

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const newToken = () => hex(crypto.getRandomValues(new Uint8Array(16)));
function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  const c = [...r].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${c.slice(0, 3)}-${c.slice(3)}`;
}
const cleanCode = (c) => {
  const s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 6 ? `${s.slice(0, 3)}-${s.slice(3)}` : '';
};
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 30);
const str = (v, n) => (v == null ? undefined : String(v).slice(0, n));
const safeUrl = (u) => (/^https?:\/\//.test(String(u || '')) ? String(u).slice(0, 600) : undefined);

function cleanItem(i = {}) {
  return {
    title: str(i.title, 160), summary: str(i.summary, 320),
    title_en: str(i.title_en, 160), summary_en: str(i.summary_en, 320),
    orig_title: str(i.orig_title, 160), orig_summary: str(i.orig_summary, 320),
    url: safeUrl(i.url), image: safeUrl(i.image), source: str(i.source, 60),
    category: str(i.category, 20), published: str(i.published, 40),
    orig_lang: /^[a-z]{2}$/.test(String(i.orig_lang || '')) ? i.orig_lang : undefined,
  };
}

const LIKE_DAYS = 7;
const LIKE_TTL = LIKE_DAYS * 24 * 3600;
const MAX_LIKES = 30;
const recent = (at) => Date.now() - Date.parse(at) < LIKE_DAYS * 864e5;
async function urlHash(url) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return hex(new Uint8Array(d).slice(0, 12));
}
const PUSH_LIKES = {
  fr: (names) => `${names} ont aimé cet article`,
  en: (names) => `${names} liked this story`,
};
const andJoin = (names, lang) => (names.length > 1 ? `${names.slice(0, -1).join(', ')}${lang === 'en' ? ' and ' : ' et '}${names.at(-1)}` : names[0]);

const PUSH_SHARE = {
  fr: (name) => `${name} t’a envoyé un article`,
  en: (name) => `${name} sent you a story`,
};

export async function handleFriends(path, body, env, ctx, { vapidOf, subject, appUrl }) {
  const KV = env.CLAIR;
  const getUser = async (token) => (token && /^[0-9a-f]{32}$/.test(token) ? KV.get(`user:${token}`, 'json') : null);
  const putUser = (token, u) => KV.put(`user:${token}`, JSON.stringify(u));
  const friendView = async (tokens) => (await Promise.all(tokens.map((t) => KV.get(`user:${t}`, 'json'))))
    .filter(Boolean).map((f) => ({ code: f.code, name: f.name }));

  if (path === '/me/register') {
    const name = cleanName(body.name);
    if (!name) return [400, { error: 'name' }];
    let code;
    for (let k = 0; k < 5; k++) { code = newCode(); if (!(await KV.get(`code:${code}`))) break; }
    const token = newToken();
    await putUser(token, { name, code, lang: body.lang === 'en' ? 'en' : 'fr', friends: [], at: new Date().toISOString() });
    await KV.put(`code:${code}`, token);
    return [200, { token, code, name }];
  }

  const me = await getUser(body.token);
  if (!me) return [401, { error: 'auth' }];

  if (path === '/me/update') {
    if (body.name) me.name = cleanName(body.name) || me.name;
    if (body.lang) me.lang = body.lang === 'en' ? 'en' : 'fr';
    await putUser(body.token, me);
    return [200, { ok: true, name: me.name, code: me.code }];
  }

  if (path === '/friends/list') return [200, { friends: await friendView(me.friends) }];

  if (path === '/friends/add') {
    const code = cleanCode(body.code);
    const other = code && (await KV.get(`code:${code}`));
    if (!other) return [404, { error: 'code' }];
    if (other === body.token) return [400, { error: 'self' }];
    const them = await getUser(other);
    if (!them) return [404, { error: 'code' }];
    if (me.friends.length >= MAX_FRIENDS) return [400, { error: 'full' }];
    if (!me.friends.includes(other)) me.friends.push(other);
    if (!them.friends.includes(body.token)) them.friends.push(body.token);
    await putUser(body.token, me);
    await putUser(other, them);
    return [200, { friend: { code: them.code, name: them.name } }];
  }

  if (path === '/friends/remove') {
    const other = await KV.get(`code:${cleanCode(body.code)}`);
    if (other) {
      me.friends = me.friends.filter((t) => t !== other);
      await putUser(body.token, me);
      const them = await getUser(other);
      if (them) { them.friends = them.friends.filter((t) => t !== body.token); await putUser(other, them); }
    }
    return [200, { ok: true }];
  }

  if (path === '/share') {
    const item = cleanItem(body.item);
    if (!item.url || !item.title) return [400, { error: 'item' }];
    const note = str(body.note, 280) || '';
    const codes = [...new Set((Array.isArray(body.to) ? body.to : []).map(cleanCode).filter(Boolean))].slice(0, 20);
    let sent = 0;
    for (const code of codes) {
      const other = await KV.get(`code:${code}`);
      if (!other || !me.friends.includes(other)) continue; // on ne partage qu'avec ses amis
      const key = `inbox:${other}:${Date.now()}-${hex(crypto.getRandomValues(new Uint8Array(3)))}`;
      await KV.put(key, JSON.stringify({ from: me.name, fromCode: me.code, note, item, at: new Date().toISOString() }), { expirationTtl: INBOX_TTL });
      sent++;
      const them = await getUser(other);
      if (them?.push) {
        ctx.waitUntil((async () => {
          const rec = await KV.get(them.push, 'json');
          if (!rec) return;
          const lang = them.lang === 'en' ? 'en' : 'fr';
          const title = (lang === 'en' && item.title_en) || item.title;
          const status = await sendPush(rec.sub, { title: PUSH_SHARE[lang](me.name), body: note ? `« ${note} » — ${title}` : title, url: `${appUrl}#recus` }, await vapidOf(env), subject).catch(() => 0);
          if (status === 404 || status === 410) await KV.delete(them.push);
        })());
      }
    }
    return [200, { sent }];
  }

  // ----- Favoris montrés aux amis -----
  if (path === '/likes/set') {
    const item = cleanItem(body.item);
    if (!item.url || !item.title) return [400, { error: 'item' }];
    let likes = ((await KV.get(`likes:${body.token}`, 'json')) || []).filter((l) => recent(l.at) && l.item.url !== item.url);
    if (body.on) likes = [{ item, at: new Date().toISOString() }, ...likes].slice(0, MAX_LIKES);
    await KV.put(`likes:${body.token}`, JSON.stringify(likes), { expirationTtl: LIKE_TTL });
    const hkey = `liked:${await urlHash(item.url)}`;
    let who = ((await KV.get(hkey, 'json')) || []).filter((t) => t !== body.token);
    if (body.on) who = [...who, body.token].slice(-200);
    await KV.put(hkey, JSON.stringify(who), { expirationTtl: LIKE_TTL });
    if (body.on && who.length >= 2) ctx.waitUntil(notifyDoubleLike(item, who));
    return [200, { ok: true }];
  }
  if (path === '/likes/sync') {
    // Activation : on partage les favoris des 7 derniers jours.
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_LIKES)
      .map((x) => ({ item: cleanItem(x.item || x), at: str(x.at, 40) || new Date().toISOString() }))
      .filter((l) => l.item.url && l.item.title && recent(l.at));
    await KV.put(`likes:${body.token}`, JSON.stringify(items), { expirationTtl: LIKE_TTL });
    return [200, { ok: true, n: items.length }];
  }
  if (path === '/likes/clear') {
    await KV.delete(`likes:${body.token}`);
    return [200, { ok: true }];
  }
  if (path === '/friends/likes') {
    // Articles aimés par tes amis ces 7 derniers jours, regroupés par article.
    const byUrl = new Map();
    await Promise.all(me.friends.map(async (ft) => {
      const [f, likes] = await Promise.all([KV.get(`user:${ft}`, 'json'), KV.get(`likes:${ft}`, 'json')]);
      if (!f || !Array.isArray(likes)) return;
      for (const l of likes) {
        if (!recent(l.at) || !l.item?.url) continue;
        const e = byUrl.get(l.item.url) || { item: l.item, names: [], at: l.at };
        if (!e.names.includes(f.name)) e.names.push(f.name);
        if (l.at > e.at) e.at = l.at;
        byUrl.set(l.item.url, e);
      }
    }));
    const items = [...byUrl.values()].sort((a, b) => b.names.length - a.names.length || (b.at > a.at ? 1 : -1)).slice(0, 15);
    return [200, { items }];
  }

  if (path === '/inbox') {
    const prefix = `inbox:${body.token}:`;
    const page = await KV.list({ prefix, limit: 100 });
    const keys = page.keys.map((k) => k.name).sort().reverse().slice(0, 50);
    const items = (await Promise.all(keys.map(async (k) => {
      const v = await KV.get(k, 'json');
      return v && { id: k.slice(prefix.length), ...v };
    }))).filter(Boolean);
    return [200, { items }];
  }

  return [404, { error: 'not found' }];

  // Prévient (une fois par jour au plus) un ami quand au moins 2 de ses amis ont aimé le même article.
  async function notifyDoubleLike(item, who) {
    for (const ft of me.friends) {
      if (who.includes(ft)) continue; // il l'a déjà aimé
      const f = await getUser(ft);
      if (!f?.push) continue;
      const today = new Date().toISOString().slice(0, 10);
      if (f.likePush === today) continue;
      const likers = who.filter((t) => f.friends.includes(t));
      if (likers.length < 2) continue;
      const names = (await Promise.all(likers.slice(-3).map((t) => KV.get(`user:${t}`, 'json')))).filter(Boolean).map((u) => u.name);
      if (names.length < 2) continue;
      const rec = await KV.get(f.push, 'json');
      if (!rec) continue;
      const lang = f.lang === 'en' ? 'en' : 'fr';
      const title = (lang === 'en' && item.title_en) || item.title;
      const status = await sendPush(rec.sub, { title: PUSH_LIKES[lang](andJoin(names, lang)), body: title, url: `${appUrl}#amis` }, await vapidOf(env), subject).catch(() => 0);
      if (status === 404 || status === 410) { await KV.delete(f.push); continue; }
      f.likePush = today;
      await putUser(ft, f);
    }
  }
}

// Associe l'abonnement aux notifications d'un appareil à son utilisateur (pour prévenir des partages).
export async function linkPush(env, token, subKey, lang) {
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return;
  const u = await env.CLAIR.get(`user:${token}`, 'json');
  if (!u) return;
  u.push = subKey;
  if (lang) u.lang = lang;
  await env.CLAIR.put(`user:${token}`, JSON.stringify(u));
}
