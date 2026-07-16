export type AtlasMode = "solar" | "galaxy" | "local";
export type GalacticMarkerKind = "center" | "home" | "region";

export type GalacticRegion = {
  id: string;
  name: string;
  kind: string;
  position: [number, number, number];
  distance: string;
  scale: string;
  description: string;
  fact: string;
  color: string;
  markerKind: GalacticMarkerKind;
};

export type NearbyGalaxy = {
  id: string;
  name: string;
  kind: string;
  distanceMly: number;
  /** Schematic 3D Local Group coordinate. One scene unit is 50,000 light-years. */
  position: [number, number, number];
  angle: number;
  height: number;
  diameter: string;
  stars: string;
  description: string;
  fact: string;
  color: string;
  visualSize: number;
  /** Which painter draws it: each Local Group member has a real, known appearance. */
  variant: "milkyway" | "andromeda" | "triangulum" | "magellanic" | "dwarf";
  /** Inclination in radians from face-on — Andromeda's heavy tilt is most of its identity. */
  tilt: number;
};

// Marker positions sit ON the arms drawn by MILKY_WAY_ARMS in galaxyPaint.ts (same frame: one
// unit = 1,000 light-years, Sun at azimuth 90° = +z at radius 26, bar at 118°, disk radius 56
// units). If the arm table moves, these must move with it or the labels drift off their arms.
export const GALACTIC_REGIONS: GalacticRegion[] = [
  { id:"center",name:"Galactic Center",kind:"Central bulge",position:[0,0,0],distance:"About 26,000 light-years from us",scale:"A dense region around Sagittarius A*",description:"The Milky Way's bright central bulge surrounds a supermassive black hole. Dust blocks visible light, so astronomers study much of this region in infrared and radio wavelengths.",fact:"Sagittarius A* contains about four million times the Sun's mass, but the crowded stars around it produce most of the light in this view.",color:"#ffd38a",markerKind:"center" },
  { id:"solar-system",name:"Our Solar System",kind:"Orion Spur",position:[0,0.8,26],distance:"About 26,000 light-years from the center",scale:"One planetary system among billions",description:"The Sun sits in the Orion Spur, a smaller branch between two of the Milky Way's major spiral arms. One orbit around the galaxy takes roughly 230 million years.",fact:"Every human story has happened during less than one ten-thousandth of the Sun's current galactic orbit.",color:"#79dfff",markerKind:"home" },
  { id:"orion",name:"Orion Spur",kind:"Minor spiral feature",position:[-4.9,0,27.7],distance:"Our local galactic neighborhood",scale:"Roughly 10,000 light-years long",description:"The Orion Spur is the bridge of stars, gas, and dust that contains the Sun. It lies between the Sagittarius and Perseus arms.",fact:"Most bright stars we draw as familiar constellations belong to this same small galactic neighborhood.",color:"#8fdcff",markerKind:"region" },
  { id:"sagittarius",name:"Sagittarius Arm",kind:"Minor spiral arm",position:[-32.8,0,-2.9],distance:"Inside the Sun's orbit",scale:"Rich in star-forming regions",description:"The Sagittarius Arm curves between us and the galactic center. Its clouds contain nurseries where new stars are forming.",fact:"The Lagoon and Eagle nebulae are prominent star-forming regions associated with this inward arm.",color:"#ffb97b",markerKind:"region" },
  { id:"perseus",name:"Perseus Arm",kind:"Major spiral arm",position:[-22.7,0,27],distance:"Beyond the Orion Spur",scale:"One of the Milky Way's broad outer arms",description:"The Perseus Arm lies farther from the galactic center than the Sun and can be traced through clusters of young stars and radio observations of gas.",fact:"Mapping this arm from inside the galaxy is like reconstructing a forest's shape while standing between the trees.",color:"#a9bcff",markerKind:"region" },
  { id:"scutum",name:"Scutum-Centaurus Arm",kind:"Major spiral arm",position:[22.6,0,-27],distance:"Across the inner galaxy",scale:"A long, star-rich spiral structure",description:"This arm sweeps from the central bar into the outer disk and contains some of the Milky Way's most massive known star clusters.",fact:"Because we view it through the dusty inner disk, radio and infrared surveys reveal structures that visible-light maps miss.",color:"#ffc58d",markerKind:"region" },
  { id:"norma",name:"Norma Arm",kind:"Minor spiral arm",position:[16.9,0,-3],distance:"Deep in the dusty inner disk",scale:"Traced mainly by radio and infrared surveys",description:"The Norma Arm winds through the crowded inner galaxy on the far side of the bar. Thick dust hides it from optical telescopes, so its path is charted through radio emission from its gas.",fact:"Several surveys suggest the Norma Arm and the Outer Arm may be one continuous arm traced most of the way around the galaxy.",color:"#ffcf9e",markerKind:"region" },
  { id:"outer",name:"Outer Arm",kind:"Outer spiral arm",position:[-35.4,0,35.4],distance:"Beyond the Perseus Arm",scale:"The outermost well-traced arm",description:"The Outer Arm sweeps the galaxy's thin rim beyond Perseus, mapped through clouds of hydrogen gas and precise radio parallaxes of bright masers.",fact:"Out here the galactic disk warps and flares: parts of the Outer Arm rise thousands of light-years above the plane of the inner galaxy.",color:"#9fd0ff",markerKind:"region" },
  { id:"near-3kpc",name:"Near 3kpc Arm",kind:"Inner gas arm",position:[10.4,0,5.5],distance:"About 10,000 light-years from the center, on our side",scale:"An arc hugging the near side of the bar",description:"The Near 3kpc Arm is a stream of gas wrapped around the near side of the central bar. It was discovered in 1957 through 21-centimeter radio observations of hydrogen.",fact:"The whole arm is expanding outward at roughly 50 kilometers per second — gas shepherded by the rotating bar rather than a normal star-forming arm.",color:"#ffe2ae",markerKind:"region" },
  { id:"far-3kpc",name:"Far 3kpc Arm",kind:"Inner gas arm",position:[-10.4,0,-5.5],distance:"About 10,000 light-years from the center, beyond it",scale:"The near arm's mirror on the bar's far side",description:"The Far 3kpc Arm is the matching gas stream on the opposite side of the bar. It hid in plain sight until 2008, when it was found in surveys of carbon monoxide gas.",fact:"Finding the far arm in symmetry with the near one was strong evidence that the Milky Way's center is a rotating bar.",color:"#f3d49c",markerKind:"region" },
];

