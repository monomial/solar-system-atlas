"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

type ScaleMode = "readable" | "linear" | "true";
type SmallBodyCategory = "off" | "all" | "comet" | "asteroid" | "outer";
type BodyName = "Sun" | "Mercury" | "Venus" | "Earth" | "Mars" | "Asteroid Belt" | "Ceres" | "Jupiter" | "Saturn" | "Uranus" | "Neptune" | "Pluto" | "Haumea" | "Makemake" | "Eris" | "Kuiper Belt" | "Moon" | "Phobos" | "Deimos" | "Io" | "Europa" | "Ganymede" | "Callisto" | "Mimas" | "Enceladus" | "Tethys" | "Dione" | "Rhea" | "Titan" | "Iapetus" | "Miranda" | "Ariel" | "Umbriel" | "Titania" | "Oberon" | "Triton" | "Halley" | "Encke" | "67P" | "Hale–Bopp" | "Swift–Tuttle" | "NEOWISE" | "Vesta" | "Pallas" | "Psyche" | "Bennu" | "Chariklo" | "Sedna" | "Arrokoth";
type Planet = {
  name: BodyName;
  kind: string;
  color: string;
  accent: string;
  radiusKm: number;
  radius: number;
  distanceAU: number;
  year: string;
  day: string;
  description: string;
  fact: string;
  shape?: [number,number,number];
  moon?: { parent:BodyName; orbitKm:number; periodDays:number; inclination:number; phase:number; retrograde?:boolean };
  category?: Exclude<SmallBodyCategory,"off"|"all">;
  perihelionAU?: number;
  aphelionAU?: number;
  elements?: {
    base: [number, number, number, number, number, number];
    rate: [number, number, number, number, number, number];
  };
  smallBody?: { epochJD:number; a:number; e:number; i:number; node:number; peri:number; meanAnomaly:number; meanMotion:number };
};

const PLANETS: Planet[] = [
  { name: "Sun", kind: "G-type star", color: "#ffb347", accent: "#fff0bd", radiusKm: 696340, radius: 7.2, distanceAU: 0, year: "230 million Earth years around the Milky Way", day: "About 27 Earth days at its equator", description: "Our star: a huge sphere of hot plasma whose gravity holds the solar system together.", fact: "Every second, the Sun turns about 600 million tons of hydrogen into helium—and loses roughly 4 million tons as energy.", },
  { name: "Mercury", kind: "Rocky planet", color: "#9c9388", accent: "#d9d0c4", radiusKm: 2439.7, radius: 1.28, distanceAU: 0.387, year: "88 Earth days", day: "59 Earth days", description: "The smallest planet and the closest one to the Sun: a cratered world with almost no atmosphere.", fact: "A solar day on Mercury—from one noon to the next—lasts 176 Earth days, twice as long as its year.", elements: { base: [0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593], rate: [0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081] } },
  { name: "Venus", kind: "Rocky planet", color: "#d9a65c", accent: "#ffe0a3", radiusKm: 6051.8, radius: 1.72, distanceAU: 0.723, year: "225 Earth days", day: "243 Earth days", description: "A rocky planet wrapped in thick carbon dioxide clouds and a runaway greenhouse atmosphere.", fact: "Venus spins backward compared with most planets, so the Sun would rise in the west—and its day is longer than its year.", elements: { base: [0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255], rate: [0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418] } },
  { name: "Earth", kind: "Ocean planet", color: "#3e89d8", accent: "#91d7ff", radiusKm: 6371, radius: 1.82, distanceAU: 1, year: "365.25 days", day: "23 hours, 56 minutes", description: "Our home: a rocky, ocean-covered planet with an oxygen-rich atmosphere and one large moon.", fact: "Earth is the only world known to have stable liquid water on its surface—and the only place where we know life exists.", elements: { base: [1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0], rate: [0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0] } },
  { name: "Mars", kind: "Rocky planet", color: "#b44d32", accent: "#ff9a72", radiusKm: 3389.5, radius: 1.48, distanceAU: 1.524, year: "687 Earth days", day: "24 hours, 37 minutes", description: "A cold desert world colored red by iron minerals in its soil, with two tiny moons.", fact: "Olympus Mons is the solar system’s largest volcano—about 2½ times the height of Mount Everest above sea level.", elements: { base: [1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891], rate: [0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343] } },
  { name: "Jupiter", kind: "Gas giant", color: "#caa077", accent: "#ffd3a2", radiusKm: 69911, radius: 4.45, distanceAU: 5.203, year: "11.86 Earth years", day: "9 hours, 56 minutes", description: "The largest planet: a deep, fast-spinning atmosphere of hydrogen and helium with no solid surface.", fact: "Jupiter’s Great Red Spot is a storm wider than Earth that astronomers have watched for at least 150 years.", elements: { base: [5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909], rate: [-0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106] } },
  { name: "Saturn", kind: "Gas giant", color: "#d8be82", accent: "#ffe5a5", radiusKm: 58232, radius: 3.95, distanceAU: 9.537, year: "29.45 Earth years", day: "About 10.7 hours", description: "A pale gas giant encircled by countless pieces of ice and rock arranged into bright rings.", fact: "Saturn is less dense than water. A bathtub big enough for it is impossible—but in that imaginary tub, Saturn would float.", elements: { base: [9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448], rate: [-0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794] } },
  { name: "Uranus", kind: "Ice giant", color: "#75cbd2", accent: "#aef6f6", radiusKm: 25362, radius: 2.78, distanceAU: 19.19, year: "84 Earth years", day: "17 hours, 14 minutes", description: "A cold ice giant with a blue-green methane atmosphere, faint rings, and an extreme tilt.", fact: "Uranus rolls around the Sun on its side. Its 98-degree tilt may be the result of a giant collision long ago.", elements: { base: [19.18916464,0.04725744,0.77263783,313.23810451,170.95427630,74.01692503], rate: [-0.00196176,-0.00004397,-0.00242939,428.48202785,0.40805281,0.04240589] } },
  { name: "Neptune", kind: "Ice giant", color: "#365dcc", accent: "#7797ff", radiusKm: 24622, radius: 2.7, distanceAU: 30.07, year: "164.8 Earth years", day: "16 hours, 6 minutes", description: "The most distant major planet: a dark, cold ice giant with an active blue atmosphere.", fact: "Neptune has the fastest winds measured in the solar system—more than 1,200 mph (2,000 km/h).", elements: { base: [30.06992276,0.00859048,1.77004347,-55.12002969,44.96476227,131.78422574], rate: [0.00026291,0.00005105,0.00035372,218.45945325,-0.32241464,-0.00508664] } },
];

const DWARFS: Planet[] = [
  {name:"Ceres",kind:"Dwarf planet · asteroid belt",color:"#77736e",accent:"#d5cec4",radiusKm:469.7,radius:.92,distanceAU:2.766,year:"4.6 Earth years",day:"9.1 hours",description:"The largest object in the asteroid belt and the only dwarf planet in the inner solar system.",fact:"Ceres may be roughly one-quarter water by mass—and NASA’s Dawn spacecraft found bright salt deposits on its surface.",smallBody:{epochJD:2461200.5,a:2.765552595034094,e:.07969229514816586,i:10.58802780183462,node:80.24862682043221,peri:73.29421453021587,meanAnomaly:274.4193463761342,meanMotion:.21430445064843}},
  {name:"Pluto",kind:"Dwarf planet · Kuiper belt",color:"#b88a6b",accent:"#f1d7bf",radiusKm:1188.5,radius:1.08,distanceAU:39.589,year:"248 Earth years",day:"153.3 hours",description:"A complex icy world with mountains, glaciers, a thin atmosphere, and five known moons.",fact:"Pluto’s heart-shaped Sputnik Planitia is a vast glacier of nitrogen ice that slowly churns like a lava lamp.",smallBody:{epochJD:2457588.5,a:39.58862938517124,e:.2518378778576892,i:17.14771140999114,node:110.2923840543057,peri:113.7090015158565,meanAnomaly:38.68366347318184,meanMotion:.003956838955553025}},
  {name:"Haumea",kind:"Dwarf planet · Kuiper belt",color:"#a8b7c2",accent:"#ecf7ff",radiusKm:870,radius:1.02,distanceAU:43.06,year:"285 Earth years",day:"3.9 hours",description:"A fast-spinning, football-shaped icy world with two moons and a narrow ring.",fact:"Haumea spins so quickly—once every four hours—that it has been stretched into an oval instead of a sphere.",shape:[1.45,.72,.82],smallBody:{epochJD:2461200.5,a:43.06029023650952,e:.1944430148898797,i:28.20847393040364,node:121.7860561329425,peri:240.6905472508661,meanAnomaly:223.2104118812299,meanMotion:.003488097731816818}},
  {name:"Makemake",kind:"Dwarf planet · Kuiper belt",color:"#a7634d",accent:"#efb190",radiusKm:715,radius:1,distanceAU:45.571,year:"305 Earth years",day:"22.8 hours",description:"A reddish, methane-frosted dwarf planet in the Kuiper belt with one known moon.",fact:"Makemake was one of the discoveries that pushed astronomers to create the dwarf-planet category in 2006.",smallBody:{epochJD:2461200.5,a:45.57093317300052,e:.1588889953992523,i:29.02785603743067,node:79.2948338209406,peri:297.0922733397207,meanAnomaly:169.9379962048232,meanMotion:.003203850120050116}},
  {name:"Eris",kind:"Dwarf planet · scattered disc",color:"#c9cdd0",accent:"#ffffff",radiusKm:1200,radius:1.08,distanceAU:67.934,year:"557 Earth years",day:"25.9 hours",description:"A bright, extremely distant icy world whose discovery helped trigger Pluto’s reclassification.",fact:"Eris follows a dramatically tilted 44-degree orbit and can travel nearly 98 AU from the Sun—more than three times Neptune’s distance.",smallBody:{epochJD:2461200.5,a:67.93394687853566,e:.4382385347971672,i:43.9258279471791,node:36.00477044417249,peri:150.7949235840312,meanAnomaly:211.774434275007,meanMotion:.001760247770619088}},
];

