import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { useLocale, useTranslations } from "./index";
vi.mock("expo-localization", () => ({ getLocales: () => [{ languageTag: "zh-CN" }] }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: vi.fn() }));
vi.mock("@/lib/persistent-storage", () => ({ getStoredString: vi.fn(), setStoredString: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("hydrates static English markup before applying the device language", async () => {
  function Screen() {
    const t = useTranslations();
    return <p lang={useLocale()}>{t("aiLab.heading")}</p>;
  }
  const host = document.createElement("div");
  host.innerHTML = renderToString(<Screen />);
  expect(host.textContent).toBe("AI generation");
  expect(host.querySelector("p")?.lang).toBe("en-US");
  document.body.append(host);
  const onRecoverableError = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(host, <Screen />, { onRecoverableError });
    });
    expect(host.textContent).toBe("AI 生成");
    expect(host.querySelector("p")?.lang).toBe("zh-CN");
    expect(onRecoverableError).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
    host.remove();
  }
});
