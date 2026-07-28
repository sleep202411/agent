// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioAgentComposer, type StudioAgentComposerProps } from "./studio-agent-composer";
import type {
  StudioAgentCanonicalAttachment,
  StudioAgentComposerAttachment,
} from "./use-studio-agent-composer-attachments";

describe("StudioAgentComposer attachments", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("allows an attachment-only message once every attachment is canonical and ready", async () => {
    const onSubmit = vi.fn<StudioAgentComposerProps["onSubmit"]>();
    await render(onSubmit, [readyItem]);

    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);

    await act(async () => submit?.click());
    expect(onSubmit).toHaveBeenCalledWith("", "send", [canonicalAttachment]);
  });

  it("blocks submission while an upload is pending or failed", async () => {
    const onSubmit = vi.fn<StudioAgentComposerProps["onSubmit"]>();
    await render(onSubmit, [{ ...readyItem, status: "uploading", attachment: null }]);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true
    );

    await render(onSubmit, [
      {
        ...readyItem,
        status: "failed",
        error: "Network unavailable",
        retryable: true,
        attachment: null,
      },
    ]);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true
    );
    expect(container.textContent).toContain("Network unavailable");
  });

  it("accepts only one submission while the current attachment message is in flight", async () => {
    let resolveSubmission!: () => void;
    const onSubmit = vi.fn<StudioAgentComposerProps["onSubmit"]>(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmission = resolve;
        })
    );
    await render(onSubmit, [readyItem]);

    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    await act(async () => {
      submit?.click();
      submit?.click();
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledOnce();

    await act(async () => {
      resolveSubmission();
      await Promise.resolve();
    });
  });

  it("suppresses the browser file-drop default while the composer is disabled", async () => {
    const onAddFiles = vi.fn();
    await act(async () => {
      root.render(
        <StudioAgentComposer
          value=""
          labels={labels}
          deliveryMode="send"
          disabled
          attachments={{
            items: [],
            accept: "image/jpeg,image/png,image/webp",
            onAddFiles,
            onRetry: vi.fn(),
            onRemove: vi.fn(),
          }}
          onDeliveryModeChange={vi.fn()}
          onValueChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      );
    });
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: {
        types: ["Files"],
        files: [new File(["image"], "reference.webp", { type: "image/webp" })],
        dropEffect: "none",
      },
    });

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(dropEvent);
    });

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(onAddFiles).not.toHaveBeenCalled();
  });

  async function render(
    onSubmit: StudioAgentComposerProps["onSubmit"],
    items: readonly StudioAgentComposerAttachment[]
  ) {
    await act(async () => {
      root.render(
        <StudioAgentComposer
          value=""
          labels={labels}
          deliveryMode="send"
          attachments={{
            items,
            accept: "image/jpeg,image/png,image/webp",
            onAddFiles: vi.fn(),
            onRetry: vi.fn(),
            onRemove: vi.fn(),
          }}
          onDeliveryModeChange={vi.fn()}
          onValueChange={vi.fn()}
          onSubmit={onSubmit}
        />
      );
    });
  }
});

describe("StudioAgentComposer stop button", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("says it is stopping, and refuses a second press, once the cancel is out", async () => {
    const onStop = vi.fn();
    await render({ isRunning: true, isCancelling: false, onStop });

    const stop = stopButton();
    expect(stop?.getAttribute("aria-label")).toBe("Stop");
    expect(stop?.disabled).toBe(false);

    // The cancel is already on the channel. The button stays — it is the only
    // place the panel can say the stop landed — but it stops being pressable.
    await render({ isRunning: true, isCancelling: true, onStop });
    const stopping = stopButton();
    expect(stopping).not.toBeNull();
    expect(stopping?.getAttribute("aria-label")).toBe("Stopping");
    expect(stopping?.disabled).toBe(true);

    await act(async () => stopping?.click());
    expect(onStop).not.toHaveBeenCalled();
  });

  function stopButton() {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      ["Stop", "Stopping"].includes(button.getAttribute("aria-label") ?? "")
    );
  }

  async function render(props: { isRunning: boolean; isCancelling: boolean; onStop: () => void }) {
    await act(async () => {
      root.render(
        <StudioAgentComposer
          value=""
          labels={labels}
          deliveryMode="steer"
          isRunning={props.isRunning}
          isCancelling={props.isCancelling}
          onStop={props.onStop}
          onDeliveryModeChange={vi.fn()}
          onValueChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      );
    });
  }
});

const canonicalAttachment: StudioAgentCanonicalAttachment = {
  type: "attachment",
  attachmentId: "00000000-0000-4000-8000-000000000071",
  fileName: "reference.webp",
  mediaType: "image/webp",
  sizeBytes: 4_096,
  status: "ready",
};

const readyItem: StudioAgentComposerAttachment = {
  id: "local-1",
  fileName: canonicalAttachment.fileName,
  mediaType: canonicalAttachment.mediaType,
  sizeBytes: canonicalAttachment.sizeBytes ?? 0,
  progress: 100,
  status: "ready",
  error: null,
  retryable: false,
  attachment: canonicalAttachment,
};

const labels = {
  input: "Message",
  placeholder: "Describe the change",
  stop: "Stop",
  stopping: "Stopping",
  queued: (count: number) => `${count} queued`,
  deliveryModeMenu: "Delivery mode",
  deliveryMode: {
    send: { label: "Send" },
    steer: { label: "Steer" },
    enqueue: { label: "Queue" },
    stop_and_send: { label: "Stop and send" },
  },
  attachments: {
    add: "Attach images",
    drop: "Drop images here",
    remove: (fileName: string) => `Remove ${fileName}`,
    retry: (fileName: string) => `Retry ${fileName}`,
    uploading: (progress: number) => `Uploading ${progress}%`,
    processing: "Processing",
    ready: "Ready",
    failed: "Failed",
    fileSize: (bytes: number) => `${bytes} B`,
  },
};
