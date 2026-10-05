// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import { GenerationEstimate } from "./generation-estimate";
import en from "../../../messages/en-US.json";
import cn from "../../../messages/zh-CN.json";
import hk from "../../../messages/zh-HK.json";

it.each([
  ["en-US", en],
  ["zh-CN", cn],
  ["zh-HK", hk],
] as const)(
  "%s keeps a total estimate stable past its duration and remount",
  async (locale, messages) => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    let root = createRoot(host);
    const view = (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <GenerationEstimate seconds={315} />
      </NextIntlClientProvider>
    );
    try {
      await act(async () => root.render(view));
      const initial = host.textContent;
      expect(initial).toContain("315");
      expect(initial).toContain(
        locale === "en-US" ? "not time remaining" : locale === "zh-CN" ? "非剩余时间" : "非剩餘時間"
      );
      await act(async () => vi.advanceTimersByTime(400_000));
      expect(host.textContent).toBe(initial);
      await act(async () => root.unmount());
      root = createRoot(host);
      await act(async () => root.render(view));
      expect(host.textContent).toBe(initial);
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  }
);
it.each([0, -1, NaN, Infinity, undefined])(
  "invalid estimate %s shows generating without zero countdown",
  async (seconds) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <NextIntlClientProvider locale="en-US" messages={en}>
            <GenerationEstimate seconds={seconds} />
          </NextIntlClientProvider>
        )
      );
      expect(host.textContent).toBe(en.canvasOps.statusGenerating);
    } finally {
      await act(async () => root.unmount());
    }
  }
);

it.each([
  ["en-US", en],
  ["zh-CN", cn],
  ["zh-HK", hk],
] as const)(
  "%s counts down across remounts and remains generating after the estimate",
  async (locale, messages) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
    const host = document.createElement("div");
    let root = createRoot(host);
    const view = (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <GenerationEstimate seconds={315} createdAt="2026-10-06T00:00:00Z" />
      </NextIntlClientProvider>
    );
    try {
      await act(async () => root.render(view));
      await act(async () => vi.advanceTimersByTime(1_000));
      expect(host.textContent).toContain("314");
      await act(async () => vi.advanceTimersByTime(60_000));
      expect(host.textContent).toContain("254");
      await act(async () => root.unmount());
      await act(async () => vi.advanceTimersByTime(20_000));
      root = createRoot(host);
      await act(async () => root.render(view));
      await act(async () => vi.advanceTimersByTime(0));
      expect(host.textContent).toContain("234");
      await act(async () => vi.advanceTimersByTime(300_000));
      expect(host.textContent).toBe(messages.canvasOps.statusGeneratingLonger);
    } finally {
      await act(async () => root.unmount());
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  }
);
