import { THEMES, LEVELS, CATEGORY_LABELS, DEFAULT_SETTINGS, select, followedReason, themeOf } from './select.js';
import { WORKER_URL } from './config.js';

const TOPIC_CHOICES = [
  { id: 'monde', label: 'Actu mondiale' },
  { id: 'aviation', label: 'Aviation' },
  { id: 'economie', label: 'Économie' },
  { id: 'tech', label: 'Tech' },
  { id: 'ecologie', label: 'Écologie' },
  { id: 'sante', label: 'Santé' },
  { id: 'espace', label: 'Espace' },
  { id: 'ia', label: 'IA' },
];

const ICONS = {
  heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6"/></svg>',
  photo: '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="17" cy="6" r="2.5"/><path d="M8 9c2.5 3.2 4 5.5 4 7.5a4 4 0 0 1-8 0C4 14.5 5.5 12.2 8 9z"/></svg>',
  check: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bell: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B6E53" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
  arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

let settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
let favs = store.get('favs', []);
let edition = null;
let sel = { essentiel: [], fil: [] };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function safeUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; }
}
function ago(iso) {
  if (!iso) return '';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600e3);
  if (h < 1) return 'il y a moins d’une heure';
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} jour${d > 1 ? 's' : ''}`;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function saveSettings() {
  store.set('settings', settings);
  sel = select(edition || { items: [] }, settings);
  renderEssentiel();
  renderFeed();
}

/* ---------- Navigation ---------- */
function show(tab) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === tab));
  document.querySelectorAll('nav.tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.body.classList.toggle('dark', tab === 'fil');
  document.querySelector('nav.tabs').classList.toggle('hidden', tab === 'profil');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', tab === 'fil' ? '#0F1D19' : '#F6F7F4');
  if (tab === 'reglages') renderSettings();
  if (tab === 'profil') renderProfileForm();
  if (tab === 'favoris') renderFavs();
  if (tab === 'fil') updateProgress();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
$('#go-fil').addEventListener('click', () => show('fil'));

/* ---------- L'essentiel ---------- */
function chipFor(item) {
  if (item.tone === 'positive') return '<span class="chip good">Bonne nouvelle</span>';
  if (item.importance >= 8) return '<span class="chip important">Important</span>';
  return `<span class="chip world">${esc(CATEGORY_LABELS[item.category] || 'Monde')}</span>`;
}
function essCard(item) {
  const f = followedReason(item, settings);
  const reason = f && f !== 'Sujet suivi : monde' ? f : item.importance >= 8 && item.tone !== 'positive' ? 'Info majeure' : CATEGORY_LABELS[item.category] || '';
  return `<a class="card" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener">
    <div class="chips">${chipFor(item)}<span class="reason">${esc(reason)}</span></div>
    <h2>${esc(item.title)}</h2>
    <p>${esc(item.summary)}</p>
  </a>`;
}
function renderEssentiel() {
  if (!edition) return;
  const d = new Date(edition.generated_at);
  const date = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#ess-date').textContent = date.charAt(0).toUpperCase() + date.slice(1);
  const n = sel.essentiel.length;
  $('#ess-sub').textContent = n ? `${n} info${n > 1 ? 's' : ''} à connaître · 1 min de lecture` : 'Rien d’essentiel à signaler aujourd’hui.';
  const ageH = (Date.now() - d.getTime()) / 3600e3;
  $('#ess-stale').innerHTML = ageH > 30 ? '<div class="stale">Cette édition date d’un peu plus d’un jour : la prochaine n’est pas encore passée.</div>' : '';
  $('#ess-list').innerHTML = sel.essentiel.map(essCard).join('') || '<div class="empty">Aucune info grave ne passe ton filtre aujourd’hui. Profite.</div>';
  $('#go-fil').innerHTML = `Passer au fil · ${sel.fil.length} belle${sel.fil.length > 1 ? 's' : ''} histoire${sel.fil.length > 1 ? 's' : ''} ${ICONS.arrow}`;
}

/* ---------- Le fil ---------- */
const isFav = (id) => favs.some((f) => f.url === id);
function slide(item, i) {
  const img = item.image
    ? `<img src="${esc(safeUrl(item.image))}" alt="" loading="${i < 2 ? 'eager' : 'lazy'}" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createRange().createContextualFragment(window.__photoIcon))">`
    : ICONS.photo;
  const fav = isFav(item.url);
  return `<article class="slide" data-i="${i}" data-cat="${esc(CATEGORY_LABELS[item.category] || '')}">
    <div class="media">${img}</div>
    <div class="slide-body">
      ${item.why ? `<span class="why">${esc(item.why)}</span>` : ''}
      <h2>${esc(item.title)}</h2>
      <p>${esc(item.summary)}</p>
      <p class="meta">${esc(item.source)} · ${esc(ago(item.published))} · <a href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener">Lire l'article</a></p>
      <div class="actions">
        <button type="button" class="icon-btn${fav ? ' on' : ''}" data-act="fav" data-i="${i}" aria-label="Enregistrer" aria-pressed="${fav}">${ICONS.heart}</button>
        <button type="button" class="icon-btn" data-act="share" data-i="${i}" aria-label="Partager">${ICONS.share}</button>
        <button type="button" class="pill-btn" data-act="less" data-i="${i}">Moins de ce sujet</button>
      </div>
    </div>
  </article>`;
}
function endSlide() {
  const minutes = Math.max(1, Math.round((sel.essentiel.length * 20 + sel.fil.length * 25) / 60));
  return `<article class="slide end" data-i="end">
    <div class="check">${ICONS.check}</div>
    <h2>Tu es à jour.</h2>
    <p>Pas de fil infini, c'est voulu. Le reste de ta journée t'appartient.</p>
    <div class="stats">
      <div class="stat"><b>${sel.essentiel.length}</b><span>infos essentielles</span></div>
      <div class="stat"><b style="color:var(--green)">${sel.fil.length}</b><span>belles histoires</span></div>
      <div class="stat"><b>${minutes} min</b><span>de lecture</span></div>
    </div>
    <div class="note">${ICONS.bell}<span>Ta prochaine édition arrive <strong>demain matin</strong>.</span></div>
    <button type="button" class="outline-btn" data-act="favs">Revoir mes favoris (${favs.length})</button>
  </article>`;
}
window.__photoIcon = ICONS.photo;

