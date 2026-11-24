import { THEMES, LEVELS, CATEGORY_LABELS, DEFAULT_SETTINGS, select, followedReason, themeOf, priorityGroups, MAX_PRIORITY, matchGroups, sameStory } from './select.js';
import { WORKER_URL } from './config.js';
import { makeT } from './i18n.js';
import { initPlayer } from './player.js';

const TOPIC_IDS = ['monde', 'aviation', 'economie', 'tech', 'ecologie', 'sante', 'espace', 'ia'];

const ICONS = {
  heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6"/></svg>',
  photo: '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="17" cy="6" r="2.5"/><path d="M8 9c2.5 3.2 4 5.5 4 7.5a4 4 0 0 1-8 0C4 14.5 5.5 12.2 8 9z"/></svg>',
  check: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bigCheck: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bell: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B6E53" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
  flame: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.4 3.6-8.3.4 1.9 1.4 3 2.6 3.6C11.6 7 13 4.5 15 3c-.3 2.8 3.5 5.5 3.5 10.8 0 4.4-2.8 7.2-6.5 7.2z"/></svg>',
  send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/></svg>',
  play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  next: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5.5v13L15 12zM16 5h3v14h-3z"/></svg>',
  prev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 5.5v13L9 12zM5 5h3v14H5z"/></svg>',
  headphones: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/></svg>',
  wave: '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3 12h1M6.5 8v8M10 5v14M13.5 9v6M17 6.5v11M20.5 10.5v3"/></svg>',
  arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

const saved = store.get('settings', {});
let settings = { ...DEFAULT_SETTINGS, ...saved };
if (!saved.lang) settings.lang = (navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
let t = makeT(settings.lang);
let favs = store.get('favs', []);
let readLog = store.get('readLog', {}); // { 'AAAA-MM-JJ': [url, …] }
let edition = null;
let sel = { essentiel: [], fil: [] };
let me = store.get('me', null);            // { token, code, name } : identité pour les amis
let friends = store.get('friends', []);    // [{ code, name }]
let inbox = store.get('inbox', []);        // articles reçus de tes amis
let friendLikes = store.get('friendLikes', []); // articles aimés par tes amis (7 jours)
const likedBy = (url) => friendLikes.find((x) => x.item?.url === url)?.names || [];
const namesText = (names) => (names.length > 2 ? t('liked_many', names[0], names.length - 1) : names.join(t('and')));
let seenShares = store.get('seenShares', []);

const $ = (q) => document.querySelector(q);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = (o) => (o ? o[settings.lang] || o.fr : '');
const catLabel = (c) => L(CATEGORY_LABELS[c] || CATEGORY_LABELS.autre);
const themeLabel = (id) => L(THEMES.find((x) => x.id === id));
const levelOf = (id) => L(LEVELS.find((l) => l.id === id) || LEVELS[1]);
const topicLabel = (id) => (id === 'monde' ? t('topic_world') : catLabel(id));
// Titre et résumé : version d'origine si demandé, sinon dans la langue de l'app
// (repli sur le français pour les anciennes éditions).
const nrm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ').trim();
// Lien vers l'article : traduit par Google Traduction quand il n'est pas dans la langue du lecteur.
function readUrl(item) {
  const url = safeUrl(item.url);
  const from = item.orig_lang;
  if (url === '#' || !from || from === settings.lang) return url;
  if (settings.articleLang === 'original' && (from === 'fr' || from === 'en')) return url; // bilingue : version d'origine
  return `https://translate.google.com/translate?sl=${encodeURIComponent(from)}&tl=${settings.lang}&u=${encodeURIComponent(url)}`;
}
// Langue dans laquelle l'article doit être lu (null = tel quel).
function readFrom(item) {
  const from = item?.orig_lang;
  if (!from || from === settings.lang) return null;
  if (settings.articleLang === 'original' && (from === 'fr' || from === 'en')) return null;
  return from;
}

// Noms du profil (lieux, sujets) traduits dans la langue du lecteur, demandés une fois au serveur.
const PL = (x) => (settings.tr?.[settings.lang]?.[x]) || x; // nom du profil traduit
let labelsPending = false;
async function ensureLabels(names, rerender) {
  const known = settings.tr?.[settings.lang] || {};
  const missing = [...new Set(names.filter(Boolean))].filter((x) => !(x in known));
  if (!missing.length || labelsPending || !WORKER_URL || !navigator.onLine) return;
  labelsPending = true;
  try {
    const res = await fetch(`${PUSH_BASE}/labels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: missing.slice(0, 40), lang: settings.lang }), signal: AbortSignal.timeout(20000) });
    if (!res.ok) return;
    const { labels = {} } = await res.json();
    const lang = settings.lang;
    const map = { ...(settings.tr?.[lang] || {}) };
    for (const x of missing.slice(0, 40)) map[x] = labels[x] || x;
    settings.tr = { ...(settings.tr || {}), [lang]: map };
    store.set('settings', settings);
    rerender?.();
  } catch { /* plus tard */ } finally { labelsPending = false; }
}
const profileNames = (o) => [...(o.places || []), ...['interests', 'keep_informed', 'avoid'].flatMap((k) => (o[k] || []).map((g) => g.label))];

function tx(item, f) {
  // Version originale seulement si elle est en français ou en anglais ; sinon, la traduction.
  const origReadable = !item.orig_lang || item.orig_lang === 'fr' || item.orig_lang === 'en';
  if (settings.articleLang === 'original' && item.orig_title && origReadable) {
    if (f === 'title') return item.orig_title;
    const sum = item.orig_summary || '';
    return nrm(sum).startsWith(nrm(item.orig_title).slice(0, 40)) ? '' : sum; // pas de résumé qui répète le titre
  }
  return (settings.lang === 'en' && item[`${f}_en`]) || item[f];
}

function safeUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; }
}
function ago(iso) {
  if (!iso) return '';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600e3);
  if (h < 1) return t('ago_now');
  if (h < 24) return t('ago_h', h);
  return t('ago_d', Math.round(h / 24));
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
// Articles reçus d'amis, pas encore vus (7 derniers jours) : ils ouvrent le fil.
function sharedForFeed() {
  const week = Date.now() - 7 * 24 * 3600e3;
  return inbox.filter((x) => !seenShares.includes(x.id) && Date.parse(x.at) > week && x.item?.url)
    .map((x) => ({ ...x.item, id: `share-${x.id}`, shareId: x.id, shared: { from: x.from, note: x.note }, tone: 'positive', importance: 10 }));
}
function computeSel() {
  sel = select(edition || { items: [] }, settings);
  const shared = sharedForFeed();
  const urls = new Set(shared.map((i) => i.url));
  sel.fil = [...shared, ...sel.fil.filter((i) => !urls.has(i.url))];
}
function markShareSeen(id) {
  if (!id || seenShares.includes(id)) return;
  seenShares = [...seenShares, id].slice(-300);
  store.set('seenShares', seenShares);
  updateBadge();
}
function saveSettings() {
  store.set('settings', settings);
  syncPushLang(false);
  computeSel();
  renderEssentiel();
  renderFeed();
}
function applyLanguage() {
  t = makeT(settings.lang);
  document.documentElement.lang = settings.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
}

/* ---------- Petites récompenses : coche, vibration, son, série ---------- */
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function markRead(item) {
  const k = dayKey();
  const list = readLog[k] || [];
  if (list.includes(item.url)) return false;
  readLog[k] = [...list, item.url];
  const keep = Object.keys(readLog).sort().slice(-60);
  readLog = Object.fromEntries(keep.map((x) => [x, readLog[x]]));
  store.set('readLog', readLog);
  return true;
}
// Une journée compte quand l'édition est terminée (arrivée au bout du fil).
// Les jours lus avant cette règle comptent aussi, pour ne casser la série de personne.
let doneDays = store.get('doneDays', null);
if (!Array.isArray(doneDays)) {
  doneDays = Object.keys(readLog).filter((k) => k < dayKey() && (readLog[k] || []).length);
  store.set('doneDays', doneDays);
}
const isDone = (k) => doneDays.includes(k);
const dayDoneToday = () => isDone(dayKey());
// Série en jours, avec un jour de pause gratuit par semaine : un seul jour manqué
// (entouré de jours lus) ne casse pas la série, au plus une fois tous les 7 jours.
function streak() {
  const d = new Date();
  if (!isDone(dayKey(d))) d.setDate(d.getDate() - 1); // la journée n'est pas finie
  let n = 0;
  let sinceGrace = 99;
  for (let guard = 0; guard < 1000; guard++) {
    if (isDone(dayKey(d))) { n++; sinceGrace++; }
    else {
      const prev = new Date(d);
      prev.setDate(prev.getDate() - 1);
      if (sinceGrace >= 6 && isDone(dayKey(prev))) sinceGrace = 0; // jour de pause
      else break;
    }
    d.setDate(d.getDate() - 1);
  }
  return n;
}
const MILESTONES = [3, 7, 14, 30, 50, 100, 150, 200, 250, 300, 365];
const isMilestone = (n) => MILESTONES.includes(n) || (n > 365 && n % 100 === 0);
function onDayDone() {
  if (!sel.fil.length || dayDoneToday()) return;
  doneDays = [...doneDays, dayKey()].sort().slice(-500);
  store.set('doneDays', doneDays);
  const n = streak();
  syncProgress({ done: dayKey(), streak: n });
  if (isMilestone(n)) setTimeout(() => celebrate(n), 1500);
}
// Petite fête aux paliers : soleil qui se lève, chiffre qui monte, confettis. Un toucher la ferme.
function celebrate(n) {
  if (document.querySelector('.milestone')) return;
  const el = document.createElement('div');
  el.className = 'milestone';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('ms_title', n));
  const rays = Array.from({ length: 12 }, (_, k) => `<line x1="60" y1="14" x2="60" y2="4" transform="rotate(${k * 30} 60 60)"/>`).join('');
  const bits = Array.from({ length: 18 }, (_, k) => {
    const a = (k / 18) * Math.PI * 2;
    const r = 120 + (k % 3) * 40;
    return `<i style="--x:${Math.round(Math.cos(a) * r)}px;--y:${Math.round(Math.sin(a) * r)}px;--d:${(k % 5) * 40}ms"></i>`;
  }).join('');
  el.innerHTML = `<div class="ms-inner">
      <div class="ms-burst" aria-hidden="true">${bits}</div>
      <svg class="ms-sun" width="150" height="150" viewBox="0 0 120 120" aria-hidden="true">
        <g class="ms-rays" stroke="#F5B83D" stroke-width="5" stroke-linecap="round">${rays}</g>
        <circle cx="60" cy="60" r="34" fill="#F5B83D"/>
      </svg>
      <div class="ms-num" aria-hidden="true">0</div>
      <h2>${esc(t('ms_title', n))}</h2>
      <p>${esc(t('ms_sub', n))}</p>
      <button type="button" class="cta">${esc(t('ms_ok'))}</button>
    </div>`;
  document.body.appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.addEventListener('click', close);
  setTimeout(close, 5000);
  const num = el.querySelector('.ms-num');
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0 - 350) / 700);
    num.textContent = String(Math.max(0, Math.round(n * (1 - (1 - k) ** 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  haptic(3);
  fanfare();
}
const readToday = () => sel.fil.filter((i) => (readLog[dayKey()] || []).includes(i.url)).length;

// Vibration : API standard (Android) ou, sur iPhone, l'interrupteur natif qui produit un retour haptique.
const hapticSwitch = (() => {
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
})();
function haptic(times = 1) {
  if (!settings.haptics) return;
  if (navigator.vibrate) { navigator.vibrate(times > 2 ? [30, 70, 30, 70, 30, 120, 90] : times > 1 ? [20, 60, 20, 60, 40] : 25); return; }
  try { hapticSwitch.click(); } catch { /* non pris en charge */ }
  for (let k = 1; k < times; k++) setTimeout(() => { try { hapticSwitch.click(); } catch { /* */ } }, 140 * k);
}
let audio = null;
function fanfare() { ding(false, [523, 659, 784, 1047, 1319, 1568]); }
function ding(big = false, custom = null) {
  if (!settings.sound) return;
  try {
    if (!audio) {
      // Le petit « ding » respecte le mode silencieux, sauf pendant l'écoute du journal audio.
      if (navigator.audioSession && !player.isActive()) navigator.audioSession.type = 'ambient';
      audio = new (window.AudioContext || window.webkitAudioContext)();
    }
    audio.resume();
    const notes = custom || (big ? [659, 880, 1175, 1568] : [880, 1319]);
    notes.forEach((f, k) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t0 = audio.currentTime + k * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(audio.destination);
      o.start(t0);
      o.stop(t0 + 0.28);
    });
  } catch { /* audio indisponible */ }
}
function popCheck(big = false) {
  const el = document.createElement('div');
  el.className = `reward${big ? ' big' : ''}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="reward-dot">${ICONS.bigCheck}</div><span>${esc(big ? t('all_read') : t('read_ok'))}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), big ? 1600 : 900);
}
const rewarded = new Set();
function reward(idx, withFeedback) {
  const item = sel.fil[idx];
  if (!item || rewarded.has(idx)) return;
  rewarded.add(idx);
  if (item.shareId) markShareSeen(item.shareId);
  if (!markRead(item)) return; // déjà lu plus tôt aujourd'hui : pas de deuxième coche
  const done = sel.fil.length > 0 && sel.fil.every((_, k) => rewarded.has(k) || (readLog[dayKey()] || []).includes(sel.fil[k].url));
  const big = done && idx === sel.fil.length - 1;
  popCheck(big);
  if (done) onDayDone();
  if (withFeedback) { haptic(big ? 2 : 1); ding(big); }
  else if (audio) ding(big);
  const seg = $('#progress').children[idx];
  if (seg) seg.classList.add('read');
  if (curIdx >= sel.fil.length) refreshEndStats();
}

/* ---------- Notifications du matin ---------- */
const PUSH_BASE = WORKER_URL.replace(/\/+$/, '');
const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function pushState() {
  if (!WORKER_URL) return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS && !isStandalone() ? 'install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return store.get('push', false) && Notification.permission === 'granted' ? 'on' : 'available';
}
const keyBytes = (k) => Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((k.length + 3) % 4)), (c) => c.charCodeAt(0));
async function enablePush() {
  const permission = Notification.requestPermission(); // appelé tout de suite : doit suivre le toucher
  const reg = await navigator.serviceWorker.register('sw.js');
  if ((await permission) !== 'granted') throw new Error(t('push_denied'));
  await navigator.serviceWorker.ready;
  const { key } = await (await fetch(`${PUSH_BASE}/push/key`)).json();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const res = await fetch(`${PUSH_BASE}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), lang: settings.lang, test: true, token: me?.token, ...pushPrefs() }),
  });
  if (!res.ok) throw new Error(t('push_error'));
  store.set('push', true);
}
async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await fetch(`${PUSH_BASE}/push/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  store.set('push', false);
}
// Réglages du rappel du soir envoyés au serveur. Les sujets prioritaires n'y sont gardés
// que si le rappel est activé (sans nom, liés à l'abonnement aux notifications).
function pushPrefs() {
  const on = !!settings.eveningOn || !!settings.flashAlert;
  return {
    evening: { on: !!settings.eveningOn, hour: settings.eveningHour || 20 },
    flash: { on: !!settings.flashAlert },
    tz: -new Date().getTimezoneOffset(),
    priorities: on ? priorityGroups(settings).map((g) => ({ label: g.label, keywords: (g.keywords || []).slice(0, 12) })) : [],
  };
}
async function pushSub() {
  if (pushState() !== 'on') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg && (await reg.pushManager.getSubscription());
}
async function syncPushLang(force = true) {
  const sub = await pushSub().catch(() => null);
  if (!sub) return;
  const body = { subscription: sub.toJSON(), lang: settings.lang, token: me?.token, ...pushPrefs() };
  const sig = JSON.stringify([body.lang, body.token, body.evening, body.flash, body.tz, body.priorities]);
  if (!force && store.get('pushSig', '') === sig) return; // rien n'a changé : pas d'appel
  const res = await fetch(`${PUSH_BASE}/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (res?.ok) store.set('pushSig', sig);
}
// Dit au serveur que l'édition du jour est finie (pas de rappel ce soir), ou que l'app a été ouverte.
async function syncProgress(extra) {
  if (!settings.eveningOn) return;
  const sub = await pushSub().catch(() => null);
  if (!sub) return;
  fetch(`${PUSH_BASE}/push/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint, seen: dayKey(), ...extra }) }).catch(() => {});
}
async function togglePush(btn, after) {
  btn.disabled = true;
  try {
    if (pushState() === 'on') { await disablePush(); toast(t('push_off_toast')); }
    else { await enablePush(); toast(t('push_on_toast')); }
  } catch (err) {
    toast(err.message || t('push_error'));
  }
  after();
}
function pushSection() {
  const st = pushState();
  const btn = st === 'on' ? t('push_disable') : st === 'available' ? t('push_enable') : '';
  return `<section>
      <h2>${esc(t('push_title'))}</h2>
      <p class="hint">${esc(t(`push_${st}`))}</p>
      ${btn ? `<button type="button" class="${st === 'on' ? 'outline-btn' : 'cta'}" data-push style="width:100%;margin:0">${esc(btn)}</button>` : ''}
      ${st === 'on' ? `<div class="evening">
        <div class="count-row" style="padding:0;border:0">
          <div><div style="font-weight:700">${esc(t('eve_title'))}</div><div class="small">${esc(t('eve_sub'))}</div></div>
          <button type="button" class="toggle" data-evening aria-pressed="${!!settings.eveningOn}">${esc(settings.eveningOn ? t('eve_on') : t('eve_off'))}</button>
        </div>
        ${settings.eveningOn ? `<div class="seg five" role="group" aria-label="${esc(t('eve_hour'))}">
          ${[18, 19, 20, 21, 22].map((h) => `<button type="button" data-eve-hour="${h}" aria-pressed="${(settings.eveningHour || 20) === h}">${h} h</button>`).join('')}
        </div>
        <p class="desc">${esc(t('eve_desc'))}</p>` : ''}
        <div class="count-row" style="padding:12px 0 0;border:0">
          <div><div style="font-weight:700">${esc(t('fl_alert'))}</div><div class="small">${esc(t('fl_alert_sub'))}</div></div>
          <button type="button" class="toggle" data-flash-alert aria-pressed="${!!settings.flashAlert}">${esc(settings.flashAlert ? t('eve_on') : t('eve_off'))}</button>
        </div>
        ${settings.flashAlert ? `<p class="desc">${esc(t('fl_alert_desc'))}</p>` : ''}
      </div>` : ''}
    </section>`;
}

