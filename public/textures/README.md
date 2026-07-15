# Planet texture attribution

`sun.webp`, `mercury.webp`, `venus.webp`, `earth.webp`, `mars.webp`, `jupiter.webp`, `saturn.webp`, `uranus.webp`, `neptune.webp`, and `ceres.webp` are adapted from the 2K texture collection by Solar System Scope, distributed under the [Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/). The collection is based on NASA elevation and imagery data, with color tuned from spacecraft and telescope observations. Ceres is explicitly provided by the collection as a reconstruction because mapped coverage is incomplete.

`moon.webp` is from the same NASA-based, CC BY 4.0 collection.

Source: https://www.solarsystemscope.com/textures/

`pluto.webp` is resized from NASA's **Pluto Global Color Map**, created from New Horizons Ralph/MVIC observations. Credit: NASA/JHUAPL/SwRI.

Source: https://science.nasa.gov/resource/pluto-global-color-map/

`saturn-ring.png` is the Solar System Scope radial ring map, based on NASA/Cassini imagery and distributed under CC BY 4.0. The map is remapped radially in WebGL so the Cassini Division and smaller banding appear at the correct concentric positions.

## Moon maps (tvOS deep-dive)

`io.webp`, `europa.webp`, `ganymede.webp`, `callisto.webp`, `enceladus.webp`, `dione.webp`, and `iapetus.webp` are global mosaics from the **USGS Astrogeology Astropedia** catalogue, produced from NASA Voyager, Galileo, and Cassini imagery. USGS/NASA planetary mosaics are in the **public domain** (credit: NASA / JPL / USGS). Each was downloaded as the source GeoTIFF, downsampled to 2048×1024 equirectangular, and encoded as WebP.

- Galilean moons (Io, Europa, Ganymede, Callisto): Voyager + Galileo SSI global mosaics.
- Enceladus, Dione, Iapetus: Cassini (+ Voyager) global mosaics.

Source: https://astrogeology.usgs.gov/search (files served from `planetarymaps.usgs.gov/mosaic/`).

These are used only by the tvOS deep-dive, which renders moons; the web atlas does not. The other moons in the catalogue (Mars's, most of Saturn's smaller moons, Titan, the Uranian moons, Triton) have no clean global map — partial single-flyby coverage or, for Titan, permanent haze — so they stay procedural colour spheres.

All of the above are 2048x1024 and encoded as WebP at quality 82 (`cwebp -q 82 -m 6`), which cut the texture payload from 6.4 MB to 2.4 MB with no visible change on a sphere (SSIM 0.97-0.998 against the JPEG originals). Re-encode from the upstream sources rather than from these files if you need to change them, so quality losses do not stack.

Haumea, Makemake, and Eris remain procedural appearance approximations because no spacecraft has acquired a resolved global surface map of them.
