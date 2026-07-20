// The ambient experience, ported from the tvOS app: an outward auto-tour that flies between
// worlds, speaks a fact at each, and plays a generated drone underneath. This module is the
// audio and orchestration; the camera lives in the Three.js scene and is driven through the
// `AmbientApi` bridge below, so the mount-once scene effect (see CLAUDE.md) is never rebuilt.

import { ALL_BODIES, NARRATION } from "./bodies";
import type { BodyName } from "./bodies";
import { heliocentricDistanceAU } from "./orbits";
import type { BridgeBody, Scene, Speaker, Turn } from "./bridgeScenes";
export { ShuffleBag } from "./shuffleBag";

// Textures and audio are loaded by raw URL, which Next cannot rewrite for basePath — same reason
// ASSET_BASE exists for textures in the scene.
const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Outward, Sun to Eris — the journey is part of what the tour teaches. Matches the TV order.
export const AMBIENT_TOUR: BodyName[] = [
  "Sun", "Mercury", "Venus", "Earth", "Mars", "Ceres", "Jupiter", "Saturn",
  "Uranus", "Neptune", "Pluto", "Haumea", "Makemake", "Eris",
];

export type AmbientKey = BodyName | "Milky Way" | "Local Group" | "Universe";

export const AMBIENT_FINALE: {mode:"galaxy"|"local"|"universe";narrationKey:AmbientKey;name:string;kind:string;distance:string}[] = [
  {mode:"galaxy",narrationKey:"Milky Way",name:"THE MILKY WAY",kind:"Barred spiral galaxy",distance:"The Sun is 26,000 light-years from its centre"},
  {mode:"local",narrationKey:"Local Group",name:"THE LOCAL GROUP",kind:"Our family of galaxies",distance:"Andromeda is 2.5 million light-years away"},
  {mode:"universe",narrationKey:"Universe",name:"THE COSMIC WEB",kind:"The observable universe",distance:"Every point of light is an entire galaxy"},
];

export const PAUSE_AFTER_LINE_MS = 4500; // after a destination's narration, or after a whole scene
export const INTRA_TURN_PAUSE_MS = 1800; // between turns *within* a Starbots Mode scene — banter
                                          // paced like back-and-forth, not four separate narrated
                                          // facts; reusing PAUSE_AFTER_LINE_MS here would add
                                          // 13-18s of dead air to a 3-4 turn exchange
export const MAX_LINE_MS = 22000; // ceiling if an audio 'ended' event never fires

export type Caption = { name: string; kind: string; distance: string; line: string };

// What the bridge card (Starbots Mode) needs, distinct from Caption's single-narrator shape:
// which character is talking (drives the portrait + label) and where in the scene this turn is.
export type BridgeCaption = { body: BridgeBody; speaker: Speaker; text: string; turnIndex: number; totalTurns: number };


export function finaleCaptionFor(beat:typeof AMBIENT_FINALE[number],lineIndex:number):Caption {
  const lines=NARRATION[beat.narrationKey]??[""];
  return {name:beat.name,kind:beat.kind,distance:beat.distance,line:lines.length?lines[lineIndex%lines.length]:""};
}

export function captionFor(name: BodyName, lineIndex: number): Caption {
  const body = ALL_BODIES.find((b) => b.name === name)!;
  const lines = NARRATION[name] ?? [body.fact];
  const au = name === "Sun" ? 0 : heliocentricDistanceAU(body, new Date());
  const distance = name === "Sun"
    ? "The centre of everything"
    : `${au.toFixed(au < 2 ? 3 : 2)} AU from the Sun, right now`;
  return { name: name.toUpperCase(), kind: body.kind, distance, line: lines[lineIndex % lines.length] };
}

/** Outerness 0 at the Sun, 1 at Eris — drives the drone's cold-outer-planets fade. */
export function outernessFor(name: BodyName): number {
  const body = ALL_BODIES.find((b) => b.name === name)!;
  const au = name === "Sun" ? 0 : heliocentricDistanceAU(body, new Date());
  return Math.min(1, Math.max(0, Math.sqrt(au / 68)));
}

// The narration voice: a rendered clip if we have one, else the browser's own speech synth as a
// placeholder — the same clip-preferred, synth-fallback pattern the tvOS Narrator uses.
function playClip(clipId: string, text: string, onEnd: () => void): () => void {
  let done = false;
  const finish = () => { if (!done) { done = true; onEnd(); } };
  const ceiling = window.setTimeout(finish, MAX_LINE_MS);

  let fallbackStarted = false;
  const fallback = () => {
    // Both the 'error' event and a play() rejection can reach here — only start the fallback
    // voice once. A play() rejection (e.g. the browser's autoplay policy blocking Explore
    // mode's gesture-less playback) does not reliably fire 'error', so this can't rely on
    // 'error' alone or a blocked clip goes silent for the full MAX_LINE_MS ceiling.
    if (fallbackStarted) return;
    fallbackStarted = true;
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.92;
      utterance.onend = () => { window.clearTimeout(ceiling); finish(); };
      speechSynthesis.speak(utterance);
    } else {
      finish(); // no speech synthesis either — don't hang until the ceiling for nothing
    }
  };

  const clip = new Audio(`${ASSET_BASE}/narration/${clipId}.m4a`);
  clip.addEventListener("ended", () => { window.clearTimeout(ceiling); finish(); });
  clip.addEventListener("error", fallback);
  clip.play().catch(fallback);

  return () => {
    window.clearTimeout(ceiling);
    clip.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    done = true;
  };
}