function renderFeed() {
  const feed = $('#feed');
  feed.innerHTML = sel.fil.map(slide).join('') + endSlide();
  feed.scrollTop = 0;
  $('#progress').innerHTML = sel.fil.map(() => '<i></i>').join('');
  updateProgress();
}
function updateProgress() {
  const feed = $('#feed');
  const idx = Math.round(feed.scrollTop / Math.max(1, feed.clientHeight));
  const total = sel.fil.length;
  const atEnd = idx >= total;
  $('.feed-head').classList.toggle('hidden', atEnd || total === 0);
  if ($('#fil').classList.contains('active')) document.body.classList.toggle('dark', !atEnd);
  $('#progress').querySelectorAll('i').forEach((el, k) => el.classList.toggle('done', k <= idx));
  $('#fil-counter').textContent = total ? `${Math.min(idx + 1, total)} / ${total}` : '';
  const cur = feed.querySelector(`.slide[data-i="${idx}"]`);
  $('#fil-cat').textContent = cur ? cur.dataset.cat : '';
}
$('#feed').addEventListener('scroll', () => requestAnimationFrame(updateProgress), { passive: true });
$('#feed').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const item = sel.fil[Number(btn.dataset.i)];
  const act = btn.dataset.act;
  if (act === 'favs') return show('favoris');
  if (!item) return;
  if (act === 'fav') {
    if (isFav(item.url)) favs = favs.filter((f) => f.url !== item.url);
    else favs = [{ ...item, savedAt: new Date().toISOString() }, ...favs].slice(0, 200);
    store.set('favs', favs);
    const on = isFav(item.url);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    toast(on ? 'Ajouté à tes favoris' : 'Retiré de tes favoris');
  } else if (act === 'share') {
    const data = { title: item.title, text: item.summary, url: safeUrl(item.url) };
    if (navigator.share) { try { await navigator.share(data); } catch { /* annulé */ } }
    else { try { await navigator.clipboard.writeText(data.url); toast('Lien copié'); } catch { toast(data.url); } }
  } else if (act === 'less') {
    const theme = themeOf(item.category);
    settings.themes = settings.themes.filter((t) => t !== theme);
    store.set('settings', settings);
    const label = THEMES.find((t) => t.id === theme)?.label || '';
    toast(`« ${label} » masqué dès la prochaine ouverture. Réactivable dans Mon dosage.`);
  }
});

/* ---------- Favoris ---------- */
function renderFavs() {
  $('#fav-list').innerHTML = favs.length
    ? favs.map((f) => `<a class="card" href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">
        <div class="chips"><span class="chip good">${esc(CATEGORY_LABELS[f.category] || 'Favori')}</span><span class="reason">${esc(f.source)}</span></div>
        <h2>${esc(f.title)}</h2><p>${esc(f.summary)}</p></a>`).join('')
    : '<div class="empty">Aucun favori pour l’instant. Dans le fil, touche l’icône marque-page pour garder une carte.</div>';
}

