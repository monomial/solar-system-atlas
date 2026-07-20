"use client";

import type { BridgeCaption } from "./ambient";
import type { Speaker } from "./bridgeScenes";

// Next rewrites its own asset URLs for basePath, but this loads by raw string like the scene
// textures do (see SolarSystem.tsx's ASSET_BASE), so the prefix has to be added manually here too.
const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Portrait crops land in public/starbots/ once the concept-art sheet is committed (design doc
// Next Steps #0). Until then — and for any future speaker the art hasn't caught up with yet —
// the colored initial below stands in, the same graceful-degrade spirit as SolarSystem.tsx's
// makePlanetTexture procedural fallback for bodies with no real texture.
const SPEAKER_COLOR: Record<Speaker, string> = {
  Horizon: "#9db5d5",
  Byte: "#e5ca8b",
  Bolt: "#e08a5c",
  Nova: "#7fd0c2",
  Pico: "#c98be0",
};

export default function BridgeCard({ caption }: { caption: BridgeCaption }) {
  return (
    <div className="bridge-card" key={`${caption.body}-${caption.turnIndex}`} aria-live="polite">
      <div className="bridge-progress">
        {Array.from({ length: caption.totalTurns }, (_, i) => <i key={i} className={i <= caption.turnIndex ? "done" : ""} />)}
      </div>
      <div className="bridge-portrait" style={{ "--speaker-color": SPEAKER_COLOR[caption.speaker] } as React.CSSProperties}>
        <span className="bridge-portrait-fallback">{caption.speaker[0]}</span>
        {/* Loads only while this turn is showing — no upfront bundle of all ~30 expressions. */}
        <img
          src={`${ASSET_BASE}/starbots/${caption.speaker.toLowerCase()}.webp`}
          alt={caption.speaker}
          loading="lazy"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      </div>
      <div className="bridge-text">
        <span className="bridge-speaker">{caption.speaker.toUpperCase()}</span>
        <p>{caption.text}</p>
      </div>
    </div>
  );
}