/* ---------- Navigation ---------- */
function show(tab) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === tab));
  document.querySelectorAll('nav.tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.body.classList.toggle('dark', tab === 'fil');
  document.querySelector('nav.tabs').classList.toggle('hidden', tab === 'profil');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', tab === 'fil' ? '#0F1D19' : '#F6F7F4');
  if (tab === 'reglages') renderSettings();
  if (tab === 'profil') renderProfileForm();
  if (tab === 'favoris') renderFavs();
  if (tab === 'amis') { renderAmis(); refreshInbox(); refreshLikes(); }
  if (tab === 'fil') updateProgress();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
$('#go-fil').addEventListener('click', () => show('fil'));

/* ---------- L'essentiel ---------- */
function chipFor(item) {
  if (item.tone === 'positive') return `<span class="chip good">${esc(t('chip_good'))}</span>`;
  if (item.importance >= 8) return `<span class="chip important">${esc(t('chip_imp'))}</span>`;
  return `<span class="chip world">${esc(catLabel(item.category))}</span>`;
}
function reasonText(item) {
  const f = followedReason(item, settings);
  if (f && !(f.kind === 'topic' && f.name === 'monde')) {
    if (f.kind === 'place') return t('r_place', PL(f.name));
    if (f.kind === 'keep') return t('r_keep', PL(f.name));
    return t('r_topic', topicLabel(f.name));
  }
  return item.importance >= 8 && item.tone !== 'positive' ? t('info_major') : catLabel(item.category);
}
function essCard(item, i, flashLabel = '') {
  const fav = isFav(item.url);
  return `<a class="card${flashLabel ? ' flash-card' : ''}" href="${esc(readUrl(item))}" target="_blank" rel="noopener">
    <div class="chips">${flashLabel ? `<span class="chip flash-chip">⚡ ${esc(flashTime(item))}</span><span class="reason">${esc(flashLabel)}</span>` : `${chipFor(item)}<span class="reason">${esc(reasonText(item))}</span>`}
      <span class="ess-acts">
        <span role="button" tabindex="0" class="ess-act" data-ess-send="${i}" aria-label="${esc(t('a_send'))}">${ICONS.send}</span>
        <span role="button" tabindex="0" class="ess-act${fav ? ' on' : ''}" data-ess-fav="${i}" aria-label="${esc(t('a_save'))}" aria-pressed="${fav}">${ICONS.heart}</span>
      </span>
    </div>
    <h2>${esc(tx(item, 'title'))}</h2>
    ${likedBy(item.url).length ? `<span class="liked">${ICONS.heart}${esc(t('liked_by', namesText(likedBy(item.url))))}</span>` : ''}
    <p>${esc(tx(item, 'summary'))}</p>
    ${readerChip(item)}
  </a>`;
}
/* ---------- Flashs : l'important paru depuis l'édition du matin ---------- */
// Pour tout le monde : les infos majeures (9+). Pour chacun : ses sujets ★ (7+).
// 3 au plus, hors série et hors progression : l'édition reste une édition qui se termine.
let flashData = null;
let flashSel = [];
function computeFlash() {
  flashSel = [];
  if (!flashData || !edition || flashData.since !== edition.generated_at) return;
  const prios = priorityGroups(settings);
  const inEdition = (x) => (edition.items || []).some((e) => e.url === x.url || sameStory(e, x));
  const out = [];
  for (const it of flashData.items || []) {
    if (it.fait_divers || inEdition(it)) continue;
    const p = matchGroups(it, prios)[0];
    const avoided = matchGroups(it, settings.avoid).length > 0;
    if (p && it.importance >= 7) out.push({ item: it, label: t('why_prio', PL(p.label)) });
    else if (it.importance >= 9 && !avoided && (!it.search || matchGroups(it, [...(settings.interests || []), ...(settings.keep_informed || [])]).length)) out.push({ item: it, label: t('info_major') });
  }
  out.sort((a, b) => b.item.importance - a.item.importance || (b.item.flash_at > a.item.flash_at ? 1 : -1));
  flashSel = out.filter((x, k) => !out.slice(0, k).some((y) => sameStory(x.item, y.item))).slice(0, 3);
}
function flashTime(item) {
  const d = new Date(item.published || item.flash_at);
  return isNaN(d) ? t('fl_today') : d.toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });
}
function renderFlash() {
  const el = $('#ess-flash');
  if (!el) return;
  computeFlash();
  el.innerHTML = flashSel.length ? `<h3 class="flash-title">${esc(t('fl_title'))}</h3>
    <div class="list" style="padding:0">${flashSel.map((x, k) => essCard(x.item, `f${k}`, x.label)).join('')}</div>` : '';
}
async function loadFlash() {
  try {
    const res = await fetch(`flash.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const next = await res.json();
    if (next.generated_at === flashData?.generated_at) return;
    flashData = next;
    renderFlash();
  } catch { /* pas de flash */ }
}

function renderEssentiel() {
  if (!edition) return;
  const d = new Date(edition.generated_at);
  const date = d.toLocaleDateString(t('locale'), { weekday: 'long', day: 'numeric', month: 'long' });
  $('#ess-date').textContent = date.charAt(0).toUpperCase() + date.slice(1);
  $('#ess-sub').textContent = t('ess_sub', sel.essentiel.length);
  const ageH = (Date.now() - d.getTime()) / 3600e3;
  $('#ess-later').innerHTML = laterBlock();
  $('#ess-stale').innerHTML = !navigator.onLine ? `<div class="stale offline">${esc(t('offline_banner', date.toLowerCase()))}</div>`
    : ageH > 30 ? `<div class="stale">${esc(t('stale'))}</div>` : '';
  renderFlash();
  $('#ess-list').innerHTML = sel.essentiel.map((it, i) => essCard(it, i)).join('') || `<div class="empty">${esc(t('ess_empty'))}</div>`;
  $('#go-fil').innerHTML = `${esc(t('go_fil', sel.fil.length))} ${ICONS.arrow}`;
  renderListenButton();
}
function renderListenButton() {
  const b = $('#listen-btn');
  if (!b || !edition) return;
  b.classList.remove('hidden');
  b.innerHTML = `${ICONS.headphones}<span>${esc(t('listen_btn'))}</span>`;
  player.summary().then(({ ready, minutes }) => {
    b.innerHTML = `${ICONS.headphones}<span>${esc(ready ? t('listen_btn_min', minutes) : t('listen_btn'))}</span>`;
  }).catch(() => {});
}

/* ---------- Le fil ---------- */
const isFav = (url) => favs.some((f) => f.url === url);
function slide(item, i) {
  const img = item.image
    ? `<img src="${esc(safeUrl(item.image))}" alt="" loading="${i < 2 ? 'eager' : 'lazy'}" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createRange().createContextualFragment(window.__photoIcon))">`
    : ICONS.photo;
  const fav = isFav(item.url);
  return `<article class="slide" data-i="${i}" data-cat="${esc(catLabel(item.category))}">
    <div class="media">${img}</div>
    <div class="slide-body">
      ${item.shared ? `<span class="why">${esc(t('shared_by', item.shared.from))}</span>${item.shared.note ? `<p class="shared-note">« ${esc(item.shared.note)} »</p>` : ''}`
        : item.prio ? `<span class="why prio">${esc(t('why_prio', PL(item.why)))}</span>`
        : item.why ? `<span class="why">${esc(t('why', PL(item.why)))}</span>` : ''}
      <h2>${esc(tx(item, 'title'))}</h2>
      ${likedBy(item.url).length ? `<span class="liked">${ICONS.heart}${esc(t('liked_by', namesText(likedBy(item.url))))}</span>` : ''}
      <p>${esc(tx(item, 'summary'))}</p>
      <p class="meta">${esc(item.source)} · ${esc(ago(item.published))} · <a href="${esc(readUrl(item))}" target="_blank" rel="noopener">${esc(t('read_article'))}</a>${hasArticle(item.url) ? ` · <a href="#" data-reader="${esc(safeUrl(item.url))}">${esc(t('read_here'))}</a>` : ''}</p>
      <div class="actions">
        <button type="button" class="icon-btn${fav ? ' on' : ''}" data-act="fav" data-i="${i}" aria-label="${esc(t('a_save'))}" aria-pressed="${fav}">${ICONS.heart}</button>
        <button type="button" class="icon-btn" data-act="send" data-i="${i}" aria-label="${esc(t('a_send'))}">${ICONS.send}</button>
        <button type="button" class="icon-btn" data-act="share" data-i="${i}" aria-label="${esc(t('a_share'))}">${ICONS.share}</button>
        <button type="button" class="pill-btn" data-act="less" data-i="${i}">${esc(t('a_less'))}</button>
      </div>
    </div>
  </article>`;
}
function endSlide() {
  const n = streak();
  return `<article class="slide end" data-i="end">
    <div class="check">${ICONS.check}</div>
    <h2>${esc(t('end_title'))}</h2>
    <p>${esc(t('end_p'))}</p>
    <div class="stats">
      <div class="stat"><b>${sel.essentiel.length}</b><span>${esc(t('st_ess'))}</span></div>
      <div class="stat"><b style="color:var(--green)">${sel.fil.length}</b><span>${esc(t('st_fil'))}</span></div>
      <div class="stat"><b id="read-count">${readToday()}</b><span>${esc(t('st_read'))}</span></div>
    </div>
    ${n ? `<div class="note streak">${ICONS.flame}<span id="streak-text">${esc(t('streak', n))}<br><small>${esc(t('streak_pause'))}</small></span></div>` : ''}
    <div class="note">${ICONS.bell}<span>${t('next_ed')}</span></div>
    ${pushState() === 'available' ? `<button type="button" class="cta" data-act="push" style="margin:0;width:100%">${esc(t('push_cta'))}</button>` : ''}
    <button type="button" class="outline-btn" data-act="favs">${esc(t('see_favs', favs.length))}</button>
  </article>`;
}
window.__photoIcon = ICONS.photo;

let curIdx = 0;
let enteredAt = Date.now();
function renderFeed() {
  const feed = $('#feed');
  rewarded.clear();
  feed.innerHTML = sel.fil.map(slide).join('') + endSlide();
  feed.scrollTop = 0;
  curIdx = 0;
  enteredAt = Date.now();
  const today = readLog[dayKey()] || [];
  $('#progress').innerHTML = sel.fil.map((i) => `<i${today.includes(i.url) ? ' class="read"' : ''}></i>`).join('');
  updateProgress();
}
function refreshEndStats() {
  const end = $('#feed .slide.end');
  if (end) end.outerHTML = endSlide(); // met à jour lus aujourd'hui + série
}
function updateProgress() {
  const feed = $('#feed');
  const idx = Math.round(feed.scrollTop / Math.max(1, feed.clientHeight));
  const total = sel.fil.length;
  if (idx !== curIdx) {
    // Lecture sans geste tactile (souris, clavier) : coche visuelle, sans vibration.
    if (idx === curIdx + 1 && Date.now() - enteredAt >= 1500) reward(curIdx, false);
    curIdx = idx;
    enteredAt = Date.now();
    if (idx >= total && total > 0) { onDayDone(); refreshEndStats(); }
  }
  const atEnd = idx >= total;
  $('.feed-head').classList.toggle('hidden', atEnd || total === 0);
  if ($('#fil').classList.contains('active')) document.body.classList.toggle('dark', !atEnd);
  $('#progress').querySelectorAll('i').forEach((el, k) => el.classList.toggle('done', k <= idx));
  $('#fil-counter').textContent = total ? `${Math.min(idx + 1, total)} / ${total}` : '';
  const cur = feed.querySelector(`.slide[data-i="${idx}"]`);
  $('#fil-cat').textContent = cur ? cur.dataset.cat : '';
}
const feedEl = $('#feed');
feedEl.addEventListener('scroll', () => requestAnimationFrame(updateProgress), { passive: true });
let touchIdx = 0;
feedEl.addEventListener('touchstart', () => { touchIdx = curIdx; }, { passive: true });
// Le glissement vers la carte suivante est un geste : on peut y déclencher vibration et son.
feedEl.addEventListener('touchend', () => {
  const h = feedEl.clientHeight;
  const forward = feedEl.scrollTop > touchIdx * h + h * 0.12;
  if (forward && touchIdx < sel.fil.length && Date.now() - enteredAt >= 1500) reward(touchIdx, true);
}, { passive: true });

// Ajoute ou retire un favori (fil ou L'essentiel) et met le bouton à jour.
function toggleFav(item, btn) {
  if (isFav(item.url)) favs = favs.filter((f) => f.url !== item.url);
  else favs = [{ ...item, savedAt: new Date().toISOString() }, ...favs].slice(0, 200);
  store.set('favs', favs);
  const on = isFav(item.url);
  if (on) saveArticle(item); // texte complet gardé pour le hors-ligne
  if (settings.shareLikes && me?.token) api('/likes/set', { token: me.token, item: shareable(item), on }).catch(() => {});
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  toast(on ? t('toast_fav_on') : t('toast_fav_off'));
}
// Boutons Enregistrer / Envoyer des cartes de L'essentiel (dans le lien de la carte : on bloque l'ouverture).
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ess-fav],[data-ess-send]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const key = String(b.dataset.essFav ?? b.dataset.essSend);
  const item = key.startsWith('f') ? flashSel[Number(key.slice(1))]?.item : sel.essentiel[Number(key)];
  if (!item) return;
  if (b.dataset.essFav !== undefined) toggleFav(item, b);
  else openSendSheet(item);
}, true);

feedEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const item = sel.fil[Number(btn.dataset.i)];
  const act = btn.dataset.act;
  if (act === 'favs') return show('favoris');
  if (act === 'push') return togglePush(btn, refreshEndStats);
  if (!item) return;
  if (act === 'send') return openSendSheet(item);
  if (act === 'fav') {
    toggleFav(item, btn);
  } else if (act === 'share') {
    const data = { title: tx(item, 'title'), text: tx(item, 'summary'), url: safeUrl(item.url) };
    if (navigator.share) { try { await navigator.share(data); } catch { /* annulé */ } }
    else { try { await navigator.clipboard.writeText(data.url); toast(t('toast_copied')); } catch { toast(data.url); } }
  } else if (act === 'less') {
    const theme = themeOf(item.category);
    settings.themes = settings.themes.filter((x) => x !== theme);
    store.set('settings', settings);
    toast(t('toast_less', themeLabel(theme)));
  }
});

/* ---------- Favoris ---------- */
function renderFavs() {
  $('#fav-list').innerHTML = favs.length
    ? favs.map((f, i) => `<div class="card fav-card">
        <a class="fav-link" href="${esc(readUrl(f))}" target="_blank" rel="noopener">
          <div class="chips"><span class="chip good">${esc(f.category ? catLabel(f.category) : t('fav_tag'))}</span><span class="reason">${esc(f.source)}</span></div>
          <h2>${esc(tx(f, 'title'))}</h2><p>${esc(tx(f, 'summary'))}</p>
        </a>
        <div class="fav-actions">
          ${readerChip(f)}
          <button type="button" class="fav-btn" data-fav-send="${i}">${ICONS.send}<span>${esc(t('a_send'))}</span></button>
          <button type="button" class="fav-btn icon-only" data-fav-share="${i}" aria-label="${esc(t('a_share'))}">${ICONS.share}</button>
          <button type="button" class="fav-btn icon-only" data-fav-remove="${i}" aria-label="${esc(t('toast_fav_off'))}">${ICONS.heart}</button>
        </div>
      </div>`).join('')
    : `<div class="empty">${esc(t('fav_empty'))}</div>`;
}
$('#fav-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.favSend) return openSendSheet(favs[Number(b.dataset.favSend)]);
  if (b.dataset.favShare) {
    const f = favs[Number(b.dataset.favShare)];
    const data = { title: tx(f, 'title'), text: tx(f, 'summary'), url: safeUrl(f.url) };
    if (navigator.share) { try { await navigator.share(data); } catch { /* annulé */ } }
    else { try { await navigator.clipboard.writeText(data.url); toast(t('toast_copied')); } catch { toast(data.url); } }
    return;
  }
  if (b.dataset.favRemove) {
    const removed = favs[Number(b.dataset.favRemove)];
    favs = favs.filter((_, k) => k !== Number(b.dataset.favRemove));
    if (removed && !currentItems().some((i) => i.url === removed.url)) deleteArticles([removed.url]);
    store.set('favs', favs);
    if (removed && settings.shareLikes && me?.token) api('/likes/set', { token: me.token, item: shareable(removed), on: false }).catch(() => {});
    renderFavs();
    renderFeed();
    toast(t('toast_fav_off'));
  }
});