export const NEARBY_GALAXIES: NearbyGalaxy[] = [
  { id:"milky-way",name:"Milky Way",kind:"Barred spiral galaxy",distanceMly:0,position:[-20,0,-12],angle:0,height:0,diameter:"About 100,000 light-years",stars:"Hundreds of billions",description:"Our home galaxy is a flattened disk with a central bar, spiral structure, and a much larger halo of old stars and dark matter.",fact:"From inside its disk we see the Milky Way as a luminous band wrapping around the night sky.",color:"#ffd6a0",visualSize:5.4,variant:"milkyway",tilt:.35 },
  { id:"andromeda",name:"Andromeda Galaxy",kind:"Spiral galaxy · M31",distanceMly:2.54,position:[18,4,22],angle:0.8,height:3,diameter:"About 152,000 light-years",stars:"Around one trillion",description:"Andromeda is the nearest large spiral galaxy and the Local Group's most massive visible member. It is approaching the Milky Way.",fact:"Its light began traveling toward us before early humans made many of the oldest known stone tools.",color:"#9ec8ff",visualSize:6.4,variant:"andromeda",tilt:1.28 },
  { id:"triangulum",name:"Triangulum Galaxy",kind:"Spiral galaxy · M33",distanceMly:2.73,position:[27,-3,14],angle:1.1,height:-2,diameter:"About 60,000 light-years",stars:"Around 40 billion",description:"Triangulum is the Local Group's third-largest spiral galaxy. Its open spiral arms contain active stellar nurseries.",fact:"Under exceptionally dark skies, it is among the most distant objects visible to the unaided eye.",color:"#a9d7ff",visualSize:3.6,variant:"triangulum",tilt:.55 },
  { id:"lmc",name:"Large Magellanic Cloud",kind:"Dwarf irregular galaxy",distanceMly:.163,position:[-21.8,-1,-14.3],angle:3.7,height:-1,diameter:"About 14,000 light-years",stars:"Around 30 billion",description:"The Large Magellanic Cloud is a satellite of the Milky Way, visibly mottled by gas clouds and intense star formation.",fact:"Supernova 1987A exploded here, giving astronomers the closest observed supernova since the invention of the telescope.",color:"#b8ddff",visualSize:2.1,variant:"magellanic",tilt:.55 },
  { id:"smc",name:"Small Magellanic Cloud",kind:"Dwarf irregular galaxy",distanceMly:.2,position:[-22.6,1.3,-14.9],angle:4.35,height:1.3,diameter:"About 7,000 light-years",stars:"Several billion",description:"The Small Magellanic Cloud is another nearby satellite, distorted by gravitational interactions with the Milky Way and its larger companion.",fact:"A bridge of gas and young stars links the two Magellanic Clouds.",color:"#bdd5ff",visualSize:1.6,variant:"magellanic",tilt:.8 },
  { id:"ngc-6822",name:"Barnard's Galaxy",kind:"Dwarf irregular galaxy · NGC 6822",distanceMly:1.63,position:[-43,-3,15],angle:4.9,height:-3,diameter:"About 7,000 light-years",stars:"Millions to billions",description:"Barnard's Galaxy is a small, irregular member of the Local Group with scattered regions of recent star formation.",fact:"Edwin Hubble's observations of its variable stars helped establish that galaxies exist beyond the Milky Way.",color:"#d7c6ff",visualSize:1.5,variant:"dwarf",tilt:.45 },
  { id:"ic-10",name:"IC 10",kind:"Dwarf irregular galaxy",distanceMly:2.2,position:[5,2,-49],angle:5.35,height:2,diameter:"About 5,000 light-years",stars:"Millions to billions",description:"IC 10 is a small but vigorous starburst galaxy on the Local Group's outskirts.",fact:"Dust in the Milky Way makes IC 10 difficult to study in visible light even though it is relatively nearby.",color:"#f0b9d4",visualSize:1.4,variant:"dwarf",tilt:.6 },
];

