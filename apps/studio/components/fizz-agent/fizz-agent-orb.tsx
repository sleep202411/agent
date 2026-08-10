"use client";

import { useGSAP } from "@gsap/react";
import { IconMessageCircle } from "@tabler/icons-react";
import gsap from "gsap";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";

import { cn } from "@/lib/utils";

export type FizzAgentOrbButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  active?: boolean;
  hoverMessages?: readonly string[];
  size?: number;
};

gsap.registerPlugin(useGSAP);

const pathMotion = {
  coolArc: {
    translate: "0 0;3.4 -2.8;-2.6 3;0 0",
    translateDuration: "2.2s",
    values:
      "M13 57 C8 35 18 14 39 8 C58 3 78 15 89 34;M11 61 C5 38 20 15 42 6 C61 2 80 16 91 38;M16 54 C10 31 22 11 40 9 C59 6 76 13 87 30;M13 57 C8 35 18 14 39 8 C58 3 78 15 89 34",
    duration: "2s",
  },
  warmArc: {
    translate: "0 0;-3.2 2.8;3.4 -3.4;0 0",
    translateDuration: "2.5s",
    values:
      "M7 63 C7 42 22 20 47 13 C67 8 87 22 93 43;M5 68 C6 44 24 17 50 12 C71 8 88 25 94 47;M10 58 C10 37 26 22 46 14 C66 6 84 20 91 39;M7 63 C7 42 22 20 47 13 C67 8 87 22 93 43",
    duration: "2.3s",
  },
  magentaShell: {
    translate: "0 0;3.8 -3.1;-3.6 3.7;0 0",
    translateDuration: "2.1s",
    values:
      "M19 32 C29 9 57 5 77 18 C96 31 98 58 83 77 C67 97 37 97 18 79 C2 64 8 42 19 32 Z;M16 36 C24 11 54 3 76 15 C97 27 101 53 87 74 C72 97 42 101 20 82 C1 66 5 47 16 36 Z;M22 28 C34 8 61 7 80 22 C97 36 95 63 78 80 C60 97 31 94 16 75 C4 59 10 39 22 28 Z;M19 32 C29 9 57 5 77 18 C96 31 98 58 83 77 C67 97 37 97 18 79 C2 64 8 42 19 32 Z",
    duration: "1.9s",
  },
  pearlShell: {
    translate: "0 0;-3.6 3.1;3.8 -2.9;0 0",
    translateDuration: "2s",
    values:
      "M10 52 C11 29 33 15 57 18 C79 21 93 39 91 60 C76 55 64 44 52 31 C39 18 21 28 10 52 Z;M8 56 C8 31 31 13 56 16 C81 19 94 36 94 56 C78 54 65 43 51 29 C37 17 20 31 8 56 Z;M13 48 C17 27 36 16 59 20 C78 23 89 42 87 64 C74 57 63 47 50 34 C38 22 22 25 13 48 Z;M10 52 C11 29 33 15 57 18 C79 21 93 39 91 60 C76 55 64 44 52 31 C39 18 21 28 10 52 Z",
    duration: "1.7s",
  },
  orangeShell: {
    translate: "0 0;3.2 3.8;-3.5 -2.8;0 0",
    translateDuration: "2.4s",
    values:
      "M58 16 C79 18 95 34 95 56 C95 77 78 91 56 91 C70 75 75 58 71 43 C68 30 62 21 58 16 Z;M61 17 C83 22 96 39 93 61 C90 80 73 92 52 89 C69 75 77 60 75 44 C72 31 65 21 61 17 Z;M55 18 C77 15 96 29 98 52 C101 75 82 93 61 94 C72 76 73 60 68 43 C65 31 60 23 55 18 Z;M58 16 C79 18 95 34 95 56 C95 77 78 91 56 91 C70 75 75 58 71 43 C68 30 62 21 58 16 Z",
    duration: "2.1s",
  },
  blueShell: {
    translate: "0 0;-3.7 -3;3.2 3.6;0 0",
    translateDuration: "2.6s",
    values:
      "M13 62 C6 42 13 20 33 10 C26 30 30 53 47 70 C59 82 75 86 91 79 C76 98 44 103 22 86 C16 81 13 72 13 62 Z;M11 58 C7 39 17 17 38 8 C29 29 31 51 50 69 C63 81 79 83 92 75 C77 96 48 104 24 88 C16 82 12 70 11 58 Z;M16 66 C6 45 10 23 29 12 C25 34 34 56 50 72 C62 84 77 90 90 82 C70 100 40 100 20 83 C14 77 15 71 16 66 Z;M13 62 C6 42 13 20 33 10 C26 30 30 53 47 70 C59 82 75 86 91 79 C76 98 44 103 22 86 C16 81 13 72 13 62 Z",
    duration: "2s",
  },
  cyanShell: {
    translate: "0 0;3.4 3.6;-4 -3.2;0 0",
    translateDuration: "1.8s",
    values:
      "M21 71 C37 91 68 94 88 66 C88 82 75 96 54 99 C31 102 13 89 8 69 C10 66 16 66 21 71 Z;M18 68 C35 93 66 97 91 69 C89 84 74 98 52 99 C28 101 12 87 7 65 C11 64 15 64 18 68 Z;M24 74 C43 90 70 91 85 61 C91 78 78 95 57 101 C34 105 15 92 10 72 C13 69 19 69 24 74 Z;M21 71 C37 91 68 94 88 66 C88 82 75 96 54 99 C31 102 13 89 8 69 C10 66 16 66 21 71 Z",
    duration: "1.6s",
  },
  core: {
    translate: "0 0;2.4 -2;-2.2 2.3;0 0",
    translateDuration: "2.4s",
    values:
      "M46 16 C65 16 81 30 86 49 C91 69 75 88 53 90 C31 92 13 78 12 55 C11 34 25 16 46 16 Z;M47 15 C67 17 83 32 86 52 C89 72 72 88 50 89 C28 90 13 75 13 52 C13 31 28 15 47 15 Z;M44 17 C64 14 82 28 88 47 C94 68 78 86 57 91 C34 96 14 80 11 58 C8 37 23 19 44 17 Z;M46 16 C65 16 81 30 86 49 C91 69 75 88 53 90 C31 92 13 78 12 55 C11 34 25 16 46 16 Z",
    duration: "2.1s",
  },
  coreEdge: {
    translate: "0 0;2.6 -2.1;-2.4 2.5;0 0",
    translateDuration: "2.2s",
    values:
      "M46 16 C65 16 81 30 86 49 C91 69 75 88 53 90 C31 92 13 78 12 55 C11 34 25 16 46 16 Z;M47 15 C67 17 83 32 86 52 C89 72 72 88 50 89 C28 90 13 75 13 52 C13 31 28 15 47 15 Z;M44 17 C64 14 82 28 88 47 C94 68 78 86 57 91 C34 96 14 80 11 58 C8 37 23 19 44 17 Z;M46 16 C65 16 81 30 86 49 C91 69 75 88 53 90 C31 92 13 78 12 55 C11 34 25 16 46 16 Z",
    duration: "2.1s",
  },
  rim: {
    translate: "0 0;3 -2.6;-3.2 2.8;0 0",
    translateDuration: "1.9s",
    values:
      "M10 55 C17 76 42 91 67 82 C78 78 86 68 90 57;M8 58 C18 79 44 93 70 82 C82 77 88 66 91 54;M13 53 C19 73 40 89 64 84 C77 81 85 71 88 60;M10 55 C17 76 42 91 67 82 C78 78 86 68 90 57",
    duration: "1.7s",
  },
  highlight: {
    translate: "0 0;-2.8 2.4;3 -2.6;0 0",
    translateDuration: "1.6s",
    values:
      "M13 70 C32 91 66 94 87 69;M10 67 C31 93 69 92 90 66;M17 73 C36 89 64 96 84 72;M13 70 C32 91 66 94 87 69",
    duration: "1.5s",
  },
} as const;

