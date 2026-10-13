# Flow видеа

Всяко видео е интерактивен плейър (HTML + SVG), който върви по озвучена пътека: диаграмата на
системата отляво, панел с текущата стъпка (протокол, команда, бележка) отдясно, субтитри отдолу,
глави за прескачане. Плейърът се вгражда с iframe най-отгоре на страницата на системата.

```
videos/
  player/        engine.js, engine.css, template.html: общият плейър, инлайнва се при билд
  tools/         make_audio.py (Kokoro озвучка), snap.mjs (кадри за проверка с Playwright)
  <slug>/        spec.json (диаграма + стъпки + текст), timeline.js и narration.m4a (генерирани)
```

`build.mjs` взима всяка папка `videos/<slug>/`, чийто slug съвпада със страница от `manifest.json`,
и прави `dist/videos/<slug>/index.html` (+ `narration.m4a`), а в страницата слага `<figure class="video">`
веднага след заглавието.

## spec.json

```jsonc
{
  "intro":  { "title": "…<em>…</em>", "subtitle": "…", "chips": [{ "text": "Kafka", "kind": "async" }], "cues": [{ "cap": "…", "say": "…" }] },
  "nodes":  [{ "id": "gw", "label": "API Gateway", "sub": "auth · rate limit", "type": "service|store|broker|external|client", "x": 630, "y": 240 }],
  "edges":  [{ "id": "gb", "from": "gw", "to": "booking", "label": "gRPC", "dash": true, "kind": "sync|async|read", "via": [[x, y]], "at": 0.5, "dx": 0, "dy": 0 }],
  "lanes":  [{ "text": "WRITE PATH", "x": 300, "y": 195, "kind": "sync", "anchor": "start|end" }],
  "scenes": [{ "id": "happy", "chapter": "Buy a ticket", "kicker": "02 · Scenario 1", "title": "…", "show": ["gw", "…"],
               "steps": [{ "cap": "subtitle and narration", "say": "optional spoken form",
                           "edges": ["gb", "-gb", "st!"],          // -id = reverse direction (response), id! = red (failure)
                           "focus": ["redis"], "tone": "sync|async|read|bad|good",
                           "title": "…", "proto": ["gRPC", "deadline 50 ms"], "code": "…", "note": "html",
                           "marks": [{ "node": "pg", "text": "HELD", "kind": "good" }] }] }],
  "recap":  { "title": "…", "closing": "html", "items": [{ "text": "…", "kind": "sync", "cap": "…" }] }
}
```

- Координатите са пиксели в сцена 1920×1080; диаграмата е в областта x 60..1250, y 190..890, панелът отдясно.
- Всяка стъпка е една реплика (cue). Пакетът тръгва по ребрата в реда, в който са изброени, възелът
  светва при пристигане; всичко от предишните стъпки остава "посетено" до края на сцената.
- `cap` е субтитърът (техническо изписване), `say` е каквото се чете на глас; без `say` инструментът
  сам разгъва gRPC, HTTPS, SQL, `/`, `_` и други.
- Редът на сцените в `timeline.js` е: intro, сцените по ред, recap.

## Озвучка

Kokoro (ONNX) с глас `af_heart`. Моделът не е в repo-то:

```bash
uv venv --python 3.12 kvenv && uv pip install --python kvenv/bin/python kokoro-onnx soundfile
mkdir kmodel && cd kmodel
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

```bash
kvenv/bin/python videos/tools/make_audio.py videos/ticketmaster /path/to/kmodel /path/to/ffmpeg af_heart 1.0
npm run build
```

Инструментът пише `narration.m4a` (AAC, 64 kbps моно) и `timeline.js`. Промяна само по диаграмата или
панелите не иска нова озвучка; промяна в `cap`/`say` или в броя стъпки иска.

## Проверка на кадри

```bash
node videos/tools/snap.mjs dist/videos/ticketmaster/index.html /tmp/stills          # по един кадър на реплика
node videos/tools/snap.mjs dist/videos/ticketmaster/index.html /tmp/stills 12,40.5   # на дадени секунди
```

Скриптът иска `playwright` в `node_modules` до него (не е dependency на проекта).
