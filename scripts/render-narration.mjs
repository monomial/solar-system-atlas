// Renders every narration line to audio, and caches the result.
//
// tvOS ships only "compact" speech voices — 41 of them on an Apple TV, not one enhanced or
// premium, with no way to download better ones (measured on the device, not assumed). So the
// on-device synthesiser is fine for checking that the *words* work and hopeless for actually
// reading to a child. These clips are the real voice; `Narrator` prefers them and falls back to
// synthesis for any line that has not been rendered yet.
//
//   npm run narration -- --sample          # render one line in several voices, to choose between
//   npm run narration                      # render anything new or changed
//   npm run narration -- --force           # re-render everything, ignoring the cache
//
// Caching is by content hash of (text + voice + model + delivery), kept in .narration-cache/
// outside the app bundle. Editing one line re-renders one line. This is real money, so nothing
// is re-rendered without a reason, and `npm run catalog` restores clips from the cache rather
// than dropping them and quietly forcing a paid rebuild.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, copyFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { NARRATION } from "../app/bodies.ts";
import { BRIDGE_SCENES, SPEAKER_VOICES } from "../app/bridgeScenes.ts";

const run = promisify(execFile);

const CACHE = fileURLToPath(new URL("../.narration-cache/", import.meta.url));
const RESOURCES = fileURLToPath(new URL("../tvos/HeliosTV/Media/", import.meta.url));
const WEB_NARRATION = fileURLToPath(new URL("../public/narration/", import.meta.url));
const MANIFEST = `${CACHE}manifest.json`;

// How the line should be *read*, not what it says. gpt-4o-mini-tts takes direction, which is most
// of what a premium voice buys you. This is a parent reading at bedtime, not a documentary.
const DELIVERY = `Read this to a small child, warmly and unhurried.
Gentle and a little bit awed, as though sharing something wonderful you have just remembered.
Slow down for the surprising part. Leave a small pause at each full stop.
Never sing-song, never cutesy, never excited. Calm enough to fall asleep to.`;

