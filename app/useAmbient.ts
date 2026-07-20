import { useCallback, useEffect, useRef, useState } from "react";

import { AMBIENT_FINALE, AMBIENT_TOUR, captionFor, createDrone, finaleCaptionFor, outernessFor, PAUSE_AFTER_LINE_MS, playScene, ShuffleBag, speakLine } from "./ambient";
import type { BridgeCaption, Caption, Drone } from "./ambient";
import { NARRATION } from "./bodies";
import type { BodyName, SmallBodyCategory } from "./bodies";
import { BRIDGE_SCENES, isBridgeBody } from "./bridgeScenes";

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

/** Drives the outward auto-tour: fly to a world, arrive, speak, hold, advance. Everything the
 *  loop owns is cancellable, because the user can leave at any moment. */
export function useAmbient({solarApi,navigate,starbotsMode}:{solarApi:()=>AmbientApi|null;navigate:(mode:"galaxy"|"local"|"universe"|"solar")=>void;starbotsMode:boolean}) {
  const [phase, setPhase] = useState<Phase>("off");
  const [caption, setCaption] = useState<Caption | null>(null);
  const [bridgeCaption, setBridgeCaption] = useState<BridgeCaption | null>(null);

  const drone = useRef<Drone | null>(null);
  const bag = useRef(new ShuffleBag());
  const sceneBag = useRef(new ShuffleBag());
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
        const lineIndex=bag.current.next(beat.narrationKey,NARRATION[beat.narrationKey]?.length??1),card=finaleCaptionFor(beat,lineIndex);
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
    setBridgeCaption(null);
    drone.current?.setOuterness(outernessFor(name));

    apiHandle.flyTo(name, () => {
      if (token !== run.current) return; // arrived after the user left — drop it

      const advanceTour = () => { if(index===AMBIENT_TOUR.length-1)runFinale(token);else stepRef.current(index+1,token); };

      if (starbotsMode && isBridgeBody(name)) {
        const scenes = BRIDGE_SCENES[name];
        const sceneIndex = sceneBag.current.next(name, scenes.length);
        const scene = scenes[sceneIndex];
        stopSpeaking.current = playScene(name, sceneIndex, scene, {
          isCancelled: () => token !== run.current,
          onTurn: (turn, turnIndex) => {
            if (turnIndex === 0) drone.current?.setDucked(true);
            setBridgeCaption({ body: name, speaker: turn.speaker, text: turn.text, turnIndex, totalTurns: scene.turns.length });
          },
          onTurnEnd: (turnIndex) => { if (turnIndex === scene.turns.length - 1) drone.current?.setDucked(false); },
        }, () => {
          if (token !== run.current) return;
          advanceTour();
        });
        return;
      }

      const lineIndex = bag.current.next(name,NARRATION[name]?.length??1);

      const card = captionFor(name, lineIndex);
      setCaption(card);
      drone.current?.setDucked(true);

      stopSpeaking.current = speakLine(name, lineIndex, card.line, () => {
        if (token !== run.current) return;
        drone.current?.setDucked(false);
        timer.current = window.setTimeout(() => {
          timer.current=null;
          if(token!==run.current)return;
          advanceTour();
        }, PAUSE_AFTER_LINE_MS);
      });
    });
  }, [runFinale, solarApi, starbotsMode]);
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
    setBridgeCaption(null);
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

  return { phase, caption, bridgeCaption, enter, begin, exit };
}

export type AmbientState = ReturnType<typeof useAmbient>;
