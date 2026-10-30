"use client";

// The village prototype as a React component: the same markup the prototype had, with refs
// instead of ids, and the drawing engine mounted in an effect. All the picture and the
// stories live in engine.ts; this file only hands it the DOM and the two page hooks.
import { useEffect, useRef } from "react";
import { mountVillage, type VillageStage } from "./engine.ts";
import "./canvas.css";

export type { VillageStage } from "./engine.ts";

export interface VillageCanvasProps {
  /** The person pressed E or clicked the human desk in the scene. */
  onEnterDesk?: () => void;
  /** The robot's stop changed (null while it walks between stops). */
  onStage?: (stage: VillageStage | null) => void;
  className?: string;
}

export default function VillageCanvas({ onEnterDesk, onStage, className }: VillageCanvasProps) {
  const screen = useRef<HTMLCanvasElement>(null);
  const title = useRef<HTMLCanvasElement>(null);
  const logbook = useRef<HTMLCanvasElement>(null);
  const keys = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLDivElement>(null);
  const b1 = useRef<HTMLButtonElement>(null);
  const b2 = useRef<HTMLButtonElement>(null);
  const b3 = useRef<HTMLButtonElement>(null);
  const bauto = useRef<HTMLButtonElement>(null);
  const bday = useRef<HTMLButtonElement>(null);
  const bsound = useRef<HTMLButtonElement>(null);
  const bspeed = useRef<HTMLButtonElement>(null);
  const brules = useRef<HTMLButtonElement>(null);
  const bA = useRef<HTMLButtonElement>(null);
  const bR = useRef<HTMLButtonElement>(null);

  // The engine mounts once. The callbacks are read through a ref, so a parent that passes a
  // new function on every render never restarts the village.
  const hooks = useRef({ onEnterDesk, onStage });
  hooks.current = { onEnterDesk, onStage };

  useEffect(() => {
    if (
      !screen.current || !title.current || !logbook.current || !keys.current || !live.current ||
      !b1.current || !b2.current || !b3.current || !bauto.current || !bday.current ||
      !bsound.current || !bspeed.current || !brules.current || !bA.current || !bR.current
    ) {
      return;
    }
    const handle = mountVillage(
      {
        screen: screen.current,
        title: title.current,
        logbook: logbook.current,
        keys: keys.current,
        live: live.current,
        buttons: {
          b1: b1.current, b2: b2.current, b3: b3.current, bauto: bauto.current, bday: bday.current,
          bsound: bsound.current, bspeed: bspeed.current, brules: brules.current, bA: bA.current, bR: bR.current,
        },
      },
      {
        onEnterDesk: () => hooks.current.onEnterDesk?.(),
        onStage: (stage) => hooks.current.onStage?.(stage),
      },
    );
    return () => handle.destroy();
  }, []);

  return (
    <div className={className ? `village-canvas ${className}` : "village-canvas"}>
      <h1 className="village-sr">Approval Desk village: a refund agent, a gate, a human desk and a factory</h1>
      <div className="village-device">
        <canvas ref={title} className="village-title" width={320} height={28} aria-hidden="true" />
        <canvas
          ref={screen}
          className="village-screen"
          width={320}
          height={240}
          role="img"
          aria-label="Pixel-art village at dusk. A small coral robot, the refund agent, walks between its house, the inbox stand, the gate with a three-colour light, the human desk screen and the factory that pays refunds. The shop stands in the middle and two empty houses are for sale. Press E, or click the human desk, to enter it."
        />
        <canvas
          ref={logbook}
          className="village-logbook"
          width={320}
          height={54}
          role="button"
          tabIndex={0}
          aria-label="Logbook. Press to see recent decisions and the reasons behind them"
        />
      </div>
      <div className="village-bar">
        <button ref={b1} type="button" aria-label="Scene 1: small $24 refund, allowed" />
        <button ref={b2} type="button" aria-label="Scene 2: big $150 refund, needs a human" />
        <button ref={b3} type="button" aria-label="Scene 3: ridiculous $500 request, blocked" />
        <button ref={bauto} type="button" className="village-bauto" aria-pressed="true" aria-label="Auto-play" />
        <button ref={bday} type="button" aria-pressed="false" aria-label="Day palette" />
        <button ref={bsound} type="button" className="village-bsound" aria-pressed="true" aria-label="Sound effects" />
        <button ref={bspeed} type="button" aria-label="Playback speed" />
        <button ref={brules} type="button" aria-label="Show the hard rules" />
      </div>
      <canvas ref={keys} className="village-keys" width={320} height={9} aria-hidden="true" />
      <div className="village-bar2">
        <button ref={bA} type="button" className="village-bA" hidden aria-label="Approve the refund" />
        <button ref={bR} type="button" className="village-bR" hidden aria-label="Reject the refund" />
      </div>
      <div ref={live} className="village-sr" aria-live="polite" />
    </div>
  );
}