/* ---------- Mon dosage ---------- */
function groupTags(key, title) {
  const groups = settings[key] || [];
  if (!groups.length) return '';
  return `<p class="small" style="margin:8px 0 6px;font-weight:700">${title}</p>
    <div class="tags">${groups.map((g, k) => `<span class="tag">${esc(g.label)}<button type="button" data-rm-group="${key}:${k}" aria-label="Retirer ${esc(g.label)}">×</button></span>`).join('')}</div>`;
}
function renderSettings() {
  const lvl = LEVELS.find((l) => l.id === settings.level) || LEVELS[1];
  $('#settings').innerHTML = `
    <h1>Mon dosage</h1>
    <section class="profile-box">
      <h2>Mon profil</h2>
      <p class="desc" style="margin:0 0 12px">${esc(settings.resume || 'Pas encore de profil : décris-toi en quelques phrases et l\u2019IA règle tout.')}</p>
      ${groupTags('interests', 'Ce que tu aimes')}
      ${groupTags('keep_informed', 'À savoir même si c\u2019est grave')}
      ${groupTags('avoid', 'À ne plus voir')}
      <button type="button" class="outline-btn" data-edit-profile style="width:100%;margin-top:6px">${settings.resume ? 'Réécrire mon profil' : 'Créer mon profil'}</button>
    </section>
    <section>
      <h2>Mauvaises nouvelles</h2>
      <div class="seg" role="group" aria-label="Niveau de mauvaises nouvelles">
        ${LEVELS.map((l) => `<button type="button" data-level="${l.id}" aria-pressed="${l.id === settings.level}">${l.label}</button>`).join('')}
      </div>
      <p class="desc">${esc(lvl.desc)}</p>
    </section>
    <section>
      <h2>Lieux que tu suis</h2>
      <p class="hint">Une info grave qui les concerne passe ton filtre, même si elle n'est pas mondiale.</p>
      <div class="tags">${settings.places.map((p, k) => `<span class="tag">${esc(p)}<button type="button" data-rm-place="${k}" aria-label="Retirer ${esc(p)}">×</button></span>`).join('')}</div>
      <form class="add-row" id="add-place">
        <label class="hidden" for="place-input">Ajouter un lieu</label>
        <input id="place-input" placeholder="Ajouter un lieu (ex. Sumba)" autocomplete="off">
        <button type="submit">Ajouter</button>
      </form>
    </section>
    <section>
      <h2>Sujets suivis</h2>
      <p class="hint">Même règle que pour les lieux : les infos importantes sur ces sujets passent.</p>
      <div class="tags">${TOPIC_CHOICES.map((t) => `<button type="button" class="toggle" data-topic="${t.id}" aria-pressed="${settings.topics.includes(t.id)}">${t.label}</button>`).join('')}</div>
    </section>
    <section>
      <h2>Ce que tu veux voir dans le fil</h2>
      <div class="grid2">${THEMES.map((t) => `<button type="button" class="toggle" data-theme="${t.id}" aria-pressed="${settings.themes.includes(t.id)}">${t.label}</button>`).join('')}</div>
    </section>
    <section class="count-row">
      <div><div style="font-weight:700">Taille de l'édition</div><div class="small">${settings.count} cartes par jour, puis c'est fini</div></div>
      <div class="btns">
        <button type="button" class="round" data-count="-5" aria-label="Moins de cartes">−</button>
        <button type="button" class="round" data-count="5" aria-label="Plus de cartes">+</button>
      </div>
    </section>
    <p class="small">${edition ? `Édition générée ${esc(ago(edition.generated_at))} · ${edition.count} articles analysés` : ''}</p>`;
}
$('#settings').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-edit-profile')) return show('profil');
  if (b.dataset.rmGroup) {
    const [key, k] = b.dataset.rmGroup.split(':');
    settings[key] = settings[key].filter((_, idx) => idx !== Number(k));
  } else if (b.dataset.level) settings.level = b.dataset.level;
  else if (b.dataset.rmPlace) settings.places = settings.places.filter((_, k) => k !== Number(b.dataset.rmPlace));
  else if (b.dataset.topic) {
    const t = b.dataset.topic;
    settings.topics = settings.topics.includes(t) ? settings.topics.filter((x) => x !== t) : [...settings.topics, t];
  } else if (b.dataset.theme) {
    const t = b.dataset.theme;
    settings.themes = settings.themes.includes(t) ? settings.themes.filter((x) => x !== t) : [...settings.themes, t];
  } else if (b.dataset.count) settings.count = Math.min(50, Math.max(5, settings.count + Number(b.dataset.count)));
  else return;
  saveSettings();
  renderSettings();
});
$('#settings').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#place-input');
  const v = input.value.trim();
  if (v && !settings.places.includes(v)) { settings.places = [...settings.places, v]; saveSettings(); }
  renderSettings();
});

