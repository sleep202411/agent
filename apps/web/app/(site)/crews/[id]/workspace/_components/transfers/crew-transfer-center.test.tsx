// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CrewTransfersProvider, useCrewTransfers } from "./crew-transfer-center";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uploadMock = vi.fn();
const attachMock = vi.fn();
const discardMock = vi.fn();
const routerPush = vi.fn();

vi.mock("@/src/i18n/i18n", async () => {
  const messages = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    Record<string, string | Record<string, string>>
  >;
  return {
    useTranslations:
      (namespace: string) => (key: string, vars?: Record<string, string | number>) => {
        const segments = key.split(".");
        let value: unknown = messages[namespace];
        for (const segment of segments) {
          value =
            value && typeof value === "object"
              ? (value as Record<string, unknown>)[segment]
              : undefined;
        }
        const copy = typeof value === "string" ? value : key;
        return Object.entries(vars ?? {}).reduce(
          (result, [name, replacement]) => result.replaceAll(`{${name}}`, String(replacement)),
          copy
        );
      },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/en-US/crews/crew-1/workspace",
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/src/lib/media-upload", () => ({
  uploadFileViaSignedUrl: (...args: unknown[]) => uploadMock(...args),
  isUploadAbort: (error: unknown) => error instanceof DOMException && error.name === "AbortError",
}));

vi.mock("@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets", () => ({
  useCrewAssetContext: () => ({
    data: {
      storageAvailable: true,
      maxUploadBytes: 5 * 1024 * 1024 * 1024,
      capabilities: { upload: true },
    },
  }),
  attachCrewAssetFile: (...args: unknown[]) => attachMock(...args),
  discardPendingCrewAssetUpload: (...args: unknown[]) => discardMock(...args),
}));

let root: Root | null = null;
let container: HTMLElement | null = null;
let idSequence = 0;

function Harness({ count }: { count: number }) {
  const { enqueueAssetFiles } = useCrewTransfers();
  return (
    <button
      type="button"
      onClick={() =>
        enqueueAssetFiles(
          Array.from(
            { length: count },
            (_, index) => new File([String(index)], `shot-${index + 1}.png`, { type: "image/png" })
          ),
          "folder-1"
        )
      }
    >
      Start
    </button>
  );
}

async function render(count: number) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <CrewTransfersProvider crewId="crew-1">
          <Harness count={count} />
        </CrewTransfersProvider>
      </QueryClientProvider>
    );
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  uploadMock.mockReset();
  attachMock.mockReset();
  discardMock.mockReset().mockResolvedValue(undefined);
  routerPush.mockReset();
  idSequence = 0;
  vi.stubGlobal("crypto", {
    randomUUID: () => `transfer-${++idSequence}`,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("CrewTransfersProvider", () => {
  it("runs at most three uploads concurrently and starts the next job after completion", async () => {
    const pending: Array<
      (value: { mediaAssetId: string; storageKey: string; url: string }) => void
    > = [];
    uploadMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(
            resolve as (value: { mediaAssetId: string; storageKey: string; url: string }) => void
          );
        })
    );
    attachMock.mockImplementation((_crewId: string, input: { mediaAssetId: string }) =>
      Promise.resolve({ id: `node-${input.mediaAssetId}` })
    );
    await render(4);

    await click(document.querySelector("button")!);

    expect(uploadMock).toHaveBeenCalledTimes(3);
    expect(document.body.textContent).toContain("Transferring 4 file(s)");

    await act(async () => {
      pending[0]?.({
        mediaAssetId: "media-1",
        storageKey: "key-1",
        url: "/asset-1",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(uploadMock).toHaveBeenCalledTimes(4);
  });

  it("does not start queued uploads after leaving the workspace", async () => {
    const signals: AbortSignal[] = [];
    uploadMock.mockImplementation((_file: File, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("Upload aborted", "AbortError"))
        );
      });
    });
    await render(4);
    await click(document.querySelector("button")!);
    expect(uploadMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      root!.unmount();
      root = null;
    });
    await flush();
    expect(signals.slice(0, 3).every((signal) => signal.aborted)).toBe(true);
    expect(uploadMock).toHaveBeenCalledTimes(3);
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("retries only the asset attach step after bytes were already confirmed", async () => {
    uploadMock.mockResolvedValue({
      mediaAssetId: "media-1",
      storageKey: "key-1",
      url: "/asset-1",
    });
    attachMock
      .mockRejectedValueOnce(new Error("Temporary attach failure"))
      .mockResolvedValueOnce({ id: "node-1" });
    await render(1);

    await click(document.querySelector("button")!);
    await flush();

    expect(document.body.textContent).toContain("Temporary attach failure");
    const retry = document.querySelector('button[aria-label="Retry transfer"]');
    if (!retry) throw new Error("Retry action not found");
    await click(retry);
    await flush();

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(attachMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Saved to crew assets");
  });
});
