import { THEMES, LEVELS, CATEGORY_LABELS, DEFAULT_SETTINGS, select, followedReason, themeOf } from './select.js';
import { WORKER_URL } from './config.js';
import { makeT } from './i18n.js';

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
function tx(item, f) {
  if (settings.articleLang === 'original' && item.orig_title) {
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
function streak() {
  const d = new Date();
  if (!(readLog[dayKey(d)] || []).length) d.setDate(d.getDate() - 1); // la journée n'est pas finie
  let n = 0;
  while ((readLog[dayKey(d)] || []).length) { n++; d.setDate(d.getDate() - 1); }
  return n;
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
  if (navigator.vibrate) { navigator.vibrate(times > 1 ? [20, 60, 20, 60, 40] : 25); return; }
  try { hapticSwitch.click(); } catch { /* non pris en charge */ }
  if (times > 1) setTimeout(() => { try { hapticSwitch.click(); } catch { /* */ } }, 140);
}
let audio = null;
function ding(big = false) {
  if (!settings.sound) return;
  try {
    if (!audio) {
      if (navigator.audioSession) navigator.audioSession.type = 'ambient'; // respecte le mode silencieux
      audio = new (window.AudioContext || window.webkitAudioContext)();
    }
    audio.resume();
    const notes = big ? [659, 880, 1175, 1568] : [880, 1319];
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
    body: JSON.stringify({ subscription: sub.toJSON(), lang: settings.lang, test: true, token: me?.token }),
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
async function syncPushLang() {
  if (pushState() !== 'on') return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) fetch(`${PUSH_BASE}/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), lang: settings.lang, token: me?.token }) }).catch(() => {});
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
  if (tab === 'amis') { renderAmis(); refreshInbox(); }
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
    if (f.kind === 'place') return t('r_place', f.name);
    if (f.kind === 'keep') return t('r_keep', f.name);
    return t('r_topic', topicLabel(f.name));
  }
  return item.importance >= 8 && item.tone !== 'positive' ? t('info_major') : catLabel(item.category);
}
function essCard(item) {
  return `<a class="card" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener">
    <div class="chips">${chipFor(item)}<span class="reason">${esc(reasonText(item))}</span></div>
    <h2>${esc(tx(item, 'title'))}</h2>
    <p>${esc(tx(item, 'summary'))}</p>
  </a>`;
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
  $('#ess-list').innerHTML = sel.essentiel.map(essCard).join('') || `<div class="empty">${esc(t('ess_empty'))}</div>`;
  $('#go-fil').innerHTML = `${esc(t('go_fil', sel.fil.length))} ${ICONS.arrow}`;
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
        : item.why ? `<span class="why">${esc(t('why', item.why))}</span>` : ''}
      <h2>${esc(tx(item, 'title'))}</h2>
      <p>${esc(tx(item, 'summary'))}</p>
      <p class="meta">${esc(item.source)} · ${esc(ago(item.published))} · <a href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener">${esc(t('read_article'))}</a></p>
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
    ${n ? `<div class="note streak">${ICONS.flame}<span id="streak-text">${esc(t('streak', n))}</span></div>` : ''}
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
    if (idx >= total) refreshEndStats();
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
    if (isFav(item.url)) favs = favs.filter((f) => f.url !== item.url);
    else favs = [{ ...item, savedAt: new Date().toISOString() }, ...favs].slice(0, 200);
    store.set('favs', favs);
    const on = isFav(item.url);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    toast(on ? t('toast_fav_on') : t('toast_fav_off'));
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
    ? favs.map((f) => `<a class="card" href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">
        <div class="chips"><span class="chip good">${esc(f.category ? catLabel(f.category) : t('fav_tag'))}</span><span class="reason">${esc(f.source)}</span></div>
        <h2>${esc(tx(f, 'title'))}</h2><p>${esc(tx(f, 'summary'))}</p></a>`).join('')
    : `<div class="empty">${esc(t('fav_empty'))}</div>`;
}

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
    <div class="tags">${groups.map((g, k) => `<span class="tag">${esc(g.label)}<button type="button" data-rm-group="${key}:${k}" aria-label="${esc(t('remove', g.label))}">×</button></span>`).join('')}</div>`;
}
function renderSettings() {
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
      ${groupTags('interests', t('g_interests'))}
      ${groupTags('keep_informed', t('g_keep'))}
      ${groupTags('avoid', t('g_avoid'))}
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
      <div class="tags">${settings.places.map((p, k) => `<span class="tag">${esc(p)}<button type="button" data-rm-place="${k}" aria-label="${esc(t('remove', p))}">×</button></span>`).join('')}</div>
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
  applyLanguage();
  saveSettings();
  syncPushLang();
}
$('#settings').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-edit-profile')) return show('profil');
  if (b.hasAttribute('data-push')) return togglePush(b, renderSettings);
  if (b.hasAttribute('data-offline')) { b.disabled = true; b.textContent = t('offline_working'); return precacheEdition(true); }
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
$('#settings').addEventListener('submit', (e) => {
  e.preventDefault();
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
  const g = (key, title) => (draft[key] || []).length
    ? `<p class="small" style="margin:14px 0 6px;font-weight:700">${esc(title)}</p><div class="tags">${draft[key].map((x, k) => `<span class="tag">${esc(x.label ?? x)}<button type="button" data-rm-draft="${key}:${k}" aria-label="${esc(t('remove', x.label ?? x))}">×</button></span>`).join('')}</div>`
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
function sharedCard(x) {
  const it = x.item || {};
  return `<a class="card${seenShares.includes(x.id) ? '' : ' unread'}" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener" data-share="${esc(x.id)}">
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
  return `<section>
      <h2>${esc(t('offline_title'))}</h2>
      <p class="hint">${esc(ready ? t('offline_ready', sel.essentiel.length + sel.fil.length) : t('offline_hint'))}</p>
      <p class="hint">${esc(t('offline_tip'))}</p>
      <button type="button" class="outline-btn" data-offline style="width:100%">${esc(t('offline_btn'))}</button>
    </section>`;
}
// Hors ligne, un article complet ne peut pas s'ouvrir : on le met de côté
// et on le propose dès que le réseau revient.
let later = store.get('later', []);
function findItem(url) {
  return [...sel.essentiel, ...sel.fil, ...favs, ...inbox.map((x) => x.item || {})].find((i) => i && safeUrl(i.url) === url);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[target="_blank"]');
  if (!a) return;
  if (!navigator.onLine) {
    e.preventDefault();
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

/* ---------- Démarrage ---------- */
async function load() {
  try {
    const res = await fetch(`edition.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    edition = await res.json();
    computeSel();
    renderEssentiel();
    renderFeed();
    setTimeout(() => precacheEdition(false), 1500); // garde les photos du jour pour le hors-ligne
  } catch {
    $('#ess-sub').textContent = t('no_edition');
    $('#ess-list').innerHTML = `<div class="empty">${esc(t('no_edition_p'))}</div>`;
    $('#go-fil').classList.add('hidden');
  }
}
applyLanguage();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
$('#ess-sub').textContent = t('loading');
load().then(refreshInbox);
updateBadge();
if (!store.get('onboarded', false)) show('profil');
else handleHash();