/* ---------- Parle-moi de toi ---------- */
let draft = null; // profil proposé par l'IA, en attente de validation

function renderProfileForm(error = '') {
  const first = !store.get('onboarded', false);
  $('#profil-body').innerHTML = `
    <h1>Parle-moi de toi</h1>
    <p class="sub" style="margin-top:8px">Qu'est-ce qui te passionne ? Tes hobbies, ton métier, les lieux qui comptent pour toi, ce dont tu veux être tenu au courant, même quand c'est grave… et ce que tu ne veux plus voir.</p>
    <label class="hidden" for="profile-text">Ton texte</label>
    <textarea id="profile-text" maxlength="2000" placeholder="Ex. Je fais du surf et de la photo, je travaille dans la santé. Ma famille vit au Portugal, je veux savoir s'il s'y passe quelque chose de grave. J'adore les inventions écologiques et l'espace. La politique française m'épuise.">${esc(settings.profileText)}</textarea>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <button type="button" class="cta" id="profile-go" style="margin:16px 0 0;width:100%">Créer mon profil</button>
    <p class="small" style="margin-top:12px;line-height:1.5">Ton texte est envoyé à l'IA de Google (Gemini) pour créer ton profil, puis le profil est gardé uniquement sur ce téléphone. Évite d'y mettre des informations sensibles.</p>
    <button type="button" class="link-btn" id="profile-skip">${first ? 'Continuer sans profil' : 'Annuler'}</button>`;
  if (!WORKER_URL) {
    $('#profile-go').disabled = true;
    $('#profile-go').textContent = 'Bientôt disponible';
  }
}

function renderDraft() {
  const g = (key, title) => (draft[key] || []).length
    ? `<p class="small" style="margin:14px 0 6px;font-weight:700">${title}</p><div class="tags">${draft[key].map((x, k) => `<span class="tag">${esc(x.label ?? x)}<button type="button" data-rm-draft="${key}:${k}" aria-label="Retirer">×</button></span>`).join('')}</div>`
    : '';
  const lvl = LEVELS.find((l) => l.id === draft.level) || LEVELS[1];
  $('#profil-body').innerHTML = `
    <h1>Voilà ton profil</h1>
    <p class="sub" style="margin-top:8px">${esc(draft.resume)}</p>
    ${g('interests', 'Ce que tu aimes')}
    ${g('places', 'Lieux que tu suis')}
    ${g('keep_informed', 'À savoir même si c\u2019est grave')}
    ${g('avoid', 'À ne plus voir')}
    <p class="small" style="margin:14px 0 0"><b>Mauvaises nouvelles :</b> ${esc(lvl.label)}. ${esc(lvl.desc)}</p>
    <button type="button" class="cta" id="draft-ok" style="margin:20px 0 0;width:100%">C'est moi, on y va</button>
    <button type="button" class="link-btn" id="draft-redo">Réécrire mon texte</button>`;
}

$('#profil-body').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'profile-skip') {
    store.set('onboarded', true);
    return show('essentiel');
  }
  if (b.id === 'profile-go') {
    const text = $('#profile-text').value.trim();
    if (text.length < 10) return renderProfileForm('Écris au moins une phrase sur toi.');
    settings.profileText = text;
    b.disabled = true;
    b.textContent = 'L\u2019IA lit ton texte…';
    try {
      const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.profile) throw new Error(data.error || `Erreur ${res.status}`);
      draft = data.profile;
      renderDraft();
    } catch (err) {
      renderProfileForm(err.message || 'Impossible de joindre l\u2019IA.');
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
      themes: draft.themes && draft.themes.length ? [...new Set([...draft.themes, 'autre'])] : settings.themes,
      topics: [...new Set(['monde', ...(draft.topics || [])])],
      level: draft.level,
      resume: draft.resume,
    };
    store.set('onboarded', true);
    draft = null;
    saveSettings();
    show('essentiel');
    toast('Profil enregistré');
  }
});

/* ---------- Démarrage ---------- */
async function load() {
  try {
    const res = await fetch(`edition.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    edition = await res.json();
    sel = select(edition, settings);
    renderEssentiel();
    renderFeed();
  } catch {
    $('#ess-sub').textContent = 'Pas encore d’édition.';
    $('#ess-list').innerHTML = '<div class="empty">La première édition sera prête après le premier passage de la tâche quotidienne sur GitHub. Reviens dans quelques minutes.</div>';
    $('#go-fil').classList.add('hidden');
  }
}
load();
if (!store.get('onboarded', false)) show('profil');
