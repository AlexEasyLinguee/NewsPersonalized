// Amis et partage d'articles, sans compte : chaque appareil reçoit un jeton secret (gardé sur le téléphone)
// et un code ami public (ex. « K7P-3MX ») à donner à ses amis.
//
// Stockage KV :
//   user:<jeton>  → { name, code, lang, friends: [jeton…], push: <clé d'abonnement> }
//   code:<code>   → <jeton>
//   inbox:<jeton>:<horodatage> → { from, fromCode, note, item, at }   (effacé après 30 jours)

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
  };
}

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