export const COSMIC_JOURNEY = [
  { mode:"solar" as AtlasMode,focus:"Earth",eyebrow:"Address 1 · A living world",title:"Earth",note:"Our starting point is one planet orbiting an ordinary star. Pull back, and the entire solar system soon becomes smaller than a single pixel." },
  { mode:"galaxy" as AtlasMode,focus:"solar-system",eyebrow:"Address 2 · Orion Spur",title:"The Sun's neighborhood",note:"The solar system sits about 26,000 light-years from the Milky Way's center, in a minor branch between major spiral arms." },
  { mode:"galaxy" as AtlasMode,focus:"center",eyebrow:"Address 3 · The Milky Way",title:"One galactic orbit",note:"The Sun needs roughly 230 million years to circle the galaxy. Dinosaurs appeared during the previous galactic year." },
  { mode:"local" as AtlasMode,focus:"milky-way",eyebrow:"Address 4 · Local Group",title:"Our galaxy among galaxies",note:"The Milky Way is one of dozens of galaxies bound together in the Local Group. Most are far smaller dwarf galaxies." },
  { mode:"local" as AtlasMode,focus:"andromeda",eyebrow:"Address 5 · Nearest large neighbor",title:"Andromeda",note:"The nearest other large spiral is 2.54 million light-years away. Together, Andromeda and the Milky Way dominate the Local Group." },
];
