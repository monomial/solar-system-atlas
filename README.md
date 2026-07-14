# Helios — Solar System Atlas

An interactive 3D atlas of the solar system. Explore the planets, their major moons, and
the dwarf planets; scrub to any date between 1800 and 2050; and watch the orbits play
forward or backward in time.

**Live: https://monomial.github.io/solar-system-atlas/**

Positions are computed in the browser from JPL orbital elements — planets from the
[approximate Keplerian elements](https://ssd.jpl.nasa.gov/planets/approx_pos.html), dwarf
planets from the [Small-Body Database](https://ssd-api.jpl.nasa.gov/doc/sbdb.html). These
are two-body approximations: good enough to teach with, not good enough to navigate with.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Other commands:

```bash
npm run build        # static export to out/
npm run preview      # serve the built export
npm test             # build, then assert the export is intact
npm run lint
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the static export
and publishes it to GitHub Pages. There is no server: the whole atlas is client-side.

Pages serves this repo from the `/solar-system-atlas` subpath, so the workflow builds with
`NEXT_PUBLIC_BASE_PATH=/solar-system-atlas`. Three.js loads textures by raw URL, so that
prefix is applied in code (`ASSET_BASE` in `app/SolarSystem.tsx`) rather than by Next.

## Credits

Textures are NASA-derived and CC BY 4.0 via [Solar System Scope](https://www.solarsystemscope.com/textures/),
except Pluto, which uses NASA's New Horizons global color map. Full attribution in
[`public/textures/README.md`](public/textures/README.md).

Haumea, Makemake, and Eris are shown as procedural approximations — no spacecraft has
resolved their surfaces.
