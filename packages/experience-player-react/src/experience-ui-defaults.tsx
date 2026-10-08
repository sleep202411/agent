"use client";
import { useId } from "react";
import { IconLock, IconPlayerPlay } from "@tabler/icons-react";
import { classNames } from "./class-names";
import { PRIMARY_BUTTON } from "./experience-player-styles";
import type { ExperienceStartUIProps, ExperienceChoicesUIProps } from "./experience-ui";

export function ExperienceDefaultStartUI({
  title,
  summary,
  eyebrow,
  state,
  actionLabel,
  onStart,
}: ExperienceStartUIProps) {
  return (
    <div data-ui-part="panel" className="max-w-lg">
      {eyebrow && (
        <p
          data-ui-part="eyebrow"
          className="text-[11px] font-semibold tracking-[0.18em] text-white/48 uppercase"
        >
          {eyebrow}
        </p>
      )}
      <h1
        data-ui-part="title"
        className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-white sm:text-3xl"
      >
        {title}
      </h1>
      {summary && (
        <p data-ui-part="summary" className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/58">
          {summary}
        </p>
      )}
      <button
        type="button"
        data-ui-part="primary"
        className={`${PRIMARY_BUTTON} mt-6`}
        disabled={state !== "ready"}
        onClick={onStart}
      >
        <IconPlayerPlay className="size-4 fill-current" />
        {actionLabel}
      </button>
    </div>
  );
}

export function ExperienceDefaultChoicesUI({
  prompt,
  choices,
  emptyLabel,
  disabled,
  onChoose,
}: ExperienceChoicesUIProps) {
  const promptId = useId();
  return (
    <div
      role="group"
      aria-labelledby={prompt ? promptId : undefined}
      data-experience-choice-overlay=""
      data-experience-ui-region="choices"
      className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-linear-to-t from-black/80 via-black/45 to-transparent px-[clamp(12px,3cqw,40px)] pt-[clamp(24px,10cqmin,96px)] pb-[max(clamp(10px,2.5cqmin,22px),var(--experience-choice-control-clearance,0px))]"
    >
      <div className="pointer-events-auto w-full max-w-[86cqw]">
        {prompt ? (
          <p
            id={promptId}
            data-ui-part="prompt"
            className="mb-[0.75em] text-center text-[length:clamp(12px,2cqmin,16px)] leading-[1.45] font-medium tracking-[0.04em] text-balance text-white/70"
          >
            {prompt}
          </p>
        ) : null}
        {choices.length > 0 ? (
          <div
            data-experience-choice-list=""
            data-ui-part="list"
            className="flex flex-row items-stretch justify-center gap-[clamp(8px,1.2cqw,16px)]"
          >
            {choices.map((choice, index) => {
              const price = choice.price;
              return (
                <button
                  key={choice.id}
                  data-experience-choice=""
                  data-ui-part="option"
                  type="button"
                  disabled={disabled}
                  onClick={() => onChoose(choice.id)}
                  className={classNames(
                    // Inner proportions are in `em` of the label, so the badge,
                    // the price and the corners scale with the clamped text.
                    "group flex min-h-[clamp(44px,7cqmin,56px)] min-w-0 max-w-[clamp(140px,40cqmin,420px)] flex-1 basis-0 items-center gap-[0.75em] rounded-[1.05em] border px-[clamp(10px,1.5cqw,20px)] py-[0.45em] text-left text-[length:clamp(13px,2.2cqmin,18px)] leading-[1.3] font-medium text-white",
                    "bg-white/10 shadow-[0_10px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl",
                    "transition-[background-color,border-color,transform] duration-200",
                    "hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none active:scale-[0.99]",
                    price ? undefined : "border-white/15 hover:border-white/30"
                  )}
                  style={
                    price
                      ? {
                          borderColor:
                            "color-mix(in srgb, var(--brand-yellow, #ffd84d) 45%, transparent)",
                        }
                      : undefined
                  }
                  aria-label={choice.accessibilityLabel}
                >
                  <span
                    data-experience-choice-index=""
                    data-ui-part="index"
                    className="grid size-[2.2em] shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-[0.73em] leading-none font-semibold text-white/60 tabular-nums group-hover:border-white/30 group-hover:text-white"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 wrap-anywhere">{choice.label}</span>
                  {price ? (
                    <span
                      data-ui-part="price"
                      className="flex max-w-[42%] shrink-0 items-center gap-[0.3em] text-[0.8em] leading-[1.3] font-medium tabular-nums"
                      style={{ color: "var(--brand-yellow, #ffd84d)" }}
                    >
                      <IconLock className="size-[1.15em] shrink-0" stroke={1.8} aria-hidden />
                      {price}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p
            role="alert"
            className="text-center text-[length:clamp(11px,2cqmin,16px)] text-white/52"
          >
            {emptyLabel}
          </p>
        )}
      </div>
    </div>
  );
}
