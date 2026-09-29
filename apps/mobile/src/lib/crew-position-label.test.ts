import { describe, expect, it } from "vitest";
import { PRESET_POSITIONS } from "@repo/shared/crew";
import { crewPositionLabel } from "./crew-position-label";
import type { MessageKey } from "@/i18n";
import en from "@/i18n/messages/en-US.json";
import cn from "@/i18n/messages/zh-CN.json";
import hk from "@/i18n/messages/zh-HK.json";

const translate = (catalog: Record<MessageKey, string>) => (key: MessageKey) => catalog[key];
describe("Mobile recruitment role labels", () => {
  it("uses the canonical role name rather than title-casing its code", () => {
    expect(crewPositionLabel("storyboard", translate(en))).toBe("Storyboard Artist");
    expect(crewPositionLabel("marketing", translate(en))).toBe("Marketing Lead");
  });
  it("renders the same retained role in both Chinese locales without fetching again", () => {
    expect(crewPositionLabel("director", translate(cn))).toBe("导演");
    expect(crewPositionLabel("director", translate(hk))).toBe("導演");
  });
  it.each(["VFX / AI lead", "制片助理", "art_director", ""])(
    'keeps custom title "%s" intact',
    (title) => {
      expect(crewPositionLabel(title, translate(cn))).toBe(title);
    }
  );
  it.each([en, cn, hk])("has a nonempty translation for every shared preset", (catalog) => {
    for (const role of PRESET_POSITIONS) {
      const label = crewPositionLabel(role.value, translate(catalog));
      expect(label).toBeTruthy();
      expect(label).not.toContain("crewRoles.");
    }
  });
});