// Osculating elements and physical values are from JPL SBDB. These date-aware
// two-body paths are an educational approximation; close planetary encounters
// can gradually move a comet away from a simple ellipse.
const SMALL_BODIES:Planet[]=[
  {name:"Halley",kind:"Periodic comet · Halley type",category:"comet",color:"#6c7378",accent:"#b9e7ff",radiusKm:5.5,radius:.54,distanceAU:17.9286,perihelionAU:.5749,aphelionAU:35.2824,year:"About 76 years",day:"About 2.2 Earth days",description:"The most famous returning comet: a dark, icy nucleus that grows a bright atmosphere and tail near the Sun.",fact:"Dust shed by Halley makes two meteor showers on Earth each year: the Eta Aquariids and Orionids.",shape:[1.35,.72,.76],smallBody:{epochJD:2439875.5,a:17.92863504856923,e:.9679359956953211,i:162.1905300439129,node:59.09894720612437,peri:112.2414314637764,meanAnomaly:274.3823371366792,meanMotion:.01298324443268444}},
  {name:"Encke",kind:"Periodic comet · Encke type",category:"comet",color:"#6f6962",accent:"#ffd6a0",radiusKm:2.4,radius:.46,distanceAU:2.2197,perihelionAU:.3379,aphelionAU:4.1014,year:"3.3 Earth years",day:"11.1 hours",description:"A small, dark comet that repeatedly dives inside Mercury’s orbit and then travels a little beyond Mars.",fact:"Encke has the shortest known orbital period of any numbered comet, and its debris helps feed the Taurid meteor showers.",shape:[1.18,.76,.68],smallBody:{epochJD:2459847.5,a:2.219688710074586,e:.8477496967533629,i:11.41227811179314,node:334.1935846036774,peri:187.1342463695676,meanAnomaly:243.1260693210057,meanMotion:.2980341047245246}},
  {name:"67P",kind:"Periodic comet · Jupiter family",category:"comet",color:"#625e59",accent:"#b9ddff",radiusKm:1.7,radius:.45,distanceAU:3.4622,perihelionAU:1.2433,aphelionAU:5.6812,year:"6.44 Earth years",day:"12.8 hours",description:"A double-lobed comet explored up close by the European Space Agency’s Rosetta spacecraft.",fact:"Rosetta traveled beside 67P for more than two years and released Philae—the first lander ever placed on a comet.",shape:[1.28,.72,.8],smallBody:{epochJD:2457305.5,a:3.462249489765068,e:.6409081306555051,i:7.040294906760007,node:50.13557380441372,peri:12.79824973415729,meanAnomaly:8.859927418758764,meanMotion:.1529912292115438}},
  {name:"Hale–Bopp",kind:"Long-period comet",category:"comet",color:"#77716a",accent:"#d9efff",radiusKm:30,radius:.72,distanceAU:177.4334,perihelionAU:.8905,aphelionAU:353.9762,year:"About 2,360 years",day:"Rotation not well constrained",description:"A large long-period comet whose brilliant 1997 visit was visible to the unaided eye for a record 18 months.",fact:"Hale–Bopp was unusually active while still far beyond Jupiter, which helped astronomers discover it early.",shape:[1.16,.82,.74],smallBody:{epochJD:2459837.5,a:177.4333839117583,e:.9949810027633206,i:89.28759424740302,node:282.7334213961641,peri:130.4146670659176,meanAnomaly:3.878386339423241,meanMotion:.0004170144183266921}},
  {name:"Swift–Tuttle",kind:"Periodic comet · Halley type",category:"comet",color:"#68645f",accent:"#c5e8ff",radiusKm:13,radius:.63,distanceAU:26.0921,perihelionAU:.9595,aphelionAU:51.2246,year:"About 133 years",day:"Rotation not well constrained",description:"A large retrograde comet that crosses Earth’s orbital neighborhood on its long loop around the Sun.",fact:"Tiny grains released by Swift–Tuttle streak into our atmosphere every August as the Perseid meteor shower.",shape:[1.22,.78,.7],smallBody:{epochJD:2450000.5,a:26.0920694978266,e:.963225755046038,i:113.453816997171,node:139.3811920815948,peri:152.9821676305871,meanAnomaly:7.631696167124212,meanMotion:.007395052881692476}},
  {name:"NEOWISE",kind:"Long-period comet",category:"comet",color:"#716b65",accent:"#aee8ff",radiusKm:2.5,radius:.48,distanceAU:358.468,perihelionAU:.2947,aphelionAU:716.6413,year:"About 6,800 years",day:"Rotation not well constrained",description:"A long-period comet discovered by NASA’s NEOWISE mission that became a bright northern-sky visitor in 2020.",fact:"NEOWISE passed closer to the Sun than Mercury does, yet its roughly 5-kilometer-wide nucleus survived the heat.",shape:[1.3,.7,.78],smallBody:{epochJD:2459036.5,a:358.4679565529321,e:.9991780262531292,i:128.9375027594809,node:61.01042818536988,peri:37.2786584481257,meanAnomaly:.0003370720801246702,meanMotion:.0001452207126474352}},
  {name:"Vesta",kind:"Large asteroid · main belt",category:"asteroid",color:"#8a8178",accent:"#e3d5c5",radiusKm:261.385,radius:.76,distanceAU:2.3614,perihelionAU:2.1484,aphelionAU:2.5744,year:"3.63 Earth years",day:"5.34 hours",description:"The second-largest body in the asteroid belt: a rocky protoplanet with a layered interior.",fact:"A colossal impact at Vesta’s south pole launched fragments that later landed on Earth as meteorites.",shape:[1,.93,.85],smallBody:{epochJD:2461200.5,a:2.361365965127599,e:.09020374382834395,i:7.143925545058711,node:103.701293265032,peri:151.4686478221564,meanAnomaly:81.19015607686903,meanMotion:.2716183613599909}},
  {name:"Pallas",kind:"Large asteroid · main belt",category:"asteroid",color:"#77736f",accent:"#cfc9c2",radiusKm:256.5,radius:.75,distanceAU:2.7696,perihelionAU:2.1306,aphelionAU:3.4085,year:"4.61 Earth years",day:"7.81 hours",description:"One of the largest asteroids, following a steeply tilted path through the main belt.",fact:"Pallas’s orbit is tilted about 35 degrees—far more than any planet—so it travels well above and below most of the asteroid belt.",shape:[1,.95,.9],smallBody:{epochJD:2461200.5,a:2.769559010737709,e:.2307000995648547,i:34.93279321851542,node:172.8866193357694,peri:310.9699161652136,meanAnomaly:254.2496521742734,meanMotion:.2138396029251949}},
  {name:"Psyche",kind:"Metal-rich asteroid · main belt",category:"asteroid",color:"#806b61",accent:"#e4bda8",radiusKm:111,radius:.62,distanceAU:2.9257,perihelionAU:2.5309,aphelionAU:3.3205,year:"5.00 Earth years",day:"4.20 hours",description:"An unusually metal-rich asteroid and the destination of NASA’s Psyche spacecraft.",fact:"Psyche may expose material like the deep interior of a small planet, letting scientists study a place humans could never drill to.",shape:[1.1,.9,.82],smallBody:{epochJD:2461200.5,a:2.925720466462538,e:.1349324738201893,i:3.098749116151128,node:149.9753859305033,peri:230.0326782748359,meanAnomaly:79.76939505329617,meanMotion:.1969494758105845}},
  {name:"Bennu",kind:"Near-Earth asteroid · Apollo",category:"asteroid",color:"#4f4c49",accent:"#bcb7b1",radiusKm:.24222,radius:.44,distanceAU:1.1264,perihelionAU:.8969,aphelionAU:1.3559,year:"1.20 Earth years",day:"4.30 hours",description:"A carbon-rich, spinning-top-shaped asteroid whose orbit crosses Earth’s neighborhood.",fact:"NASA’s OSIRIS-REx returned pieces of Bennu to Earth in 2023—the largest asteroid sample ever delivered here.",shape:[1,.92,.84],smallBody:{epochJD:2455562.5,a:1.126391025894812,e:.2037450762416414,i:6.03494377024794,node:2.06086619569642,peri:66.22306084084298,meanAnomaly:101.703952002457,meanMotion:.8244613503320309}},
  {name:"Chariklo",kind:"Ringed centaur",category:"outer",color:"#6d6259",accent:"#d6bfa8",radiusKm:151,radius:.65,distanceAU:15.7344,perihelionAU:13.0466,aphelionAU:18.4221,year:"62.4 Earth years",day:"7.00 hours",description:"A small icy centaur that travels between Saturn and Uranus and carries two narrow rings.",fact:"In 2013, Chariklo became the first object smaller than a planet found to have rings.",shape:[1,.94,.88],smallBody:{epochJD:2461200.5,a:15.73437332078415,e:.1708195854003942,i:23.43190431353433,node:300.4768909592962,peri:241.2066068296425,meanAnomaly:130.0890828375457,meanMotion:.01579173685605144}},
  {name:"Sedna",kind:"Distant trans-Neptunian object",category:"outer",color:"#9d4536",accent:"#ee927f",radiusKm:500,radius:.86,distanceAU:543.7195,perihelionAU:76.1846,aphelionAU:1011.2544,year:"About 12,700 years",day:"10.3 hours",description:"A reddish world on an immense orbit far beyond the Kuiper belt, in the solar system’s remote frontier.",fact:"Even at its closest, Sedna stays more than twice Neptune’s distance from the Sun; at its farthest it travels beyond 1,000 AU.",smallBody:{epochJD:2461200.5,a:543.7195289104732,e:.8598824585187618,i:11.92527582847476,node:144.5061662673739,peri:311.0987725939751,meanAnomaly:358.5956944005428,meanMotion:.00007773948799642578}},
  {name:"Arrokoth",kind:"Cold classical Kuiper belt object",category:"outer",color:"#8c3e35",accent:"#db8878",radiusKm:9,radius:.55,distanceAU:44.0526,perihelionAU:42.4862,aphelionAU:45.619,year:"292 Earth years",day:"15.9 hours",description:"A small, red, double-lobed Kuiper belt object visited by NASA’s New Horizons spacecraft.",fact:"Arrokoth’s two lobes appear to have joined at walking speed, preserving clues to the solar system’s gentle beginnings.",shape:[1.65,.72,.72],smallBody:{epochJD:2461200.5,a:44.05257835991367,e:.03555717645015258,i:2.450613924655929,node:159.0377267890618,peri:188.8507463365642,meanAnomaly:310.9839309924138,meanMotion:.003370909362685521}},
];