const KEY_SPLINES = "0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1";

function PathMotion({ motion }: { motion: (typeof pathMotion)[keyof typeof pathMotion] }) {
  return (
    <>
      <animateTransform
        attributeName="transform"
        type="translate"
        values={motion.translate}
        dur={motion.translateDuration}
        repeatCount="indefinite"
      />
      <animate
        attributeName="d"
        values={motion.values}
        dur={motion.duration}
        repeatCount="indefinite"
        calcMode="spline"
        keySplines={KEY_SPLINES}
      />
    </>
  );
}

export function FizzAgentOrbButton({
  active = false,
  hoverMessages = [],
  size = 60,
  className,
  style,
  onBlur,
  onClick,
  onFocus,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  ...props
}: FizzAgentOrbButtonProps) {
  const instanceId = useId().replaceAll(":", "");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const orbVisualRef = useRef<SVGGElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const focusedRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const lastMessageIndexRef = useRef(-1);
  const orbMotionRef = useRef({ x: 0, y: 0, rotation: 0 });
  const quickXRef = useRef<(value: number) => void>(() => undefined);
  const quickYRef = useRef<(value: number) => void>(() => undefined);
  const quickRotationRef = useRef<(value: number) => void>(() => undefined);
  const [bubbleMessage, setBubbleMessage] = useState(hoverMessages[0] ?? "");
  const [interactionActive, setInteractionActive] = useState(false);
  const id = (name: string) => `fizz-agent-${instanceId}-${name}`;
  const sizedStyle = { width: size, height: size, ...style } satisfies CSSProperties;

  useGSAP(
    () => {
      const target = orbVisualRef.current;
      if (!target) return;

      const motion = orbMotionRef.current;
      const setX = gsap.quickSetter(target, "x", "px");
      const setY = gsap.quickSetter(target, "y", "px");
      const setRotation = gsap.quickSetter(target, "rotation", "deg");

      quickXRef.current = gsap.quickTo(motion, "x", {
        duration: 0.36,
        ease: "power2.out",
        onUpdate: () => setX(motion.x),
      });
      quickYRef.current = gsap.quickTo(motion, "y", {
        duration: 0.36,
        ease: "power2.out",
        onUpdate: () => setY(motion.y),
      });
      quickRotationRef.current = gsap.quickTo(motion, "rotation", {
        duration: 0.36,
        ease: "power2.out",
        onUpdate: () => setRotation(motion.rotation),
      });

      return () => {
        setX(0);
        setY(0);
        setRotation(0);
        motion.x = 0;
        motion.y = 0;
        motion.rotation = 0;
        quickXRef.current = () => undefined;
        quickYRef.current = () => undefined;
        quickRotationRef.current = () => undefined;
      };
    },
    { scope: buttonRef }
  );

  useGSAP(
    () => {
      const duration = reducedMotionRef.current ? 0 : interactionActive ? 0.46 : 0.34;
      if (!interactionActive) {
        quickXRef.current(0);
        quickYRef.current(0);
        quickRotationRef.current(0);
      }

      gsap.to(displacementRef.current, {
        attr: { scale: interactionActive ? 11 : 0 },
        duration,
        ease: interactionActive ? "power3.out" : "power2.out",
        overwrite: "auto",
      });
      gsap.to(orbVisualRef.current, {
        scale: interactionActive ? 1.07 : 1,
        duration,
        ease: interactionActive ? "power3.out" : "power2.out",
        overwrite: "auto",
        transformOrigin: "50% 50%",
      });

      if (!bubbleRef.current) return;
      gsap.to(bubbleRef.current, {
        autoAlpha: interactionActive ? 1 : 0,
        scale: interactionActive ? 1 : 0.97,
        y: interactionActive ? 0 : 5,
        duration: reducedMotionRef.current ? 0 : interactionActive ? 0.28 : 0.18,
        ease: interactionActive ? "back.out(1.45)" : "power2.in",
        overwrite: "auto",
      });
    },
    { scope: buttonRef, dependencies: [interactionActive] }
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => {
      reducedMotionRef.current = motionQuery.matches;
      if (motionQuery.matches) svg.pauseAnimations();
      else svg.unpauseAnimations();
    };

    syncMotion();
    motionQuery.addEventListener("change", syncMotion);
    return () => motionQuery.removeEventListener("change", syncMotion);
  }, []);

  return (
    <button
      {...props}
      ref={buttonRef}
      type={props.type ?? "button"}
      aria-pressed={active}
      data-fizz-agent-orb=""
      data-slot="fizz-agent-launcher"
      onPointerEnter={(event) => {
        pointerInsideRef.current = true;
        if (hoverMessages.length > 0) {
          const previousIndex = lastMessageIndexRef.current;
          const nextIndex =
            previousIndex < 0
              ? Math.floor(Math.random() * hoverMessages.length)
              : (previousIndex +
                  1 +
                  Math.floor(Math.random() * Math.max(1, hoverMessages.length - 1))) %
                hoverMessages.length;
          lastMessageIndexRef.current = nextIndex;
          setBubbleMessage(hoverMessages[nextIndex] ?? "");
        }
        setInteractionActive(true);
        onPointerEnter?.(event);
      }}
      onPointerMove={(event) => {
        if (!reducedMotionRef.current) {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
          const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
          quickXRef.current(x * 3.2);
          quickYRef.current(y * 3.2);
          quickRotationRef.current(x * 4);
        }
        onPointerMove?.(event);
      }}
      onPointerLeave={(event) => {
        pointerInsideRef.current = false;
        if (!focusedRef.current) setInteractionActive(false);
        onPointerLeave?.(event);
      }}
      onFocus={(event) => {
        focusedRef.current = true;
        setInteractionActive(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focusedRef.current = false;
        if (!pointerInsideRef.current) setInteractionActive(false);
        onBlur?.(event);
      }}
      onClick={(event) => {
        setInteractionActive(false);
        onClick?.(event);
      }}
      className={cn(
        "relative isolate shrink-0 overflow-visible rounded-full bg-transparent p-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        className
      )}
      style={sizedStyle}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        fill="none"
        className="block size-full overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={id("magenta-shell")}
            x1="22"
            y1="7"
            x2="80"
            y2="88"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FF5BB9" stopOpacity="0.86" />
            <stop offset="0.34" stopColor="#DD4A9D" stopOpacity="0.64" />
            <stop offset="0.7" stopColor="#8442AA" stopOpacity="0.3" />
            <stop offset="1" stopColor="#02101D" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={id("pearl-shell")}
            x1="12"
            y1="24"
            x2="89"
            y2="73"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.94" />
            <stop offset="0.24" stopColor="#FFE7F5" stopOpacity="0.78" />
            <stop offset="0.58" stopColor="#9BA3B9" stopOpacity="0.28" />
            <stop offset="1" stopColor="#071421" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={id("orange-shell")}
            x1="78"
            y1="16"
            x2="49"
            y2="92"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FF3424" stopOpacity="0.88" />
            <stop offset="0.3" stopColor="#FF7740" stopOpacity="0.64" />
            <stop offset="0.66" stopColor="#E34B8C" stopOpacity="0.33" />
            <stop offset="1" stopColor="#071421" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={id("cyan-shell")}
            x1="23"
            y1="93"
            x2="88"
            y2="37"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#0B5BFF" stopOpacity="0.18" />
            <stop offset="0.4" stopColor="#18DFFF" stopOpacity="0.78" />
            <stop offset="0.74" stopColor="#28E8FF" stopOpacity="0.42" />
            <stop offset="1" stopColor="#061221" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={id("blue-shell")}
            x1="13"
            y1="72"
            x2="55"
            y2="7"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#3048FF" stopOpacity="0.34" />
            <stop offset="0.4" stopColor="#15D6F3" stopOpacity="0.46" />
            <stop offset="0.76" stopColor="#FFFFFF" stopOpacity="0.2" />
            <stop offset="1" stopColor="#FE4EA9" stopOpacity="0.26" />
          </linearGradient>
          <radialGradient
            id={id("core")}
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(48 46) rotate(79) scale(45 40)"
          >
            <stop offset="0" stopColor="#06111F" />
            <stop offset="0.52" stopColor="#071323" stopOpacity="0.98" />
            <stop offset="0.76" stopColor="#162235" stopOpacity="0.9" />
            <stop offset="0.9" stopColor="#74747B" stopOpacity="0.48" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.16" />
          </radialGradient>
          <linearGradient
            id={id("core-edge")}
            x1="18"
            y1="21"
            x2="87"
            y2="80"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.52" />
            <stop offset="0.25" stopColor="#EF5AAE" stopOpacity="0.32" />
            <stop offset="0.6" stopColor="#FF6842" stopOpacity="0.45" />
            <stop offset="0.82" stopColor="#1FE2F8" stopOpacity="0.54" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.36" />
          </linearGradient>
          <linearGradient
            id={id("rim")}
            x1="9"
            y1="48"
            x2="91"
            y2="60"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.65" />
            <stop offset="0.22" stopColor="#FFE9F5" stopOpacity="0.54" />
            <stop offset="0.5" stopColor="#FF59A8" stopOpacity="0.38" />
            <stop offset="0.77" stopColor="#15DDF5" stopOpacity="0.58" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.56" />
          </linearGradient>
          <linearGradient
            id={id("warm-arc")}
            x1="5"
            y1="53"
            x2="92"
            y2="30"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#F0406E" stopOpacity="0.2" />
            <stop offset="0.42" stopColor="#FF4EA5" stopOpacity="0.55" />
            <stop offset="0.72" stopColor="#FF6A31" stopOpacity="0.6" />
            <stop offset="1" stopColor="#FFB152" stopOpacity="0.34" />
          </linearGradient>
          <linearGradient
            id={id("cool-arc")}
            x1="14"
            y1="21"
            x2="84"
            y2="86"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#11DBF7" stopOpacity="0.72" />
            <stop offset="0.37" stopColor="#FFFFFF" stopOpacity="0.28" />
            <stop offset="0.68" stopColor="#FD65BA" stopOpacity="0.42" />
            <stop offset="1" stopColor="#12D9F0" stopOpacity="0.66" />
          </linearGradient>
          <filter
            id={id("sheet-blur")}
            x="-18%"
            y="-18%"
            width="136%"
            height="136%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="0.9" />
          </filter>
          <filter
            id={id("core-shadow")}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            <feDropShadow
              dx="0"
              dy="2.5"
              stdDeviation="4"
              floodColor="#020916"
              floodOpacity="0.68"
            />
          </filter>
          <filter
            id={id("hover-distortion")}
            x="-32%"
            y="-32%"
            width="164%"
            height="164%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.018 0.026"
              numOctaves="2"
              seed="11"
              result="hover-noise"
            >
              <animate
                attributeName="baseFrequency"
                values="0.018 0.026;0.027 0.017;0.018 0.026"
                dur="2.8s"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap
              ref={displacementRef}
              in="SourceGraphic"
              in2="hover-noise"
              scale="0"
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
        </defs>

        <g ref={orbVisualRef} filter={`url(#${id("hover-distortion")})`}>
          <g opacity="0.72">
            <path
              d="M13 57 C8 35 18 14 39 8 C58 3 78 15 89 34"
              stroke={`url(#${id("cool-arc")})`}
              strokeWidth="1.25"
              strokeLinecap="round"
              filter={`url(#${id("sheet-blur")})`}
            >
              <PathMotion motion={pathMotion.coolArc} />
            </path>
            <path
              d="M7 63 C7 42 22 20 47 13 C67 8 87 22 93 43"
              stroke={`url(#${id("warm-arc")})`}
              strokeWidth="1.1"
              strokeLinecap="round"
              filter={`url(#${id("sheet-blur")})`}
            >
              <PathMotion motion={pathMotion.warmArc} />
            </path>
          </g>

          <g filter={`url(#${id("sheet-blur")})`}>
            <path
              d="M19 32 C29 9 57 5 77 18 C96 31 98 58 83 77 C67 97 37 97 18 79 C2 64 8 42 19 32 Z"
              fill={`url(#${id("magenta-shell")})`}
              opacity="0.82"
            >
              <PathMotion motion={pathMotion.magentaShell} />
            </path>
            <path
              d="M10 52 C11 29 33 15 57 18 C79 21 93 39 91 60 C76 55 64 44 52 31 C39 18 21 28 10 52 Z"
              fill={`url(#${id("pearl-shell")})`}
              opacity="0.9"
            >
              <PathMotion motion={pathMotion.pearlShell} />
            </path>
            <path
              d="M58 16 C79 18 95 34 95 56 C95 77 78 91 56 91 C70 75 75 58 71 43 C68 30 62 21 58 16 Z"
              fill={`url(#${id("orange-shell")})`}
              opacity="0.86"
            >
              <PathMotion motion={pathMotion.orangeShell} />
            </path>
            <path
              d="M13 62 C6 42 13 20 33 10 C26 30 30 53 47 70 C59 82 75 86 91 79 C76 98 44 103 22 86 C16 81 13 72 13 62 Z"
              fill={`url(#${id("blue-shell")})`}
              opacity="0.74"
            >
              <PathMotion motion={pathMotion.blueShell} />
            </path>
            <path
              d="M21 71 C37 91 68 94 88 66 C88 82 75 96 54 99 C31 102 13 89 8 69 C10 66 16 66 21 71 Z"
              fill={`url(#${id("cyan-shell")})`}
              opacity="0.82"
            >
              <PathMotion motion={pathMotion.cyanShell} />
            </path>
          </g>

          <path
            d="M46 16 C65 16 81 30 86 49 C91 69 75 88 53 90 C31 92 13 78 12 55 C11 34 25 16 46 16 Z"
            fill={`url(#${id("core")})`}
            filter={`url(#${id("core-shadow")})`}
          >
            <PathMotion motion={pathMotion.core} />
          </path>
          <path
            d="M46 16 C65 16 81 30 86 49 C91 69 75 88 53 90 C31 92 13 78 12 55 C11 34 25 16 46 16 Z"
            fill="none"
            stroke={`url(#${id("core-edge")})`}
            strokeWidth="1.1"
            strokeOpacity="0.56"
          >
            <PathMotion motion={pathMotion.coreEdge} />
          </path>

          <g opacity="0.82">
            <path
              d="M10 55 C17 76 42 91 67 82 C78 78 86 68 90 57"
              stroke={`url(#${id("rim")})`}
              strokeWidth="1.15"
              strokeLinecap="round"
              filter={`url(#${id("sheet-blur")})`}
            >
              <PathMotion motion={pathMotion.rim} />
            </path>
            <path
              d="M13 70 C32 91 66 94 87 69"
              stroke="#FFFFFF"
              strokeWidth="0.9"
              strokeLinecap="round"
              strokeOpacity="0.5"
              filter={`url(#${id("sheet-blur")})`}
            >
              <PathMotion motion={pathMotion.highlight} />
            </path>
          </g>
        </g>
      </svg>

      {hoverMessages.length > 0 ? (
        <span
          aria-hidden="true"
          data-slot="fizz-agent-greeting-anchor"
          className="pointer-events-none absolute right-0 bottom-[calc(100%+14px)] flex"
        >
          <span
            ref={bubbleRef}
            data-slot="fizz-agent-greeting"
            className="relative flex w-max max-w-[min(16rem,calc(100vw-2rem))] items-start gap-2.5 rounded-2xl bg-white px-4 py-3 text-left text-[13px] leading-[1.4] font-medium text-neutral-950 opacity-0 shadow-[0_14px_38px_rgba(0,0,0,0.32)]"
          >
            <IconMessageCircle className="mt-0.5 size-4 shrink-0 text-[#e62227]" stroke={2} />
            <span>{bubbleMessage}</span>
            <span
              data-slot="fizz-agent-greeting-tail"
              className="absolute -bottom-1 size-2.5 rotate-45 bg-white"
              style={{ right: size / 2 - 5 }}
            />
          </span>
        </span>
      ) : null}
    </button>
  );
}
