"use client";

/* eslint-disable @next/next/no-img-element -- This carousel intentionally mirrors the GSAP CodePen structure. */

import { useLayoutEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import gsap from "gsap";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { HERO_SLIDES } from "../_data/preview-data";

if (typeof window !== "undefined") {
  gsap.registerPlugin(Draggable, InertiaPlugin);
}

type HorizontalLoopTimeline = gsap.core.Timeline & {
  next: (vars?: gsap.TweenVars) => gsap.core.Tween;
  previous: (vars?: gsap.TweenVars) => gsap.core.Tween;
  toIndex: (index: number, vars?: gsap.TweenVars) => gsap.core.Tween;
  current: () => number;
  closestIndex: (setCurrent?: boolean) => number;
  times: number[];
  draggable?: Draggable;
};

type HorizontalLoopConfig = {
  center?: boolean | Element | string;
  draggable?: boolean;
  onChange?: (slide: HTMLElement, index: number) => void;
  onUpdate?: () => void;
  paddingRight?: number;
  paused?: boolean;
  repeat?: number;
  reversed?: boolean;
  snap?: number | false;
  speed?: number;
};

const INITIAL_SLIDE_INDEX = Math.min(1, HERO_SLIDES.length - 1);
const SLIDE_LOOP_GAP = 18;

export function FizzStudioHeroCarousel() {
  const t = useTranslations("fizzStudio");
  const rootRef = useRef<HTMLElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const prevRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const counterRef = useRef<HTMLDivElement | null>(null);
  const loopRef = useRef<HorizontalLoopTimeline | null>(null);
  const [activeIndex, setActiveIndex] = useState(INITIAL_SLIDE_INDEX);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const carousel = carouselRef.current;
    const prev = prevRef.current;
    const next = nextRef.current;
    const counter = counterRef.current;
    if (!root || !carousel || !prev || !next || !counter) return;

    const ctx = gsap.context(() => {
      const slides = gsap.utils.toArray<HTMLElement>(".carousel-slide", carousel);
      let activeSlide: HTMLElement | undefined;
      let firstRun = true;

      gsap.set(carousel, { overflow: "visible", scrollSnapType: "none" });
      gsap.set(root.querySelector(".carousel-nav"), { display: "block" });
      gsap.set(slides, { opacity: (index) => (index === INITIAL_SLIDE_INDEX ? 1 : 0.3) });
      gsap.set(
        slides.map((slide) => slide.querySelector("h2")),
        {
          opacity: (index) => (index === INITIAL_SLIDE_INDEX ? 1 : 0),
        }
      );
      gsap.set(
        slides.map((slide) => slide.querySelector("h5")),
        {
          opacity: (index) => (index === INITIAL_SLIDE_INDEX ? 1 : 0),
        }
      );

      const slideImgUpdate = () => {
        slides.forEach((slide) => {
          const rect = slide.getBoundingClientRect();
          const progress = gsap.utils.mapRange(-rect.width, window.innerWidth, 0, 1, rect.x);
          const value = gsap.utils.clamp(0, 1, progress);
          gsap.set(slide.querySelector("[data-carousel-image]"), {
            xPercent: gsap.utils.interpolate(0, -50, value),
          });
        });
      };

      const loop = horizontalLoop(slides, {
        paused: true,
        paddingRight: SLIDE_LOOP_GAP,
        center: true,
        draggable: true,
        onChange: (slide, index) => {
          if (activeSlide) {
            gsap.to(carousel.querySelectorAll("h2, h5"), {
              overwrite: true,
              opacity: 0,
              ease: "power3",
            });
            gsap.to(activeSlide, { opacity: 0.3 });
            activeSlide.classList.remove("active");
          }

          slide.classList.add("active");
          activeSlide = slide;
          setActiveIndex(index);

          gsap
            .timeline({ defaults: { ease: "power1.inOut" } })
            .to(slide, { opacity: 1, ease: "power2.inOut" }, 0)
            .to(counter, { duration: 0.2, opacity: 0, ease: "power1.in" }, 0)
            .set(counter, { innerText: `${index + 1}/${slides.length}` }, 0.2)
            .to(counter, { duration: 0.4, opacity: 0.5, ease: "power1.inOut" }, 0.2)
            .to(slide.querySelectorAll("h2, h5"), { opacity: 1, ease: "power1.inOut" }, 0.3)
            .fromTo(
              slide.querySelectorAll("h2, h5"),
              { y: (itemIndex) => [40, 60][itemIndex] },
              { duration: 1.5, y: 0, ease: "expo" },
              0.3
            )
            .progress(firstRun ? 1 : 0);
        },
        onUpdate: slideImgUpdate,
      });

      loopRef.current = loop;
      loop.toIndex(INITIAL_SLIDE_INDEX, { duration: 0 });
      firstRun = false;

      const arrowBtnOver = (event: PointerEvent) => {
        gsap.to(event.currentTarget, { opacity: 0.42 });
      };
      const arrowBtnOut = (event: PointerEvent) => {
        gsap.to(event.currentTarget, { opacity: 1 });
      };
      const handleNext = () => loop.next({ duration: 1, ease: "expo" });
      const handlePrev = () => loop.previous({ duration: 1, ease: "expo" });

      next.addEventListener("pointerover", arrowBtnOver);
      next.addEventListener("pointerout", arrowBtnOut);
      next.addEventListener("click", handleNext);
      prev.addEventListener("pointerover", arrowBtnOver);
      prev.addEventListener("pointerout", arrowBtnOut);
      prev.addEventListener("click", handlePrev);

      slides.forEach((slide, index) => {
        slide.addEventListener("click", () => loop.toIndex(index, { duration: 1, ease: "expo" }));
      });

      return () => {
        next.removeEventListener("pointerover", arrowBtnOver);
        next.removeEventListener("pointerout", arrowBtnOut);
        next.removeEventListener("click", handleNext);
        prev.removeEventListener("pointerover", arrowBtnOver);
        prev.removeEventListener("pointerout", arrowBtnOut);
        prev.removeEventListener("click", handlePrev);
        loop.draggable?.kill();
        loop.kill();
        loopRef.current = null;
      };
    }, root);

    return () => ctx.revert();
  }, []);

  const handleDotClick = (index: number) => {
    loopRef.current?.toIndex(index, { duration: 1, ease: "expo" });
  };

  return (
    <section
      ref={rootRef}
      aria-labelledby="fizzstudio-events"
      className="relative isolate overflow-hidden"
    >
      <h1 id="fizzstudio-events" className="sr-only">
        {t("hero.accessibleTitle")}
      </h1>

      <div className="mx-auto max-w-[calc((clamp(320px,26vw,430px)*3)+(18px*2))] overflow-hidden 2xl:max-w-[calc((430px*5)+(18px*4))]">
        <div
          ref={carouselRef}
          className="carousel flex w-full snap-x snap-mandatory gap-[18px] overflow-x-auto py-2"
          aria-label={t("hero.accessibleTitle")}
        >
          {HERO_SLIDES.map((slide, index) => (
            <article
              key={slide.key}
              className={cn(
                "carousel-slide relative aspect-video w-[clamp(320px,26vw,430px)] shrink-0 snap-center cursor-pointer touch-pan-y overflow-hidden rounded-[20px] border border-white/10 text-white shadow-xl shadow-black/40",
                index === INITIAL_SLIDE_INDEX ? "opacity-100" : "opacity-30"
              )}
              aria-current={index === activeIndex ? "true" : undefined}
            >
              <img
                data-carousel-image
                src={slide.imageUrl}
                alt=""
                draggable={false}
                className="absolute left-0 h-full w-[150%] max-w-none object-cover"
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_18%,rgba(255,255,255,0.24),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.76))]" />
              <div className="relative flex h-full flex-col justify-end p-4">
                <span className="w-fit rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white/76">
                  {t(`hero.slides.${slide.key}.eyebrow`)}
                </span>
                <span className={cn("mt-3 h-1.5 w-10 rounded-full", slide.accent)} />
                <h2
                  className={cn(
                    "m-0 mt-3 line-clamp-2 text-lg font-semibold leading-tight",
                    index === INITIAL_SLIDE_INDEX ? "opacity-100" : "opacity-0"
                  )}
                >
                  {t(`hero.slides.${slide.key}.title`)}
                </h2>
                <h5
                  className={cn(
                    "m-0 mt-2 line-clamp-2 text-xs font-normal leading-5 tracking-[0.2px] text-white/68",
                    index === INITIAL_SLIDE_INDEX ? "opacity-100" : "opacity-0"
                  )}
                >
                  {t(`hero.slides.${slide.key}.body`)}
                </h5>
              </div>
            </article>
          ))}
        </div>
      </div>

      <nav className="carousel-nav hidden" aria-label={t("hero.accessibleTitle")}>
        <button
          ref={prevRef}
          type="button"
          aria-label={t("hero.previous")}
          className="prev absolute left-3 top-[108px] z-30 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-black/35 text-white/86 shadow-[0_16px_38px_rgba(0,0,0,0.36)] backdrop-blur-xl transition-colors hover:border-white/24 hover:bg-white/14 hover:text-white active:scale-95 md:flex"
        >
          <IconChevronLeft className="size-5" />
        </button>
        <button
          ref={nextRef}
          type="button"
          aria-label={t("hero.next")}
          className="next absolute right-3 top-[108px] z-30 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-black/35 text-white/86 shadow-[0_16px_38px_rgba(0,0,0,0.36)] backdrop-blur-xl transition-colors hover:border-white/24 hover:bg-white/14 hover:text-white active:scale-95 md:flex"
        >
          <IconChevronRight className="size-5" />
        </button>
        <div
          ref={counterRef}
          className="absolute left-0 top-[182px] hidden w-full text-center text-sm font-light tracking-[0.18rem] text-white/45 md:block"
        >
          {INITIAL_SLIDE_INDEX + 1}/{HERO_SLIDES.length}
        </div>
      </nav>

      <div className="mt-3 flex justify-center gap-2">
        {HERO_SLIDES.map((slide, index) => (
          <button
            key={slide.key}
            type="button"
            aria-label={t(`hero.slides.${slide.key}.title`)}
            onClick={() => handleDotClick(index)}
            className={cn(
              "h-1.5 rounded-full bg-white/24 transition-all",
              activeIndex === index ? "w-8 bg-white/70" : "w-4"
            )}
          />
        ))}
      </div>
    </section>
  );
}

