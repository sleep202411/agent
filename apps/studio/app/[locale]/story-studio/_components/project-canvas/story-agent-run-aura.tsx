"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

export interface StoryAgentRunAuraProps {
  active: boolean;
}

const TOP_GLOW =
  "radial-gradient(circle at 8% 64%, rgba(255,95,162,0.92) 0%, rgba(255,95,162,0.45) 18%, transparent 38%), radial-gradient(circle at 34% 42%, rgba(157,92,255,0.94) 0%, rgba(157,92,255,0.44) 20%, transparent 42%), radial-gradient(circle at 64% 56%, rgba(79,124,255,0.95) 0%, rgba(79,124,255,0.42) 22%, transparent 44%), radial-gradient(circle at 90% 48%, rgba(57,217,255,0.92) 0%, rgba(57,217,255,0.4) 18%, transparent 40%)";
const RIGHT_GLOW =
  "radial-gradient(circle at 42% 8%, rgba(57,217,255,0.94) 0%, rgba(57,217,255,0.42) 19%, transparent 40%), radial-gradient(circle at 58% 34%, rgba(79,124,255,0.95) 0%, rgba(79,124,255,0.42) 22%, transparent 44%), radial-gradient(circle at 46% 65%, rgba(157,92,255,0.94) 0%, rgba(157,92,255,0.44) 20%, transparent 42%), radial-gradient(circle at 55% 92%, rgba(255,95,162,0.9) 0%, rgba(255,95,162,0.4) 18%, transparent 40%)";
const BOTTOM_GLOW =
  "radial-gradient(circle at 8% 45%, rgba(255,159,67,0.94) 0%, rgba(255,159,67,0.44) 18%, transparent 40%), radial-gradient(circle at 34% 58%, rgba(255,95,162,0.94) 0%, rgba(255,95,162,0.42) 22%, transparent 44%), radial-gradient(circle at 66% 44%, rgba(157,92,255,0.94) 0%, rgba(157,92,255,0.42) 20%, transparent 42%), radial-gradient(circle at 92% 58%, rgba(79,124,255,0.92) 0%, rgba(79,124,255,0.4) 18%, transparent 40%)";
const LEFT_GLOW =
  "radial-gradient(circle at 56% 8%, rgba(255,159,67,0.92) 0%, rgba(255,159,67,0.42) 18%, transparent 40%), radial-gradient(circle at 44% 34%, rgba(255,95,162,0.94) 0%, rgba(255,95,162,0.42) 20%, transparent 42%), radial-gradient(circle at 58% 64%, rgba(157,92,255,0.94) 0%, rgba(157,92,255,0.44) 22%, transparent 44%), radial-gradient(circle at 42% 92%, rgba(57,217,255,0.92) 0%, rgba(57,217,255,0.4) 18%, transparent 40%)";

const HORIZONTAL_RIBBON =
  "linear-gradient(90deg, transparent 0%, rgba(255,95,162,0.74) 12%, rgba(157,92,255,0.88) 34%, rgba(79,124,255,0.9) 58%, rgba(57,217,255,0.78) 78%, transparent 100%)";
const HORIZONTAL_RIBBON_REVERSED =
  "linear-gradient(90deg, transparent 0%, rgba(255,159,67,0.76) 13%, rgba(255,95,162,0.86) 36%, rgba(157,92,255,0.9) 62%, rgba(79,124,255,0.76) 82%, transparent 100%)";
const VERTICAL_RIBBON =
  "linear-gradient(180deg, transparent 0%, rgba(57,217,255,0.76) 13%, rgba(79,124,255,0.9) 36%, rgba(157,92,255,0.88) 63%, rgba(255,95,162,0.74) 82%, transparent 100%)";
const VERTICAL_RIBBON_REVERSED =
  "linear-gradient(180deg, transparent 0%, rgba(255,159,67,0.74) 12%, rgba(255,95,162,0.88) 36%, rgba(157,92,255,0.9) 61%, rgba(57,217,255,0.76) 82%, transparent 100%)";

/**
 * Viewport aura shown while the Story Agent owns the project write lock.
 * It never intercepts canvas input and intentionally exposes no interaction or
 * status text; the surrounding authoring UI owns those accessible semantics.
 */
