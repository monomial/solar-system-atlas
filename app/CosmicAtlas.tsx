"use client";

import { useEffect, useRef, useState } from "react";
import SolarSystem from "./SolarSystem";
import DeepSpace from "./DeepSpace";
import { COSMIC_JOURNEY } from "./cosmic";
import type { AtlasMode } from "./cosmic";

const MODE_LABELS: Record<AtlasMode, string> = { solar:"Solar system",galaxy:"Milky Way",local:"Local Group" };

export default function CosmicAtlas() {
  const [mode,setMode]=useState<AtlasMode>("solar");
  const [ambient,setAmbient]=useState(false);
  const [transition,setTransition]=useState<{from:AtlasMode;to:AtlasMode}|null>(null);
  const [journey,setJourney]=useState<number|null>(null);
  const timers=useRef<number[]>([]);

  useEffect(()=>()=>timers.current.forEach(window.clearTimeout),[]);

  function navigate(next:AtlasMode){
    if(next===mode||transition)return;
    timers.current.forEach(window.clearTimeout);timers.current=[];
    setTransition({from:mode,to:next});
    timers.current.push(window.setTimeout(()=>setMode(next),320));
    timers.current.push(window.setTimeout(()=>setTransition(null),980));
  }
  function beginJourney(){setJourney(0);navigate("solar");}
  function moveJourney(delta:number){
    if(journey===null)return;
    const next=(journey+delta+COSMIC_JOURNEY.length)%COSMIC_JOURNEY.length;
    setJourney(next);navigate(COSMIC_JOURNEY[next].mode);
  }
  const focus=journey===null?undefined:COSMIC_JOURNEY[journey].focus;

  return <div className={`cosmic-host ${journey!==null?"journey-active":""}`}>
    {mode==="solar"?<SolarSystem onAmbientModeChange={setAmbient}/>:<DeepSpace key={mode} mode={mode} focusId={focus}/>} 

    {!ambient&&<>
      <nav className="cosmic-scale-nav" aria-label="Choose atlas scale">
        {(Object.keys(MODE_LABELS) as AtlasMode[]).map(value=><button key={value} className={mode===value?"active":""} onClick={()=>navigate(value)} aria-current={mode===value?"page":undefined}><i/>{MODE_LABELS[value]}</button>)}
      </nav>
      <button className="cosmic-journey-launch" onClick={beginJourney}>Cosmic address</button>
    </>}

    {transition&&<div className="cosmic-transition" aria-live="polite">
      <div><span>{MODE_LABELS[transition.from]}</span><i/><strong>{MODE_LABELS[transition.to]}</strong></div>
    </div>}

    {journey!==null&&<section className="cosmic-tour-card" aria-live="polite">
      <div className="cosmic-tour-progress">{COSMIC_JOURNEY.map((_,index)=><i key={index} className={index<=journey?"done":""}/>)}</div>
      <button className="cosmic-tour-close" onClick={()=>setJourney(null)} aria-label="Exit cosmic address journey">×</button>
      <div className="eyebrow">{COSMIC_JOURNEY[journey].eyebrow}</div>
      <h2>{COSMIC_JOURNEY[journey].title}</h2>
      <p>{COSMIC_JOURNEY[journey].note}</p>
      <div className="cosmic-tour-actions"><button onClick={()=>moveJourney(-1)} aria-label="Previous cosmic address">←</button><span>{journey+1} / {COSMIC_JOURNEY.length}</span><button className="next" onClick={()=>moveJourney(1)}>{journey===COSMIC_JOURNEY.length-1?"RESTART":"NEXT"} →</button></div>
    </section>}
  </div>;
}
