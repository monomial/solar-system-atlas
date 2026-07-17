// The ambient experience, ported from the tvOS app: an outward auto-tour that flies between
// worlds, speaks a fact at each, and plays a generated drone underneath. This module is the
// audio and orchestration; the camera lives in the Three.js scene and is driven through the
// `AmbientApi` bridge below, so the mount-once scene effect (see CLAUDE.md) is never rebuilt.

import { ALL_BODIES, NARRATION } from "./bodies";
import type { BodyName } from "./bodies";
import { heliocentricDistanceAU } from "./orbits";

// Textures and audio are loaded by raw URL, which Next cannot rewrite for basePath — same reason
// ASSET_BASE exists for textures in the scene.
const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Outward, Sun to Eris — the journey is part of what the tour teaches. Matches the TV order.
export const AMBIENT_TOUR: BodyName[] = [
  "Sun", "Mercury", "Venus", "Earth", "Mars", "Ceres", "Jupiter", "Saturn",
  "Uranus", "Neptune", "Pluto", "Haumea", "Makemake", "Eris",
];

export const PAUSE_AFTER_LINE_MS = 4500;
export const MAX_LINE_MS = 22000; // ceiling if an audio 'ended' event never fires

export type Caption = { name: string; kind: string; distance: string; line: string };

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
export function speakLine(name: BodyName, lineIndex: number, text: string, onEnd: () => void): () => void {
  let done = false;
  const finish = () => { if (!done) { done = true; onEnd(); } };
  const ceiling = window.setTimeout(finish, MAX_LINE_MS);

  const clip = new Audio(`${ASSET_BASE}/narration/narration-${name.toLowerCase().replace(/\s+/g, "-")}-${lineIndex}.m4a`);
  clip.addEventListener("ended", () => { window.clearTimeout(ceiling); finish(); });
  clip.addEventListener("error", () => {
    // No clip bundled — fall back to the browser voice so the line still speaks.
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.92;
      utterance.onend = () => { window.clearTimeout(ceiling); finish(); };
      speechSynthesis.speak(utterance);
    }
  });
  clip.play().catch(() => { /* the error listener handles fallback */ });

  return () => {
    window.clearTimeout(ceiling);
    clip.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    done = true;
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
