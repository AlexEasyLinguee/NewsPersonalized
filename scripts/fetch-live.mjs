// Récupère l'édition et le journal audio actuellement en ligne, pour republier l'app
// sans tout recalculer (utilisé quand seul le code de l'app change).
import fs from 'node:fs/promises';

const SITE = process.env.SITE || 'https://alexeasylinguee.github.io/NewsPersonalized';
const get = async (path) => {
  const res = await fetch(`${SITE}/${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
};

// --json-only : seulement l'édition et les flashs ; --audio-only : seulement le journal audio.
const jsonOnly = process.argv.includes('--json-only');
const audioOnly = process.argv.includes('--audio-only');

if (!audioOnly) {
  for (const f of ['edition.json', 'flash.json']) {
    try {
      await fs.writeFile(`docs/${f}`, Buffer.from(await (await get(f)).arrayBuffer()));
      console.log(`✓ ${f}`);
    } catch (e) {
      console.log(`– pas de ${f} en ligne (${e.message})`);
    }
  }
}

for (const lang of jsonOnly ? [] : ['fr', 'en']) {
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
