// Lecteur « podcast » de Clair : écoute l'édition du jour comme un journal radio.
// - Résumés lus par la voix Kokoro (fichiers préparés chaque matin, disponibles hors ligne).
// - En ligne, option « article complet » : après l'annonce, le texte entier est lu par la voix
//   de Cloudflare (MeloTTS), morceau par morceau.
// - Lecture écran verrouillé, commandes sur l'écran de verrouillage et dans les écouteurs.

const AUDIO_CACHE = 'clair-audio-v1';
const SPEEDS = [1, 1.25, 1.5, 0.8];

export function initPlayer(ctx) {
  const { $, esc, t, tx, catLabel, safeUrl, toast, ICONS } = ctx;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');

  let manifest = null;      // sommaire audio du jour (langue de l'app)
  let manifestLang = null;
  let queue = [];           // [{ kind: 'clip'|'item', name?, item?, file?, d? }]
  let qi = -1;              // piste en cours
  let parts = [];           // morceaux de la piste en cours : [{ file } | { text, lang }]
  let pi = 0;               // morceau en cours
  let blobUrls = new Map(); // clé de morceau → objectURL
  let pending = new Map();  // clé de morceau → promesse de blob
  let playing = false;
  let speedIdx = 0;
  let token = 0;            // invalide les chargements d'une piste abandonnée

  const base = new URL('audio/', location.href).href;
  const full = () => ctx.settings().audioFull !== false && navigator.onLine;

  /* ---------- Sommaire et file d'écoute ---------- */
  async function loadManifest() {
    const lang = ctx.settings().lang === 'en' ? 'en' : 'fr';
    if (manifest && manifestLang === lang) return manifest;
    let m = null;
    try {
      const res = await fetch(`${base}${lang}.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) m = await res.json();
    } catch { /* hors ligne */ }
    if (!m) { try { const c = await (await caches.open(AUDIO_CACHE)).match(`${base}${lang}.json`); if (c) m = await c.json(); } catch { /* */ } }
    if (m) { try { (await caches.open(AUDIO_CACHE)).put(`${base}${lang}.json`, new Response(JSON.stringify(m))); } catch { /* */ } }
    manifest = m;
    manifestLang = lang;
    return m;
  }
  function buildQueue() {
    const { essentiel, fil } = ctx.selection();
    const m = manifest || { clips: {}, items: {} };
    const has = (i) => !!m.items[i.url] || (full() && !!i.url);
    const ess = essentiel.filter(has);
    const feed = fil.filter(has);
    const q = [];
    const clip = (name) => m.clips?.[name] && q.push({ kind: 'clip', name, file: m.clips[name].f, d: m.clips[name].d });
    clip(ess.some((i) => i.tone !== 'positive') ? 'intro' : 'intro_nobad');
    ess.forEach((item) => q.push({ kind: 'item', item }));
    if (ess.length && feed.length) clip('transition');
    feed.forEach((item) => q.push({ kind: 'item', item }));
    clip('outro');
    return q;
  }
  function itemAudio(item) { return manifest?.items?.[item.url] || null; }
  function estimateMinutes(q) {
    const s = q.reduce((n, x) => n + (x.kind === 'clip' ? x.d : itemAudio(x.item)?.d || 20), 0);
    return Math.max(1, Math.round(s / 60));
  }

  /* ---------- Chargement des morceaux ---------- */
  async function fileBlob(file) {
    const url = base + file;
    let cache = null;
    try { cache = await caches.open(AUDIO_CACHE); const hit = await cache.match(url); if (hit) return new Blob([await hit.arrayBuffer()], { type: 'audio/mpeg' }); } catch { /* */ }
    const res = await fetch(url);
    if (!res.ok) throw new Error('audio');
    const blob = new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
    try { cache && cache.put(url, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } })); } catch { /* */ }
    return blob;
  }
  async function speechBlob(text, lang) {
    const res = await fetch(`${ctx.relay}/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error('voice');
    const buf = await res.arrayBuffer();
    // La voix peut renvoyer du WAV ou du MP3 : on donne le bon type, sinon l'iPhone refuse de le lire.
    const h = new Uint8Array(buf.slice(0, 4));
    const type = h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 ? 'audio/wav' : 'audio/mpeg';
    return new Blob([buf], { type });
  }
  const partKey = (p) => (p.file ? `f:${p.file}` : `s:${p.lang}:${p.text.slice(0, 80)}:${p.text.length}`);
  function loadPart(p) {
    const k = partKey(p);
    if (blobUrls.has(k)) return Promise.resolve(blobUrls.get(k));
    if (!pending.has(k)) {
      pending.set(k, (p.file ? fileBlob(p.file) : speechBlob(p.text, p.lang))
        .then((b) => { const u = URL.createObjectURL(b); blobUrls.set(k, u); return u; })
        .finally(() => pending.delete(k)));
    }
    return pending.get(k);
  }
  function freeBlobs() {
    for (const u of blobUrls.values()) URL.revokeObjectURL(u);
    blobUrls = new Map();
  }

  // Découpe un article en morceaux de ~800 caractères, en fin de phrase.
  function chunks(blocks) {
    const sentences = blocks.flatMap((b) => (b.t === 'h' ? [`${b.text}.`] : b.text.match(/[^.!?…]+[.!?…]+["»”)]*\s*|.+$/g) || [b.text]));
    const out = [];
    let cur = '';
    for (const s of sentences) {
      if (cur && (cur + s).length > 800) { out.push(cur.trim()); cur = ''; }
      cur += `${s} `;
      while (cur.length > 1100) { out.push(cur.slice(0, 1000)); cur = cur.slice(1000); }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function guessLang(text) {
    const w = ` ${text.toLowerCase().slice(0, 2000)} `;
    const fr = (w.match(/ (le|la|les|des|une|est|dans|pour|qui|que|avec|sur|du|au) /g) || []).length;
    const en = (w.match(/ (the|and|is|are|of|to|in|that|with|for|on|was|it) /g) || []).length;
    return fr >= en ? 'fr' : 'en';
  }
  async function partsFor(entry) {
    if (entry.kind === 'clip') return [{ file: entry.file }];
    const a = itemAudio(entry.item);
    const intro = a ? [{ file: a.f }] : [];
    if (!full()) return intro;
    const art = await ctx.getArticle(entry.item).catch(() => null);
    if (!art?.blocks?.length) return intro.length ? intro : [];
    const body = chunks(art.blocks);
    const lang = guessLang(body.join(' '));
    return [...intro, ...body.map((text) => ({ text, lang }))];
  }

  /* ---------- Lecture ---------- */
  async function startTrack(index, autoplay = true) {
    const my = ++token;
    qi = index;
    pi = 0;
    if (qi >= queue.length) return finish();
    render();
    const entry = queue[qi];
    try { parts = await partsFor(entry); } catch { parts = []; }
    if (my !== token) return;
    if (!parts.length) return startTrack(qi + 1, autoplay); // rien à lire pour cette piste
    setMeta(entry);
    render();
    await playPart(my, autoplay);
  }
  async function playPart(my, autoplay = true) {
    if (pi >= parts.length) return trackDone();
    let url;
    try { url = await loadPart(parts.at(pi)); } catch {
      if (my !== token) return;
      if (pi === 0 && !navigator.onLine) toast(t('listen_offline_skip'));
      pi++; return playPart(my, autoplay); // morceau indisponible : on passe
    }
    if (my !== token) return;
    audio.src = url;
    audio.playbackRate = SPEEDS.at(speedIdx);
    if (autoplay) { try { await audio.play(); playing = true; } catch { playing = false; } }
    render();
    // Prépare les deux morceaux suivants (et le début de la piste suivante) pendant l'écoute.
    parts.slice(pi + 1, pi + 3).forEach((p) => loadPart(p).catch(() => {}));
    if (pi + 1 >= parts.length && queue[qi + 1]) partsFor(queue[qi + 1]).then((ps) => ps.slice(0, 1).forEach((p) => loadPart(p).catch(() => {}))).catch(() => {});
  }
  function trackDone() {
    const entry = queue[qi];
    if (entry?.kind === 'item') { entry.done = true; ctx.markRead(entry.item); }
    startTrack(qi + 1);
  }
  audio.addEventListener('ended', () => { pi++; playPart(token); });
  audio.addEventListener('timeupdate', () => renderProgress());
  audio.addEventListener('play', () => { playing = true; render(); });
  audio.addEventListener('pause', () => { playing = false; render(); });

  function finish() {
    playing = false;
    audio.pause();
    qi = queue.length;
    render();
    ctx.onFinished?.();
  }
  function setMeta(entry) {
    if (!('mediaSession' in navigator)) return;
    const title = entry.kind === 'item' ? tx(entry.item, 'title') : t(`clip_${entry.name}`);
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: entry.kind === 'item' ? entry.item.source || 'Clair' : 'Clair',
      album: t('listen_album'),
      artwork: [{ src: new URL('icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
    });
  }
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* non pris en charge */ } };
    set('play', () => audio.play());
    set('pause', () => audio.pause());
    set('nexttrack', () => next());
    set('previoustrack', () => prev());
    set('seekforward', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15); });
    set('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 15); });
  }

  /* ---------- Commandes ---------- */
  // Un journal audio doit s'entendre même en mode silencieux, et continuer écran verrouillé.
  function playbackSession() { try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* */ } }
  audio.addEventListener('play', playbackSession);

  async function start() {
    playbackSession();
    await loadManifest();
    queue = buildQueue();
    if (!queue.some((x) => x.kind === 'item')) { toast(t(manifest ? 'listen_empty' : 'listen_not_ready')); return; }
    freeBlobs();
    open();
    startTrack(0);
  }
  function toggle() {
    playbackSession();
    if (qi < 0 || qi >= queue.length) return start();
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  function next() { if (qi < queue.length) startTrack(qi + 1); }
  function prev() {
    if (audio.currentTime > 4 || pi > 0) { pi = 0; return startTrack(qi); }
    startTrack(Math.max(0, qi - 1));
  }
  function jumpTo(i) { startTrack(i); }
  function cycleSpeed() { speedIdx = (speedIdx + 1) % SPEEDS.length; audio.playbackRate = SPEEDS.at(speedIdx); render(); }
  function stop() { token++; audio.pause(); audio.removeAttribute('src'); qi = -1; queue = []; freeBlobs(); close(); render(); }

  // Prépare les résumés audio du jour sur le téléphone, pour l'écoute hors ligne.
  async function precache() {
    if (!navigator.onLine) return;
    await loadManifest();
    if (!manifest) return;
    const q = buildQueue();
    const files = q.map((x) => (x.kind === 'clip' ? x.file : itemAudio(x.item)?.f)).filter(Boolean);
    for (const f of files) { try { await fileBlob(f); } catch { /* */ } }
  }

  /* ---------- Affichage ---------- */
  const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
  function current() { return queue[qi]; }
  function open() { $('#player').classList.remove('hidden'); render(); }
  function close() { $('#player').classList.add('hidden'); }
  function renderProgress() {
    const bar = $('#pl-progress');
    if (!bar) return;
    const d = audio.duration || 0;
    bar.style.width = d ? `${(audio.currentTime / d) * 100}%` : '0%';
    const tm = $('#pl-time');
    if (tm) tm.textContent = `${fmt(audio.currentTime)} / ${fmt(d)}`;
  }
  function render() {
    const active = qi >= 0 && qi < queue.length;
    const e = current();
    const title = !active ? t('listen_done_title') : e.kind === 'item' ? tx(e.item, 'title') : t(`clip_${e.name}`);
    const sub = !active ? t('listen_done_sub') : e.kind === 'item'
      ? `${e.item.source || ''}${parts.length > 1 ? ` · ${t('listen_full_part', pi + 1, parts.length)}` : ''}`
      : 'Clair';
    // Mini-lecteur
    const mini = $('#mini-player');
    mini.classList.toggle('hidden', !active || !$('#player').classList.contains('hidden'));
    $('#mini-title').textContent = title;
    $('#mini-toggle').innerHTML = playing ? ICONS.pause : ICONS.play;
    $('#mini-toggle').setAttribute('aria-label', playing ? t('listen_pause') : t('listen_play'));
    // Grand lecteur
    const items = queue.filter((x) => x.kind === 'item');
    $('#player-body').innerHTML = `
      <div class="pl-top">
        <button type="button" class="link-btn" data-pl="close">‹ ${esc(t('reader_back'))}</button>
        <span class="small">${esc(t('listen_count', items.filter((x) => x.done).length, items.length))}</span>
      </div>
      <div class="pl-art">${e?.kind === 'item' && e.item.image ? `<img src="${esc(safeUrl(e.item.image))}" alt="" referrerpolicy="no-referrer">` : ICONS.wave}</div>
      <p class="pl-cat">${esc(e?.kind === 'item' ? catLabel(e.item.category) : t('listen_album'))}</p>
      <h2 class="pl-title">${esc(title)}</h2>
      <p class="small">${esc(sub)}</p>
      <div class="pl-bar"><i id="pl-progress"></i></div>
      <p class="small pl-time" id="pl-time">0:00 / 0:00</p>
      <div class="pl-controls">
        <button type="button" class="round" data-pl="prev" aria-label="${esc(t('listen_prev'))}">${ICONS.prev}</button>
        <button type="button" class="round" data-pl="back" aria-label="${esc(t('listen_back15'))}">−15</button>
        <button type="button" class="pl-play" data-pl="toggle" aria-label="${esc(playing ? t('listen_pause') : t('listen_play'))}">${playing ? ICONS.pause : ICONS.play}</button>
        <button type="button" class="round" data-pl="fwd" aria-label="${esc(t('listen_fwd15'))}">+15</button>
        <button type="button" class="round" data-pl="next" aria-label="${esc(t('listen_next'))}">${ICONS.next}</button>
      </div>
      <div class="tags" style="justify-content:center;margin-top:12px">
        <button type="button" class="toggle" data-pl="speed">${esc(t('listen_speed', String(SPEEDS.at(speedIdx)).replace('.', ',')))}</button>
        <button type="button" class="toggle" data-pl="full" aria-pressed="${ctx.settings().audioFull !== false}">${esc(t('listen_full'))}</button>
      </div>
      <p class="small" style="text-align:center;margin:8px 0 0">${esc(navigator.onLine ? (ctx.settings().audioFull !== false ? t('listen_full_on') : t('listen_full_off')) : t('listen_offline'))}</p>
      <ol class="pl-queue">${queue.map((x, i) => x.kind === 'item'
        ? `<li class="${i === qi ? 'now' : ''}${x.done ? ' done' : ''}"><button type="button" data-pl-jump="${i}"><span>${x.done ? '✓' : i === qi ? '▶' : ''}</span>${esc(tx(x.item, 'title'))}</button></li>`
        : '').join('')}</ol>
      <button type="button" class="link-btn" data-pl="stop">${esc(t('listen_stop'))}</button>`;
    renderProgress();
  }
  $('#player-body').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const a = b.dataset.pl;
    if (b.dataset.plJump) return jumpTo(Number(b.dataset.plJump));
    if (a === 'close') { close(); return render(); }
    if (a === 'toggle') return toggle();
    if (a === 'next') return next();
    if (a === 'prev') return prev();
    if (a === 'back') { audio.currentTime = Math.max(0, audio.currentTime - 15); return; }
    if (a === 'fwd') { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15); return; }
    if (a === 'speed') return cycleSpeed();
    if (a === 'stop') return stop();
    if (a === 'full') { ctx.toggleFull(); toast(ctx.settings().audioFull !== false ? t('listen_full_on') : t('listen_full_off')); return render(); }
  });
  $('#mini-player').addEventListener('click', (ev) => {
    if (ev.target.closest('#mini-toggle')) return toggle();
    open();
  });

  return {
    start, toggle, precache,
    isActive: () => qi >= 0 && qi < queue.length,
    async summary() { await loadManifest(); const q = buildQueue(); return { ready: !!manifest, items: q.filter((x) => x.kind === 'item').length, minutes: estimateMinutes(q) }; },
    reset() { manifest = null; },
  };
}
