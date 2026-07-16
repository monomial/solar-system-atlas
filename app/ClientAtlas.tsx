"use client";

import dynamic from "next/dynamic";

const CosmicAtlas = dynamic(() => import("./CosmicAtlas"), {
  ssr: false,
  loading: () => (
    <main className="atlas-shell">
      <div className="loading-veil">
        <div className="loading-orbit" />
        <span>Plotting today’s sky</span>
      </div>
    </main>
  ),
});

export default function ClientAtlas() {
  return <CosmicAtlas />;
}