/* ---------- Mon dosage ---------- */
function langSwitch() {
  return `<div class="seg two" role="group" aria-label="${esc(t('lang_title'))}">
    <button type="button" data-lang="fr" aria-pressed="${settings.lang === 'fr'}">Français</button>
    <button type="button" data-lang="en" aria-pressed="${settings.lang === 'en'}">English</button>
  </div>`;
}
function groupTags(key, title) {
  const groups = settings[key] || [];
  if (!groups.length) return '';
  return `<p class="small" style="margin:8px 0 6px;font-weight:700">${esc(title)}</p>
    <div class="tags">${groups.map((g, k) => `<span class="tag${g.priority ? ' prio' : ''}">${key !== 'avoid' ? `<button type="button" class="star" data-prio="${key}:${k}" aria-pressed="${!!g.priority}" aria-label="${esc(t('prio_aria', g.label))}">${g.priority ? '★' : '☆'}</button>` : ''}${esc(PL(g.label))}<button type="button" data-rm-group="${key}:${k}" aria-label="${esc(t('remove', PL(g.label)))}">×</button></span>`).join('')}</div>`;
}
let topicKind = 'keep_informed';
async function addTopic(text) {
  let group = { label: text.slice(0, 40), keywords: [text.toLowerCase()] };
  if (WORKER_URL && navigator.onLine) {
    try {
      const res = await fetch(`${PUSH_BASE}/topic`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: settings.lang }), signal: AbortSignal.timeout(25000) });
      const data = await res.json();
      if (res.ok && data.group) group = data.group;
    } catch { /* hors ligne : on garde le texte comme mot-clé */ }
  }
  const key = topicKind === 'priority' ? 'interests' : topicKind;
  if (topicKind === 'priority') {
    if (priorityGroups(settings).length >= MAX_PRIORITY) toast(t('prio_max', MAX_PRIORITY));
    else group = { ...group, priority: true };
  }
  settings[key] = [...(settings[key] || []).filter((g) => g.label !== group.label), group];
  saveSettings();
  return group;
}
function renderSettings() {
  ensureLabels(profileNames(settings), renderSettings);
  const lvl = levelOf(settings.level);
  $('#settings').innerHTML = `
    <h1>${esc(t('set_title'))}</h1>
    <section>
      <h2>${esc(t('lang_title'))}</h2>
      ${langSwitch()}
      <p class="hint" style="margin:14px 0 8px">${esc(t('art_lang_title'))}</p>
      <div class="seg two" role="group" aria-label="${esc(t('art_lang_title'))}">
        <button type="button" data-artlang="translated" aria-pressed="${settings.articleLang !== 'original'}">${esc(t('art_translated'))}</button>
        <button type="button" data-artlang="original" aria-pressed="${settings.articleLang === 'original'}">${esc(t('art_original'))}</button>
      </div>
      <p class="desc">${esc(settings.articleLang === 'original' ? t('art_original_desc') : t('art_translated_desc'))}</p>
    </section>
    <section class="profile-box">
      <h2>${esc(t('profile'))}</h2>
      <p class="desc" style="margin:0 0 12px">${esc(settings.resume || t('no_profile'))}</p>
      ${(settings.interests || []).length || (settings.keep_informed || []).length ? `<p class="hint" style="margin:0 0 4px">${esc(t('prio_hint'))}</p>` : ''}
      ${groupTags('interests', t('g_interests'))}
      ${groupTags('keep_informed', t('g_keep'))}
      ${groupTags('avoid', t('g_avoid'))}
      <form id="topic-form" class="topic-form">
        <label class="small" for="topic-input" style="font-weight:700">${esc(t('topic_add_title'))}</label>
        <input id="topic-input" maxlength="200" placeholder="${esc(t('topic_add_ph'))}" autocomplete="off">
        <div class="seg four" role="group" aria-label="${esc(t('topic_add_title'))}">
          <button type="button" data-topic-kind="priority" aria-pressed="${topicKind === 'priority'}">${esc(t('topic_kind_prio'))}</button>
          <button type="button" data-topic-kind="interests" aria-pressed="${topicKind === 'interests'}">${esc(t('topic_kind_love'))}</button>
          <button type="button" data-topic-kind="keep_informed" aria-pressed="${topicKind === 'keep_informed'}">${esc(t('topic_kind_keep'))}</button>
          <button type="button" data-topic-kind="avoid" aria-pressed="${topicKind === 'avoid'}">${esc(t('topic_kind_avoid'))}</button>
        </div>
        <button type="submit" class="cta" style="margin:0;width:100%">${esc(t('topic_add_btn'))}</button>
      </form>
      <button type="button" class="outline-btn" data-edit-profile style="width:100%;margin-top:6px">${esc(settings.resume ? t('redo_profile') : t('create_profile'))}</button>
    </section>
    <section>
      <h2>${esc(t('bad_news'))}</h2>
      <div class="seg" role="group" aria-label="${esc(t('bad_news_aria'))}">
        ${LEVELS.map((l) => `<button type="button" data-level="${l.id}" aria-pressed="${l.id === settings.level}">${esc(L(l).label)}</button>`).join('')}
      </div>
      <p class="desc">${esc(lvl.desc)}</p>
    </section>
    <section>
      <h2>${esc(t('g_places'))}</h2>
      <p class="hint">${esc(t('places_hint'))}</p>
      <div class="tags">${settings.places.map((p, k) => `<span class="tag">${esc(PL(p))}<button type="button" data-rm-place="${k}" aria-label="${esc(t('remove', PL(p)))}">×</button></span>`).join('')}</div>
      <form class="add-row" id="add-place">
        <label class="hidden" for="place-input">${esc(t('add_place_label'))}</label>
        <input id="place-input" placeholder="${esc(t('add_place_ph'))}" autocomplete="off">
        <button type="submit">${esc(t('add'))}</button>
      </form>
    </section>
    <section>
      <h2>${esc(t('topics_title'))}</h2>
      <p class="hint">${esc(t('topics_hint'))}</p>
      <div class="tags">${TOPIC_IDS.map((id) => `<button type="button" class="toggle" data-topic="${id}" aria-pressed="${settings.topics.includes(id)}">${esc(topicLabel(id))}</button>`).join('')}</div>
    </section>
    <section>
      <h2>${esc(t('themes_title'))}</h2>
      <div class="grid2">${THEMES.map((x) => `<button type="button" class="toggle" data-theme="${x.id}" aria-pressed="${settings.themes.includes(x.id)}">${esc(L(x))}</button>`).join('')}</div>
    </section>
    <section class="count-row">
      <div><div style="font-weight:700">${esc(t('size_title'))}</div><div class="small">${esc(t('size_sub', settings.count))}</div></div>
      <div class="btns">
        <button type="button" class="round" data-count="-5" aria-label="${esc(t('less_cards'))}">−</button>
        <button type="button" class="round" data-count="5" aria-label="${esc(t('more_cards'))}">+</button>
      </div>
    </section>
    ${pushSection()}
    ${offlineSection()}
    <section>
      <h2>${esc(t('fx_title'))}</h2>
      <p class="hint">${esc(t('fx_hint'))}</p>
      <div class="tags">
        <button type="button" class="toggle" data-fx="sound" aria-pressed="${settings.sound}">${esc(t('sound'))}</button>
        <button type="button" class="toggle" data-fx="haptics" aria-pressed="${settings.haptics}">${esc(t('haptics'))}</button>
      </div>
    </section>
    <p class="small">${edition ? esc(t('generated', ago(edition.generated_at), edition.count)) : ''}</p>`;
}
function setLanguage(lang) {
  settings.lang = lang;
  player.reset();
  applyLanguage();
  saveSettings();
  syncPushLang();
}
$('#settings').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-edit-profile')) return show('profil');
  if (b.dataset.topicKind) { topicKind = b.dataset.topicKind; document.querySelectorAll('[data-topic-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); return; }
  if (b.hasAttribute('data-push')) return togglePush(b, renderSettings);
  if (b.hasAttribute('data-flash-alert')) {
    settings.flashAlert = !settings.flashAlert;
    if (settings.flashAlert && !priorityGroups(settings).length) toast(t('eve_no_prio'));
    saveSettings();
    return renderSettings();
  }
  if (b.hasAttribute('data-evening')) {
    settings.eveningOn = !settings.eveningOn;
    if (settings.eveningOn && !priorityGroups(settings).length) toast(t('eve_no_prio'));
    saveSettings();
    if (settings.eveningOn && dayDoneToday()) syncProgress({ done: dayKey(), streak: streak() });
    return renderSettings();
  }
  if (b.dataset.eveHour) { settings.eveningHour = Number(b.dataset.eveHour); saveSettings(); return renderSettings(); }
  if (b.dataset.prio) {
    const [key, k] = b.dataset.prio.split(':');
    const g = settings[key][Number(k)];
    if (!g.priority && priorityGroups(settings).length >= MAX_PRIORITY) return toast(t('prio_max', MAX_PRIORITY));
    settings[key] = settings[key].map((x, idx) => (idx === Number(k) ? { ...x, priority: !x.priority } : x));
    if (!g.priority) toast(t('prio_on', g.label));
    saveSettings();
    return renderSettings();
  }
  if (b.hasAttribute('data-offline')) return downloadAll(b);
  if (b.hasAttribute('data-offline-clear')) {
    if (!confirm(t('offline_clear_confirm'))) return;
    return deleteArticles([...artIndex]).then(() => { toast(t('offline_cleared')); renderSettings(); renderEssentiel(); renderFeed(); });
  }
  if (b.dataset.lang) setLanguage(b.dataset.lang);
  else if (b.dataset.artlang) settings.articleLang = b.dataset.artlang;
  else if (b.dataset.fx) {
    settings[b.dataset.fx] = !settings[b.dataset.fx];
    store.set('settings', settings);
    if (settings[b.dataset.fx]) { if (b.dataset.fx === 'sound') ding(); else haptic(); }
    return renderSettings();
  } else if (b.dataset.rmGroup) {
    const [key, k] = b.dataset.rmGroup.split(':');
    settings[key] = settings[key].filter((_, idx) => idx !== Number(k));
  } else if (b.dataset.level) settings.level = b.dataset.level;
  else if (b.dataset.rmPlace) settings.places = settings.places.filter((_, k) => k !== Number(b.dataset.rmPlace));
  else if (b.dataset.topic) {
    const x = b.dataset.topic;
    settings.topics = settings.topics.includes(x) ? settings.topics.filter((y) => y !== x) : [...settings.topics, x];
  } else if (b.dataset.theme) {
    const x = b.dataset.theme;
    settings.themes = settings.themes.includes(x) ? settings.themes.filter((y) => y !== x) : [...settings.themes, x];
  } else if (b.dataset.count) settings.count = Math.min(50, Math.max(5, settings.count + Number(b.dataset.count)));
  else return;
  saveSettings();
  renderSettings();
});
$('#settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'topic-form') {
    const v = $('#topic-input').value.trim();
    if (v.length < 3) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = t('topic_adding');
    const g = await addTopic(v);
    toast(t('topic_added', g.label));
    return renderSettings();
  }
  const v = $('#place-input').value.trim();
  if (v && !settings.places.includes(v)) { settings.places = [...settings.places, v]; saveSettings(); }
  renderSettings();
});

