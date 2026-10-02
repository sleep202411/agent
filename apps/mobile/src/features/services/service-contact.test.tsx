import { ServiceEditorDrafts } from "./service-editor-drafts";
import { ServiceIntentProvider } from "./service-intent";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ServiceContact } from "./service-contact";
const h = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  send: vi.fn(),
  push: vi.fn(),
  gate: vi.fn(),
  generation: 1,
  userId: "buyer",
  authenticated: true,
}));
vi.mock("./inquiry-outbox", () => ({
  inquiryOutbox: () => ({ read: h.read, save: h.save, clear: h.clear }),
}));
vi.mock("./inquiry-api", () => ({ sendServiceInquiry: h.send, inquiryKey: () => "stable-key" }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }), useIsFocused: () => true }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: h.userId },
  }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (text: string) => void;
    editable: boolean;
  }) => <input value={value} onChange={(e) => onChangeText(e.target.value)} disabled={!editable} />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = (status = "listed") =>
  act(async () =>
    root.render(<ServiceContact serviceId="service" creatorId="creator" status={status} />)
  );
const click = (text: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === text)!
    .click();
function type(text: string) {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
beforeEach(() => {
  vi.resetAllMocks();
  h.read.mockReturnValue(null);
  h.generation = 1;
  h.userId = "buyer";
  h.authenticated = true;
  h.gate.mockImplementation(({ onAuthenticated }: { onAuthenticated: () => void }) => {
    if (h.authenticated) onAuthenticated();
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function compose() {
  await render();
  await act(async () => click("serviceContact.title"));
  await act(async () => type("Hello"));
}
it("defers the composer to sign-in and hides contact for owners and unlisted services", async () => {
  h.authenticated = false;
  await render();
  await act(async () => click("serviceContact.title"));
  expect(h.gate).toHaveBeenCalled();
  expect(host.querySelector("input")).toBeNull();
  h.authenticated = true;
  h.userId = "creator";
  await render();
  expect(host.textContent).toBe("");
  h.userId = "buyer";
  await render("paused");
  expect(host.textContent).toBe("");
});
it("serializes rapid sends and opens the returned conversation", async () => {
  h.send.mockResolvedValue("conv/id");
  await compose();
  await act(async () => {
    click("serviceContact.send");
    click("serviceContact.send");
  });
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.send).toHaveBeenCalledWith("service", "Hello", "stable-key");
  await act(async () => click("serviceContact.open"));
  expect(h.push).toHaveBeenCalledWith("/conversation/conv%2Fid");
});
it("preserves text and idempotency identity for a retry", async () => {
  h.send.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("conv");
  await compose();
  await act(async () => click("serviceContact.send"));
  expect(host.querySelector("input")!.value).toBe("Hello");
  await act(async () => click("serviceContact.send"));
  expect(h.send.mock.calls[0]).toEqual(h.send.mock.calls[1]);
});
it("ignores late success after an account change and clears the draft", async () => {
  let finish!: (id: string) => void;
  h.send.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await compose();
  await act(async () => click("serviceContact.send"));
  h.generation = 2;
  await render();
  await act(async () => finish("old"));
  expect(host.querySelector("input")!.value).toBe("");
  expect(host.textContent).not.toContain("serviceContact.sent");
});

it("restores the original inquiry after reopening and freezes edits until acknowledgement", async () => {
  h.read.mockReturnValue({ body: "Recovered inquiry", clientKey: "original-key" });
  h.send.mockResolvedValue("conversation");
  await render();
  await act(async () => click("serviceContact.title"));
  expect(host.querySelector("input")!.value).toBe("Recovered inquiry");
  expect(host.querySelector("input")!.disabled).toBe(true);
  await act(async () => click("serviceContact.send"));
  expect(h.send).toHaveBeenCalledWith("service", "Recovered inquiry", "original-key");
  expect(h.save.mock.invocationCallOrder[0]).toBeLessThan(h.send.mock.invocationCallOrder[0]);
  expect(h.clear).toHaveBeenCalledWith("original-key");
});
it("does not send when durable storage fails", async () => {
  h.save.mockImplementation(() => {
    throw new Error("Disk full");
  });
  await compose();
  await act(async () => click("serviceContact.send"));
  expect(h.send).not.toHaveBeenCalled();
  expect(h.clear).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Disk full");
});

it("keeps an uncertain send immutable until the same request is acknowledged", async () => {
  h.send.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValue("conversation");
  await compose();
  await act(async () => click("serviceContact.send"));
  expect(host.querySelector("input")!.disabled).toBe(true);
  expect(h.clear).not.toHaveBeenCalled();
  await act(async () => click("serviceContact.send"));
  expect(h.send.mock.calls[0]).toEqual(h.send.mock.calls[1]);
  expect(h.clear).toHaveBeenCalledWith("stable-key");
});
it("allows editing after a storage failure that prevented sending", async () => {
  h.save.mockImplementationOnce(() => {
    throw new Error("Disk full");
  });
  h.send.mockResolvedValue("conversation");
  await compose();
  await act(async () => click("serviceContact.send"));
  expect(host.querySelector("input")!.disabled).toBe(false);
  await act(async () => type("Updated before any send"));
  await act(async () => click("serviceContact.send"));
  expect(h.send).toHaveBeenCalledWith("service", "Updated before any send", "stable-key");
});

it("resumes the guest action after login replaces the service controls", async () => {
  h.authenticated = false;
  let complete!: () => void;
  h.gate.mockImplementation(({ onAuthenticated }: { onAuthenticated: () => void }) => {
    complete = onAuthenticated;
  });
  const page = (ready: boolean) =>
    act(async () =>
      root.render(
        <ServiceIntentProvider>
          {ready ? (
            <ServiceContact serviceId="service" creatorId="creator" status="listed" />
          ) : (
            <span>reloading service</span>
          )}
        </ServiceIntentProvider>
      )
    );
  await page(true);
  await act(async () => click("serviceContact.title"));
  h.authenticated = true;
  h.generation = 2;
  await page(false);
  await act(async () => complete());
  await page(true);
  expect(host.querySelector("input")).not.toBeNull();
  expect(h.send).not.toHaveBeenCalled();
  h.generation = 3;
  await page(true);
  expect(host.querySelector("input")).toBeNull();
});

it("retains an unsent inquiry through reload but clears cancelled, sent and foreign-account drafts", async () => {
  const draw = (shown: boolean, scope = "buyer", status = "listed") =>
    act(async () =>
      root.render(
        <ServiceEditorDrafts key={scope}>
          <ServiceIntentProvider>
            {shown && <ServiceContact serviceId="service" creatorId="creator" status={status} />}
          </ServiceIntentProvider>
        </ServiceEditorDrafts>
      )
    );
  await draw(true);
  await act(async () => click("serviceContact.title"));
  await act(async () => type("Keep my project inquiry"));
  await draw(false);
  await draw(true, "buyer", "paused");
  expect(host.querySelector("input")).toBeNull();
  await draw(true);
  expect(host.querySelector("input")?.value).toBe("Keep my project inquiry");
  expect(h.send).not.toHaveBeenCalled();
  await act(async () => click("experienceEdit.cancel"));
  await act(async () => click("serviceContact.title"));
  expect(host.querySelector("input")?.value).toBe("");
  await act(async () => type("Send this inquiry"));
  h.send.mockResolvedValue("conversation");
  await act(async () => click("serviceContact.send"));
  expect(h.send).toHaveBeenCalledExactlyOnceWith("service", "Send this inquiry", "stable-key");
  await act(async () => click("experienceEdit.cancel"));
  await act(async () => click("serviceContact.title"));
  expect(host.querySelector("input")?.value).toBe("");
  await act(async () => type("Private draft"));
  await draw(true, "different-account");
  await act(async () => click("serviceContact.title"));
  expect(host.querySelector("input")?.value).toBe("");
});
