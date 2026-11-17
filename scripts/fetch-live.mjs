// Récupère l'édition et le journal audio actuellement en ligne, pour republier l'app
// sans tout recalculer (utilisé quand seul le code de l'app change).
import fs from 'node:fs/promises';

const SITE = process.env.SITE || 'https://alexeasylinguee.github.io/NewsPersonalized';
const get = async (path) => {
  const res = await fetch(`${SITE}/${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
};

try {
  await fs.writeFile('docs/edition.json', Buffer.from(await (await get('edition.json')).arrayBuffer()));
  console.log('✓ édition');
} catch (e) {
  console.log(`✗ pas d'édition en ligne (${e.message})`);
}

for (const lang of ['fr', 'en']) {
  let manifest;
  try { manifest = await (await get(`audio/${lang}.json`)).json(); } catch { console.log(`– pas d'audio ${lang}`); continue; }
  await fs.mkdir(`docs/audio/${lang}`, { recursive: true });
  const files = [...Object.values(manifest.clips || {}), ...Object.values(manifest.items || {})].map((x) => x.f);
  let ok = 0;
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(files.slice(i, i + 8).map(async (f) => {
      try { await fs.writeFile(`docs/audio/${f}`, Buffer.from(await (await get(`audio/${f}`)).arrayBuffer())); ok++; } catch { /* fichier manquant */ }
    }));
  }
  await fs.writeFile(`docs/audio/${lang}.json`, JSON.stringify(manifest));
  console.log(`✓ audio ${lang} : ${ok}/${files.length} fichiers`);
}
