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

/** Drives the outward auto-tour: fly to a world, arrive, speak, hold, advance. Everything the
 *  loop owns is cancellable, because the user can leave at any moment. */
export function useAmbient(api: () => AmbientApi | null) {
  const [phase, setPhase] = useState<Phase>("off");
  const [caption, setCaption] = useState<Caption | null>(null);

  const drone = useRef<Drone | null>(null);
  const spoken = useRef<Map<BodyName, number>>(new Map());
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

      const turn = spoken.current.get(name) ?? 0;
      spoken.current.set(name, turn + 1);
      const lineIndex = turn % (NARRATION[name]?.length ?? 1);

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
