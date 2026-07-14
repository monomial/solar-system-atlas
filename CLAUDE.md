# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Helios — Solar System Atlas": an interactive 3D solar system built with Three.js, served from a Next.js App Router surface that runs on **vinext** (Cloudflare Workers), not on `next dev`. It renders real heliocentric positions for any date between 1800-01-01 and 2050-12-31.

It was generated with ChatGPT and is hosted on **ChatGPT Sites**, live at https://solar-system-atlas.monomial.chatgpt.site/. That platform explains most of what would otherwise look like stray scaffolding: `.openai/hosting.json` (the Sites manifest, keyed to a `project_id`), the `codex-preview` meta tag, the `scripts/*.sh` Sites lifecycle helpers, and the vinext starter base. Deploys happen when a commit is pushed — the remote Sites builder runs `npm run build` against it — so building locally is a diagnostic step, not part of shipping.

## Commands

- `npm run dev` — Vite/vinext dev server. This is the normal way to run the app.
- `npm run build` — bounded vinext build + Sites artifact validation (writes `dist/`).
- `npm test` — runs `build`, then `node --test tests/rendered-html.test.mjs`.
- `npm run lint` — ESLint (next core-web-vitals + TS).
- `npm run validate:artifact` — recheck an existing `dist/` without rebuilding.
- `npm run db:generate` — Drizzle migrations (only if a schema is ever added).

There is a single test file, so "run a single test" is `node --test tests/rendered-html.test.mjs` against an existing `dist/`.

**Platform caveat:** the `scripts/*.sh` helpers target Linux. `install:ci` requires `flock`, which does not exist on macOS — do not run it here; use a plain `npm install` if deps are missing. `build` requires GNU `timeout` (present on this machine via Homebrew coreutils). Per the README, the remote Sites builder runs `npm run build` on the pushed commit, so build/install are diagnostic commands, not a routine pre-checkpoint step.

`scripts/sites-env.sh` re-homes `HOME`, `TMPDIR`, and the npm cache into a disposable `.sites-runtime/`, which is why lint and build go through bash wrappers rather than calling the binaries directly.

## Architecture

**Rendering path.** `app/page.tsx` → `app/ClientAtlas.tsx` → `app/SolarSystem.tsx`. `ClientAtlas` loads `SolarSystem` via `next/dynamic` with `ssr: false` because the scene needs DOM/WebGL at import time. Everything of substance — data, orbital math, the Three.js scene, and all UI — lives in the single ~570-line `SolarSystem.tsx`.

**The imperative bridge (most important invariant).** The entire Three.js scene is constructed in one mount-once `useEffect` with an empty dependency array. React state does *not* drive the scene through re-renders. Instead the effect publishes `apiRef.current = { focus, scale, date, previewDate }`, and UI handlers call those methods. Adding a dependency to that effect would tear down and rebuild the whole scene on every state change. Keep new scene mutations inside the effect and expose them through `apiRef`.

**Position math is two-tiered.**
- Planets carry `elements` — JPL approximate Keplerian elements as `base` + `rate` per Julian century since J2000.
- Dwarf planets carry `smallBody` — JPL SBDB elements with an epoch and mean motion.

Both flow through `orbitParamsAt` → `heliocentricPosition` (Kepler's equation, 10 Newton iterations) → `orbitalPoint`. On top of that, `updateDate` fetches `/api/dwarf-positions` and *overwrites* the five dwarf positions with true NASA/JPL Horizons vectors. If that request fails, the code silently keeps the two-body approximation as a fallback — so the map still works offline, just less precisely.

**Coordinate convention.** Horizons and the orbital elements are ecliptic (x, y, z); Three.js is y-up. The client swaps axes when consuming API vectors: `new THREE.Vector3(x, z, y)`. Preserve this whenever touching position plumbing.

**`app/api/dwarf-positions/route.ts`** proxies NASA/JPL Horizons server-side. It queries the five dwarfs **sequentially on purpose** — Horizons rate-limits bursts, and five concurrent requests fail often. It validates the date range and caches for 24h.

**Scale modes.** `distanceScale(au, mode)` is the single source of truth: `readable` is `sqrt(au) * 29` (compressed distances, real orbital angles), `linear` is `au * 5.5` (true relative distance, planets enlarged ~0.36×, Sun 0.08×). This function feeds orbit lines, labels, belt point clouds, and the invisible torus click targets for the asteroid/Kuiper belts — a change to it means updating all of those together (see `rebuildScale` and `updateRegions`).

**Moons** are display-only approximations. `moonOrbitRadius` is deliberately *logarithmic*, not physical, so moons stay visible next to their parent; orbits are circular from a stored `phase` rather than solved. Moons are hidden unless their family is selected (`showMoonFamily`). The UI labels this honestly ("DISPLAY SPACING COMPRESSED") — keep that framing.

**WebGL fallback.** If `new THREE.WebGLRenderer()` throws, the mount gets a `.no-webgl` class and a pure-CSS orbit diagram (`.fallback-*` in `globals.css`) takes over while panels and the tour stay interactive. Test changes with this path in mind.

**Textures.** `TEXTURE_MAPS` maps bodies to real NASA-derived images in `public/textures/`; anything absent falls back to `makePlanetTexture`, a procedural canvas gradient. The info panel's "VISUAL MAP" line surfaces which one is in use. Attribution requirements (CC BY 4.0 / NASA credit) are in `public/textures/README.md` — maintain them, and keep the "approximation" wording for Haumea, Makemake, and Eris, which have no resolved surface maps.

**Styling** is hand-written CSS in `app/globals.css` (dense, one-rule-per-line). Tailwind is imported but effectively unused — follow the existing CSS rather than introducing utility classes.

## Conventions

- `SolarSystem.tsx` is written in a deliberately compact style: packed one-liners, no spaces around operators, minimal comments reserved for non-obvious constraints. Match it rather than reformatting.
- The 1800–2050 date bound is enforced in three places that must stay in sync: the API route regex/range check, the `<input type="date">` min/max, and `MIN_SIM_TIME` / `MAX_SIM_TIME` for playback.
- `app/layout.tsx` sets `metadata.other["codex-preview"] = "development"`. The one test asserts this meta tag is present in the rendered HTML — removing it breaks `npm test`.

## Dormant scaffolding

This started from a vinext starter template. D1/Drizzle is wired but inactive: `.openai/hosting.json` has `"d1": null`, `db/schema.ts` is intentionally empty, and `getDb()` throws until a binding exists. `examples/d1/` is an opt-in reference, and `app/chatgpt-auth.ts` provides unused Sign-in-with-ChatGPT helpers. `next.config.ts` is a stub — real config lives in `vite.config.ts` (which simulates Cloudflare bindings locally) and `worker/index.ts` (the actual Worker entry, which also handles image optimization).
