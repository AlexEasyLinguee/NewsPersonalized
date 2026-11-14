// Relais Cloudflare pour Clair : transforme le texte « Parle-moi de toi » en profil structuré.
// La clé Gemini reste ici (secret GEMINI_API_KEY du Worker), jamais dans l'app.
// Rien n'est stocké : le texte est envoyé à Gemini, le profil renvoyé à l'app, point.

const ALLOWED_ORIGINS = ['https://alexeasylinguee.github.io'];
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_CHARS = 2000;

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
  if (!res.ok) throw new Error(`Clé Gemini refusée (HTTP ${res.status})`);
  const names = ((await res.json()).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
    .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n));
  const ver = (n) => parseFloat(n.split('-')[1]);
  // Ici on préfère Flash (plus fin) : une seule requête par profil.
  const flash = names.filter((n) => !n.endsWith('-lite')).sort((a, b) => ver(b) - ver(a));
  const lite = names.filter((n) => n.endsWith('-lite')).sort((a, b) => ver(b) - ver(a));
  cachedModel = flash[0] || lite[0];
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405, origin);

    let text = '';
    try { text = String((await request.json()).text || '').trim(); } catch { /* corps invalide */ }
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
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }],
        }),
      });
      if (res.status === 429) return json({ error: 'L’IA est très sollicitée, réessaie dans une minute.' }, 429, origin);
      if (!res.ok) return json({ error: `L’IA a répondu une erreur (${res.status}).` }, 502, origin);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      const profile = cleanProfile(JSON.parse(content.replace(/^```(json)?|```$/g, '').trim()));
      return json({ profile }, 200, origin);
    } catch (e) {
      return json({ error: `Impossible de créer le profil : ${e.message}` }, 502, origin);
    }
  },
};
