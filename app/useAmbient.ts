import { useCallback, useEffect, useRef, useState } from "react";

import { AMBIENT_FINALE, AMBIENT_TOUR, captionFor, createDrone, finaleCaptionFor, outernessFor, PAUSE_AFTER_LINE_MS, speakLine } from "./ambient";
import type { AmbientKey, Caption, Drone } from "./ambient";
import { NARRATION } from "./bodies";
import type { BodyName, SmallBodyCategory } from "./bodies";

// The solar scene apiRef, shared upward so the persistent ambient orchestrator can drive it.
export type AmbientApi = {
  focus: (name: BodyName, close?: boolean) => void;
  scale: (mode: "readable" | "linear" | "true") => void;
  smallBodies: (category: SmallBodyCategory) => void;
  flyTo: (name: BodyName, onArrive: () => void) => void;
  setAmbient: (on: boolean) => void;
  date: (date: Date) => void;
  previewDate: (date: Date) => void;
};

type Phase = "off" | "gate" | "playing";

// A shuffle bag per body: hand out every fact once, in random order, before any repeats, then
// reshuffle. Better than picking purely at random each time — pure random can replay one fact
// while another goes unheard for ages, and for a child you want him to eventually hear them all.
// Also cheaper on the ear: no fact lands twice in a row, even across a reshuffle.
class ShuffleBag {
  private bags = new Map<AmbientKey, number[]>();
  private last = new Map<AmbientKey, number>();

  next(name: AmbientKey): number {
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
export function useAmbient({solarApi,navigate}:{solarApi:()=>AmbientApi|null;navigate:(mode:"galaxy"|"local"|"universe"|"solar")=>void}) {
  const [phase, setPhase] = useState<Phase>("off");
  const [caption, setCaption] = useState<Caption | null>(null);

  const drone = useRef<Drone | null>(null);
  const bag = useRef(new ShuffleBag());
  const stopSpeaking = useRef<(() => void) | null>(null);
  const timer = useRef<number | null>(null);
  // A token invalidated on every exit, so an async arrival from an abandoned run cannot resurrect
  // the tour after the user has left.
  const run = useRef(0);
  const navigateRef = useRef(navigate);
  useEffect(()=>{navigateRef.current=navigate;},[navigate]);

  const clearTimer = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };

  // The loop advances by calling itself after each line. Routing the recursion through a ref keeps
  // `step` from referencing itself in its own closure (which cannot be initialised in order).
  const stepRef = useRef<(index: number, token: number) => void>(() => {});

  const runFinale = useCallback((token:number) => {
    const arrive=(index:number) => {
      if(token!==run.current)return;
      if(index===AMBIENT_FINALE.length){
        setCaption(null);
        navigateRef.current("solar");
        timer.current=window.setTimeout(()=>{
          timer.current=null;
          if(token!==run.current)return;
          stepRef.current(0,token);
        },1100);
        return;
      }
      const beat=AMBIENT_FINALE[index];
      setCaption(null);
      drone.current?.setOuterness(1);
      navigateRef.current(beat.mode);
      timer.current=window.setTimeout(()=>{
        timer.current=null;
        if(token!==run.current)return;
        const lineIndex=bag.current.next(beat.narrationKey),card=finaleCaptionFor(beat,lineIndex);
        setCaption(card);
        drone.current?.setDucked(true);
        stopSpeaking.current=speakLine(beat.narrationKey,lineIndex,card.line,()=>{
          if(token!==run.current)return;
          drone.current?.setDucked(false);
          timer.current=window.setTimeout(()=>{
            timer.current=null;
            if(token!==run.current)return;
            arrive(index+1);
          },PAUSE_AFTER_LINE_MS);
        });
      },1100);
    };
    arrive(0);
  },[]);

  const step = useCallback((index: number, token: number) => {
    const apiHandle = solarApi();
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
        timer.current = window.setTimeout(() => {
          timer.current=null;
          if(token!==run.current)return;
          if(index===AMBIENT_TOUR.length-1)runFinale(token);else stepRef.current(index+1,token);
        }, PAUSE_AFTER_LINE_MS);
      });
    });
  }, [runFinale, solarApi]);
  useEffect(() => { stepRef.current = step; }, [step]);

  const enter = useCallback(() => setPhase("gate"), []);

  const begin = useCallback(async () => {
    const apiHandle = solarApi();
    if (!apiHandle) return;
    drone.current = createDrone();
    await drone.current.resume();
    apiHandle.date(new Date());   // positions live, for right now
    apiHandle.setAmbient(true);
    setPhase("playing");
    const token = ++run.current;
    step(0, token);
  }, [solarApi, step]);

  const exit = useCallback(() => {
    const token=++run.current;
    clearTimer();
    stopSpeaking.current?.();
    stopSpeaking.current = null;
    drone.current?.stop();
    drone.current = null;
    solarApi()?.setAmbient(false);
    setCaption(null);
    setPhase("off");
    navigateRef.current("solar");
    timer.current=window.setTimeout(()=>{timer.current=null;if(token!==run.current)return;navigateRef.current("solar");},1100);
  }, [solarApi]);

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

export type AmbientState = ReturnType<typeof useAmbient>;