const MOONS:Planet[]=[
  {name:"Moon",kind:"Major moon · Earth",color:"#aaa7a0",accent:"#e7e2d8",radiusKm:1737.4,radius:.58,distanceAU:1,year:"27.3 days around Earth",day:"27.3 Earth days",description:"Earth’s large, airless companion: a cratered world whose gravity drives most ocean tides.",fact:"The Moon is slowly moving away from Earth—about 3.8 centimeters each year.",moon:{parent:"Earth",orbitKm:384400,periodDays:27.322,inclination:5.16,phase:.376}},
  {name:"Phobos",kind:"Moon · Mars",color:"#777069",accent:"#c8bdb0",radiusKm:11.08,radius:.2,distanceAU:1.524,year:"7 hours, 39 minutes around Mars",day:"7 hours, 39 minutes",description:"The larger and innermost of Mars’s two tiny, irregularly shaped moons.",fact:"Phobos is spiraling inward. In tens of millions of years it may break into a ring or crash into Mars.",moon:{parent:"Mars",orbitKm:9375,periodDays:.3187,inclination:1.1,phase:.527}},
  {name:"Deimos",kind:"Moon · Mars",color:"#8b8177",accent:"#d1c2ae",radiusKm:6.2,radius:.16,distanceAU:1.524,year:"30.3 hours around Mars",day:"30.3 hours",description:"Mars’s smaller outer moon, a lumpy body covered by a blanket of dusty rock.",fact:"From Mars, Deimos would look more like a bright star than the large Moon we see from Earth.",moon:{parent:"Mars",orbitKm:23457,periodDays:1.2625,inclination:1.8,phase:.569}},
  {name:"Io",kind:"Galilean moon · Jupiter",color:"#d5b049",accent:"#fff0a1",radiusKm:1821.49,radius:.52,distanceAU:5.203,year:"1.76 days around Jupiter",day:"1.76 Earth days",description:"A sulfur-colored world squeezed and heated by Jupiter’s gravity and neighboring moons.",fact:"Io is the most volcanically active world known, with eruptions that can throw material hundreds of kilometers high.",moon:{parent:"Jupiter",orbitKm:421800,periodDays:1.762732,inclination:1.3,phase:.919}},
  {name:"Europa",kind:"Galilean moon · Jupiter",color:"#b9a78b",accent:"#eee1c9",radiusKm:1560.8,radius:.47,distanceAU:5.203,year:"3.53 days around Jupiter",day:"3.53 Earth days",description:"A bright, fractured ice shell wrapped around a deep global ocean.",fact:"Europa may hold about twice as much liquid water as all of Earth’s oceans combined.",moon:{parent:"Jupiter",orbitKm:671100,periodDays:3.525463,inclination:1.8,phase:.959}},
  {name:"Ganymede",kind:"Galilean moon · Jupiter",color:"#77736d",accent:"#c7c5bf",radiusKm:2631.2,radius:.62,distanceAU:5.203,year:"7.16 days around Jupiter",day:"7.16 Earth days",description:"A grooved world of rock and ice—and the largest moon in the solar system.",fact:"Ganymede is the only moon known to generate its own magnetic field.",moon:{parent:"Jupiter",orbitKm:1070400,periodDays:7.155588,inclination:1.5,phase:.902}},
  {name:"Callisto",kind:"Galilean moon · Jupiter",color:"#514a43",accent:"#a79d92",radiusKm:2410.3,radius:.58,distanceAU:5.203,year:"16.69 days around Jupiter",day:"16.69 Earth days",description:"A dark, ancient ice-and-rock world covered with overlapping impact craters.",fact:"Callisto has one of the oldest and most heavily cratered surfaces anywhere in the solar system.",moon:{parent:"Jupiter",orbitKm:1882700,periodDays:16.69044,inclination:1.6,phase:.243}},
  {name:"Mimas",kind:"Major moon · Saturn",color:"#a7a39b",accent:"#e1ddd4",radiusKm:198.2,radius:.28,distanceAU:9.537,year:"22.6 hours around Saturn",day:"22.6 hours",description:"A small icy moon dominated by an enormous round impact scar.",fact:"Herschel crater makes Mimas resemble the Death Star—but the resemblance is pure coincidence.",moon:{parent:"Saturn",orbitKm:186000,periodDays:.942422,inclination:26.7,phase:.765}},
  {name:"Enceladus",kind:"Major moon · Saturn",color:"#d8e2e7",accent:"#ffffff",radiusKm:252.1,radius:.31,distanceAU:9.537,year:"1.37 days around Saturn",day:"1.37 Earth days",description:"A brilliant ice-covered moon hiding a salty ocean beneath its crust.",fact:"Jets spray ocean water from cracks near Enceladus’s south pole and supply material to Saturn’s E ring.",moon:{parent:"Saturn",orbitKm:238400,periodDays:1.370218,inclination:26.7,phase:.158}},
  {name:"Tethys",kind:"Major moon · Saturn",color:"#b9b8b4",accent:"#eeece5",radiusKm:531.1,radius:.39,distanceAU:9.537,year:"1.89 days around Saturn",day:"1.89 Earth days",description:"A pale, low-density icy moon marked by a huge canyon and impact basin.",fact:"Odysseus crater is roughly two-fifths as wide as Tethys itself.",moon:{parent:"Saturn",orbitKm:295000,periodDays:1.887802,inclination:27.8,phase:0}},
  {name:"Dione",kind:"Major moon · Saturn",color:"#9b9b98",accent:"#deded8",radiusKm:561.4,radius:.4,distanceAU:9.537,year:"2.74 days around Saturn",day:"2.74 Earth days",description:"An icy moon with bright cliff-like fractures cutting across older cratered ground.",fact:"Gravity and magnetic measurements suggest Dione may hide a deep subsurface ocean.",moon:{parent:"Saturn",orbitKm:377700,periodDays:2.736916,inclination:26.7,phase:.589}},
  {name:"Rhea",kind:"Major moon · Saturn",color:"#9c9a95",accent:"#d8d5cf",radiusKm:763.5,radius:.45,distanceAU:9.537,year:"4.52 days around Saturn",day:"4.52 Earth days",description:"Saturn’s second-largest moon, an icy and heavily cratered world with a battered history.",fact:"Rhea’s wispy bright streaks are actually long fractures that expose cleaner ice.",moon:{parent:"Saturn",orbitKm:527200,periodDays:4.517503,inclination:27,phase:.088}},
  {name:"Titan",kind:"Major moon · Saturn",color:"#c88a45",accent:"#ffd08a",radiusKm:2574.76,radius:.61,distanceAU:9.537,year:"15.95 days around Saturn",day:"15.95 Earth days",description:"A giant moon wrapped in a thick orange atmosphere, with rivers and lakes on its surface.",fact:"Titan is the only world besides Earth known to have stable surface liquids—although its lakes are methane and ethane.",moon:{parent:"Saturn",orbitKm:1221900,periodDays:15.945448,inclination:27.3,phase:.033}},
  {name:"Iapetus",kind:"Major moon · Saturn",color:"#756b5e",accent:"#d4c6b1",radiusKm:734.3,radius:.44,distanceAU:9.537,year:"79.33 days around Saturn",day:"79.33 Earth days",description:"A distant two-toned moon with one bright hemisphere, one dark hemisphere, and a strange equatorial ridge.",fact:"Iapetus’s equatorial ridge reaches about 20 kilometers high, giving the moon a walnut-like silhouette.",moon:{parent:"Saturn",orbitKm:3561700,periodDays:79.331002,inclination:34.3,phase:.208}},
  {name:"Miranda",kind:"Major moon · Uranus",color:"#9e9d99",accent:"#dedbd4",radiusKm:235.8,radius:.3,distanceAU:19.19,year:"1.41 days around Uranus",day:"1.41 Earth days",description:"A small icy moon patched with cliffs, grooves, and enormous oval-shaped regions.",fact:"Miranda’s Verona Rupes may be the tallest known cliff in the solar system—possibly around 20 kilometers high.",moon:{parent:"Uranus",orbitKm:129846,periodDays:1.413479,inclination:102.2,phase:.203}},
  {name:"Ariel",kind:"Major moon · Uranus",color:"#b3b1ab",accent:"#eeebe4",radiusKm:578.9,radius:.4,distanceAU:19.19,year:"2.52 days around Uranus",day:"2.52 Earth days",description:"A bright icy moon crossed by long valleys and signs of relatively recent resurfacing.",fact:"Ariel appears to have the youngest surface among Uranus’s five major moons.",moon:{parent:"Uranus",orbitKm:190929,periodDays:2.520379,inclination:97.8,phase:.538}},
  {name:"Umbriel",kind:"Major moon · Uranus",color:"#555654",accent:"#9c9d99",radiusKm:584.7,radius:.4,distanceAU:19.19,year:"4.14 days around Uranus",day:"4.14 Earth days",description:"The darkest major moon of Uranus, with an old surface crowded by impact craters.",fact:"A bright ring on the floor of Wunda crater stands out sharply against Umbriel’s otherwise dark surface.",moon:{parent:"Uranus",orbitKm:265986,periodDays:4.144177,inclination:97.9,phase:.703}},
  {name:"Titania",kind:"Major moon · Uranus",color:"#817e78",accent:"#c8c2b7",radiusKm:788.9,radius:.47,distanceAU:19.19,year:"8.71 days around Uranus",day:"8.71 Earth days",description:"Uranus’s largest moon, a mixture of rock and ice cut by giant fault valleys.",fact:"Titania’s enormous canyons suggest its interior expanded and cracked the surface as it cooled.",moon:{parent:"Uranus",orbitKm:436298,periodDays:8.705869,inclination:97.9,phase:.189}},
  {name:"Oberon",kind:"Major moon · Uranus",color:"#6e6258",accent:"#b7a493",radiusKm:761.4,radius:.46,distanceAU:19.19,year:"13.46 days around Uranus",day:"13.46 Earth days",description:"The outermost major Uranian moon, a dark and cratered mixture of rock and water ice.",fact:"Some impacts on Oberon expose bright material beneath its darker surface.",moon:{parent:"Uranus",orbitKm:583511,periodDays:13.463237,inclination:97.9,phase:.399}},
  {name:"Triton",kind:"Major moon · Neptune",color:"#c9a5a0",accent:"#f2d3cd",radiusKm:1352.6,radius:.46,distanceAU:30.07,year:"5.88 days around Neptune",day:"5.88 Earth days",description:"A cold pinkish world that circles Neptune backward, probably because it was captured long ago.",fact:"Voyager 2 saw dark plumes from nitrogen geysers rising above Triton’s frozen surface.",moon:{parent:"Neptune",orbitKm:354800,periodDays:5.876994,inclination:130.2,phase:.175,retrograde:true}},
];

const ALL_BODIES=[...PLANETS,...DWARFS,...MOONS,...SMALL_BODIES];
const ORBITING_BODIES=[...PLANETS.slice(1),...DWARFS,...SMALL_BODIES];

// Next rewrites its own asset URLs for basePath, but Three.js loads textures from raw
// strings, so these paths must carry the prefix themselves. See next.config.ts.
const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const TEXTURE_MAPS:Partial<Record<BodyName,{path:string;label:string}>>={
  Sun:{path:"/textures/sun.jpg",label:"NASA-based solar reference texture"},
  Mercury:{path:"/textures/mercury.jpg",label:"NASA-based global reference map"},
  Venus:{path:"/textures/venus.jpg",label:"NASA-based cloud-layer reference map"},
  Earth:{path:"/textures/earth.jpg",label:"NASA Blue Marble–based day map"},
  Moon:{path:"/textures/moon.jpg",label:"NASA-based lunar global map"},
  Mars:{path:"/textures/mars.jpg",label:"NASA-based global reference map"},
  Jupiter:{path:"/textures/jupiter.jpg",label:"NASA-based atmospheric reference map"},
  Saturn:{path:"/textures/saturn.jpg",label:"NASA-based atmosphere · Cassini-derived ring bands"},
  Uranus:{path:"/textures/uranus.jpg",label:"NASA-based atmospheric reference map"},
  Neptune:{path:"/textures/neptune.jpg",label:"NASA-based atmospheric reference map"},
  Ceres:{path:"/textures/ceres.jpg",label:"Reference reconstruction · incomplete mapping"},
  Pluto:{path:"/textures/pluto.jpg",label:"New Horizons global color mosaic"},
};