function horizontalLoop(items: HTMLElement[], config: HorizontalLoopConfig = {}) {
  let timeline: HorizontalLoopTimeline | undefined;

  gsap.context(() => {
    const onChange = config.onChange;
    let lastIndex = 0;
    const tl = gsap.timeline({
      repeat: config.repeat,
      onUpdate:
        onChange &&
        function () {
          config.onUpdate?.();
          const index = tl.closestIndex();
          if (lastIndex !== index) {
            lastIndex = index;
            onChange(items[index], index);
          }
        },
      paused: config.paused,
      defaults: { ease: "none" },
      onReverseComplete: () => tl.totalTime(tl.rawTime() + tl.duration() * 100),
    }) as HorizontalLoopTimeline;
    const length = items.length;
    const startX = items[0].offsetLeft;
    const times: number[] = [];
    const widths: number[] = [];
    const spaceBefore: number[] = [];
    const xPercents: number[] = [];
    let curIndex = 0;
    let indexIsDirty = false;
    const center = config.center;
    const pixelsPerSecond = (config.speed || 1) * 100;
    const snap =
      config.snap === false ? (value: number) => value : gsap.utils.snap(config.snap || 1);
    let timeOffset = 0;
    const container =
      center === true || center == null || center === false
        ? (items[0].parentNode as HTMLElement)
        : (gsap.utils.toArray(center)[0] as HTMLElement) || (items[0].parentNode as HTMLElement);
    let totalWidth = 0;
    let timeWrap: (value: number) => number;
    let proxy: HTMLDivElement | undefined;

    const getTotalWidth = () =>
      items[length - 1].offsetLeft +
      (xPercents[length - 1] / 100) * widths[length - 1] -
      startX +
      spaceBefore[0] +
      items[length - 1].offsetWidth * Number(gsap.getProperty(items[length - 1], "scaleX")) +
      (Number(config.paddingRight) || 0);

    const populateWidths = () => {
      let b1 = container.getBoundingClientRect();
      items.forEach((element, index) => {
        widths[index] = parseFloat(String(gsap.getProperty(element, "width", "px")));
        xPercents[index] = snap(
          (parseFloat(String(gsap.getProperty(element, "x", "px"))) / widths[index]) * 100 +
            Number(gsap.getProperty(element, "xPercent"))
        );
        const b2 = element.getBoundingClientRect();
        spaceBefore[index] = b2.left - (index ? b1.right : b1.left);
        b1 = b2;
      });
      gsap.set(items, { xPercent: (index) => xPercents[index] });
      totalWidth = getTotalWidth();
    };

    const populateOffsets = () => {
      timeOffset = center ? (tl.duration() * (container.offsetWidth / 2)) / totalWidth : 0;
      if (center) {
        times.forEach((time, index) => {
          times[index] = timeWrap(
            tl.labels[`label${index}`] +
              (tl.duration() * widths[index]) / 2 / totalWidth -
              timeOffset
          );
        });
      }
    };

    const getClosest = (values: number[], value: number, wrap: number) => {
      let closest = 1e10;
      let index = 0;
      for (let i = values.length; i--; ) {
        let distance = Math.abs(values[i] - value);
        if (distance > wrap / 2) distance = wrap - distance;
        if (distance < closest) {
          closest = distance;
          index = i;
        }
      }
      return index;
    };

    const populateTimeline = () => {
      tl.clear();
      for (let i = 0; i < length; i += 1) {
        const item = items[i];
        const curX = (xPercents[i] / 100) * widths[i];
        const distanceToStart = item.offsetLeft + curX - startX + spaceBefore[0];
        const distanceToLoop =
          distanceToStart + widths[i] * Number(gsap.getProperty(item, "scaleX"));
        tl.to(
          item,
          {
            xPercent: snap(((curX - distanceToLoop) / widths[i]) * 100),
            duration: distanceToLoop / pixelsPerSecond,
          },
          0
        )
          .fromTo(
            item,
            { xPercent: snap(((curX - distanceToLoop + totalWidth) / widths[i]) * 100) },
            {
              xPercent: xPercents[i],
              duration: (curX - distanceToLoop + totalWidth - curX) / pixelsPerSecond,
              immediateRender: false,
            },
            distanceToLoop / pixelsPerSecond
          )
          .add(`label${i}`, distanceToStart / pixelsPerSecond);
        times[i] = distanceToStart / pixelsPerSecond;
      }
      timeWrap = gsap.utils.wrap(0, tl.duration());
    };

    const refresh = (deep?: boolean) => {
      const progress = tl.progress();
      tl.progress(0, true);
      populateWidths();
      if (deep) populateTimeline();
      populateOffsets();
      if (deep && tl.draggable && tl.paused()) {
        tl.time(times[curIndex], true);
      } else {
        tl.progress(progress, true);
      }
    };

    const onResize = () => refresh(true);
    gsap.set(items, { x: 0 });
    populateWidths();
    populateTimeline();
    populateOffsets();
    window.addEventListener("resize", onResize);

    const toIndex = (index: number, vars: gsap.TweenVars = {}) => {
      let nextIndex = index;
      if (Math.abs(nextIndex - curIndex) > length / 2) {
        nextIndex += nextIndex > curIndex ? -length : length;
      }
      const newIndex = gsap.utils.wrap(0, length, nextIndex);
      let time = times[newIndex];
      if (time > tl.time() !== nextIndex > curIndex && nextIndex !== curIndex) {
        time += tl.duration() * (nextIndex > curIndex ? 1 : -1);
      }
      if (time < 0 || time > tl.duration()) {
        vars.modifiers = { time: timeWrap };
      }
      curIndex = newIndex;
      vars.overwrite = true;
      if (proxy) gsap.killTweensOf(proxy);
      return vars.duration === 0
        ? gsap.to(tl, { duration: 0, time: timeWrap(time) })
        : tl.tweenTo(time, vars);
    };

    tl.toIndex = (index, vars) => toIndex(index, vars);
    tl.closestIndex = (setCurrent) => {
      const index = getClosest(times, tl.time(), tl.duration());
      if (setCurrent) {
        curIndex = index;
        indexIsDirty = false;
      }
      return index;
    };
    tl.current = () => (indexIsDirty ? tl.closestIndex(true) : curIndex);
    tl.next = (vars) => toIndex(tl.current() + 1, vars);
    tl.previous = (vars) => toIndex(tl.current() - 1, vars);
    tl.times = times;
    tl.progress(1, true).progress(0, true);

    if (config.reversed) {
      tl.vars.onReverseComplete?.();
      tl.reverse();
    }

    if (config.draggable && typeof Draggable === "function") {
      proxy = document.createElement("div");
      const proxyElement = proxy;
      const wrap = gsap.utils.wrap(0, 1);
      let ratio = 1;
      let startProgress = 0;
      let dragSnap = 0;
      let lastSnap = 0;
      let initChangeX = 0;
      let wasPlaying = false;
      const syncIndex = () => tl.closestIndex(true);
      function align() {
        tl.progress(wrap(startProgress + (draggable.startX - draggable.x) * ratio));
      }

      const draggable = Draggable.create(proxyElement, {
        trigger: items[0].parentNode as HTMLElement,
        type: "x",
        onPressInit() {
          const x = this.x;
          gsap.killTweensOf(tl);
          wasPlaying = !tl.paused();
          tl.pause();
          startProgress = tl.progress();
          refresh();
          ratio = 1 / totalWidth;
          initChangeX = startProgress / -ratio - x;
          gsap.set(proxyElement, { x: startProgress / -ratio });
        },
        onDrag: align,
        onThrowUpdate: align,
        overshootTolerance: 0,
        inertia: true,
        snap(value) {
          if (Math.abs(startProgress / -ratio - this.x) < 10) {
            return lastSnap + initChangeX;
          }
          const time = -(value * ratio) * tl.duration();
          const wrappedTime = timeWrap(time);
          const snapTime = times[getClosest(times, wrappedTime, tl.duration())];
          let diff = snapTime - wrappedTime;
          if (Math.abs(diff) > tl.duration() / 2) diff += diff < 0 ? tl.duration() : -tl.duration();
          lastSnap = (time + diff) / tl.duration() / -ratio;
          dragSnap = lastSnap;
          return dragSnap;
        },
        onRelease() {
          syncIndex();
          if (draggable.isThrowing) indexIsDirty = true;
        },
        onThrowComplete() {
          syncIndex();
          if (wasPlaying) tl.play();
        },
      })[0];
      tl.draggable = draggable;
    }

    tl.closestIndex(true);
    lastIndex = curIndex;
    onChange?.(items[curIndex], curIndex);
    timeline = tl;

    return () => window.removeEventListener("resize", onResize);
  });

  return timeline!;
}
