"""Narration for one video: spec.json -> narration.m4a + timeline.js (Kokoro, voice af_heart).

usage: python make_audio.py <video dir> <kokoro model dir> <ffmpeg> [voice] [speed]
The model dir holds kokoro-v1.0.onnx and voices-v1.0.bin (see videos/README.md).
"""
import json, os, re, subprocess, sys
import numpy as np, soundfile as sf
import espeakng_loader
from kokoro_onnx import Kokoro
from kokoro_onnx.config import EspeakConfig

base, model_dir, ffmpeg = sys.argv[1], sys.argv[2], sys.argv[3]
voice = sys.argv[4] if len(sys.argv) > 4 else 'af_heart'
speed = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
# espeak-ng keeps its data path in a 160-byte buffer (after resolving symlinks) and silently falls back to a
# build-time path when the real one is longer, which deep venv paths hit, so the data is copied to a short path.
import shutil
data = espeakng_loader.get_data_path()
if len(data) > 150:
    short = os.path.join(os.path.expanduser('~'), '.cache', 'kokoro', 'espeak-ng-data')
    if not os.path.exists(short): shutil.copytree(data, short)
    data = short
k = Kokoro(os.path.join(model_dir, 'kokoro-v1.0.onnx'), os.path.join(model_dir, 'voices-v1.0.bin'), espeak_config=EspeakConfig(data_path=data))
lang = 'en-us' if voice[0] == 'a' else 'en-gb'
spec = json.load(open(os.path.join(base, 'spec.json')))

# Captions keep the technical spelling; the voice gets a readable form unless the cue has its own "say".
SAY = [
    (r'\bgRPC\b', 'G R P C'), (r'\bHTTPS\b', 'H T T P S'), (r'\bHTTP\b', 'H T T P'), (r'\bWSS\b', 'secure websocket'),
    (r'\bSQL\b', 'S Q L'), (r'\bCDN\b', 'C D N'), (r'\bDLQ\b', 'dead letter queue'), (r'\bOTP\b', 'O T P'),
    (r'\bUUID\b', 'U U I D'), (r'\bJWT\b', 'J W T'), (r'\bTTL\b', 'T T L'), (r'\bAPI\b', 'A P I'), (r'\bHLS\b', 'H L S'),
    (r'\bDRM\b', 'D R M'), (r'\bS3\b', 'S three'), (r'\bETA\b', 'E T A'), (r'\bH3\b', 'H three'), (r'\bPSP\b', 'P S P'),
    (r'\bHMAC\b', 'H mac'), (r'\bFFmpeg\b', 'F F m peg'), (r'\bBFF\b', 'B F F'), (r'\bFCM\b', 'F C M'), (r'\bAPNs\b', 'A P N s'),
    (r'\bSMS\b', 'S M S'), (r'\bGPS\b', 'G P S'), (r'\bNX\b', 'N X'), (r'\bEX\b', 'E X'), (r'\bPX\b', 'P X'), (r'\bACK\b', 'ack'),
    (r'\bRPS\b', 'requests per second'), (r'\bP99\b', 'P ninety nine'), (r'\bms\b', 'milliseconds'), (r'\bSETNX\b', 'set N X'),
    (r'\bGEOADD\b', 'geo add'), (r'\bGEOSEARCH\b', 'geo search'), (r'\bHGETALL\b', 'H get all'), (r'\bHSET\b', 'H set'),
    (r'\bINCR\b', 'increment'), (r'\bZREM\b', 'Z rem'), (r'\bE2E\b', 'end to end'), (r'\bWS\b', 'websocket'), (r'\bLB\b', 'load balancer'),
    (r'\bCQRS\b', 'C Q R S'), (r'\bCDC\b', 'C D C'), (r'\bCSV\b', 'C S V'), (r'\bPDF\b', 'P D F'), (r'\bQR\b', 'Q R'), (r'\bID\b', 'I D'),
    (r'\bIDs\b', 'I Ds'), (r'\bURL\b', 'U R L'), (r'\bJSON\b', 'jason'), (r'\bUI\b', 'U I'), (r'\bML\b', 'M L'), (r'\bSPA\b', 'S P A'),
    (r'\bNATS\b', 'nats'), (r'\bES\b', 'elastic search'), (r'\bWAL\b', 'write ahead log'), (r'\bREST\b', 'rest'), (r'\bTLS\b', 'T L S'),
    (r'\bTCP\b', 'T C P'), (r'\bL4\b', 'layer four'), (r'\bIP\b', 'I P'), (r'\bRAM\b', 'ram'), (r'\bGC\b', 'G C'), (r'\bOK\b', 'okay'),
    (r'\bPCI\b', 'P C I'), (r'\b3DS\b', 'three D S'), (r'\bEUR\b', 'euros'), (r'\bAVAILABLE\b', 'available'), (r'\bHELD\b', 'held'),
    (r'\bBOOKED\b', 'booked'), (r'\bPENDING\b', 'pending'), (r'\bCONFIRMED\b', 'confirmed'), (r'\bOFFERED\b', 'offered'),
    (r'\bACCEPTED\b', 'accepted'), (r'\bCAPTURED\b', 'captured'), (r'\bCREATED\b', 'created'), (r'\bREADY\b', 'ready'),
    (r'\bUPLOADING\b', 'uploading'), (r'\bUPLOADED\b', 'uploaded'), (r'\bSENT\b', 'sent'), (r'\bDELIVERED\b', 'delivered'),
    (r'\bFAILED\b', 'failed'), (r'\bUPDATE\b', 'update'), (r'\bINSERT\b', 'insert'), (r'\bSET\b', 'set'), (r'\bWHERE\b', 'where'),
    (r'\bUNIQUE\b', 'unique'), (r'\bON CONFLICT DO NOTHING\b', 'on conflict do nothing'), (r'\bPOST\b', 'post'), (r'\bPUT\b', 'put'),
    (r'\bGET\b', 'get'), (r'_', ' '), (r'/', ' slash '), (r'→', ' to '), (r'#', ' number '), (r'\bvs\.?\b', 'versus'),
]
def say_of(c):
    if c.get('say'): return c['say']
    s = c['cap']
    for pat, rep in SAY: s = re.sub(pat, rep, s)
    return s