/* ---------- Parle-moi de toi ---------- */
let draft = null; // profil proposé par l'IA, en attente de validation

function renderProfileForm(error = '') {
  const first = !store.get('onboarded', false);
  const typed = $('#profile-text') ? $('#profile-text').value : settings.profileText;
  $('#profil-body').innerHTML = `
    <div class="lang-top">${langSwitch()}</div>
    <h1>${esc(t('pf_title'))}</h1>
    <p class="sub" style="margin-top:8px">${esc(t('pf_sub'))}</p>
    <label class="hidden" for="profile-text">${esc(t('pf_label'))}</label>
    <textarea id="profile-text" maxlength="2000" placeholder="${esc(t('pf_ph'))}">${esc(typed)}</textarea>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <button type="button" class="cta" id="profile-go" style="margin:16px 0 0;width:100%">${esc(t('pf_go'))}</button>
    <p class="small" style="margin-top:12px;line-height:1.5">${esc(t('pf_privacy'))}</p>
    <button type="button" class="link-btn" id="profile-skip">${esc(first ? t('pf_skip') : t('pf_cancel'))}</button>`;
  if (!WORKER_URL) {
    $('#profile-go').disabled = true;
    $('#profile-go').textContent = t('pf_soon');
  }
}

function renderDraft() {
  ensureLabels(profileNames(draft), () => { if (draft) renderDraft(); });
  const g = (key, title) => (draft[key] || []).length
    ? `<p class="small" style="margin:14px 0 6px;font-weight:700">${esc(title)}</p><div class="tags">${draft[key].map((x, k) => `<span class="tag">${esc(PL(x.label ?? x))}<button type="button" data-rm-draft="${key}:${k}" aria-label="${esc(t('remove', PL(x.label ?? x)))}">×</button></span>`).join('')}</div>`
    : '';
  const lvl = levelOf(draft.level);
  $('#profil-body').innerHTML = `
    <h1>${esc(t('draft_title'))}</h1>
    <p class="sub" style="margin-top:8px">${esc(draft.resume)}</p>
    ${g('interests', t('g_interests'))}
    ${g('places', t('g_places'))}
    ${g('keep_informed', t('g_keep'))}
    ${g('avoid', t('g_avoid'))}
    <p class="small" style="margin:14px 0 0"><b>${esc(t('draft_bad'))}</b> ${esc(lvl.label)}. ${esc(lvl.desc)}</p>
    <button type="button" class="cta" id="draft-ok" style="margin:20px 0 0;width:100%">${esc(t('draft_ok'))}</button>
    <button type="button" class="link-btn" id="draft-redo">${esc(t('draft_redo'))}</button>`;
}