const TOUR: { body: BodyName; eyebrow: string; title: string; note: string }[] = [
  { body: "Sun", eyebrow: "Stop 1 · The anchor", title: "Begin at the star", note: "The Sun contains 99.86% of the solar system’s mass. Everything here is falling around it." },
  { body: "Mercury", eyebrow: "Stop 2 · Inner frontier", title: "A world of extremes", note: "Mercury races around the Sun faster than any other planet, but turns very slowly." },
  { body: "Venus", eyebrow: "Stop 3 · Earth’s strange twin", title: "The hottest planet", note: "Venus is not closest to the Sun, yet its thick atmosphere traps enough heat to melt lead." },
  { body: "Earth", eyebrow: "Stop 4 · One astronomical unit", title: "The pale blue reference point", note: "Astronomers use Earth’s average Sun-distance—149.6 million km—as a measuring stick: 1 AU." },
  { body: "Mars", eyebrow: "Stop 5 · The red world", title: "A planet-sized archive", note: "Mars preserves ancient river valleys and lake beds from a time when it was warmer and wetter." },
  { body: "Asteroid Belt", eyebrow: "Stop 6 · Between the worlds", title: "The asteroid belt", note: "Most asteroids orbit between Mars and Jupiter, spread across an enormous region. A spacecraft can usually cross it without coming close to one." },
  { body: "Jupiter", eyebrow: "Stop 7 · Giant country", title: "A miniature system", note: "Jupiter and its many moons behave almost like a small solar system inside our own." },
  { body: "Saturn", eyebrow: "Stop 8 · Rings in motion", title: "Billions of orbiting pieces", note: "Saturn’s rings are enormous across, but the main rings are typically only about 10 meters thick." },
  { body: "Uranus", eyebrow: "Stop 9 · The sideways world", title: "An ice giant tipped over", note: "Uranus rotates almost on its side. Each pole experiences about 42 Earth years of sunlight followed by 42 years of darkness." },
  { body: "Neptune", eyebrow: "Stop 10 · The blue edge", title: "Four light-hours from home", note: "At Neptune, sunlight is about 900 times dimmer than it is on Earth." },
  { body: "Kuiper Belt", eyebrow: "Stop 11 · Beyond the planets", title: "The Kuiper belt", note: "This broad ring of icy leftovers begins near Neptune and extends to roughly 50 AU. Pluto is one of its best-known residents." },
];

const SOURCE_LINKS = [
  ["JPL orbital elements", "https://ssd.jpl.nasa.gov/planets/approx_pos.html"],
  ["JPL Small-Body Database", "https://ssd-api.jpl.nasa.gov/doc/sbdb.html"],
  ["JPL satellite elements", "https://ssd.jpl.nasa.gov/sats/elem/"],
  ["JPL satellite physical data", "https://ssd.jpl.nasa.gov/sats/phys_par/"],
  ["Planet texture maps · CC BY 4.0", "https://www.solarsystemscope.com/textures/"],
  ["NASA Pluto global color map", "https://science.nasa.gov/resource/pluto-global-color-map/"],
  ["NASA Cassini ring science", "https://science.nasa.gov/mission/cassini/science/rings/"],
  ["NASA comet facts", "https://science.nasa.gov/solar-system/comets/"],
  ["NASA Arrokoth overview", "https://science.nasa.gov/solar-system/kuiper-belt/arrokoth-2014-mu69/"],
  ["NASA asteroid facts", "https://science.nasa.gov/solar-system/asteroids/"],
  ["NASA planet sizes & locations", "https://science.nasa.gov/solar-system/planets/planet-sizes-and-locations-in-our-solar-system/"],
  ["NASA solar system facts", "https://science.nasa.gov/solar-system/solar-system-facts/"],
];

function deg(v: number) { return v * Math.PI / 180; }
function norm(v: number) { return ((v % 360) + 360) % 360; }

function orbitParamsAt(planet: Planet, date = new Date()) {
  if(planet.smallBody){
    const jd=date.getTime()/86400000+2440587.5;const o=planet.smallBody;
    return [o.a,o.e,o.i,norm(o.meanAnomaly+o.meanMotion*(jd-o.epochJD)),o.node,o.peri];
  }
  if (!planet.elements) return [0,0,0,0,0,0];
  const centuries = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000 / 36525;
  const [a,e,inc,L,longPeri,node]=planet.elements.base.map((v, i) => v + planet.elements!.rate[i] * centuries);
  return [a,e,inc,norm(L-longPeri),node,longPeri-node];
}

function orbitalPoint(planet: Planet, E: number, date = new Date()) {
  const [a, e, inc, , node, peri] = orbitParamsAt(planet, date);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const omega = deg(peri), O = deg(node), I = deg(inc);
  const x = (Math.cos(omega) * Math.cos(O) - Math.sin(omega) * Math.sin(O) * Math.cos(I)) * xp + (-Math.sin(omega) * Math.cos(O) - Math.cos(omega) * Math.sin(O) * Math.cos(I)) * yp;
  const z = (Math.cos(omega) * Math.sin(O) + Math.sin(omega) * Math.cos(O) * Math.cos(I)) * xp + (-Math.sin(omega) * Math.sin(O) + Math.cos(omega) * Math.cos(O) * Math.cos(I)) * yp;
  const y = Math.sin(omega) * Math.sin(I) * xp + Math.cos(omega) * Math.sin(I) * yp;
  return new THREE.Vector3(x, y, z);
}

