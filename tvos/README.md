# Helios TV — ambient orrery

An Apple TV screensaver: the solar system, drawn from **real heliocentric positions for the
current moment**, with the camera drifting slowly between worlds.

This is deliberately *not* a port of the web atlas. The web app is lean-forward and
pointer-driven — a date input, filter rails, a dense fact grid. A TV is ten feet away, driven
by a trackpad remote, and watched rather than operated. So the interaction model is thrown
away and the content is kept: one world, one number, one fact, in type you can read from a
sofa. There is no input. It is meant to be left running.

## Build

```sh
npm run catalog                 # from the repo root: regenerates bodies.json + test goldens
cd tvos && xcodegen generate    # project.yml is the source of truth; the .xcodeproj is generated
open HeliosTV.xcodeproj
```

Or headless:

```sh
xcodebuild -project tvos/HeliosTV.xcodeproj -scheme HeliosTV \
  -sdk appletvsimulator -destination 'platform=tvOS Simulator,name=Apple TV 4K (3rd generation)' build
```

## How it shares code with the web app

Exactly two things, and nothing else:

- **The catalog.** `app/bodies.ts` is the single source of truth for physical data and JPL
  elements. `scripts/emit-catalog.mjs` emits it as `HeliosTV/Resources/bodies.json`, which this
  app decodes. This app carries **no** transcription of the element tables — two hand-maintained
  copies is how the web and the TV quietly start disagreeing about where Pluto is.
- **The maths.** `Orbits.swift` is a port of `app/orbits.ts`, and it is pinned to golden values
  generated from that TypeScript by `scripts/emit-orbit-goldens.mjs`.

The UI is not shared and should not be. See the note above.

## The Kepler solver, and why the tests matter

`Orbits.solveKepler` uses a **Danby starter with Halley iteration**, not Newton starting from
`E = M`. Newton-from-M diverges as eccentricity approaches 1 — the derivative `1 - e·cos(E)`
collapses near perihelion and it settles on the wrong root. It does not throw and does not
produce `NaN`. It returns a confident wrong answer.

In the web app that put NEOWISE (e=0.9992) **hundreds of AU** from its true position for a
quarter of the supported date range, silently, for as long as the feature existed.

So the port is not trusted to "look right on screen". The chain of custody is:

> bisection reference solver → `orbits.ts` (`tests/orbits.test.mjs`) → `orbit-goldens.json` → `Orbits.swift` (`OrbitsTests.swift`)

`OrbitsTests` matches the Swift solver against those goldens to 1e-9 AU. It has been checked
against a deliberately broken solver: three of its tests fail on Newton-from-M.

One thing worth knowing if you extend the goldens: **do not sample the mean anomaly uniformly.**
Newton-from-M only diverges in a narrow band just off perihelion, and a coarse uniform sweep
steps straight over it. A first cut of these goldens used 12 evenly spaced values and the buggy
solver passed against them — green, and blind to the one bug it existed to catch.
`emit-orbit-goldens.mjs` now samples densely near `M = 0` and `M = 2π`.

## Why SceneKit and not RealityKit

RealityKit is Apple's stated direction, and for a long-lived app it is probably right. For this
one, SceneKit wins on the thing that matters most here: `SCNCamera` has `wantsHDR`,
`bloomIntensity`, `bloomThreshold` and `bloomBlurRadius` built in. On a TV the glow around the
Sun is most of the drama, and in SceneKit it is four lines rather than a post-processing chain.

Worth noting against the WWDC25 messaging: SceneKit carries **no `API_DEPRECATED` annotations**
in the tvOS 26.5 SDK, and this target builds with zero deprecation warnings. Revisit if that
changes.

## Running on a real Apple TV

Device builds need code signing; simulator builds do not. The team ID is deliberately kept out
of the repo, so set it in your environment before generating the project:

```sh
export DEVELOPMENT_TEAM=XXXXXXXXXX     # Xcode > Settings > Accounts > your team
cd tvos && xcodegen generate
```

Then, with the Apple TV paired to Xcode and on the same network:

```sh
xcrun devicectl list devices                      # grab the device UUID
xcodebuild -project tvos/HeliosTV.xcodeproj -scheme HeliosTV \
  -destination "platform=tvOS,id=<DEVICE_ID>" -allowProvisioningUpdates build
xcrun devicectl device install app --device <DEVICE_UUID> \
  ~/Library/Developer/Xcode/DerivedData/HeliosTV-*/Build/Products/Debug-appletvos/HeliosTV.app
xcrun devicectl device process launch --device <DEVICE_UUID> com.helios.HeliosTV
```

If the build products land in `Debug-appletvsimulator`, you are still building for the simulator
and the `-destination` is wrong.

Log noise you can ignore on tvOS: `failed to load 'RawCamera' bundle`, `fopen failed for data
file`, and `SCNView implements focusItemsInRect:`. All three are standard platform chatter, not
faults in this app. `signal 15` on exit is SIGTERM — the session was stopped, not a crash.

## The voice

The narration is rendered ahead of time by **Kokoro**, a small open-weights neural TTS model that
runs locally (`scripts/kokoro_render.py`). Not a cloud service — no account, no billing, nothing
leaves the machine, and no per-line cost, which matters more than it sounds: the whole point of
this thing is that the script keeps getting better, and a per-character bill makes you flinch at
every rewrite.

```sh
brew install espeak-ng
uv venv --python 3.12 .venv-kokoro
VIRTUAL_ENV=.venv-kokoro uv pip install kokoro soundfile \
  "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"

npm run narration -- --sample        # hear the candidate voices
TTS_VOICE=bm_george npm run narration # render everything new or changed
```

Clips are cached by content hash of (text + voice + model + speed) in `.narration-cache/`, so
editing one line re-renders one line. `npm run catalog` restores them from that cache rather than
dropping them. OpenAI and ElevenLabs remain wired up behind `TTS_PROVIDER` if you ever want them
(ElevenLabs' free tier cannot call the API; OpenAI needs billing enabled).

`Narrator` prefers a rendered clip and falls back to on-device synthesis, so an unrendered line
still speaks — badly, but it speaks.

## Two bundling traps, both of which bite silently

**The media folder must not be called `Resources`.** A directory by that name at the root of a
tvOS `.app` collides with codesign's bundle layout, and the sign step fails with the wonderfully
unhelpful "code object is not signed at all ... In subcomponent: embedded.mobileprovision". It is
called `Media` for that reason alone.

**It is a folder *reference*, not an enumerated file list.** xcodegen bakes explicit file lists at
generate time, so the first full narration render shipped **zero of its 73 clips** — the project
had been generated before they existed. The app ran perfectly, sounded like a robot, and gave no
indication anything was wrong. `OrreryScene.auditNarrationClips()` now counts the clips at launch
and says so, because a silent downgrade to the robot voice is indistinguishable from success.

## Known gaps
- No screensaver integration yet. tvOS does not let third-party apps supply system screensavers,
  so "leave it running" is the current story. A Top Shelf extension is the closest native hook.
- The dwell and flight timings (11s / 5.5s) are guesses tuned by eye in the simulator. They want
  testing on a sofa.