$('#profil-body').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.lang) {
    settings.lang = b.dataset.lang;
    applyLanguage();
    store.set('settings', settings);
    if (edition) { renderEssentiel(); renderFeed(); }
    return renderProfileForm();
  }
  if (b.id === 'profile-skip') {
    store.set('onboarded', true);
    return show('essentiel');
  }
  if (b.id === 'profile-go') {
    const text = $('#profile-text').value.trim();
    if (text.length < 10) return renderProfileForm(t('pf_short'));
    settings.profileText = text;
    b.disabled = true;
    b.textContent = t('pf_loading');
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: settings.lang }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.profile) throw new Error(data.error || `Erreur ${res.status}`);
      draft = data.profile;
      renderDraft();
    } catch (err) {
      renderProfileForm(err.name === 'TimeoutError' ? t('pf_timeout') : err.message || t('pf_unreach'));
    }
    return;
  }
  if (b.dataset.rmDraft) {
    const [key, k] = b.dataset.rmDraft.split(':');
    draft[key] = draft[key].filter((_, idx) => idx !== Number(k));
    return renderDraft();
  }
  if (b.id === 'draft-redo') return renderProfileForm();
  if (b.id === 'draft-ok') {
    settings = {
      ...settings,
      interests: draft.interests,
      places: draft.places,
      keep_informed: draft.keep_informed,
      avoid: draft.avoid,
      // Tous les thèmes restent ouverts : les centres d'intérêt font remonter ce qui compte,
      // et chacun peut fermer un thème dans Mon dosage.
      themes: THEMES.map((x) => x.id),
      topics: [...new Set(['monde', ...(draft.topics || [])])],
      level: draft.level,
      resume: draft.resume,
    };
    store.set('onboarded', true);
    draft = null;
    saveSettings();
    show('essentiel');
    toast(t('profile_saved'));
  }
});

/* ---------- Amis et partage ---------- */
async function api(path, body) {
  const res = await fetch(`${PUSH_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { me = null; store.set('me', null); }
  if (!res.ok) { const e = new Error(data.error || String(res.status)); e.code = data.error; throw e; }
  return data;
}
const inviteUrl = () => `${location.origin}${location.pathname}#ami=${me.code.replace('-', '')}`;
function updateBadge() {
  const n = inbox.filter((x) => !seenShares.includes(x.id)).length;
  const b = $('#amis-badge');
  if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
}
async function refreshInbox() {
  if (!me || !WORKER_URL) return;
  try {
    const [box, fl] = await Promise.all([api('/inbox', { token: me.token }), api('/friends/list', { token: me.token })]);
    const before = inbox.map((x) => x.id).join();
    inbox = box.items || [];
    friends = fl.friends || [];
    store.set('inbox', inbox);
    store.set('friends', friends);
    updateBadge();
    if (inbox.map((x) => x.id).join() !== before && edition) { computeSel(); renderEssentiel(); if (!$('#fil').classList.contains('active')) renderFeed(); }
    if ($('#amis').classList.contains('active')) renderAmis();
  } catch { /* hors ligne : on garde le cache */ }
}
async function addFriend(code) {
  try {
    const { friend } = await api('/friends/add', { token: me.token, code });
    if (!friends.some((f) => f.code === friend.code)) friends = [...friends, friend];
    store.set('friends', friends);
    toast(t('friend_added', friend.name));
    return true;
  } catch (e) {
    toast(e.code === 'self' ? t('friend_self') : e.code === 'code' ? t('friend_unknown') : t('friends_error'));
    return false;
  }
}
// Ce qu'on envoie au serveur d'un article (pas les champs internes de l'app).
const shareable = (i) => ({ title: i.title, summary: i.summary, title_en: i.title_en, summary_en: i.summary_en, orig_title: i.orig_title, orig_summary: i.orig_summary, orig_lang: i.orig_lang, url: i.url, image: i.image, source: i.source, category: i.category, published: i.published });
async function refreshLikes() {
  if (!me || !WORKER_URL) return;
  try {
    const { items } = await api('/friends/likes', { token: me.token });
    const changed = JSON.stringify(items) !== JSON.stringify(friendLikes);
    friendLikes = items || [];
    store.set('friendLikes', friendLikes);
    if (!changed) return;
    if ($('#amis').classList.contains('active')) renderAmis();
    else if (edition) { renderEssentiel(); if (!$('#fil').classList.contains('active')) renderFeed(); }
  } catch { /* hors ligne */ }
}
async function setShareLikes(on) {
  settings.shareLikes = on;
  saveSettings();
  try {
    if (on) {
      const week = Date.now() - 7 * 864e5;
      const items = favs.filter((f) => Date.parse(f.savedAt) > week).slice(0, 30).map((f) => ({ item: shareable(f), at: f.savedAt }));
      await api('/likes/sync', { token: me.token, items });
      toast(t('likes_on'));
    } else {
      await api('/likes/clear', { token: me.token });
      toast(t('likes_off'));
    }
  } catch { toast(t('friends_error')); }
}
function likedCard(x) {
  const it = x.item || {};
  return `<a class="card" href="${esc(readUrl(it))}" target="_blank" rel="noopener">
    <div class="chips"><span class="chip liked-chip">${ICONS.heart}${esc(t('liked_by', namesText(x.names)))}</span><span class="reason">${esc(ago(x.at))}</span></div>
    <h2>${esc(tx(it, 'title'))}</h2><p>${esc(tx(it, 'summary') || '')}</p>
  </a>`;
}
function sharedCard(x) {
  const it = x.item || {};
  return `<a class="card${seenShares.includes(x.id) ? '' : ' unread'}" href="${esc(readUrl(it))}" target="_blank" rel="noopener" data-share="${esc(x.id)}">
    <div class="chips"><span class="chip good">${esc(t('from_friend', x.from))}</span><span class="reason">${esc(ago(x.at))}</span></div>
    ${x.note ? `<p class="shared-note dark">« ${esc(x.note)} »</p>` : ''}
    <h2>${esc(tx(it, 'title'))}</h2><p>${esc(tx(it, 'summary') || '')}</p>
  </a>`;
}
function renderAmis() {
  const box = $('#amis-body');
  if (!WORKER_URL) { box.innerHTML = `<h1>${esc(t('amis_title'))}</h1><div class="empty">${esc(t('pf_soon'))}</div>`; return; }
  if (!me) {
    box.innerHTML = `
      <h1>${esc(t('amis_title'))}</h1>
      <p class="sub" style="margin:8px 0 18px">${esc(t('amis_intro'))}</p>
      <form id="me-form" class="add-row" style="margin:0">
        <label class="hidden" for="me-name">${esc(t('your_name'))}</label>
        <input id="me-name" maxlength="30" placeholder="${esc(t('your_name'))}" autocomplete="given-name" value="${esc(store.get('pendingName', ''))}">
        <button type="submit">${esc(t('start'))}</button>
      </form>
      <p class="small" style="margin-top:12px;line-height:1.5">${esc(t('amis_privacy'))}</p>`;
    return;
  }
  const shared = inbox;
  box.innerHTML = `
    <h1>${esc(t('amis_title'))}</h1>
    <section class="profile-box" style="margin-top:14px">
      <p class="small" style="margin:0 0 4px">${esc(t('your_code'))}</p>
      <div class="code-row"><b class="friend-code">${esc(me.code)}</b><span class="small">${esc(me.name)}</span></div>
      <div class="tags" style="margin-top:12px">
        <button type="button" class="toggle" data-invite aria-pressed="true">${esc(t('invite'))}</button>
        <button type="button" class="toggle" data-copy>${esc(t('copy_code'))}</button>
      </div>
    </section>
    <section style="margin-top:20px">
      <h2>${esc(t('my_friends'))}</h2>
      <div class="tags">${friends.map((f) => `<span class="tag">${esc(f.name)}<button type="button" data-unfriend="${esc(f.code)}" aria-label="${esc(t('remove', f.name))}">×</button></span>`).join('') || `<p class="small" style="margin:0">${esc(t('no_friends'))}</p>`}</div>
      <form class="add-row" id="friend-form">
        <label class="hidden" for="friend-code">${esc(t('friend_code_label'))}</label>
        <input id="friend-code" maxlength="8" placeholder="${esc(t('friend_code_ph'))}" autocomplete="off" autocapitalize="characters">
        <button type="submit">${esc(t('add'))}</button>
      </form>
    </section>
    <section style="margin-top:22px" id="likes">
      <h2>${esc(t('liked_title'))}</h2>
      <div class="list" style="padding:0">${friendLikes.map(likedCard).join('') || `<div class="empty" style="margin:0">${esc(t('liked_empty'))}</div>`}</div>
      <div class="count-row" style="padding:12px 0 0;border:0">
        <div><div style="font-weight:700">${esc(t('likes_share'))}</div><div class="small">${esc(t('likes_share_sub'))}</div></div>
        <button type="button" class="toggle" data-share-likes aria-pressed="${!!settings.shareLikes}">${esc(settings.shareLikes ? t('eve_on') : t('eve_off'))}</button>
      </div>
    </section>
    <section style="margin-top:22px" id="recus">
      <h2>${esc(t('received'))}</h2>
      <div class="list" style="padding:0">${shared.map(sharedCard).join('') || `<div class="empty" style="margin:0">${esc(t('no_received'))}</div>`}</div>
    </section>`;
}
$('#amis-body').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'me-form') {
    const name = $('#me-name').value.trim();
    if (!name) return;
    try {
      const r = await api('/me/register', { name, lang: settings.lang });
      me = { token: r.token, code: r.code, name: r.name };
      store.set('me', me);
      syncPushLang(); // relie les notifications à ce profil d'ami
      const pending = store.get('pendingFriend', '');
      if (pending) { store.set('pendingFriend', ''); await addFriend(pending); }
    } catch { toast(t('friends_error')); }
    renderAmis();
  } else if (e.target.id === 'friend-form') {
    const code = $('#friend-code').value.trim();
    if (code && (await addFriend(code))) renderAmis();
  }
});
$('#amis-body').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-share]');
  if (card) markShareSeen(card.dataset.share);
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-share-likes')) { await setShareLikes(!settings.shareLikes); return renderAmis(); }
  if (b.hasAttribute('data-invite')) {
    const text = t('invite_text', me.code);
    if (navigator.share) { try { await navigator.share({ title: 'Clair', text, url: inviteUrl() }); } catch { /* annulé */ } }
    else { try { await navigator.clipboard.writeText(`${text} ${inviteUrl()}`); toast(t('toast_copied')); } catch { toast(inviteUrl()); } }
  } else if (b.hasAttribute('data-copy')) {
    try { await navigator.clipboard.writeText(me.code); toast(t('code_copied')); } catch { toast(me.code); }
  } else if (b.dataset.unfriend) {
    const f = friends.find((x) => x.code === b.dataset.unfriend);
    if (!f || !confirm(t('unfriend_confirm', f.name))) return;
    try { await api('/friends/remove', { token: me.token, code: f.code }); } catch { /* */ }
    friends = friends.filter((x) => x.code !== f.code);
    store.set('friends', friends);
    renderAmis();
  }
});

