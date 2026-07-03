"use client";

import { useEffect, useState } from "react";

/**
 * Full-viewport "AI is working" chrome, in the Apple-Intelligence genre:
 * an iridescent sweep that BLEEDS in from the screen edges and dissolves
 * toward the center — no border radius, no hard inner boundary, just a
 * soft gradient falloff — plus an input blocker so nothing is operable
 * while StoryOS is generating/drawing.
 *
 * Deliberate rule-3 color decision: the flowing spectrum is a functional
 * AI-state indicator (screen-level "generation in progress"), not surface
 * decoration — brand red is woven into the sweep.
 */
export function AiEdgeGlow({ active, label }: { active: boolean; label?: string }) {
  // Keep mounted briefly after deactivation so the light fades out
  // instead of vanishing on the last frame. Activation is derived during
  // render (sanctioned prop-derived-state adjustment); only the delayed
  // unmount needs the effect.
  const [render, setRender] = useState(active);
  if (active && !render) setRender(true);
  useEffect(() => {
    if (active) return;
    const timer = window.setTimeout(() => setRender(false), 550);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!render) return null;

  const sweep =
    "conic-gradient(from var(--fizz-ai-angle), #E52227, #ff9d57, #ffd76f, #7cc7ff, #b18cff, #ff6ac1, #E52227)";
  // Union of a horizontal and a vertical edge band, each fading to nothing
  // toward the center — the glow dissolves instead of stopping at a line.
  // PIXEL-based falloff so the light keeps the same physical size on any
  // viewport (percentages read fat and smudgy on large screens).
  const edgeFalloff = (inset: string) =>
    `linear-gradient(to right, black, transparent ${inset}, transparent calc(100% - ${inset}), black), ` +
    `linear-gradient(to bottom, black, transparent ${inset}, transparent calc(100% - ${inset}), black)`;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[90] transition-opacity duration-500"
      style={{ opacity: active ? 1 : 0 }}
    >
      <style>{`
        @property --fizz-ai-angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }
        @keyframes fizzAiSweep {
          to { --fizz-ai-angle: 360deg; }
        }
        @keyframes fizzAiBreathe {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes fizzNodePop {
          0% { opacity: 0; scale: 0.86; }
          60% { opacity: 1; }
          100% { opacity: 1; scale: 1; }
        }
        @keyframes fizzEdgeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .fizz-node-enter {
          animation: fizzNodePop 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
          transform-origin: center;
        }
        .fizz-edge-enter {
          animation: fizzEdgeIn 0.45s ease both;
        }
      `}</style>

      {/* input blocker — nothing on screen is operable while the AI draws */}
      <div className="absolute inset-0 cursor-progress" />

      {/* luminous thread right at the screen edge */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: sweep,
          filter: "blur(1.5px)",
          opacity: 0.95,
          mask: edgeFalloff("4px"),
          WebkitMask: edgeFalloff("4px"),
          animation: "fizzAiSweep 3.2s linear infinite",
        }}
      />
      {/* ~20px visual band: a short soft bleed off the thread, nothing more */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: sweep,
          filter: "blur(8px)",
          opacity: 0.65,
          mask: edgeFalloff("22px"),
          WebkitMask: edgeFalloff("22px"),
          animation: "fizzAiSweep 3.2s linear infinite, fizzAiBreathe 2.6s ease-in-out infinite",
        }}
      />

      {label ? (
        <div className="pointer-events-none absolute top-7 left-1/2 -translate-x-1/2">
          <span className="inline-flex h-9 items-center gap-2.5 rounded-full bg-[oklch(0.19_0_0)/0.92] px-4 text-[13px] font-medium text-white/78 shadow-[0_16px_48px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#E52227] opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-[#E52227]" />
            </span>
            {label}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The "AI is sketching" placeholder shown on the empty canvas while the
 * analysis is still running — a ghost story-root drawing itself (animated
 * dashed outline + shimmer lines) with satellite stubs pulsing in around
 * it, so the canvas visibly works from the first click instead of idling
 * until the result arrives.
 */
export function AiSketchGhost({ active }: { active: boolean }) {
  if (!active) return null;

  const satellites = [
    { left: "68%", top: "22%", delay: "0s" },
    { left: "76%", top: "48%", delay: "0.5s" },
    { left: "66%", top: "72%", delay: "1s" },
    { left: "24%", top: "76%", delay: "1.5s" },
  ];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <style>{`
        @keyframes fizzGhostDash {
          to { stroke-dashoffset: -48; }
        }
        @keyframes fizzGhostShimmer {
          from { background-position: -200% 0; }
          to { background-position: 200% 0; }
        }
        @keyframes fizzGhostFloat {
          0%, 100% { translate: 0 0; }
          50% { translate: 0 -8px; }
        }
        @keyframes fizzGhostPulse {
          0%, 100% { opacity: 0.14; scale: 0.94; }
          50% { opacity: 0.42; scale: 1; }
        }
      `}</style>

      <div className="absolute top-1/2 left-[38%] -translate-x-1/2 -translate-y-1/2">
        <div
          className="relative h-[240px] w-[300px]"
          style={{ animation: "fizzGhostFloat 4.5s ease-in-out infinite" }}
        >
          {/* self-drawing dashed silhouette */}
          <svg className="absolute inset-0 size-full" viewBox="0 0 300 240" fill="none">
            <rect
              x="1.5"
              y="1.5"
              width="297"
              height="237"
              rx="26"
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="1.5"
              strokeDasharray="10 14"
              style={{ animation: "fizzGhostDash 2.4s linear infinite" }}
            />
          </svg>
          {/* shimmering draft lines */}
          <div className="absolute inset-0 flex flex-col gap-3 p-7">
            {[64, 100, 88, 46].map((width, index) => (
              <div
                key={index}
                className="h-3.5 rounded-full"
                style={{
                  width: `${width}%`,
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0.05) 75%)",
                  backgroundSize: "200% 100%",
                  animation: `fizzGhostShimmer 2.2s ease-in-out ${index * 0.18}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* satellite stubs waiting to become cast / plots / clues */}
      {satellites.map((satellite, index) => (
        <div
          key={index}
          className="absolute h-[72px] w-[120px] rounded-[18px] bg-white/[0.08]"
          style={{
            left: satellite.left,
            top: satellite.top,
            animation: `fizzGhostPulse 2.8s ease-in-out ${satellite.delay} infinite`,
          }}
        />
      ))}
    </div>
  );
}
