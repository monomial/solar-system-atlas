// Starbots Mode: short bridge-crew exchanges shown/spoken instead of the usual solo narration,
// at a handful of destinations. Separate from NARRATION (app/bodies.ts) — this is a multi-turn,
// speaker-tagged shape, not a flat per-body string[] — but it flows through the same shuffle-bag,
// TTS-clip, and cancellation-token machinery documented in CLAUDE.md's Ambient mode section.

import type { BodyName } from "./bodies";

export type Speaker = "Nova" | "Byte" | "Bolt" | "Pico" | "Horizon";

export type Turn = { speaker: Speaker; text: string };
export type Scene = { turns: Turn[] };

export const BRIDGE_BODIES = ["Mars", "Saturn", "Pluto"] as const satisfies readonly BodyName[];
export type BridgeBody = (typeof BRIDGE_BODIES)[number];

export function isBridgeBody(name: BodyName | null | undefined): name is BridgeBody {
  return name != null && (BRIDGE_BODIES as readonly string[]).includes(name);
}

// One Horizon announcer line, then 2-3 turns of banter — Byte states the fact, Bolt/Nova reacts,
// Pico beeps. Two exchanges per body so a repeat click (the Success Criteria's primary signal)
// shows something new, not a rerun.
export const BRIDGE_SCENES: Record<BridgeBody, Scene[]> = {
  Mars: [
    { turns: [
      { speaker: "Horizon", text: "Approaching Mars." },
      { speaker: "Byte", text: "Mars has the largest volcano in the whole solar system. Olympus Mons is almost three times taller than Mount Everest." },
      { speaker: "Bolt", text: "Three Everests stacked up? I could fix an antenna up there and see the whole planet." },
      { speaker: "Pico", text: "Beep! Beep-beep!" },
    ] },
    { turns: [
      { speaker: "Horizon", text: "Approaching Mars." },
      { speaker: "Byte", text: "Long ago, Mars had rivers and lakes. You can still see the dry riverbeds from orbit." },
      { speaker: "Nova", text: "Rivers on Mars? I want to walk where the water used to be." },
      { speaker: "Pico", text: "Bloop?" },
    ] },
  ],
  Saturn: [
    { turns: [
      { speaker: "Horizon", text: "Approaching Saturn." },
      { speaker: "Byte", text: "Saturn's rings look solid, but they're actually billions of icy chunks, most no bigger than a snowball." },
      { speaker: "Bolt", text: "Billions of snowballs and not one snowball fight? Tragic." },
      { speaker: "Pico", text: "Beep-boop!" },
    ] },
    { turns: [
      { speaker: "Horizon", text: "Approaching Saturn." },
      { speaker: "Byte", text: "Saturn is so light for its size that it would float in a bathtub, if you could find one big enough." },
      { speaker: "Nova", text: "A whole planet that floats? Now that's a planet I want to see." },
      { speaker: "Pico", text: "Beep!" },
    ] },
  ],
  Pluto: [
    { turns: [
      { speaker: "Horizon", text: "Approaching Pluto." },
      { speaker: "Byte", text: "Pluto has a heart on it. A huge, bright, heart-shaped plain of frozen nitrogen." },
      { speaker: "Bolt", text: "A planet with a heart. I'm not crying, my sensors are just leaking coolant." },
      { speaker: "Pico", text: "Bleep..." },
    ] },
    { turns: [
      { speaker: "Horizon", text: "Approaching Pluto." },
      { speaker: "Byte", text: "Pluto used to be called the ninth planet. Now it's called a dwarf planet, but it's still exactly the same amazing place." },
      { speaker: "Nova", text: "Name or no name, I still want to stand on it." },
      { speaker: "Pico", text: "Beep-beep-boop." },
    ] },
  ],
};

// Kokoro voice per speaker, for scripts/render-narration.mjs. Chosen from voices already
// sampled in this codebase (see PROVIDERS.kokoro.sampleVoices in render-narration.mjs) where
// possible, to de-risk unknown voice names; verify with `npm run narration -- --sample <voice>`
// before a real render and adjust here if a voice doesn't suit its character.
export const SPEAKER_VOICES: Record<Speaker, string> = {
  Horizon: "bm_george", // measured, announcer-like
  Byte: "bf_emma", // precise, matter-of-fact
  Bolt: "am_michael", // practical, wisecracking
  Nova: "af_sarah", // curious, energetic
  Pico: "af_heart", // short beeps, voice barely matters
};