export function StoryAgentRunAura({ active }: StoryAgentRunAuraProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!active || !rootRef.current) return;

      const edges = [topRef.current, rightRef.current, bottomRef.current, leftRef.current].filter(
        (edge): edge is HTMLDivElement => edge !== null
      );
      const ribbons = rootRef.current.querySelectorAll<HTMLElement>(
        "[data-story-agent-aura-ribbon]"
      );
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          rootRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.36, ease: "power2.out" }
        );
        gsap.set(edges, { opacity: 0.68, transformOrigin: "50% 50%" });

        gsap.to(topRef.current, {
          xPercent: 7,
          yPercent: 3,
          scaleX: 1.08,
          rotation: 0.7,
          opacity: 0.9,
          duration: 4.4,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        });
        gsap.to(rightRef.current, {
          xPercent: -3,
          yPercent: -8,
          scaleY: 1.07,
          rotation: -0.8,
          opacity: 0.86,
          duration: 5.2,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        });
        gsap.to(bottomRef.current, {
          xPercent: -8,
          yPercent: -3,
          scaleX: 1.1,
          rotation: -0.6,
          opacity: 0.91,
          duration: 4.8,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        });
        gsap.to(leftRef.current, {
          xPercent: 4,
          yPercent: 7,
          scaleY: 1.08,
          rotation: 0.8,
          opacity: 0.87,
          duration: 5.5,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        });
        gsap.to(ribbons, {
          xPercent: 4,
          yPercent: -3,
          scale: 1.06,
          opacity: 0.86,
          duration: 3.6,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          stagger: 0.31,
        });
      });

      media.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(rootRef.current, { opacity: 1 });
        gsap.set(edges, {
          xPercent: 0,
          yPercent: 0,
          scale: 1,
          rotation: 0,
          opacity: 0.7,
        });
        gsap.set(ribbons, { xPercent: 0, yPercent: 0, scale: 1, opacity: 0.72 });
      });

      return () => media.revert();
    },
    { scope: rootRef, dependencies: [active], revertOnUpdate: true }
  );

  if (!active) return null;

  return (
    <div
      ref={rootRef}
      data-story-agent-run-aura
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[90] overflow-hidden"
    >
      <div
        ref={topRef}
        data-story-agent-aura-edge="top"
        className="absolute -top-8 left-[4%] h-16 w-[92%] opacity-70 [will-change:transform,opacity]"
      >
        <div
          className="absolute inset-0 mix-blend-screen blur-[18px]"
          style={{ background: TOP_GLOW }}
        />
        <div
          data-story-agent-aura-ribbon
          className="absolute inset-x-[7%] bottom-4 h-3.5 rounded-full opacity-75 mix-blend-screen blur-[8px] [will-change:transform,opacity]"
          style={{ background: HORIZONTAL_RIBBON }}
        />
      </div>

      <div
        ref={rightRef}
        data-story-agent-aura-edge="right"
        className="absolute top-[4%] -right-8 h-[92%] w-16 opacity-70 [will-change:transform,opacity]"
      >
        <div
          className="absolute inset-0 mix-blend-screen blur-[18px]"
          style={{ background: RIGHT_GLOW }}
        />
        <div
          data-story-agent-aura-ribbon
          className="absolute inset-y-[7%] left-4 w-3.5 rounded-full opacity-75 mix-blend-screen blur-[8px] [will-change:transform,opacity]"
          style={{ background: VERTICAL_RIBBON }}
        />
      </div>

      <div
        ref={bottomRef}
        data-story-agent-aura-edge="bottom"
        className="absolute -bottom-8 left-[4%] h-16 w-[92%] opacity-70 [will-change:transform,opacity]"
      >
        <div
          className="absolute inset-0 mix-blend-screen blur-[18px]"
          style={{ background: BOTTOM_GLOW }}
        />
        <div
          data-story-agent-aura-ribbon
          className="absolute inset-x-[7%] top-4 h-3.5 rounded-full opacity-75 mix-blend-screen blur-[8px] [will-change:transform,opacity]"
          style={{ background: HORIZONTAL_RIBBON_REVERSED }}
        />
      </div>

      <div
        ref={leftRef}
        data-story-agent-aura-edge="left"
        className="absolute top-[4%] -left-8 h-[92%] w-16 opacity-70 [will-change:transform,opacity]"
      >
        <div
          className="absolute inset-0 mix-blend-screen blur-[18px]"
          style={{ background: LEFT_GLOW }}
        />
        <div
          data-story-agent-aura-ribbon
          className="absolute inset-y-[7%] right-4 w-3.5 rounded-full opacity-75 mix-blend-screen blur-[8px] [will-change:transform,opacity]"
          style={{ background: VERTICAL_RIBBON_REVERSED }}
        />
      </div>
    </div>
  );
}
