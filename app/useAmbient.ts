import { useCallback, useEffect, useRef, useState } from "react";

import { AMBIENT_TOUR, captionFor, createDrone, outernessFor, PAUSE_AFTER_LINE_MS, speakLine } from "./ambient";
import type { Caption, Drone } from "./ambient";
import { NARRATION } from "./bodies";
import type { BodyName } from "./bodies";

// The subset of the scene's apiRef the ambient tour drives. The scene implements a superset.
export type AmbientApi = {
  flyTo: (name: BodyName, onArrive: () => void) => void;
  setAmbient: (on: boolean) => void;
  date: (date: Date) => void;
};

type Phase = "off" | "gate" | "playing";

// A shuffle bag per body: hand out every fact once, in random order, before any repeats, then
// reshuffle. Better than picking purely at random each time — pure random can replay one fact
// while another goes unheard for ages, and for a child you want him to eventually hear them all.
// Also cheaper on the ear: no fact lands twice in a row, even across a reshuffle.
class ShuffleBag {
  private bags = new Map<BodyName, number[]>();
  private last = new Map<BodyName, number>();

  next(name: BodyName): number {
    const count = NARRATION[name]?.length ?? 1;
    if (count <= 1) return 0;

    let bag = this.bags.get(name);
    if (!bag || bag.length === 0) {
      bag = [...Array(count).keys()];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // Don't let the reshuffle repeat the fact we just finished on.
      const last = this.last.get(name);
      if (last !== undefined && bag[0] === last && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
      this.bags.set(name, bag);
    }

    const index = bag.shift()!;
    this.last.set(name, index);
    return index;
  }
}

/** Drives the outward auto-tour: fly to a world, arrive, speak, hold, advance. Everything the
 *  loop owns is cancellable, because the user can leave at any moment. */
export function useAmbient(api: () => AmbientApi | null) {
  const [phase, setPhase] = useState<Phase>("off");
  const [caption, setCaption] = useState<Caption | null>(null);

  const drone = useRef<Drone | null>(null);
  const bag = useRef(new ShuffleBag());
  const stopSpeaking = useRef<(() => void) | null>(null);
  const timer = useRef<number | null>(null);
  // A token invalidated on every exit, so an async arrival from an abandoned run cannot resurrect
  // the tour after the user has left.
  const run = useRef(0);

  const clearTimer = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };

  // The loop advances by calling itself after each line. Routing the recursion through a ref keeps
  // `step` from referencing itself in its own closure (which cannot be initialised in order).
  const stepRef = useRef<(index: number, token: number) => void>(() => {});

  const step = useCallback((index: number, token: number) => {
    const apiHandle = api();
    if (!apiHandle || token !== run.current) return;

    const name = AMBIENT_TOUR[index % AMBIENT_TOUR.length];
    setCaption(null); // the card fades out for the flight, and returns on arrival with the voice
    drone.current?.setOuterness(outernessFor(name));

    apiHandle.flyTo(name, () => {
      if (token !== run.current) return; // arrived after the user left — drop it

      const lineIndex = bag.current.next(name);

      const card = captionFor(name, lineIndex);
      setCaption(card);
      drone.current?.setDucked(true);

      stopSpeaking.current = speakLine(name, lineIndex, card.line, () => {
        if (token !== run.current) return;
        drone.current?.setDucked(false);
        timer.current = window.setTimeout(() => stepRef.current(index + 1, token), PAUSE_AFTER_LINE_MS);
      });
    });
  }, [api]);
  useEffect(() => { stepRef.current = step; }, [step]);

  const enter = useCallback(() => setPhase("gate"), []);

  const begin = useCallback(async () => {
    const apiHandle = api();
    if (!apiHandle) return;
    drone.current = createDrone();
    await drone.current.resume();
    apiHandle.date(new Date());   // positions live, for right now
    apiHandle.setAmbient(true);
    setPhase("playing");
    const token = ++run.current;
    step(0, token);
  }, [api, step]);

  const exit = useCallback(() => {
    run.current++;
    clearTimer();
    stopSpeaking.current?.();
    stopSpeaking.current = null;
    drone.current?.stop();
    drone.current = null;
    api()?.setAmbient(false);
    setCaption(null);
    setPhase("off");
  }, [api]);

  // Esc leaves the mode, matching every other fullscreen thing on the web.
  useEffect(() => {
    if (phase === "off") return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") exit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, exit]);

  // Tear everything down if the component unmounts mid-tour.
  useEffect(() => () => {
    run.current++;
    clearTimer();
    stopSpeaking.current?.();
    drone.current?.stop();
  }, []);

  return { phase, caption, enter, begin, exit };
}
