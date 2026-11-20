"""Journal audio de Clair : enregistre chaque matin la version « radio » des articles, dans une langue.

Voix : Phonon (Gradium, modèles ouverts, gratuits).
  - anglais : Phonon 31m, licence Apache 2.0 (usage commercial permis), téléchargement libre ;
  - français : Phonon 40m, licence CC BY-NC (non commercial), modèle « gated » : il faut accepter
    ses conditions sur Hugging Face et fournir HF_TOKEN.
Si Phonon ne peut pas être chargé (pas de jeton, Hugging Face indisponible…), on revient à Kokoro.

Usage : python3 scripts/audio.py fr|en docs/edition.json docs/audio
Écrit docs/audio/<langue>/<id>.mp3 et le sommaire docs/audio/<langue>.json.
"""
import datetime
import hashlib
import json
import os
import subprocess
import sys
import time

def _ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


FFMPEG = _ffmpeg()

LANG, EDITION, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
MODEL_DIR = os.environ.get('KOKORO_DIR', 'kokoro')
MAX_ITEMS = int(os.environ.get('AUDIO_MAX', '90'))
MAX_MINUTES = float(os.environ.get('AUDIO_MAX_MINUTES', '45'))  # garde-fou de durée de calcul
SAMPLE = os.environ.get('AUDIO_SAMPLE')  # pour un test rapide : n'enregistre que N articles

KOKORO_VOICE = {'fr': ('ff_siwis', 'fr-fr'), 'en': ('bf_emma', 'en-gb')}[LANG]
PHONON_MODEL = os.environ.get(f'PHONON_MODEL_{LANG.upper()}') or {'fr': 'hf://gradium/phonon-40m-fr', 'en': 'hf://gradium/phonon-31m-en'}[LANG]
PHONON_VOICE = os.environ.get(f'PHONON_VOICE_{LANG.upper()}') or None  # vide : voix par défaut du modèle
ENGINE = os.environ.get('AUDIO_ENGINE', 'phonon')  # « kokoro » pour forcer l'ancienne voix


def load_voice():
    """Renvoie (nom, fonction texte -> (échantillons float32, fréquence))."""
    if ENGINE == 'phonon':
        try:
            import ptts
            tts = ptts.TTS(PHONON_MODEL, lang=LANG, quant='q8', voice=PHONON_VOICE)
            sr = tts.sample_rate
            name = f"phonon:{PHONON_MODEL.split('/')[-1]}:{PHONON_VOICE or 'default'}"
            print(f'Voix : {name}')
            return name, lambda text: (tts.synth(text), sr)
        except Exception as e:  # pas de jeton, modèle indisponible… : on garde un journal audio quand même
            print(f'Phonon indisponible ({type(e).__name__}: {str(e)[:300]}) : retour à Kokoro.')
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(MODEL_DIR, 'kokoro.onnx'), os.path.join(MODEL_DIR, 'voices.bin'))
    voice, lang = KOKORO_VOICE
    print(f'Voix : kokoro:{voice}')
    return f'kokoro:{voice}', lambda text: k.create(text, voice=voice, speed=1.0, lang=lang)
DAYS = {'fr': ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
        'en': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']}[LANG]
MONTHS = {'fr': ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
          'en': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']}[LANG]


def audio_id(url):
    return hashlib.sha1(url.encode('utf-8')).hexdigest()[:12]


def eligible(i):
    """Les articles qui peuvent figurer dans l'édition de quelqu'un (le tri final se fait dans l'app)."""
    if i.get('fait_divers'):
        return False
    if i.get('tone') == 'negative':
        return i.get('importance', 0) >= 5
    return i.get('importance', 0) >= 3


def script(i):
    if LANG == 'en':
        return i.get('radio_en') or '. '.join(x for x in [i.get('title_en') or i.get('title'), i.get('summary_en') or i.get('summary')] if x)
    return i.get('radio') or '. '.join(x for x in [i.get('title'), i.get('summary')] if x)


def main():
    edition = json.load(open(EDITION, encoding='utf-8'))
    d = datetime.datetime.fromisoformat(edition['generated_at'].replace('Z', '+00:00')) + datetime.timedelta(hours=1)
    date = f"{DAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]}" if LANG == 'fr' else f"{DAYS[d.weekday()]}, {MONTHS[d.month - 1]} {d.day}"
    clips = {
        'fr': {
            'intro': f"Bonjour, et bienvenue dans ton édition Clair du {date}. Voici d'abord l'essentiel.",
            'intro_nobad': f"Bonjour, et bienvenue dans ton édition Clair du {date}. Bonne nouvelle : rien de grave à signaler aujourd'hui. Place tout de suite aux belles histoires.",
            'transition': "Voilà pour l'essentiel. Place maintenant aux belles histoires du jour.",
            'outro': "Et voilà, tu es à jour. Pas de fil infini : le reste de ta journée t'appartient. À demain !",
        },
        'en': {
            'intro': f"Hello, and welcome to your Clair edition for {date}. First, the essentials.",
            'intro_nobad': f"Hello, and welcome to your Clair edition for {date}. Good news: nothing serious to report today. Let's go straight to the good stories.",
            'transition': "That's it for the essentials. Now for today's good stories.",
            'outro': "And that's it, you're all caught up. No endless feed: the rest of your day is yours. See you tomorrow!",
        },
    }[LANG]

    items = sorted((i for i in edition['items'] if eligible(i) and script(i)), key=lambda i: -i.get('importance', 0))[:MAX_ITEMS]
    if SAMPLE:
        items = items[:int(SAMPLE)]
    os.makedirs(os.path.join(OUT, LANG), exist_ok=True)
    voice, speak = load_voice()
    start = time.time()

    def record(text, name):
        samples, sr = speak(text)
        path = os.path.join(OUT, LANG, f'{name}.mp3')
        proc = subprocess.run([FFMPEG, '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '1', '-i', '-',
                               '-ac', '1', '-b:a', '48k', path], input=samples.astype('float32').tobytes())
        if proc.returncode != 0:
            raise RuntimeError('ffmpeg')
        return round(len(samples) / sr, 1)

    manifest = {'generated_at': edition['generated_at'], 'voice': voice, 'clips': {}, 'items': {}}
    for name, text in clips.items():
        manifest['clips'][name] = {'f': f'{LANG}/{name}.mp3', 'd': record(text, name)}
    done = 0
    for i in items:
        if (time.time() - start) / 60 > MAX_MINUTES:
            print(f'Limite de {MAX_MINUTES} min atteinte : {done} articles enregistrés.')
            break
        aid = audio_id(i['url'])
        try:
            manifest['items'][i['url']] = {'f': f'{LANG}/{aid}.mp3', 'd': record(script(i), aid)}
            done += 1
        except Exception as e:  # un article raté ne bloque pas le journal
            print(f'✗ {i["url"]}: {e}')
    json.dump(manifest, open(os.path.join(OUT, f'{LANG}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    total = sum(v['d'] for v in manifest['items'].values())
    print(f'{LANG} : {done} articles, {round(total / 60, 1)} min d\'audio, en {round((time.time() - start) / 60, 1)} min.')


if __name__ == '__main__':
    main()
