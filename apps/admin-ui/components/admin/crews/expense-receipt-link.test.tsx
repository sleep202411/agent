// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { ExpenseReceiptLink } from "./expense-receipt-link";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it.each(["", "/ops"])(
  "retries a receipt under base %s and aborts on session reset",
  async (base) => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_UI_BASE_PATH", base);
    const rootNode = document.createElement("div"),
      root = createRoot(rootNode);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Receipt unavailable" }), { status: 503 })
      );
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", fetcher);
    try {
      await act(async () =>
        root.render(<ExpenseReceiptLink draftId="claim" id="receipt" version={2} index={1} />)
      );
      await act(async () => rootNode.querySelector("button")!.click());
      expect(rootNode.textContent).toContain("Receipt unavailable");
      fetcher.mockImplementation(async (_url: string, options: RequestInit) => {
        signal = options.signal ?? undefined;
        return new Promise(() => {});
      });
      await act(async () => rootNode.querySelector("button")!.click());
      expect(fetcher).toHaveBeenLastCalledWith(
        `${base}/api/admin/crew-expense-submissions/claim/receipts/receipt/read?version=2`,
        expect.objectContaining({ cache: "no-store" })
      );
      act(() => root.unmount());
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  }
);