// Feuille « Envoyer à un ami »
let sending = null;
function openSendSheet(item) {
  sending = item;
  const sheet = $('#sheet');
  const ready = me && friends.length;
  $('#sheet-body').innerHTML = ready ? `
    <h2>${esc(t('send_title'))}</h2>
    <p class="small" style="margin:0 0 12px">${esc(tx(item, 'title'))}</p>
    <div class="tags">${friends.map((f, k) => `<button type="button" class="toggle" data-pick="${k}" aria-pressed="${friends.length === 1}">${esc(f.name)}</button>`).join('')}</div>
    <label class="hidden" for="send-note">${esc(t('send_note_ph'))}</label>
    <textarea id="send-note" maxlength="280" placeholder="${esc(t('send_note_ph'))}"></textarea>
    <button type="button" class="cta" data-send style="margin:14px 0 0;width:100%">${esc(t('send_btn'))}</button>
    <button type="button" class="link-btn" data-close>${esc(t('pf_cancel'))}</button>` : `
    <h2>${esc(t('send_title'))}</h2>
    <p class="desc" style="margin:0 0 16px">${esc(me ? t('send_no_friends') : t('send_no_me'))}</p>
    <button type="button" class="cta" data-goamis style="margin:0;width:100%">${esc(t('go_amis'))}</button>
    <button type="button" class="link-btn" data-close>${esc(t('pf_cancel'))}</button>`;
  sheet.classList.remove('hidden');
}
function closeSheet() { $('#sheet').classList.add('hidden'); sending = null; }
$('#sheet').addEventListener('click', async (e) => {
  if (e.target.id === 'sheet') return closeSheet();
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-close')) return closeSheet();
  if (b.hasAttribute('data-goamis')) { closeSheet(); return show('amis'); }
  if (b.dataset.pick) return b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
  if (b.hasAttribute('data-send')) {
    const to = [...document.querySelectorAll('#sheet [data-pick][aria-pressed="true"]')].map((x) => friends[Number(x.dataset.pick)]);
    if (!to.length) return toast(t('send_pick'));
    b.disabled = true;
    const { shared, why, score, group, id, shareId, ...item } = sending;
    try {
      await api('/share', { token: me.token, to: to.map((f) => f.code), item, note: $('#send-note').value.trim() });
      toast(t('sent_to', to.map((f) => f.name).join(', ')));
      haptic(); ding();
      closeSheet();
    } catch { b.disabled = false; toast(t('friends_error')); }
  }
});

// Lien d'invitation (#ami=CODE) et ouverture depuis une notification de partage (#recus)
function handleHash() {
  const m = location.hash.match(/ami=([A-Za-z0-9-]{6,7})/);
  if (m) {
    history.replaceState(null, '', location.pathname);
    if (me) addFriend(m[1]).then(() => renderAmis());
    else store.set('pendingFriend', m[1]);
    show('amis');
  } else if (location.hash === '#recus') {
    history.replaceState(null, '', location.pathname);
    show('amis');
  }
}
window.addEventListener('hashchange', handleHash);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshInbox(); });

/* ---------- Hors ligne ---------- */
let offlineInfo = store.get('offline', null); // { edition: generated_at, ok, total }
function precacheEdition(manual = false) {
  if (!('serviceWorker' in navigator) || !edition) return;
  const urls = [...sel.essentiel, ...sel.fil, ...favs].map((i) => i.image).filter(Boolean).map(safeUrl).filter((u) => u !== '#');
  navigator.serviceWorker.ready.then((reg) => {
    if (!reg.active) return;
    precacheManual = manual;
    reg.active.postMessage({ type: 'precache', urls });
  }).catch(() => {});
}
let precacheManual = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'precached' || !edition) return;
    offlineInfo = { edition: edition.generated_at, ok: e.data.ok, total: e.data.total };
    store.set('offline', offlineInfo);
    if (precacheManual) { toast(t('offline_ready_toast', sel.essentiel.length + sel.fil.length)); precacheManual = false; }
    if ($('#reglages').classList.contains('active')) renderSettings();
  });
}
function offlineSection() {
  const ready = offlineInfo && edition && offlineInfo.edition === edition.generated_at;
  const all = currentItems();
  const n = all.filter((i) => hasArticle(i.url)).length;
  return `<section>
      <h2>${esc(t('offline_title'))}</h2>
      <p class="hint">${esc(ready ? t('offline_ready', sel.essentiel.length + sel.fil.length) : t('offline_hint'))}</p>
      <p class="hint">${esc(t('offline_articles', n, all.length))}</p>
      <button type="button" class="${n < all.length ? 'cta' : 'outline-btn'}" data-offline style="width:100%;margin:0">${esc(t('offline_btn'))}</button>
      ${artIndex.length ? `<button type="button" class="link-btn" data-offline-clear style="margin:6px 0 0">${esc(t('offline_clear', artIndex.length))}</button>` : ''}
      <p class="small" style="margin-top:10px;line-height:1.5">${esc(t('offline_tip'))}</p>
    </section>`;
}