export function speakLine(name: AmbientKey, lineIndex: number, text: string, onEnd: () => void): () => void {
  return playClip(`narration-${name.toLowerCase().replace(/\s+/g, "-")}-${lineIndex}`, text, onEnd);
}

function sceneClipId(body: BridgeBody, sceneIndex: number, turnIndex: number): string {
  return `narration-${body.toLowerCase()}-scene${sceneIndex}-turn${turnIndex}`;
}

export type PlaySceneHooks = {
  isCancelled: () => boolean;
  onTurn: (turn: Turn, turnIndex: number) => void;
  onTurnEnd?: (turnIndex: number) => void;
};

// Shared by Ambient's step() and Explore's click handling (see CosmicAtlas/SolarSystem) — the
// trigger paths differ (auto-tour arrival vs. a kid's click) and each owns its own cancellation
// check, but the turn-by-turn sequencing is identical either way: play a turn, run the caller's
// hooks (duck the drone, show the portrait — whatever that trigger path needs), wait, advance.
export function playScene(body: BridgeBody, sceneIndex: number, scene: Scene, hooks: PlaySceneHooks, onDone: () => void): () => void {
  let stopCurrent: (() => void) | null = null;
  let timer: number | null = null;
  let stopped = false;

  const advance = (turnIndex: number) => {
    if (stopped || hooks.isCancelled()) return;
    if (turnIndex === scene.turns.length) { onDone(); return; }
    const turn = scene.turns[turnIndex];
    hooks.onTurn(turn, turnIndex);
    stopCurrent = playClip(sceneClipId(body, sceneIndex, turnIndex), turn.text, () => {
      if (stopped || hooks.isCancelled()) return;
      hooks.onTurnEnd?.(turnIndex);
      const pause = turnIndex === scene.turns.length - 1 ? PAUSE_AFTER_LINE_MS : INTRA_TURN_PAUSE_MS;
      timer = window.setTimeout(() => { timer = null; advance(turnIndex + 1); }, pause);
    });
  };
  advance(0);

  return () => {
    stopped = true;
    if (timer !== null) { window.clearTimeout(timer); timer = null; }
    stopCurrent?.();
  };
}

// The ambient drone, as a live Web Audio graph. This is the same synth verified offline for the
// TV (AmbientAudio.swift / drone.mjs): an open chord with no third, each voice breathing on its
// own slow cycle so it never repeats, and the bright voices fading out as the journey moves
// outward so the far planets sound hollow and cold.
type Voice = { freq: number; gain: number; lfoRate: number; brightness: number };
const VOICES: Voice[] = [
  { freq: 55.0, gain: 0.9, lfoRate: 0.037, brightness: 0.0 },
  { freq: 82.41, gain: 0.55, lfoRate: 0.041, brightness: 0.12 },
  { freq: 110.0, gain: 0.48, lfoRate: 0.053, brightness: 0.28 },
  { freq: 164.81, gain: 0.3, lfoRate: 0.067, brightness: 0.62 },
  { freq: 220.13, gain: 0.22, lfoRate: 0.079, brightness: 0.82 },
  { freq: 246.94, gain: 0.13, lfoRate: 0.101, brightness: 1.0 },
  { freq: 329.63, gain: 0.08, lfoRate: 0.113, brightness: 1.0 },
];
const MASTER_GAIN = 0.12;

export type Drone = {
  resume: () => Promise<void>;
  setOuterness: (value: number) => void;
  setDucked: (ducked: boolean) => void;
  stop: () => void;
};

export function createDrone(): Drone {
  const ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const master = ctx.createGain();
  master.connect(ctx.destination);

  // Per-voice: a sine into its own gain, with a slow LFO added onto that gain to make it breathe.
  const centres: GainNode[] = [];
  const lfoDepths: GainNode[] = [];
  for (const voice of VOICES) {
    const osc = ctx.createOscillator();
    osc.frequency.value = voice.freq;
    const centre = ctx.createGain();
    osc.connect(centre).connect(master);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = voice.lfoRate;
    const depth = ctx.createGain();
    lfo.connect(depth).connect(centre.gain);

    centres.push(centre);
    lfoDepths.push(depth);
    osc.start();
    lfo.start();
  }

  let outerness = 0;
  let ducked = false;

  // breath = 0.55 .. 1.0: a static centre of 0.775 with the LFO swinging ±0.225.
  const applyVoices = () => {
    VOICES.forEach((voice, i) => {
      const g = voice.gain * (1 - voice.brightness * outerness);
      centres[i].gain.setTargetAtTime(g * 0.775, ctx.currentTime, 1.2);
      lfoDepths[i].gain.setTargetAtTime(g * 0.225, ctx.currentTime, 1.2);
    });
  };
  const applyMaster = () => {
    const level = MASTER_GAIN * (ducked ? 0.38 : 1) * (1 - 0.22 * outerness);
    master.gain.setTargetAtTime(level, ctx.currentTime, ducked ? 0.25 : 0.8);
  };
  applyVoices();
  applyMaster();

  return {
    resume: () => ctx.resume(),
    setOuterness: (value) => { outerness = Math.min(1, Math.max(0, value)); applyVoices(); applyMaster(); },
    setDucked: (value) => { ducked = value; applyMaster(); },
    stop: () => { master.gain.setTargetAtTime(0, ctx.currentTime, 0.4); window.setTimeout(() => ctx.close(), 800); },
  };
}