const PROVIDERS = {
  // Local neural TTS. No account, no billing, nothing leaves the machine — and crucially, no
  // per-line cost, so rewriting the script stays free. Batched: the model loads once, not 73 times.
  kokoro: {
    model: "Kokoro-82M",
    sampleVoices: ["bm_george", "bf_emma", "af_heart", "am_michael"],
    key: async () => "local",
    batch: async (jobs, voice, outDir) => {
      const venv = fileURLToPath(new URL("../.venv-kokoro/", import.meta.url));
      if (!existsSync(`${venv}bin/python`)) {
        console.error("Kokoro environment missing. Create it once with:\n");
        console.error("  brew install espeak-ng");
        console.error("  uv venv --python 3.12 .venv-kokoro");
        console.error("  VIRTUAL_ENV=.venv-kokoro uv pip install kokoro soundfile\n");
        process.exit(1);
      }
      const script = fileURLToPath(new URL("./kokoro_render.py", import.meta.url));
      const child = execFile(`${venv}bin/python`, [script, outDir]);
      child.stdout.on("data", (chunk) =>
        String(chunk).trim().split("\n").filter(Boolean).forEach((row) => {
          const [id, seconds] = row.split("\t");
          console.log(`  ${id.padEnd(24)} ${seconds}s`);
        }));
      child.stdin.end(JSON.stringify({ voice, speed: Number(process.env.TTS_SPEED ?? 0.9), lines: jobs }));
      await new Promise((resolve, reject) => {
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`kokoro exited ${code}`))));
        child.stderr.on("data", (chunk) => process.stderr.write(chunk));
      });
    },
  },

  openai: {
    model: "gpt-4o-mini-tts",
    // Warm, unhurried candidates. Not the brighter ones — this loops in a living room.
    sampleVoices: ["fable", "sage", "coral", "ballad"],
    key: async () => {
      const key = process.env.OPENAI_API_KEY?.trim();
      if (!key) throw new Error("OPENAI_API_KEY is not set.");
      return key;
    },
    speak: async (text, voice, key, model) => {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: text, voice, instructions: DELIVERY, response_format: "mp3" }),
      });
      if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
      return Buffer.from(await response.arrayBuffer());
    },
  },

  // Kept working in case the account is ever upgraded — the free tier cannot call the API.
  elevenlabs: {
    model: "eleven_multilingual_v2",
    sampleVoices: [],
    key: async () => {
      if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
      const { stdout } = await run("security", ["find-generic-password", "-s", "elevenlabs-api-key", "-w"]);
      return stdout.trim();
    },
    speak: async (text, voice, key, model) => {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
          }),
        },
      );
      if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${await response.text()}`);
      return Buffer.from(await response.arrayBuffer());
    },
  },
};

const providerName = process.env.TTS_PROVIDER ?? "kokoro";
const provider = PROVIDERS[providerName];
if (!provider) { console.error(`Unknown TTS_PROVIDER "${providerName}".`); process.exit(1); }

const key = await provider.key();
const model = process.env.TTS_MODEL ?? provider.model;

// Respellings applied ONLY to what the TTS is handed, never to what the apps display. These
// names don't follow English letter-to-sound rules, so espeak-ng (which Kokoro phonemises
// through) mangles them: Makemake as the English word "make" twice, Haumea as "HAW-mee-ah",
// Charon with a church "ch", Kuiper as "kew-EE-per". Each respelling was chosen by checking its
// espeak phonemes against the correct pronunciation — verifiable without hearing the audio:
//   Makemake /mˈɑːkeɪmˈɑːkeɪ/  Haumea /hˈaʊmeɪə/  Charon /kˈeəɹɒn/  Kuiper /kˈaɪpə/
// The caption on screen still reads Makemake, Haumea, Charon, Kuiper.
const PRONUNCIATIONS = {
  Makemake: "Mahkay mahkay",
  Haumea: "Howmayah",
  Charon: "Care-on",
  Kuiper: "Kyper",
  // Moons espeak gets wrong: Io as "EE-oh", Mimas "MEE-mus", Rhea loses its ending, Miranda
  // "MUR-anda", Oberon drops a syllable, Tethys "TETH-iss". Each respelling checked against the
  // right phonemes (Io /ˈaɪəʊ/, Mimas /mˈaɪməs/, Rhea /ɹˈiːjə/, Miranda /mˈɪɹandə/, Oberon
  // /ˈəʊbəɹən/, Tethys /tˈiːθɪs/). Ganymede, Callisto, Enceladus, Dione, Titania all checked out.
  Io: "Eyeoh",
  Mimas: "Mymus",
  Rhea: "Reeya",
  Miranda: "Mih-randa",
  Oberon: "Oberron",
  Tethys: "Teethiss",
};
function forSpeech(text) {
  let out = text;
  for (const [name, said] of Object.entries(PRONUNCIATIONS)) out = out.replace(new RegExp(`\\b${name}\\b`, "gi"), said);
  return out;
}

/** Every line, paired with the stable clip id the app looks for in the bundle. The text is the
 *  spoken form (pronunciation-corrected); the clip id and the on-screen caption are unaffected. */
const lines = () =>
  Object.entries(NARRATION).flatMap(([body, spoken]) =>
    // Spaces become hyphens ("Milky Way" → milky-way) so ids stay filename- and URL-safe.
    spoken.map((text, index) => ({ id: `narration-${body.toLowerCase().replace(/\s+/g, "-")}-${index}`, body, text: forSpeech(text) })),
  );

/** Starbots Mode's scene/turn lines, each carrying its own speaker voice (unlike `lines()`,
 *  which all share the single global TTS_VOICE). Composite ids (body-scene-turn) keep these
 *  out of the per-body NARRATION id space entirely, so there is no collision to worry about.
 *  A malformed scene or turn is skipped with a warning, not a crash — one bad entry shouldn't
 *  take down the render for every other line in the build. */
const sceneLines = () => {
  const out = [];
  for (const [body, scenes] of Object.entries(BRIDGE_SCENES)) {
    if (!Array.isArray(scenes)) { console.warn(`Skipping ${body}: scenes is not an array`); continue; }
    scenes.forEach((scene, sceneIndex) => {
      if (!scene || !Array.isArray(scene.turns)) { console.warn(`Skipping ${body} scene ${sceneIndex}: missing turns`); return; }
      scene.turns.forEach((turn, turnIndex) => {
        const turnVoice = turn && SPEAKER_VOICES[turn.speaker];
        if (!turn?.text || !turnVoice) { console.warn(`Skipping ${body} scene ${sceneIndex} turn ${turnIndex}: malformed entry`); return; }
        out.push({
          id: `narration-${body.toLowerCase().replace(/\s+/g, "-")}-scene${sceneIndex}-turn${turnIndex}`,
          text: forSpeech(turn.text),
          voice: turnVoice,
        });
      });
    });
  }
  return out;
};

function groupByVoice(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.voice)) groups.set(entry.voice, []);
    groups.get(entry.voice).push(entry);
  }
  return groups;
}

const hash = (text, voice) =>
  createHash("sha256").update(`${text}|${voice}|${model}|${DELIVERY}|${process.env.TTS_SPEED ?? 0.9}`).digest("hex").slice(0, 16);

/** Into the bundle as AAC mono: tvOS plays it natively and speech needs no stereo. */
async function encode(source, outPath) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-ac", "1", "-b:a", "64k", `${outPath}.m4a`]);
  await run("rm", ["-f", source]);
}

/** One line. Used by the per-line (network) providers and by --sample. */
async function render(text, voice, outPath) {
  if (provider.batch) {
    const id = outPath.split("/").pop();
    const dir = outPath.slice(0, -id.length);
    await provider.batch([{ id, text }], voice, dir);
    return encode(`${outPath}.wav`, outPath);
  }
  const mp3 = `${outPath}.mp3`;
  await writeFile(mp3, await provider.speak(text, voice, key, model));
  await encode(mp3, outPath);
}

const args = process.argv.slice(2);
await mkdir(CACHE, { recursive: true });
await mkdir(RESOURCES, { recursive: true });

if (args.includes("--sample")) {
  const voices = args.filter((a) => !a.startsWith("--"));
  const candidates = voices.length ? voices : provider.sampleVoices;
  // A line with shape to it: a long sentence, a short one, and a beat in the middle. A voice that
  // can carry this can carry the rest.
  const text = NARRATION.Saturn[5];
  const dir = fileURLToPath(new URL("../.narration-samples/", import.meta.url));
  await mkdir(dir, { recursive: true });
  console.log(`Sampling with ${providerName}/${model}:\n  "${text}"\n`);
  for (const voice of candidates) {
    await render(text, voice, `${dir}sample-${voice}`);
    console.log(`  ${voice.padEnd(10)} ${dir}sample-${voice}.m4a`);
  }
  console.log(`\nListen, then: TTS_VOICE=<name> npm run narration`);
  process.exit(0);
}

const voice = process.env.TTS_VOICE;
if (!voice) { console.error("Set TTS_VOICE. Run with --sample first to choose one."); process.exit(1); }

const manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, "utf8")) : {};
const force = args.includes("--force");
let rendered = 0, cached = 0;

/** Renders one group of lines that all share a single voice — one call to provider.batch()
 *  per group, since Kokoro reloads its model per voice (see SPEAKER_VOICES in bridgeScenes.ts).
 *  The body-narration group (global TTS_VOICE) and each Starbots speaker group both flow
 *  through here, so caching/manifest/encode behavior stays identical between the two. */
async function renderGroup(entries, groupVoice) {
  const stale = entries.filter(({ id, text }) =>
    force || manifest[id] !== hash(text, groupVoice) || !existsSync(`${CACHE}${id}.m4a`));
  cached += entries.length - stale.length;

  if (stale.length && provider.batch) {
    await provider.batch(stale, groupVoice, CACHE);
    for (const { id, text } of stale) {
      await encode(`${CACHE}${id}.wav`, `${CACHE}${id}`);
      manifest[id] = hash(text, groupVoice);
      rendered++;
    }
  } else {
    for (const { id, text } of stale) {
      process.stdout.write(`  ${id} ... `);
      await render(text, groupVoice, `${CACHE}${id}`);
      manifest[id] = hash(text, groupVoice);
      rendered++;
      console.log("done");
    }
  }
}

await renderGroup(lines(), voice);
for (const [groupVoice, entries] of groupByVoice(sceneLines())) await renderGroup(entries, groupVoice);

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

const clips = (await readdir(CACHE)).filter((file) => file.endsWith(".m4a"));
// The tvOS bundle and the web app both consume the same rendered clips. The web copy is committed
// to the repo because GitHub Pages cannot run Kokoro to regenerate it at deploy time.
await mkdir(WEB_NARRATION, { recursive: true });
for (const clip of clips) {
  await copyFile(`${CACHE}${clip}`, `${RESOURCES}${clip}`);
  await copyFile(`${CACHE}${clip}`, `${WEB_NARRATION}${clip}`);
}

console.log(`\nnarration → ${clips.length} clips in the bundle (${rendered} rendered, ${cached} cached)`);