function heliocentricPosition(planet: Planet, date = new Date()) {
  if (!planet.elements&&!planet.smallBody) return new THREE.Vector3();
  const [, e, , meanAnomaly] = orbitParamsAt(planet, date);
  const M = deg(meanAnomaly);
  let E = M;
  for (let i = 0; i < 20; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return orbitalPoint(planet, E, date);
}

function seeded(n: number) {
  const x = Math.sin(n * 999.91) * 43758.5453;
  return x - Math.floor(x);
}

function mixHex(a:string,b:string,t:number){
  const channels=(value:string)=>[1,3,5].map(index=>parseInt(value.slice(index,index+2),16));
  const [ar,ag,ab]=channels(a),[br,bg,bb]=channels(b);
  return `rgb(${Math.round(ar+(br-ar)*t)},${Math.round(ag+(bg-ag)*t)},${Math.round(ab+(bb-ab)*t)})`;
}

function dateValue(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;}
function utcDateValue(date:Date){return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;}
function dateFromValue(value:string){return new Date(`${value}T12:00:00Z`);}
function dateForMap(value:string){const now=new Date();return value===dateValue(now)?now:dateFromValue(value);}

const PLAYBACK_SPEEDS=[{days:1,label:"1 day / sec"},{days:7,label:"1 week / sec"},{days:30,label:"1 month / sec"},{days:365,label:"1 year / sec"},{days:3650,label:"10 years / sec"}];
const MIN_SIM_TIME=Date.UTC(1800,0,1,12),MAX_SIM_TIME=Date.UTC(2050,11,31,12);

function makePlanetTexture(planet: Planet) {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const highlight=mixHex(planet.color,planet.accent,.28);
  const lowlight=mixHex(planet.color,"#101522",.7);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, highlight); grad.addColorStop(.42, planet.color); grad.addColorStop(1, lowlight);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 256);
  if (["Jupiter", "Saturn", "Venus", "Uranus", "Neptune"].includes(planet.name)) {
    for (let y = 12; y < 250; y += planet.name === "Jupiter" ? 13 : 20) {
      const alpha = .07 + seeded(y) * .13;
      const band=planet.name === "Neptune" ? "150,180,238" : planet.name === "Uranus" ? "157,213,213" : "218,187,137";
      ctx.fillStyle = `rgba(${band},${alpha})`;
      ctx.fillRect(0, y, 512, 3 + seeded(y + 1) * 7);
    }
    if (planet.name === "Jupiter") { ctx.fillStyle = "rgba(153,51,31,.68)"; ctx.beginPath(); ctx.ellipse(355, 159, 34, 12, -.08, 0, Math.PI * 2); ctx.fill(); }
  } else {
    for (let i = 0; i < 260; i++) {
      const x = seeded(i * 3) * 512, y = seeded(i * 7 + 2) * 256, r = 1 + seeded(i * 11) * 9;
      ctx.fillStyle = planet.name === "Earth" ? (seeded(i) > .55 ? "rgba(54,112,59,.78)" : "rgba(220,235,240,.16)") : `rgba(30,20,18,${.04 + seeded(i + 8) * .22})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function labelTexture(name: string, color: string) {
  const c = document.createElement("canvas"); c.width = 384; c.height = 96; const x = c.getContext("2d")!;
  x.font = "600 30px Arial"; x.textAlign = "center"; x.fillStyle = "rgba(5,8,18,.78)"; x.roundRect(62, 17, 260, 58, 29); x.fill();
  x.strokeStyle = color; x.globalAlpha = .5; x.stroke(); x.globalAlpha = 1; x.fillStyle = "#c3c9d4"; x.fillText(name.toUpperCase(), 192, 55);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export default function Home() {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ focus:(name:BodyName,close?:boolean)=>void;scale:(mode:ScaleMode)=>void;smallBodies:(category:SmallBodyCategory)=>void;date:(date:Date)=>void;previewDate:(date:Date)=>void }|null>(null);
  const [selected, setSelected] = useState<BodyName | null>("Earth");
  const [tourIndex, setTourIndex] = useState<number | null>(null);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("readable");
  const [smallBodyCategory,setSmallBodyCategory]=useState<SmallBodyCategory>("off");
  const [distanceLabel, setDistanceLabel] = useState("30 AU span");
  const [ready, setReady] = useState(false);
  const today=dateValue(new Date());const [mapDate,setMapDate]=useState(today);
  const selectedDate=useMemo(()=>dateForMap(mapDate),[mapDate]);const isToday=mapDate===today;
  const [isPlaying,setIsPlaying]=useState(false);const [playbackRate,setPlaybackRate]=useState(30);const [playbackDirection,setPlaybackDirection]=useState<1|-1>(1);const simulationDateRef=useRef(selectedDate);
  const selectedBody = useMemo(() => ALL_BODIES.find(p => p.name === selected), [selected]);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#02030a");
    scene.fog = new THREE.FogExp2("#02030a", .00135);
    const camera = new THREE.PerspectiveCamera(46, mount.clientWidth / mount.clientHeight, .000001, 12000);
    camera.position.set(0, 115, 165);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer:true });
    } catch {
      mount.classList.add("no-webgl");
      apiRef.current = { focus:(name)=>setSelected(name),scale:()=>setSelected(null),smallBodies:()=>undefined,date:()=>undefined,previewDate:()=>undefined };
      window.setTimeout(() => setReady(true), 0);
      return () => { apiRef.current = null; };
    }
    renderer.setSize(mount.clientWidth, mount.clientHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .98;
    mount.appendChild(renderer.domElement);
    const textureManager=new THREE.LoadingManager();
    const textureLoader=new THREE.TextureLoader(textureManager);
    const maxAnisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    function mappedTexture(body:Planet){
      const source=TEXTURE_MAPS[body.name];
      if(!source)return makePlanetTexture(body);
      const texture=textureLoader.load(`${ASSET_BASE}${source.path}`);
      texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=maxAnisotropy;texture.wrapS=THREE.RepeatWrapping;
      return texture;
    }
    const saturnRingTexture=textureLoader.load(`${ASSET_BASE}/textures/saturn-ring.png`);
    saturnRingTexture.colorSpace=THREE.SRGBColorSpace;saturnRingTexture.anisotropy=maxAnisotropy;saturnRingTexture.wrapS=THREE.ClampToEdgeWrapping;
    function radialRingGeometry(inner:number,outer:number){
      const geometry=new THREE.RingGeometry(inner,outer,256,1);const positions=geometry.attributes.position,uv=geometry.attributes.uv;
      for(let i=0;i<positions.count;i++){const radius=Math.hypot(positions.getX(i),positions.getY(i));uv.setXY(i,(radius-inner)/(outer-inner),.5);}
      return geometry;
    }
    const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 1.05, .85, .62));
    const coarsePointer=window.matchMedia("(pointer: coarse)").matches;
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .045; controls.minDistance = 3; controls.maxDistance = 6500; controls.zoomSpeed = coarsePointer ? .9 : .7; controls.rotateSpeed = coarsePointer ? .32 : .4; controls.enablePan=!coarsePointer;
    controls.touches.ONE=THREE.TOUCH.ROTATE;controls.touches.TWO=THREE.TOUCH.DOLLY_ROTATE;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight("#6a83be", .58));
    // Constant display-space strength keeps the lit side detailed in both readable and linear scale modes.
    const sunLight = new THREE.PointLight("#ffd7a1", 1.2, 0, 0); scene.add(sunLight);

    const starGeo = new THREE.BufferGeometry(); const starCount = 5200; const stars = new Float32Array(starCount * 3); const starColors = new Float32Array(starCount * 3);
    const col = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      const r = 180 + seeded(i) * 640, th = seeded(i + 8) * Math.PI * 2, ph = Math.acos(2 * seeded(i + 18) - 1);
      stars[i*3] = r * Math.sin(ph) * Math.cos(th); stars[i*3+1] = r * Math.cos(ph) * .7; stars[i*3+2] = r * Math.sin(ph) * Math.sin(th);
      col.set(i % 13 === 0 ? "#7aa2ff" : i % 17 === 0 ? "#ffd1aa" : "#ffffff"); starColors.set([col.r,col.g,col.b], i*3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(stars, 3)); starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
    const starField = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: .72, transparent: true, opacity: .72, vertexColors: true, sizeAttenuation: true, depthWrite: false })); scene.add(starField);

    const bodies = new Map<BodyName, THREE.Mesh>(); const labels: THREE.Sprite[] = []; const orbitGroup = new THREE.Group(); scene.add(orbitGroup);
    const planetGroup = new THREE.Group(); scene.add(planetGroup);
    const sunGeo = new THREE.SphereGeometry(7.2, 64, 64);
    const sunMat = new THREE.MeshBasicMaterial({ map:mappedTexture(PLANETS[0]),color:"#ffc66c" });
    const sun = new THREE.Mesh(sunGeo, sunMat); sun.userData.body = "Sun"; planetGroup.add(sun); bodies.set("Sun", sun);
    const glowMap = (() => { const c=document.createElement("canvas");c.width=128;c.height=128;const x=c.getContext("2d")!;const g=x.createRadialGradient(64,64,4,64,64,64);g.addColorStop(0,"rgba(255,244,190,1)");g.addColorStop(.22,"rgba(255,171,51,.8)");g.addColorStop(1,"rgba(255,102,0,0)");x.fillStyle=g;x.fillRect(0,0,128,128);return new THREE.CanvasTexture(c); })();
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowMap,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})); sunGlow.scale.set(33,33,1); sun.add(sunGlow);

    const orbitMaterials: THREE.LineBasicMaterial[] = [];
    const KM_PER_AU=149_597_870.7,UNITS_PER_AU=5.5;
    const distanceScale = (au: number, mode: ScaleMode) => mode === "readable" ? Math.sqrt(au) * 29 : au * UNITS_PER_AU;
    function transformed(raw: THREE.Vector3, mode: ScaleMode) { const au=raw.length(); return au ? raw.clone().normalize().multiplyScalar(distanceScale(au, mode)) : raw.clone(); }
    function bodyDisplayScale(body:Planet,mode:ScaleMode){
      if(mode==="readable")return 1;
      if(mode==="linear")return body.name==="Sun"?.08:.36;
      return (body.radiusKm/KM_PER_AU*UNITS_PER_AU)/body.radius;
    }
    let activeDate=new Date();

    type BeltSeed = [angle: number, au: number, height: number];
    function beltSeeds(count: number, innerAU: number, outerAU: number, offset: number): BeltSeed[] {
      return Array.from({length:count},(_,i)=>[seeded(i+offset)*Math.PI*2,innerAU+seeded(i+offset+30)*(outerAU-innerAU),(seeded(i+offset+60)-.5)]);
    }
    function beltCloud(seeds: BeltSeed[], color: string, size: number) {
      const geometry=new THREE.BufferGeometry();
      const points=new THREE.Points(geometry,new THREE.PointsMaterial({color,size,transparent:true,opacity:.38,depthWrite:false}));
      scene.add(points); return points;
    }
    function setBeltPositions(points: THREE.Points, seeds: BeltSeed[], mode: ScaleMode, thickness: number) {
      const positions=new Float32Array(seeds.length*3);
      seeds.forEach(([angle,au,height],i)=>{const r=distanceScale(au,mode);positions[i*3]=Math.cos(angle)*r;positions[i*3+1]=height*thickness;positions[i*3+2]=Math.sin(angle)*r;});
      points.geometry.dispose(); points.geometry=new THREE.BufferGeometry(); points.geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
    }
    const asteroidSeeds=beltSeeds(1900,2.1,3.3,70); const kuiperSeeds=beltSeeds(2700,30,50,9000);
    const dustBelt=beltCloud(asteroidSeeds,"#8b7f78",.2); const kuiperBelt=beltCloud(kuiperSeeds,"#6587b8",.28);
    setBeltPositions(dustBelt,asteroidSeeds,"readable",3.4); setBeltPositions(kuiperBelt,kuiperSeeds,"readable",10);

    const regionTargets=new Map<BodyName,THREE.Object3D>();
    function regionTarget(name: BodyName, au: number) { const target=new THREE.Object3D();target.position.set(distanceScale(au,"readable"),0,0);scene.add(target);regionTargets.set(name,target);return target; }
    regionTarget("Asteroid Belt",2.7); regionTarget("Kuiper Belt",40);
    function regionClick(name: BodyName, innerAU: number, outerAU: number) {
      const inner=distanceScale(innerAU,"readable"),outer=distanceScale(outerAU,"readable");
      const mesh=new THREE.Mesh(new THREE.TorusGeometry((inner+outer)/2,(outer-inner)/2,8,180),new THREE.MeshBasicMaterial({transparent:true,opacity:.001,depthWrite:false,side:THREE.DoubleSide}));
      mesh.rotation.x=Math.PI/2;mesh.userData.body=name;scene.add(mesh);return mesh;
    }
    const asteroidClick=regionClick("Asteroid Belt",2.1,3.3); const kuiperClick=regionClick("Kuiper Belt",30,50); const regionClicks=[asteroidClick,kuiperClick];
    function updateRegions(mode: ScaleMode) {
      setBeltPositions(dustBelt,asteroidSeeds,mode,3.4);setBeltPositions(kuiperBelt,kuiperSeeds,mode,10);
      dustBelt.visible=mode!=="true";kuiperBelt.visible=mode!=="true";
      regionTargets.get("Asteroid Belt")!.position.x=distanceScale(2.7,mode);regionTargets.get("Kuiper Belt")!.position.x=distanceScale(40,mode);
      ([[asteroidClick,2.1,3.3],[kuiperClick,30,50]] as const).forEach(([mesh,innerAU,outerAU])=>{const inner=distanceScale(innerAU,mode),outer=distanceScale(outerAU,mode);mesh.geometry.dispose();mesh.geometry=new THREE.TorusGeometry((inner+outer)/2,(outer-inner)/2,8,180);});
    }

    let activeScaleMode:ScaleMode="readable";
    let activeSmallBodyCategory:SmallBodyCategory="off";
    const cometTails=new Map<BodyName,{ion:THREE.Line;dust:THREE.Line}>();
    function makeTail(color:string,opacity:number){return new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false,blending:THREE.AdditiveBlending}));}
    function updateCometTail(comet:Planet,pos:THREE.Vector3){
      const tail=cometTails.get(comet.name);if(!tail)return;
      const au=heliocentricPosition(comet,activeDate).length(),activity=THREE.MathUtils.clamp((4.2-au)/3.4,0,1),direction=pos.clone().normalize();
      const length=(activeScaleMode==="readable"?2.4:1.35)*(0.2+activity*5.2),dustDirection=direction.clone().lerp(new THREE.Vector3(direction.x,direction.y+.18,direction.z),.5).normalize();
      tail.ion.geometry.dispose();tail.ion.geometry=new THREE.BufferGeometry().setFromPoints([pos,pos.clone().addScaledVector(direction,length)]);
      tail.dust.geometry.dispose();tail.dust.geometry=new THREE.BufferGeometry().setFromPoints([pos,pos.clone().addScaledVector(dustDirection,length*.72)]);
      (tail.ion.material as THREE.LineBasicMaterial).opacity=activity*.68;(tail.dust.material as THREE.LineBasicMaterial).opacity=activity*.34;
    }
    for (const planet of ORBITING_BODIES) {
      const raw = heliocentricPosition(planet,activeDate); const pos = transformed(raw, "readable");
      const geometry = new THREE.SphereGeometry(planet.radius, 48, 32);
      if(planet.shape)geometry.scale(...planet.shape);
      const mat = new THREE.MeshStandardMaterial({ map:mappedTexture(planet), color:"#dedbd3", roughness: planet.name === "Earth" ? .9 : .97, metalness: 0, emissive: planet.color, emissiveIntensity: .025 });
      const mesh = new THREE.Mesh(geometry, mat); mesh.position.copy(pos); mesh.rotation.z = planet.name === "Uranus" ? deg(97.8) : planet.name === "Saturn" ? deg(26.7) : deg(planet.name === "Earth" ? 23.4 : 8); mesh.userData.body = planet.name;mesh.visible=!planet.category; planetGroup.add(mesh); bodies.set(planet.name, mesh);
      if (planet.name === "Saturn" || planet.name === "Uranus" || planet.name === "Chariklo") {
        const inner=planet.radius*(planet.name==="Chariklo"?2.42:1.35),outer=planet.radius*(planet.name === "Saturn" ? 2.3 : planet.name==="Chariklo"?2.64:1.72);
        const ringMaterial=planet.name==="Saturn"?new THREE.MeshBasicMaterial({map:saturnRingTexture,color:"#d8d0c2",side:THREE.DoubleSide,transparent:true,opacity:.92,alphaTest:.015,depthWrite:false}):new THREE.MeshBasicMaterial({color:"#80aeb5",side:THREE.DoubleSide,transparent:true,opacity:.22,depthWrite:false});
        const ring = new THREE.Mesh(planet.name==="Saturn"?radialRingGeometry(inner,outer):new THREE.RingGeometry(inner,outer,128),ringMaterial);
        ring.rotation.x = Math.PI/2; ring.userData.body = planet.name; mesh.add(ring);
      }
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(planet.name,planet.accent),transparent:true,depthTest:false,depthWrite:false})); sprite.position.copy(pos).add(new THREE.Vector3(0,planet.radius+3.2,0)); sprite.scale.set(1,.25,1); sprite.renderOrder=8; sprite.userData.body=planet.name;sprite.visible=!planet.category; planetGroup.add(sprite); labels.push(sprite);
      const pts: THREE.Vector3[] = [];
      const segments=planet.category?300:180;for (let i=0;i<=segments;i++) pts.push(transformed(orbitalPoint(planet,(i/segments)*Math.PI*2,activeDate),"readable"));
      const lineMat = new THREE.LineBasicMaterial({color:planet.accent,transparent:true,opacity:.19}); orbitMaterials.push(lineMat);
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat); line.userData.body=planet.name;line.visible=!planet.category; orbitGroup.add(line);
      if(planet.category==="comet"){const ion=makeTail("#9fe5ff",.5),dust=makeTail("#f0d1a2",.25);ion.userData.body=planet.name;dust.userData.body=planet.name;ion.visible=false;dust.visible=false;scene.add(ion,dust);cometTails.set(planet.name,{ion,dust});updateCometTail(planet,pos);}
    }

    const moonObjects=new Map<BodyName,{moon:Planet;mesh:THREE.Mesh;label:THREE.Sprite;orbit:THREE.LineLoop}>();
    const epoch2000=Date.UTC(2000,0,1,12);
    function compactMoonOrbitRadius(moon:Planet){
      const parent=ALL_BODIES.find(body=>body.name===moon.moon!.parent)!;
      const family=MOONS.filter(sibling=>sibling.moon!.parent===moon.moon!.parent);
      const index=family.findIndex(sibling=>sibling.name===moon.name);
      const largestMoon=Math.max(...family.map(sibling=>sibling.radius));
      const inner=parent.radius+largestMoon+.7,spacing=Math.max(.7,largestMoon*1.45);
      return inner+index*spacing;
    }
    function moonOrbitRadius(moon:Planet,mode:ScaleMode){return mode==="true"?moon.moon!.orbitKm/KM_PER_AU*UNITS_PER_AU:compactMoonOrbitRadius(moon)*(mode==="linear"?.34:1);}
    function moonLocalPosition(moon:Planet,date:Date,mode:ScaleMode){
      const data=moon.moon!,turns=(date.getTime()-epoch2000)/86400000/data.periodDays;const angle=Math.PI*2*(data.phase+(data.retrograde?-turns:turns));const tilt=deg(data.inclination),r=moonOrbitRadius(moon,mode);
      return new THREE.Vector3(Math.cos(angle)*r,Math.sin(angle)*r*Math.sin(tilt),Math.sin(angle)*r*Math.cos(tilt));
    }
    for(const moon of MOONS){
      const parent=bodies.get(moon.moon!.parent)!;const geometry=new THREE.SphereGeometry(moon.radius,28,20);const material=new THREE.MeshStandardMaterial({map:mappedTexture(moon),color:"#d7d5cf",roughness:.98,metalness:0,emissive:moon.color,emissiveIntensity:.018});
      const mesh=new THREE.Mesh(geometry,material);mesh.position.copy(parent.position).add(moonLocalPosition(moon,activeDate,"readable"));mesh.userData.body=moon.name;mesh.visible=false;planetGroup.add(mesh);bodies.set(moon.name,mesh);
      const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture(moon.name,moon.accent),transparent:true,depthTest:false,depthWrite:false}));label.position.copy(mesh.position).add(new THREE.Vector3(0,moon.radius+1.5,0));label.scale.set(1,.25,1);label.renderOrder=8;label.userData.body=moon.name;label.visible=false;planetGroup.add(label);labels.push(label);
      const r=compactMoonOrbitRadius(moon),tilt=deg(moon.moon!.inclination),points:Array<THREE.Vector3>=[];for(let i=0;i<100;i++){const angle=i/100*Math.PI*2;points.push(new THREE.Vector3(Math.cos(angle)*r,Math.sin(angle)*r*Math.sin(tilt),Math.sin(angle)*r*Math.cos(tilt)));}
      const orbit=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:moon.accent,transparent:true,opacity:.16}));orbit.position.copy(parent.position);orbit.visible=false;orbit.userData.body=moon.name;orbitGroup.add(orbit);moonObjects.set(moon.name,{moon,mesh,label,orbit});
    }
    function updateMoonPositions(date:Date,mode:ScaleMode){for(const {moon,mesh,label,orbit} of moonObjects.values()){const parent=bodies.get(moon.moon!.parent)!;mesh.position.copy(parent.position).add(moonLocalPosition(moon,date,mode));mesh.scale.setScalar(bodyDisplayScale(moon,mode));label.position.copy(mesh.position);orbit.position.copy(parent.position);orbit.scale.setScalar(moonOrbitRadius(moon,mode)/compactMoonOrbitRadius(moon));}}
    function showMoonFamily(name:BodyName|null){const selectedBody=ALL_BODIES.find(body=>body.name===name),parent=selectedBody?.moon?.parent??name;for(const {moon,mesh,label,orbit} of moonObjects.values()){const visible=moon.moon!.parent===parent;mesh.visible=visible;label.visible=visible;orbit.visible=visible;}}

    function markerTexture(color:string){const canvas=document.createElement("canvas");canvas.width=64;canvas.height=64;const ctx=canvas.getContext("2d")!;ctx.strokeStyle=color;ctx.lineWidth=5;ctx.beginPath();ctx.arc(32,32,18,0,Math.PI*2);ctx.stroke();ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(32,32,3,0,Math.PI*2);ctx.fill();return new THREE.CanvasTexture(canvas);}
    const markers=new Map<BodyName,THREE.Sprite>();
    for(const definition of ALL_BODIES){const marker=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture(definition.accent),transparent:true,depthTest:false,depthWrite:false,opacity:0}));marker.userData.body=definition.name;marker.renderOrder=9;marker.visible=false;planetGroup.add(marker);markers.set(definition.name,marker);}
    function setSmallBodies(category:SmallBodyCategory){
      activeSmallBodyCategory=category;
      for(const body of SMALL_BODIES){const visible=category!=="off"&&(category==="all"||body.category===category);bodies.get(body.name)!.visible=visible;const label=labels.find(item=>item.userData.body===body.name);if(label)label.visible=visible;const orbit=orbitGroup.children.find(item=>item.userData.body===body.name);if(orbit)orbit.visible=visible;const tail=cometTails.get(body.name);if(tail){tail.ion.visible=visible;tail.dust.visible=visible;}}
    }

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
    const fly = { active:false, start:0, duration:1600, from:new THREE.Vector3(), to:new THREE.Vector3(), targetFrom:new THREE.Vector3(), targetTo:new THREE.Vector3() };
    let lastFocused:BodyName|null="Earth";let viewingFullSystem=false;
    function focus(name: BodyName, close = true) {
      const body = bodies.get(name) ?? regionTargets.get(name); if (!body) return;
      lastFocused=name;viewingFullSystem=false;
      const isRegion=name==="Asteroid Belt"||name==="Kuiper Belt";
      showMoonFamily(isRegion?null:name);
      if(isRegion){setSelected(null);setTourIndex(TOUR.findIndex(stop=>stop.body===name));}else setSelected(name);
      const definition=ALL_BODIES.find(p=>p.name===name),isMoon=Boolean(definition?.moon);
      const displayScale=definition?bodyDisplayScale(definition,activeScaleMode):1;
      const world = new THREE.Vector3(); body.getWorldPosition(world); const radius = (definition?.radius ?? 4)*displayScale;
      fly.active=true; fly.start=performance.now(); fly.duration=close ? 1700 : 2200; fly.from.copy(camera.position); fly.targetFrom.copy(controls.target); fly.targetTo.copy(world);
      const viewDir = camera.position.clone().sub(controls.target).normalize(); if (viewDir.lengthSq()<.1) viewDir.set(.6,.35,1);
      const regionDistance=name==="Asteroid Belt"?48:name==="Kuiper Belt"?82:0;
      const closeMinimum=activeScaleMode==="true"
        ? (name==="Sun" ? .12 : (isMoon||Boolean(definition?.category) ? .00008 : .0003))
        : isMoon ? (activeScaleMode==="linear"?1.5:2.8) : name==="Sun" ? (activeScaleMode==="linear"?4.5:28) : (activeScaleMode==="linear"?3.2:9);
      const familyRadius=Math.max(0,...MOONS.filter(moon=>moon.moon!.parent===name).map(moon=>moonOrbitRadius(moon,activeScaleMode)));
      const dist = close ? Math.max(radius*4.2,familyRadius*1.45,regionDistance || closeMinimum) : 74; fly.to.copy(world).add(viewDir.multiplyScalar(dist)).add(new THREE.Vector3(0,radius*.55,0));
      controls.enabled=false;
    }
    function rebuildScale(mode: ScaleMode) {
      activeScaleMode=mode;viewingFullSystem=true;
      sun.scale.setScalar(bodyDisplayScale(PLANETS[0],mode));
      for (const planet of ORBITING_BODIES) {
        const mesh=bodies.get(planet.name)!; const pos=transformed(heliocentricPosition(planet,activeDate),mode); mesh.position.copy(pos);mesh.scale.setScalar(bodyDisplayScale(planet,mode));
        const label=labels.find(l=>l.userData.body===planet.name); label?.position.copy(pos);
        const line=orbitGroup.children.find(x=>x.userData.body===planet.name) as THREE.Line; const pts=[];
        const segments=planet.category?300:180;for(let i=0;i<=segments;i++) pts.push(transformed(orbitalPoint(planet,(i/segments)*Math.PI*2,activeDate),mode));
        line.geometry.dispose(); line.geometry=new THREE.BufferGeometry().setFromPoints(pts);
        if(planet.category==="comet")updateCometTail(planet,pos);
      }
      updateMoonPositions(activeDate,mode);showMoonFamily(null);setSmallBodies(activeSmallBodyCategory);
      updateRegions(mode);
      controls.minDistance=mode==="true"?.00002:3;controls.maxDistance=mode==="readable"?900:6500;
      if(scene.fog instanceof THREE.FogExp2)scene.fog.density=mode==="true"?.00035:.00135;
      controls.target.set(0,0,0); camera.position.set(0, mode === "readable" ? 115 : 125, mode === "readable" ? 165 : 200); setSelected(null);
    }
    function positionBodies(date:Date,trackFocused=false){
      const tracked=trackFocused&&!viewingFullSystem&&lastFocused?bodies.get(lastFocused)?.position.clone():undefined;
      activeDate=date;
      for(const body of ORBITING_BODIES){
        const mesh=bodies.get(body.name)!;const pos=transformed(heliocentricPosition(body,activeDate),activeScaleMode);mesh.position.copy(pos);
        const label=labels.find(item=>item.userData.body===body.name);label?.position.copy(pos);if(body.category==="comet")updateCometTail(body,pos);
      }
      updateMoonPositions(activeDate,activeScaleMode);
      if(tracked&&lastFocused){const next=bodies.get(lastFocused)?.position;if(next){const delta=next.clone().sub(tracked);camera.position.add(delta);controls.target.add(delta);if(fly.active){fly.to.add(delta);fly.targetTo.add(delta);}}}
    }
    function updateDate(date:Date){
      positionBodies(date);
      for(const body of ORBITING_BODIES){
        const line=orbitGroup.children.find(item=>item.userData.body===body.name) as THREE.Line;const pts=[];
        const segments=body.category?300:180;for(let i=0;i<=segments;i++)pts.push(transformed(orbitalPoint(body,(i/segments)*Math.PI*2,activeDate),activeScaleMode));
        line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints(pts);
      }
      if(!viewingFullSystem&&lastFocused)focus(lastFocused,true);
    }
    apiRef.current={focus,scale:rebuildScale,smallBodies:setSmallBodies,date:updateDate,previewDate:date=>positionBodies(date,true)};

    const tapStart={x:0,y:0,time:0,moved:false};
    function onPointerDown(e:PointerEvent){tapStart.x=e.clientX;tapStart.y=e.clientY;tapStart.time=performance.now();tapStart.moved=false;}
    function onPointer(e: PointerEvent) {
      if(tapStart.moved||performance.now()-tapStart.time>650)return;
      const rect=renderer.domElement.getBoundingClientRect(); pointer.x=((e.clientX-rect.left)/rect.width)*2-1; pointer.y=-((e.clientY-rect.top)/rect.height)*2+1; raycaster.setFromCamera(pointer,camera);
      const hit=raycaster.intersectObjects([...bodies.values(),...markers.values(),...regionClicks],true)[0]; if(hit){ let obj:THREE.Object3D|null=hit.object; while(obj&&!obj.userData.body)obj=obj.parent; if(obj?.userData.body) focus(obj.userData.body as BodyName); }
    }
    function onMove(e:PointerEvent){if(Math.hypot(e.clientX-tapStart.x,e.clientY-tapStart.y)>8)tapStart.moved=true;if(coarsePointer)return;const rect=renderer.domElement.getBoundingClientRect();pointer.x=((e.clientX-rect.left)/rect.width)*2-1;pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera); renderer.domElement.style.cursor=raycaster.intersectObjects([...bodies.values(),...markers.values(),...regionClicks],true).length?"pointer":"grab"; }
    renderer.domElement.addEventListener("pointerdown",onPointerDown);renderer.domElement.addEventListener("pointerup",onPointer); renderer.domElement.addEventListener("pointermove",onMove);
    let frame=0,lastDistanceLabel="";
    const labelWorldPosition=new THREE.Vector3(),bodyWorldPosition=new THREE.Vector3(),bodyWorldScale=new THREE.Vector3(),cameraScreenUp=new THREE.Vector3();
    function placeLabelsInScreenSpace(){
      const viewportHeight=Math.max(1,renderer.domElement.clientHeight),pixelHeight=coarsePointer?20:22;
      const perspectiveFactor=2*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))/viewportHeight;
      cameraScreenUp.set(0,1,0).applyQuaternion(camera.quaternion).normalize();
      for(const label of labels){
        if(!label.visible)continue;
        const body=bodies.get(label.userData.body as BodyName);if(!body)continue;
        body.getWorldPosition(bodyWorldPosition);body.getWorldScale(bodyWorldScale);
        const worldPerPixel=Math.max(1e-10,camera.position.distanceTo(bodyWorldPosition)*perspectiveFactor),height=worldPerPixel*pixelHeight;
        if(!body.geometry.boundingSphere)body.geometry.computeBoundingSphere();
        const bodyRadius=(body.geometry.boundingSphere?.radius??0)*Math.max(bodyWorldScale.x,bodyWorldScale.y,bodyWorldScale.z);
        labelWorldPosition.copy(bodyWorldPosition).addScaledVector(cameraScreenUp,bodyRadius+worldPerPixel*(5+pixelHeight*.5));
        label.position.copy(labelWorldPosition);label.parent?.worldToLocal(label.position);label.scale.set(height*4,height,1);
      }
      for(const [name,marker] of markers){
        const body=bodies.get(name);if(activeScaleMode!=="true"||!body?.visible){marker.visible=false;continue;}
        body.getWorldPosition(bodyWorldPosition);body.getWorldScale(bodyWorldScale);if(!body.geometry.boundingSphere)body.geometry.computeBoundingSphere();
        const worldPerPixel=Math.max(1e-10,camera.position.distanceTo(bodyWorldPosition)*perspectiveFactor),bodyRadius=(body.geometry.boundingSphere?.radius??0)*Math.max(bodyWorldScale.x,bodyWorldScale.y,bodyWorldScale.z),pixelRadius=bodyRadius/worldPerPixel;
        const opacity=THREE.MathUtils.clamp((7-pixelRadius)/4,0,1);marker.visible=opacity>.01;(marker.material as THREE.SpriteMaterial).opacity=opacity;marker.position.copy(bodyWorldPosition);marker.parent?.worldToLocal(marker.position);const markerSize=worldPerPixel*14;marker.scale.set(markerSize,markerSize,1);
      }
    }
    function animate(now:number){ frame=requestAnimationFrame(animate); controls.update(); starField.rotation.y+=.000035; dustBelt.rotation.y-=.00018; kuiperBelt.rotation.y-=.000035; sun.rotation.y+=.0012; for(const p of ORBITING_BODIES){ const m=bodies.get(p.name)!; m.rotation.y+=p.name==="Jupiter"?.0022:.001; }for(const moon of MOONS)bodies.get(moon.name)!.rotation.y+=.0015;
      if(fly.active){ const t=Math.min(1,(now-fly.start)/fly.duration); const eased=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; camera.position.lerpVectors(fly.from,fly.to,eased); controls.target.lerpVectors(fly.targetFrom,fly.targetTo,eased); if(t>=1){fly.active=false;controls.enabled=true;} }
      placeLabelsInScreenSpace();const span=camera.position.distanceTo(controls.target),nextDistanceLabel=span<16?"Planetary view":span<55?"Local neighborhood":span<140?"Inner system":span<260?"30 AU span":"Deep system";if(nextDistanceLabel!==lastDistanceLabel){lastDistanceLabel=nextDistanceLabel;setDistanceLabel(nextDistanceLabel);}composer.render(); }
    const loadFallback=window.setTimeout(()=>setReady(true),5000);
    textureManager.onLoad=()=>{window.clearTimeout(loadFallback);setReady(true);};
    animate(performance.now()); window.setTimeout(() => { focus("Earth");updateDate(activeDate); }, 0);
    function resize(){ const w=mount.clientWidth,h=mount.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);composer.setSize(w,h); }
    const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(mount);window.addEventListener("resize",resize);
    return()=>{ window.clearTimeout(loadFallback);cancelAnimationFrame(frame);resizeObserver.disconnect();window.removeEventListener("resize",resize);renderer.domElement.removeEventListener("pointerdown",onPointerDown);renderer.domElement.removeEventListener("pointerup",onPointer);renderer.domElement.removeEventListener("pointermove",onMove);controls.dispose();composer.dispose();renderer.dispose();mount.replaceChildren();apiRef.current=null; };
  },[]);

  useEffect(()=>{
    if(!isPlaying)return;
    let frame=0,last=performance.now(),lastLabel=0,stopping=false;
    function tick(now:number){
      const elapsed=Math.min((now-last)/1000,.2);last=now;
      const nextTime=simulationDateRef.current.getTime()+elapsed*playbackRate*playbackDirection*86400000;
      const bounded=Math.max(MIN_SIM_TIME,Math.min(MAX_SIM_TIME,nextTime));const nextDate=new Date(bounded);
      simulationDateRef.current=nextDate;apiRef.current?.previewDate(nextDate);
      if(now-lastLabel>100){setMapDate(utcDateValue(nextDate));lastLabel=now;}
      if(bounded!==nextTime&&!stopping){stopping=true;finishPlayback(nextDate);return;}
      frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[isPlaying,playbackRate,playbackDirection]);

  function choose(name: BodyName) { setTourIndex(null); apiRef.current?.focus(name); }
  function beginTour() { if(isPlaying)finishPlayback();setTourIndex(0); apiRef.current?.focus(TOUR[0].body, false); }
  function changeTour(next:number){ const i=(next+TOUR.length)%TOUR.length;setTourIndex(i);apiRef.current?.focus(TOUR[i].body,true); }
  function toggleScale(){ const next:ScaleMode=scaleMode==="readable"?"linear":scaleMode==="linear"?"true":"readable";setScaleMode(next);apiRef.current?.scale(next); }
  function showSmallBodies(category:SmallBodyCategory){setSmallBodyCategory(category);apiRef.current?.smallBodies(category);if(selectedBody?.category&&(category==="off"||(category!=="all"&&category!==selectedBody.category)))setSelected(null);}
  function toggleSmallBodies(){showSmallBodies(smallBodyCategory==="off"?"all":"off");}
  function changeDate(value:string){
    if(!value)return;
    setIsPlaying(false);const date=dateForMap(value);simulationDateRef.current=date;setMapDate(value);apiRef.current?.date(date);
  }
  function resetToday(){changeDate(dateValue(new Date()));}
  function startPlayback(){setTourIndex(null);simulationDateRef.current=selectedDate;setIsPlaying(true);}
  function finishPlayback(date=simulationDateRef.current){
    setIsPlaying(false);const rounded=dateFromValue(utcDateValue(date));simulationDateRef.current=rounded;setMapDate(utcDateValue(rounded));apiRef.current?.date(rounded);
  }
  function togglePlayback(){if(isPlaying)finishPlayback();else startPlayback();}
  const selectedMoon=selectedBody?.moon;const moonParent=selectedMoon?PLANETS.find(body=>body.name===selectedMoon.parent):undefined;
  const distanceReference=moonParent??selectedBody;
  const currentDistance = distanceReference && distanceReference.name !== "Sun" ? heliocentricPosition(distanceReference,selectedDate).length() : 0;
  const lightMinutes = currentDistance * 8.3167;
  const dwarfIndex=selectedBody?DWARFS.indexOf(selectedBody):-1;
  const smallBodyIndex=selectedBody?SMALL_BODIES.indexOf(selectedBody):-1;
  const moonIndex=selectedBody?MOONS.indexOf(selectedBody):-1;const familyMoons=selectedBody?MOONS.filter(moon=>moon.moon!.parent===(selectedMoon?.parent??selectedBody.name)):[];
  const mapDateLabel=selectedDate.toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"});
  const appearanceLabel=selectedBody?(TEXTURE_MAPS[selectedBody.name]?.label??(selectedMoon?"Procedural color reference · surface detail simplified":selectedBody.category==="comet"?"Nucleus shape simplified · tail is an activity and solar-direction overlay":selectedBody.category?"Measured size and approximate shape · surface detail unresolved":"Color and shape approximation · surface unresolved")):"";
  const visibleSmallBodies=SMALL_BODIES.filter(body=>smallBodyCategory==="all"||body.category===smallBodyCategory);

  return (
    <main className={`atlas-shell ${selectedBody&&tourIndex===null?"panel-open":""} ${tourIndex!==null?"tour-open":""} ${smallBodyCategory!=="off"?"small-bodies-open":""}`}>
      <div ref={mountRef} className="space-stage" aria-label="Interactive 3D model of the solar system">
        <div className="fallback-space" aria-hidden="true">
          <div className="fallback-stars"/>
          <div className="fallback-system">
            {[1,2,3,4,5,6,7,8].map(i=><i key={i} className={`fallback-orbit o${i}`}/>) }
            <b className="fallback-sun"/>
            {PLANETS.slice(1).map((p,i)=><span key={p.name} className={`fallback-planet fp${i+1}`} style={{"--p":p.color} as React.CSSProperties}/>) }
          </div>
          <div className="fallback-message"><span>3D preview unavailable here</span><small>The learning panels and tour remain fully interactive.</small></div>
        </div>
      </div>
      <div className={`loading-veil ${ready ? "is-ready" : ""}`}><div className="loading-orbit"/><span>Plotting the solar system</span></div>
      <header className="topbar">
        <button className="brand" onClick={()=>{setTourIndex(null);apiRef.current?.scale(scaleMode)}} aria-label="Return to full solar system">
          <span className="brand-mark"><i/><i/><b/></span><span><strong>HELIOS</strong><small>Solar system atlas</small></span>
        </button>
        <nav aria-label="Main controls">
          <button className={tourIndex===null?"active":""} onClick={()=>setTourIndex(null)}>Explore</button>
          <button className={tourIndex!==null?"active":""} onClick={beginTour}><span className="play">▶</span> Guided tour</button>
        </nav>
        <div className="date-chip">
          <span className={`date-status ${isToday?"live":""} ${isPlaying?"playing":""}`}><i/>{isPlaying?"PLAYING":isToday?"LIVE":"DATE"}</span>
          <input type="date" min="1800-01-01" max="2050-12-31" value={mapDate} disabled={isPlaying} onChange={event=>changeDate(event.target.value)} aria-label="Solar system map date"/>
          {!isToday&&<button onClick={resetToday}>TODAY</button>}
        </div>
      </header>

      <aside className="left-tools">
        <div className="eyebrow">NAVIGATE</div>
        <p><span>Drag</span> to orbit<br/><span>Scroll</span> to travel<br/><span>Click</span> any world</p>
        <div className="zoom-meter"><span/><span/><span/><span/><span/></div>
        <strong>{distanceLabel}</strong>
        <button className="scale-button" onClick={toggleScale}><span>Scale</span><b>{scaleMode === "readable" ? "READABLE" : scaleMode==="linear"?"LINEAR DISTANCE":"TRUE PROPORTIONS"}</b><i>↔</i></button>
        <small className="scale-note">{scaleMode === "readable" ? "Distances are square-root compressed; orbital angles are real." : scaleMode==="linear"?"Distance from the Sun is linear; planet sizes are enlarged.":"Distances and body sizes share one physical scale. Markers and labels are navigation overlays."}</small>
        <button className={`layer-button ${smallBodyCategory!=="off"?"active":""}`} onClick={toggleSmallBodies}><span>Layer</span><b>SMALL BODIES</b><i>{smallBodyCategory==="off"?"OFF":"ON"}</i></button>
      </aside>

      <div className="planet-rail" aria-label="Choose a celestial body">
        {PLANETS.map((p,i)=><button key={p.name} className={selected===p.name?"selected":""} onClick={()=>choose(p.name)} style={{"--planet":p.color} as React.CSSProperties}><span className={`mini-world m${i}`}/><small>{p.name}</small></button>)}
      </div>

      {tourIndex===null&&smallBodyCategory==="off"&&<div className="dwarf-rail" aria-label="Choose a dwarf planet">
        <span>DWARF WORLDS</span>
        {DWARFS.map(p=><button key={p.name} className={selected===p.name?"selected":""} onClick={()=>choose(p.name)} style={{"--planet":p.color} as React.CSSProperties}><i/><small>{p.name}</small></button>)}
      </div>}

      {tourIndex===null&&smallBodyCategory!=="off"&&<div className="small-body-rail" aria-label="Explore comets, asteroids, and distant objects">
        <div className="small-body-filters" aria-label="Filter small bodies">
          {(["all","comet","asteroid","outer"] as const).map(category=><button key={category} className={smallBodyCategory===category?"active":""} onClick={()=>showSmallBodies(category)}>{category==="all"?"ALL":category==="asteroid"?"ROCKS":category.toUpperCase()}</button>)}
        </div>
        <div className="small-body-list">{visibleSmallBodies.map(body=><button key={body.name} className={selected===body.name?"selected":""} onClick={()=>choose(body.name)} style={{"--planet":body.color} as React.CSSProperties}><i/><small>{body.name}</small></button>)}</div>
      </div>}

      {tourIndex===null&&<section className={`playback-bar ${isPlaying?"is-playing":""}`} aria-label="Orbital playback controls">
        <button className="direction-button" onClick={()=>setPlaybackDirection(value=>value===1?-1:1)} aria-label={`Play ${playbackDirection===1?"backward":"forward"} through time`} title="Reverse time direction">{playbackDirection===1?"→":"←"}</button>
        <button className="playback-button" onClick={togglePlayback} aria-label={isPlaying?"Pause orbital playback":"Start orbital playback"}>{isPlaying?"Ⅱ":"▶"}</button>
        <div className="simulation-date"><span>SIMULATION DATE</span><strong>{mapDateLabel}</strong></div>
        <label className="speed-picker"><span>SPEED</span><select value={playbackRate} onChange={event=>setPlaybackRate(Number(event.target.value))} aria-label="Simulation speed">{PLAYBACK_SPEEDS.map(option=><option key={option.days} value={option.days}>{option.label}</option>)}</select></label>
        <button className="now-button" onClick={resetToday}>NOW</button>
      </section>}

      {selectedBody && tourIndex===null && <aside className="info-panel" aria-live="polite">
        <button className="close" onClick={()=>setSelected(null)} aria-label="Close information panel">×</button>
        <div className="panel-index">{moonIndex>=0?`MOON ${String(familyMoons.indexOf(selectedBody)+1).padStart(2,"0")}`:dwarfIndex>=0?`DWARF ${String(dwarfIndex+1).padStart(2,"0")}`:smallBodyIndex>=0?`${selectedBody.category?.toUpperCase()} ${String(smallBodyIndex+1).padStart(2,"0")}`:String(PLANETS.indexOf(selectedBody)).padStart(2,"0")} <span>/ {moonIndex>=0?String(familyMoons.length).padStart(2,"0"):dwarfIndex>=0?"05":smallBodyIndex>=0?String(SMALL_BODIES.length).padStart(2,"0"):"08"}</span></div>
        <div className="eyebrow">{selectedBody.kind}</div>
        <h1>{selectedBody.name}</h1>
        <p className="lede">{selectedBody.description}</p>
        <div className="fact-grid">
          <div><span>{selectedMoon?`DISTANCE FROM ${selectedMoon.parent.toUpperCase()}`:"DISTANCE FROM SUN"}</span><strong>{selectedMoon?`${selectedMoon.orbitKm.toLocaleString()} km`:selectedBody.name === "Sun" ? "The center" : `${currentDistance.toFixed(currentDistance<2?3:2)} AU ${isToday?"now":"on this date"}`}</strong><small>{selectedMoon?"average center-to-center distance":selectedBody.name === "Sun" ? "0 km" : selectedBody.perihelionAU&&selectedBody.aphelionAU?`orbit ${selectedBody.perihelionAU.toLocaleString()}–${selectedBody.aphelionAU.toLocaleString()} AU`:`average ${selectedBody.distanceAU.toLocaleString()} AU`}</small></div>
          <div><span>SUNLIGHT TRAVEL</span><strong>{selectedBody.name === "Sun" ? "Starts here" : lightMinutes < 60 ? `${lightMinutes.toFixed(1)} minutes` : `${(lightMinutes/60).toFixed(1)} hours`}</strong><small>at light speed</small></div>
          <div><span>{selectedMoon?"ONE ORBIT":"ONE YEAR"}</span><strong>{selectedBody.year}</strong></div>
          <div><span>{selectedMoon?"ROTATION":"ONE DAY"}</span><strong>{selectedBody.day}</strong></div>
        </div>
        <div className="wild-fact"><span>✦ WORTH KNOWING</span><p>{selectedBody.fact}</p></div>
        <div className="appearance-note"><span>VISUAL MAP</span><p>{appearanceLabel}</p></div>
        {familyMoons.length>0&&<div className="moon-family"><span>{selectedMoon?`${selectedMoon.parent.toUpperCase()} SYSTEM`:"MAJOR MOONS"} · LOCAL SPACING COMPACTED</span><div>{familyMoons.map(moon=><button key={moon.name} className={selected===moon.name?"selected":""} onClick={()=>choose(moon.name)}>{moon.name}</button>)}</div></div>}
        <div className="diameter"><span>{selectedBody.category?"APPROX. RADIUS":"RADIUS"}</span><b>{selectedBody.radiusKm.toLocaleString()} km</b></div>
      </aside>}

      {tourIndex!==null && <section className="tour-card" aria-live="polite">
        <div className="tour-progress">{TOUR.map((_,i)=><i key={i} className={i<=tourIndex?"done":""}/>)}</div>
        <button className="tour-close" onClick={()=>setTourIndex(null)} aria-label="Exit guided tour">×</button>
        <div className="eyebrow">{TOUR[tourIndex].eyebrow}</div>
        <h2>{TOUR[tourIndex].title}</h2>
        <p>{TOUR[tourIndex].note}</p>
        <div className="tour-actions"><button onClick={()=>changeTour(tourIndex-1)} aria-label="Previous tour stop">←</button><span>{tourIndex+1} / {TOUR.length}</span><button className="next" onClick={()=>changeTour(tourIndex+1)}>{tourIndex===TOUR.length-1?"RESTART":"NEXT"} →</button></div>
      </section>}

      <footer className="footer-note">
        <span>POSITIONS</span> Approximate heliocentric positions for {isToday?"today":mapDateLabel} · computed in-browser from JPL orbital and osculating elements
        <details><summary>Sources</summary><div>{SOURCE_LINKS.map(([label,url])=><a key={url} href={url} target="_blank" rel="noreferrer">{label} ↗</a>)}</div></details>
      </footer>
    </main>
  );
}