/* ---------- Articles complets, lisibles hors ligne ---------- */
// v2 : les articles dans une autre langue que celle du lecteur sont désormais gardés traduits.
const ART_CACHE = 'clair-articles-v2';
if (store.get('artCacheV', '') !== ART_CACHE) {
  store.set('artIndex', []);
  store.set('artCacheV', ART_CACHE);
  try { caches.delete('clair-articles-v1'); } catch { /* */ }
}
const artKey = (url) => `https://clair.invalid/article?u=${encodeURIComponent(url)}`;
let artIndex = store.get('artIndex', []);   // adresses des articles gardés, du plus récent au plus ancien
let artFailed = new Set();                  // indisponibles (pour ne pas réessayer en boucle)
function hasArticle(url) { return artIndex.includes(url); }
function currentItems() {
  const seen = new Set();
  return [...sel.essentiel, ...sel.fil, ...favs].filter((i) => i.url && !seen.has(i.url) && seen.add(i.url));
}
async function saveArticle(item) {
  if (!item?.url || hasArticle(item.url)) return true;
  if (!WORKER_URL || !('caches' in window) || artFailed.has(item.url)) return false;
  try {
    const res = await fetch(`${PUSH_BASE}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: item.url, lang: settings.lang, from: readFrom(item) }), signal: AbortSignal.timeout(40000) });
    if (!res.ok) { if (res.status === 422 || res.status === 403) artFailed.add(item.url); return false; }
    const data = await res.json();
    if (!Array.isArray(data.blocks) || !data.blocks.length) return false;
    const cache = await caches.open(ART_CACHE);
    await cache.put(artKey(item.url), new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    artIndex = [item.url, ...artIndex.filter((u) => u !== item.url)];
    const keep = new Set(favs.map((f) => f.url));
    while (artIndex.length > 150) {
      const k = artIndex.findLastIndex((u) => !keep.has(u));
      if (k < 0) break;
      await cache.delete(artKey(artIndex[k]));
      artIndex.splice(k, 1);
    }
    store.set('artIndex', artIndex);
    return true;
  } catch { return false; }
}
async function deleteArticles(urls) {
  if (!urls.length) return;
  try {
    const cache = await caches.open(ART_CACHE);
    for (const u of urls) await cache.delete(artKey(u));
  } catch { /* stockage indisponible */ }
  const gone = new Set(urls);
  artIndex = artIndex.filter((u) => !gone.has(u));
  store.set('artIndex', artIndex);
}
// Ménage automatique : les articles d'anciennes éditions qui ne sont pas en favoris sont effacés.
function pruneArticles() {
  if (!edition) return;
  const keep = new Set(currentItems().map((i) => i.url));
  deleteArticles(artIndex.filter((u) => !keep.has(u)));
}
// Télécharge le texte complet de toute l'édition et des favoris (3 à la fois).
async function downloadArticles(onProgress) {
  const todo = currentItems().filter((i) => !hasArticle(i.url));
  let done = 0;
  const next = async () => {
    const item = todo.shift();
    if (!item) return;
    await saveArticle(item);
    onProgress(++done, done + todo.length);
    return next();
  };
  await Promise.all([next(), next(), next()]);
}
async function downloadAll(btn) {
  if (!navigator.onLine) return toast(t('offline_need_net'));
  btn.disabled = true;
  btn.textContent = t('offline_working');
  precacheEdition(false);
  const total = currentItems().length;
  await downloadArticles((a, b) => { btn.textContent = t('offline_progress', a, b); });
  const n = currentItems().filter((i) => hasArticle(i.url)).length;
  toast(t('offline_done', n, total));
  renderSettings();
  renderEssentiel();
  renderFeed();
}
function readerChip(item) {
  return hasArticle(item.url) ? `<span class="chip offline-chip" role="button" data-reader="${esc(safeUrl(item.url))}">${esc(t('read_here'))}</span>` : '';
}
async function openReader(url) {
  const item = findItem(url) || { url };
  let data = null;
  try { const hit = await (await caches.open(ART_CACHE)).match(artKey(item.url)); data = hit && (await hit.json()); } catch { /* */ }
  if (!data) return false;
  const source = item.source || new URL(item.url).hostname.replace(/^www\./, '');
  $('#reader-body').innerHTML = `
    <button type="button" class="link-btn reader-back" data-reader-close>‹ ${esc(t('reader_back'))}</button>
    <p class="small" style="margin:8px 0 6px;font-weight:700;color:var(--green)">${esc(source)}</p>
    <h1>${esc(data.title || tx(item, 'title') || '')}</h1>
    ${data.partial ? `<p class="stale" style="margin:14px 0 0">${esc(t('reader_partial'))}</p>` : ''}
    <div class="reader-text">${data.blocks.map((b) => (b.t === 'h' ? `<h2>${esc(b.text)}</h2>` : `<p>${esc(b.text)}</p>`)).join('')}</div>
    <a class="outline-btn reader-orig" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener">${esc(t('reader_original', source))}</a>
    <button type="button" class="link-btn" data-reader-delete="${esc(item.url)}" style="margin-top:10px">${esc(t('reader_delete'))}</button>`;
  const r = $('#reader');
  r.classList.remove('hidden');
  r.scrollTop = 0;
  return true;
}
$('#reader').addEventListener('click', (e) => {
  if (e.target.closest('[data-reader-close]')) $('#reader').classList.add('hidden');
  const del = e.target.closest('[data-reader-delete]');
  if (del) {
    deleteArticles([del.dataset.readerDelete]).then(() => {
      $('#reader').classList.add('hidden');
      toast(t('reader_deleted'));
      renderEssentiel(); renderFeed();
      if ($('#favoris').classList.contains('active')) renderFavs();
    });
  }
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-reader]');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  openReader(el.dataset.reader);
}, true);

// Hors ligne, un article complet ne peut pas s'ouvrir : on le met de côté
// et on le propose dès que le réseau revient.
let later = store.get('later', []);
function findItem(url) {
  return [...sel.essentiel, ...sel.fil, ...favs, ...inbox.map((x) => x.item || {})].find((i) => i && safeUrl(i.url) === url);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[target="_blank"]');
  if (!a) return;
  if (e.target.closest('[data-reader]')) return;
  if (!navigator.onLine) {
    e.preventDefault();
    if (hasArticle(a.href) || artIndex.some((u) => safeUrl(u) === a.href)) { openReader(artIndex.find((u) => safeUrl(u) === a.href)); return; }
    if (a.closest('#reader')) { toast(t('offline_need_net')); return; }
    const it = findItem(a.href);
    if (it && !later.some((x) => x.url === it.url)) {
      const { shared, why, score, group, ...keep } = it;
      later = [keep, ...later].slice(0, 30);
      store.set('later', later);
    }
    toast(t('offline_saved_later'));
  } else if (a.dataset.later) {
    later = later.filter((x) => safeUrl(x.url) !== a.href);
    store.set('later', later);
    setTimeout(renderEssentiel, 300);
  }
}, true);
function laterBlock() {
  if (!navigator.onLine || !later.length) return '';
  return `<section class="later">
    <h2>${esc(t('later_title', later.length))}</h2>
    ${later.map((i) => `<a class="later-item" data-later="1" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener"><b>${esc(tx(i, 'title'))}</b><span>${esc(i.source || '')}</span></a>`).join('')}
    <button type="button" class="link-btn" id="later-clear" style="margin:4px 0 0">${esc(t('later_clear'))}</button>
  </section>`;
}
document.addEventListener('click', (e) => {
  if (e.target.id !== 'later-clear') return;
  later = [];
  store.set('later', later);
  renderEssentiel();
});
window.addEventListener('online', () => { renderEssentiel(); refreshInbox(); });
window.addEventListener('offline', renderEssentiel);

/* ---------- Écouter (journal audio) ---------- */
async function getArticle(item) {
  const read = async () => {
    try { const hit = await (await caches.open(ART_CACHE)).match(artKey(item.url)); return hit ? hit.json() : null; } catch { return null; }
  };
  return (await read()) || (navigator.onLine && (await saveArticle(item)) ? read() : null);
}
const player = initPlayer({
  $, esc, t: (...a) => t(...a), tx, catLabel, safeUrl, toast, ICONS,
  relay: PUSH_BASE,
  settings: () => settings,
  selection: () => sel,
  getArticle,
  markRead: (item) => {
    if (item.shareId) markShareSeen(item.shareId);
    if (markRead(item)) { const k = sel.fil.indexOf(item); const seg = $('#progress').children[k]; if (seg) seg.classList.add('read'); }
  },
  toggleFull: () => { settings.audioFull = settings.audioFull === false; store.set('settings', settings); },
  onFinished: () => { haptic(2); onDayDone(); }, // écouter tout le journal compte aussi pour la série
});
$('#listen-btn').addEventListener('click', () => { if (player.isActive()) player.toggle(); else player.start(); });

/* ---------- Démarrage ---------- */
async function load() {
  try {
    const res = await fetch(`edition.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    edition = await res.json();
    computeSel();
    renderEssentiel();
    renderFeed();
    loadFlash();
    setTimeout(() => precacheEdition(false), 1500); // garde les photos du jour pour le hors-ligne
    setTimeout(pruneArticles, 2000);
    setTimeout(() => player.precache(), 4000); // résumés audio du jour, pour l'écoute hors ligne
    setTimeout(() => { if (navigator.onLine) favs.slice(0, 30).reduce((p, f) => p.then(() => saveArticle(f)), Promise.resolve()); }, 3000);
  } catch {
    $('#ess-sub').textContent = t('no_edition');
    $('#ess-list').innerHTML = `<div class="empty">${esc(t('no_edition_p'))}</div>`;
    $('#go-fil').classList.add('hidden');
  }
}
// Nouvelle édition sortie pendant que l'app était ouverte (ou en arrière-plan) : bandeau pour l'afficher.
let lastEditionCheck = 0;
async function checkNewEdition() {
  if (!edition || !navigator.onLine || document.visibilityState !== 'visible') return;
  if (Date.now() - lastEditionCheck < 60e3) return;
  lastEditionCheck = Date.now();
  loadFlash();
  try {
    const res = await fetch(`edition.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const next = await res.json();
    if (!next.generated_at || next.generated_at === edition.generated_at || document.querySelector('.new-edition')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'new-edition';
    b.innerHTML = `☀️ ${esc(t('new_edition'))} <strong>${esc(t('new_edition_btn'))}</strong>`;
    b.addEventListener('click', async () => {
      b.remove();
      await load();
      show('essentiel');
      window.scrollTo(0, 0);
    });
    document.body.appendChild(b);
  } catch { /* hors ligne */ }
}
document.addEventListener('visibilitychange', checkNewEdition);
setInterval(checkNewEdition, 15 * 60e3);

applyLanguage();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
$('#ess-sub').textContent = t('loading');
load().then(refreshInbox).then(refreshLikes);
// Une fois par jour : l'app a été ouverte, donc le rappel du soir n'est pas ignoré.
if (store.get('seenDay', '') !== dayKey()) { store.set('seenDay', dayKey()); setTimeout(() => syncProgress({}), 3000); }
setTimeout(() => syncPushLang(false), 3500); // fuseau horaire ou réglages changés depuis le dernier envoi
updateBadge();
if (!store.get('onboarded', false)) show('profil');
else handleHash();
