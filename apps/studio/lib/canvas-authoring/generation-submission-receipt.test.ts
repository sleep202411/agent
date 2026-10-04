// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  clearGenerationReceipt,
  generationReceiptKey,
  readGenerationReceipt,
  saveGenerationReceipt,
  type GenerationSubmissionReceipt,
} from "./generation-submission-receipt";
const receipt: GenerationSubmissionReceipt = {
  version: 1,
  prompt: "A panorama",
  createdAt: "2026-10-03",
  request: {
    context: { documentBlockId: "block", sourceSurface: "images" },
    idempotencyKey: "original",
    modelId: "chosen",
    schemaVersion: "1",
    input: { prompt: "A panorama", quality: "high" },
  },
};
const key = generationReceiptKey("owner", "workspace", "images");
beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("retains the exact reviewed request across component/page sessions", () => {
  saveGenerationReceipt(key, receipt);
  expect(readGenerationReceipt(key)).toEqual(receipt);
  expect(readGenerationReceipt(generationReceiptKey("other", "workspace", "images"))).toBeNull();
  expect(readGenerationReceipt(generationReceiptKey("owner", "other", "images"))).toBeNull();
  expect(readGenerationReceipt(generationReceiptKey("owner", "workspace", "video"))).toBeNull();
});
it("does not replace an unresolved command with a new model/key", () => {
  saveGenerationReceipt(key, receipt);
  expect(() =>
    saveGenerationReceipt(key, {
      ...receipt,
      request: { ...receipt.request, idempotencyKey: "new", modelId: "different" },
    })
  ).toThrow("Resolve the previous");
  expect(readGenerationReceipt(key)).toEqual(receipt);
});
it("does not let a late response erase a newer receipt", () => {
  saveGenerationReceipt(key, receipt);
  clearGenerationReceipt(key, "old");
  expect(readGenerationReceipt(key)).toEqual(receipt);
  clearGenerationReceipt(key, "original");
  expect(readGenerationReceipt(key)).toBeNull();
});
it("fails closed for corrupt receipts or unavailable persistence", () => {
  sessionStorage.setItem(key, "{}");
  expect(() => readGenerationReceipt(key)).toThrow("saved generation receipt");
  sessionStorage.removeItem(key);
  vi.spyOn(Object.getPrototypeOf(window.sessionStorage), "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  expect(() => saveGenerationReceipt(key, receipt)).toThrow("Storage unavailable");
});