scenes = [{'id': 'intro', 'chapter': spec['intro'].get('chapter', 'Intro'), 'cues': spec['intro']['cues']}]
for s in spec['scenes']:
    scenes.append({'id': s['id'], 'chapter': s['chapter'], 'cues': s['steps']})
scenes.append({'id': 'recap', 'chapter': spec['recap'].get('chapter', 'Recap'), 'cues': spec['recap']['items']})

SR = 24000
LEAD, CUE_GAP, SCENE_GAP, TAIL = 0.8, 0.4, 1.1, 2.0
chunks = []
def silence(sec): chunks.append(np.zeros(int(sec * SR), dtype=np.float32))
t = LEAD; silence(LEAD)
timeline = []
for si, s in enumerate(scenes):
    sc = {'id': s['id'], 'chapter': s['chapter'], 'start': t if si == 0 else t - 0.5, 'cues': []}
    for ci, c in enumerate(s['cues']):
        audio, sr = k.create(say_of(c), voice=voice, speed=speed, lang=lang)
        assert sr == SR
        audio = audio.astype(np.float32)
        # Kokoro pads each clip with silence; trim it so the cue starts with the first word.
        nz = np.flatnonzero(np.abs(audio) > 0.01)
        if len(nz): audio = audio[max(0, nz[0] - 1200):nz[-1] + 2400]
        dur = len(audio) / SR
        sc['cues'].append({'start': round(t, 3), 'dur': round(dur, 3), 'cap': c['cap']})
        chunks.append(audio); t += dur
        gap = CUE_GAP if ci < len(s['cues']) - 1 else (SCENE_GAP if si < len(scenes) - 1 else TAIL)
        silence(gap); t += gap
    sc['end'] = round(t - 0.5 if si < len(scenes) - 1 else t, 3)
    sc['start'] = round(sc['start'], 3)
    timeline.append(sc)
wav = os.path.join(base, 'narration.wav')
sf.write(wav, np.concatenate(chunks), SR, subtype='PCM_16')
subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', os.path.join(base, 'narration.m4a')], check=True)
os.remove(wav)
open(os.path.join(base, 'timeline.js'), 'w').write('window.TIMELINE=' + json.dumps({'total': round(t, 3), 'scenes': timeline}) + ';\n')
print(os.path.basename(base), 'total', round(t, 1), 's,', sum(len(s['cues']) for s in scenes), 'cues')
