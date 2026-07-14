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

const run = promisify(execFile);

const CACHE = fileURLToPath(new URL("../.narration-cache/", import.meta.url));
const RESOURCES = fileURLToPath(new URL("../tvos/HeliosTV/Media/", import.meta.url));
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

/** Every line, paired with the stable clip id the app looks for in the bundle. */
const lines = () =>
  Object.entries(NARRATION).flatMap(([body, spoken]) =>
    spoken.map((text, index) => ({ id: `narration-${body.toLowerCase()}-${index}`, body, text })),
  );

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
const all = lines();
let rendered = 0, cached = 0;

const stale = all.filter(({ id, text }) =>
  force || manifest[id] !== hash(text, voice) || !existsSync(`${CACHE}${id}.m4a`));
cached = all.length - stale.length;

if (stale.length && provider.batch) {
  await provider.batch(stale, voice, CACHE);
  for (const { id, text } of stale) {
    await encode(`${CACHE}${id}.wav`, `${CACHE}${id}`);
    manifest[id] = hash(text, voice);
    rendered++;
  }
} else {
  for (const { id, text } of stale) {
    process.stdout.write(`  ${id} ... `);
    await render(text, voice, `${CACHE}${id}`);
    manifest[id] = hash(text, voice);
    rendered++;
    console.log("done");
  }
}

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

const clips = (await readdir(CACHE)).filter((file) => file.endsWith(".m4a"));
for (const clip of clips) await copyFile(`${CACHE}${clip}`, `${RESOURCES}${clip}`);

console.log(`\nnarration → ${clips.length} clips in the bundle (${rendered} rendered, ${cached} cached)`);
