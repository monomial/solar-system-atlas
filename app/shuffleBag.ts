// Zero-dependency by design, like orbits.ts — so `node --test` can exercise it directly without
// pulling in ambient.ts's DOM-only imports (Audio, window, speechSynthesis).

// A shuffle bag per key: hand out every option once, in random order, before any repeats, then
// reshuffle. Better than picking purely at random each time — pure random can replay one option
// while another goes unheard for ages, and for a child you want him to eventually hear them all.
// Also cheaper on the ear: no option lands twice in a row, even across a reshuffle. Generic over
// `count` (not hardcoded to NARRATION's shape) so the same class drives both per-body fact
// rotation (useAmbient.ts) and Starbots Mode's per-body scene-exchange rotation
// (SolarSystem.tsx's Explore-mode trigger), keyed separately.
export class ShuffleBag {
  private bags = new Map<string, number[]>();
  private last = new Map<string, number>();

  next(key: string, count: number): number {
    if (count <= 1) return 0;

    let bag = this.bags.get(key);
    if (!bag || bag.length === 0) {
      bag = [...Array(count).keys()];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // Don't let the reshuffle repeat the option we just finished on.
      const last = this.last.get(key);
      if (last !== undefined && bag[0] === last && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
      this.bags.set(key, bag);
    }

    const index = bag.shift()!;
    this.last.set(key, index);
    return index;
  }
}
