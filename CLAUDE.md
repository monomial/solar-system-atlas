# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Helios — Solar System Atlas": an interactive 3D solar system built with Three.js on a Next.js App Router surface. It is a **fully client-side static site** — no server, no API, no database. It renders heliocentric positions for any date between 1800-01-01 and 2050-12-31, computed in the browser.

Deployed to GitHub Pages at https://monomial.github.io/solar-system-atlas/ by `.github/workflows/deploy.yml` on every push to `main`.

It was originally generated with ChatGPT and hosted on ChatGPT Sites (a Cloudflare Workers/vinext stack, with a server route that proxied NASA/JPL Horizons). That was all removed when it moved to Pages; if you find references to vinext, wrangler, D1, or `/api/dwarf-positions`, they are stale.

## Commands

- `npm run dev` — dev server on :3000.
- `npm run build` — static export to `out/`.
- `npm run preview` — serve the built export.
- `npm test` — builds, then asserts the export is intact (`tests/exported-html.test.mjs`).
- `npm run lint`

Single test: `node --test tests/exported-html.test.mjs` against an existing `out/`.

## Architecture

**Rendering path.** `app/page.tsx` → `app/ClientAtlas.tsx` → `app/SolarSystem.tsx`. `ClientAtlas` loads `SolarSystem` via `next/dynamic` with `ssr: false` because the scene needs DOM/WebGL at import time. Everything of substance — data, orbital math, the Three.js scene, and all UI — lives in the single ~550-line `SolarSystem.tsx`. The prerendered HTML is just a shell.

**The imperative bridge (most important invariant).** The entire Three.js scene is constructed in one mount-once `useEffect` with an empty dependency array. React state does *not* drive the scene through re-renders. Instead the effect publishes `apiRef.current = { focus, scale, date, previewDate }`, and UI handlers call those methods. Adding a dependency to that effect would tear down and rebuild the whole scene on every state change. Keep new scene mutations inside the effect and expose them through `apiRef`.

**Position math.** Planets carry `elements` (JPL approximate Keplerian elements, `base` + `rate` per Julian century since J2000); dwarf planets carry `smallBody` (JPL SBDB elements with an epoch and mean motion). Both flow through `orbitParamsAt` → `heliocentricPosition` (Kepler's equation, 10 Newton iterations) → `orbitalPoint`.

These are **two-body approximations** — they ignore perturbations, so accuracy degrades away from each body's epoch (Pluto's elements are from 2016 and Neptune tugs on it). That is a deliberate, accepted tradeoff: this is a teaching tool. The UI says so in the footer; keep that framing honest if you change the math.

**Asset paths and `basePath`.** GitHub Pages serves this project repo from `/solar-system-atlas`, not the domain root. Next rewrites its own asset URLs for `basePath`, but **Three.js loads textures from raw strings, which Next cannot rewrite** — so `ASSET_BASE` (from `NEXT_PUBLIC_BASE_PATH`, set in the deploy workflow) is prefixed onto texture URLs manually in `SolarSystem.tsx`. The favicon in `layout.tsx` is prefixed the same way. Get this wrong and textures 404 *silently*: planets render as flat grey spheres with no console error. Always verify texture loads in a browser after touching asset paths.

**Scale modes.** `distanceScale(au, mode)` is the single source of truth: `readable` is `sqrt(au) * 29` (compressed distances, real orbital angles), `linear` is `au * 5.5` (true relative distance, planets enlarged ~0.36×, Sun 0.08×). It feeds orbit lines, labels, belt point clouds, and the invisible torus click targets for the asteroid/Kuiper belts — changing it means updating all of those together (see `rebuildScale` and `updateRegions`).

**Moons** are display-only approximations. `moonOrbitRadius` is deliberately *logarithmic*, not physical, so moons stay visible next to their parent; orbits are circular from a stored `phase` rather than solved. Moons are hidden unless their family is selected (`showMoonFamily`). The UI labels this honestly ("DISPLAY SPACING COMPRESSED") — keep that framing.

**WebGL fallback.** If `new THREE.WebGLRenderer()` throws, the mount gets a `.no-webgl` class and a pure-CSS orbit diagram (`.fallback-*` in `globals.css`) takes over while panels and the tour stay interactive. Note that most headless browsers cannot create a WebGL context and will hit this path — to QA the real scene you need a headed browser with GPU access.

**Textures.** `TEXTURE_MAPS` maps bodies to real NASA-derived images in `public/textures/`; anything absent falls back to `makePlanetTexture`, a procedural canvas gradient. The info panel's "VISUAL MAP" line surfaces which one is in use. Attribution requirements (CC BY 4.0 / NASA credit) are in `public/textures/README.md` — maintain them, and keep the "approximation" wording for Haumea, Makemake, and Eris, which have no resolved surface maps.

**Styling** is hand-written CSS in `app/globals.css` (dense, one-rule-per-line). Tailwind is imported but effectively unused — follow the existing CSS rather than introducing utility classes.

## Conventions

- `SolarSystem.tsx` is written in a deliberately compact style: packed one-liners, no spaces around operators, minimal comments reserved for non-obvious constraints. Match it rather than reformatting.
- The 1800–2050 date bound is enforced in two places that must stay in sync: the `<input type="date">` min/max, and `MIN_SIM_TIME` / `MAX_SIM_TIME` for playback.
- Static export means no server-side anything: no route handlers, no `headers()`/`cookies()`, no `next/image` optimization (`images.unoptimized` is set). Adding a feature that needs a server means leaving GitHub Pages.
