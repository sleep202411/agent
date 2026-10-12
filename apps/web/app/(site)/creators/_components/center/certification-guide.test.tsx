import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import en from "@/messages/en-US.json";
import { CertificationGuide } from "./certification-guide";
import { certificationEntry, certificationGroup } from "./certification-guide-data";
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => (en.certificationGuide as Record<string, string>)[key],
}));
it("explains all fifteen certifications from a keyboard-accessible help button", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CertificationGuide />));
    const help = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Explain certification levels"]'
    )!;
    expect(help).not.toBeNull();
    await act(async () => help.click());
    expect(document.querySelectorAll("dt")).toHaveLength(15);
    for (const group of [
      "A · Partner Verification",
      "B · AI Director Verification",
      "C · Skill Verification",
    ])
      expect(document.body.textContent).toContain(group);
    expect(document.body.textContent).toContain(en.certificationGuide.fd2Description);
    expect(document.body.textContent).toContain(en.certificationGuide.directorDescription);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it("groups Instructor as Partner and preserves unknown regional certifications", () => {
  expect(certificationGroup("Instructor")).toBe("partner");
  expect(certificationGroup("FD-III · Senior Creator")).toBe("director");
  expect(certificationEntry("FD-II · JuniorCreator")).toBe("fd2");
  expect(certificationEntry("Writer")).toBe("writer");
  expect(certificationEntry("剪輯師")).toBe("editor");
  expect(certificationGroup("Regional certificate")).toBe("other");
});
it("matches live Java user_level names", () => {
  expect(certificationGroup("分销商")).toBe("partner");
  expect(certificationEntry("OPC创始人")).toBe("opc");
  expect(certificationEntry("FD-III·高级创作者-AI短剧")).toBe("fd3");
  expect(certificationEntry("艺术总监")).toBe("art");
  expect(certificationEntry("音乐作曲")).toBe("music");
});
