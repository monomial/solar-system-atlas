// Renders every narration line to audio with ElevenLabs, and caches the result.
//
// tvOS ships only "compact" speech voices — 41 of them on an Apple TV, not one enhanced or
// premium, with no way to download better ones (measured on the device, not assumed). So the
// on-device synthesiser is fine for checking that the *words* work and hopeless for actually
// reading to a child. These clips are the real voice; `Narrator` prefers them and falls back to
// synthesis for any line that has not been rendered yet.
//
//   npm run narration              # render anything new or changed
//   npm run narration -- --voices  # list the voices on your account
//   npm run narration -- --sample  # render one line in several voices, to choose between them
//   npm run narration -- --force   # re-render everything, ignoring the cache
//
// The key is read from the ELEVENLABS_API_KEY environment variable, or from the macOS Keychain:
//   security add-generic-password -a "$USER" -s elevenlabs-api-key -w
//
// Caching is by content hash of (text + voice + model), kept in .narration-cache/ outside the
// app bundle. Editing one line re-renders one line. This is real money, so nothing is re-rendered
// without a reason.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, copyFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { NARRATION } from "../app/bodies.ts";

const run = promisify(execFile);

const CACHE = fileURLToPath(new URL("../.narration-cache/", import.meta.url));
const RESOURCES = fileURLToPath(new URL("../tvos/HeliosTV/Resources/", import.meta.url));
const MANIFEST = `${CACHE}manifest.json`;

// eleven_multilingual_v2 is the quality-first model. Speed does not matter here: this runs once,
// offline, at build time, and the output is bundled.
const MODEL = "eleven_multilingual_v2";

async function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  try {
    const { stdout } = await run("security", ["find-generic-password", "-s", "elevenlabs-api-key", "-w"]);
    return stdout.trim();
  } catch {
    console.error("No ElevenLabs key found.\n");
    console.error("  Store it in the Keychain (it will prompt, and will not echo):");
    console.error('    security add-generic-password -a "$USER" -s elevenlabs-api-key -w\n');
    console.error("  ...or set ELEVENLABS_API_KEY in your environment.");
    process.exit(1);
  }
}

async function elevenlabs(path, key, options = {}) {
  const response = await fetch(`https://api.elevenlabs.io/v1${path}`, {
    ...options,
    headers: { "xi-api-key": key, "content-type": "application/json", ...options.headers },
  });
  if (!response.ok) throw new Error(`ElevenLabs ${path} → ${response.status} ${await response.text()}`);
  return response;
}

/** Every line, paired with the stable clip id the app looks for in the bundle. */
function lines() {
  return Object.entries(NARRATION).flatMap(([body, spoken]) =>
    spoken.map((text, index) => ({ id: `narration-${body.toLowerCase()}-${index}`, body, text })),
  );
}

const hash = (text, voice) => createHash("sha256").update(`${text}|${voice}|${MODEL}`).digest("hex").slice(0, 16);

async function speak(text, voice, key, outPath) {
  const response = await elevenlabs(`/text-to-speech/${voice}?output_format=mp3_44100_128`, key, {
    method: "POST",
    body: JSON.stringify({
      text,
      model_id: MODEL,
      // Stability high and style low: this is a calm reading voice for a child at bedtime, not a
      // performance. It has to survive its hundredth hearing without becoming irritating.
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
    }),
  });
  const mp3 = `${outPath}.mp3`;
  await writeFile(mp3, Buffer.from(await response.arrayBuffer()));
  // AAC mono: tvOS plays it natively, and speech does not need stereo or a high bitrate.
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", mp3, "-ac", "1", "-b:a", "64k", `${outPath}.m4a`]);
  await run("rm", ["-f", mp3]);
}

const args = process.argv.slice(2);
const key = await apiKey();
await mkdir(CACHE, { recursive: true });
await mkdir(RESOURCES, { recursive: true });

if (args.includes("--voices")) {
  const { voices } = await (await elevenlabs("/voices", key)).json();
  console.log(`${voices.length} voices on this account:\n`);
  for (const voice of voices) {
    const labels = Object.values(voice.labels ?? {}).join(", ");
    console.log(`  ${voice.voice_id}  ${voice.name.padEnd(18)} ${labels}`);
  }
  console.log("\nPick one, then: npm run narration -- --sample <voice_id> [<voice_id>...]");
  process.exit(0);
}

if (args.includes("--sample")) {
  const voices = args.filter((a) => !a.startsWith("--"));
  if (!voices.length) { console.error("Give me one or more voice ids. Try --voices first."); process.exit(1); }
  // A line with some shape to it: a long sentence, a short one, and a beat in the middle. A voice
  // that can carry this can carry the rest.
  const text = NARRATION.Saturn[5];
  const dir = fileURLToPath(new URL("../.narration-samples/", import.meta.url));
  await mkdir(dir, { recursive: true });
  console.log(`Sampling: "${text}"\n`);
  for (const voice of voices) {
    await speak(text, voice, key, `${dir}sample-${voice}`);
    console.log(`  ${dir}sample-${voice}.m4a`);
  }
  console.log("\nListen, then set the voice id in package.json's narration script.");
  process.exit(0);
}

const voice = process.env.ELEVENLABS_VOICE_ID;
if (!voice) { console.error("Set ELEVENLABS_VOICE_ID. Run with --voices to list them."); process.exit(1); }

const manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, "utf8")) : {};
const force = args.includes("--force");
const all = lines();
let rendered = 0, cached = 0;

for (const { id, text } of all) {
  const digest = hash(text, voice);
  if (!force && manifest[id] === digest && existsSync(`${CACHE}${id}.m4a`)) { cached++; continue; }
  process.stdout.write(`  rendering ${id} ... `);
  await speak(text, voice, key, `${CACHE}${id}`);
  manifest[id] = digest;
  rendered++;
  console.log("done");
}

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

// Cache is the source of truth; Resources/ is a generated copy, so wiping it costs nothing.
const clips = (await readdir(CACHE)).filter((file) => file.endsWith(".m4a"));
for (const clip of clips) await copyFile(`${CACHE}${clip}`, `${RESOURCES}${clip}`);

const characters = all.reduce((sum, { text }) => sum + text.length, 0);
console.log(`\nnarration → ${clips.length} clips in the bundle (${rendered} rendered, ${cached} cached)`);
console.log(`${characters} characters total across ${all.length} lines`);
