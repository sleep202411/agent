import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WechatScanPay } from "./wechat-scan-pay";

const mocks = vi.hoisted(() => ({ get: vi.fn(), paid: vi.fn() }));
vi.mock("@/config", () => ({ appEnv: { appRegion: "cn" } }));
vi.mock("@/lib/api-client", () => ({ api: { get: mocks.get } }));
vi.mock("@tabler/icons-react-native", () => ({
  IconCircleCheck: () => null,
  IconRefresh: () => null,
  IconX: () => null,
}));
vi.mock("react-native-qrcode-svg", () => ({ default: () => <span>QR</span> }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Modal: Box,
    View: Box,
    Pressable: Box,
    StyleSheet: { create: (value: unknown) => value, absoluteFill: {}, hairlineWidth: 1 },
  };
});
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () =>
    root.render(
      <WechatScanPay
        orderId="order"
        codeUrl="weixin://pay"
        onClose={() => {}}
        onPaid={mocks.paid}
      />
    )
  );
const order = (status: string) => ({ order: { id: "order", orderNo: "number", status } });

it("waits for wallet fulfillment after payment and notifies once", async () => {
  mocks.get.mockResolvedValueOnce(order("paid")).mockResolvedValue(order("fulfilled"));
  await render();
  expect(mocks.paid).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(mocks.paid).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("paywall.wechat.success");
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(mocks.get).toHaveBeenCalledTimes(2);
});

it("does not overlap slow requests or notify after unmount", async () => {
  let resolve!: (value: ReturnType<typeof order>) => void;
  mocks.get.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(mocks.get).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => resolve(order("fulfilled")));
  expect(mocks.paid).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["canceled", "refunded"])("stops polling a %s backend order", async (status) => {
  mocks.get.mockResolvedValue(order(status));
  await render();
  expect(host.textContent).toContain("paywall.wechat.failed");
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(mocks.get).toHaveBeenCalledTimes(1);
  expect(mocks.paid).not.toHaveBeenCalled();
});

it("auto-completes a mock WeChat scan order without Nest polling", async () => {
  await act(async () =>
    root.render(
      <WechatScanPay
        orderId="mock-wechat-demo"
        codeUrl="weixin://wxpay/bizpayurl?pr=mock"
        amountLabel="¥0.99"
        onClose={() => {}}
        onPaid={mocks.paid}
      />
    )
  );
  expect(host.textContent).toContain("QR");
  expect(mocks.paid).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(2800));
  expect(mocks.paid).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("paywall.wechat.success");
  expect(mocks.get).not.toHaveBeenCalled();
});

vi.mock("@tabler/icons-react-native/IconCircleCheck", () => ({ default: () => null }));
vi.mock("@tabler/icons-react-native/IconRefresh", () => ({ default: () => null }));
vi.mock("@tabler/icons-react-native/IconX", () => ({ default: () => null }));
