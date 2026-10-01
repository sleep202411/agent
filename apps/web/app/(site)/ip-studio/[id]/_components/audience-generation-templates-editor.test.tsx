import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreateUploadUrlSchema, ConfirmUploadSchema } from "../../../../../../server/src/media/dto";
import { AudienceGenerationTemplatesEditor } from "./audience-generation-templates-editor";

const s = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/src/lib/api", () => ({ api: { get: s.get, put: s.put } }));
vi.mock("sonner", () => ({ toast: { success: s.success, error: s.error } }));
vi.mock("@/src/i18n/i18n", () => {
  const translate = (key: string) => key;
  return { useTranslations: () => translate };
});
vi.mock("@/app/(fizzstudio)/_hooks/use-ai-catalog", () => ({
  useAiCatalog: () => ({
    data: { models: { image: { id: "image", type: "image", name: "Image" } } },
  }),
}));

class UploadRequest {
  status = 200;
  statusText = "OK";
  upload = {};
  onload?: () => void;
  open() {}
  setRequestHeader() {}
  send() {
    this.onload?.();
  }
}
let root: Root, host: HTMLDivElement;
const asset = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const template = {
  id: "template",
  name: "Poster",
  modelId: "image",
  description: "Keep this draft",
  promptPrefix: "",
  promptSuffix: "",
  requireReferenceImage: false,
  referenceImageHint: "",
  outputAspectRatio: "1:1",
  logoAssetId: null,
  enabled: true,
  order: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
  s.get.mockResolvedValue({ templates: [template], version: 3 });
  s.put.mockImplementation((_url, options) =>
    Promise.resolve({ templates: options.data.templates, version: 4 })
  );
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it.each([null, "signing", "confirming"])(
  "uploads and saves only a confirmed logo (failure=%s)",
  async (failure) => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      const signing = url.endsWith("upload-url");
      // Use the real Server schemas at the HTTP boundary, not a permissive upload mock.
      (signing ? CreateUploadUrlSchema : ConfirmUploadSchema).parse(payload);
      expect(payload.kind).toBe("ip_banner");
      if (failure === (signing ? "signing" : "confirming")) {
        return Response.json({ message: "Storage denied this image" }, { status: 400 });
      }
      return Response.json(
        signing
          ? {
              uploadUrl: "https://storage.test.invalid/logo",
              method: "PUT",
              headers: {},
              storageKey: "media/ip-banner/logo.png",
              provider: "s3_compatible",
              expiresAt: "2099-01-01",
            }
          : {
              mediaAssetId: asset,
              storageKey: "media/ip-banner/logo.png",
              url: "https://storage.test.invalid/logo",
            }
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<AudienceGenerationTemplatesEditor ipId="ip" />));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [new File(["png"], "logo.png", { type: "image/png" })],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(fetcher).toHaveBeenCalledTimes(failure === "signing" ? 1 : 2);
    if (failure) expect(s.error).toHaveBeenCalledWith("Storage denied this image");
    else expect(s.success).toHaveBeenCalledWith("logoUploaded");
    const save = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "saveChanges"
    )!;
    await act(async () => save.click());
    expect(s.put).toHaveBeenCalledWith("/aurora/ip-commerce/me/ips/ip/generation-templates", {
      data: {
        expectedVersion: 3,
        templates: [{ ...template, logoAssetId: failure ? null : asset }],
      },
    });
  }
);
