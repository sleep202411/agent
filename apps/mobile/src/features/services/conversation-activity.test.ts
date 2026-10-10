import { expect, it } from "vitest";
import {
  activitySubject,
  conversationActivity,
  conversationDisplayIds,
} from "./conversation-activity";
import type { NativeMessage } from "./conversation-api";
import en from "@/i18n/messages/en-US.json";
const t = (key: keyof typeof en) => en[key];
const message: NativeMessage = {
  id: "m",
  conversationId: "c",
  authorId: null,
  clientKey: null,
  type: "system",
  body: "untrusted body",
  createdAt: "now",
  payload: { kind: "system", system: { kind: "crew.member.left", params: { userId: "123" } } },
};
it("resolves the former member rather than attributing activity to the sender", () => {
  const names = new Map([["123", { userId: "123", nickname: "Pax", avatar: null }]]);
  expect(conversationActivity(message, names, t)).toBe("Pax left the crew.");
  expect(conversationDisplayIds(["1"], [message])).toContain("123");
});
it("uses a generic member when the profile is missing and never exposes raw IDs or body", () => {
  expect(conversationActivity(message, undefined, t)).toBe("A member left the crew.");
});
it("treats names as literal text, including replacement syntax", () => {
  expect(
    conversationActivity(
      message,
      new Map([["123", { userId: "123", nickname: "$&", avatar: null }]]),
      t
    )
  ).toBe("$& left the crew.");
});
it("accepts numeric IDs but ignores unsafe or unknown event subjects", () => {
  const numeric = {
    ...message,
    payload: {
      kind: "system" as const,
      system: { kind: "crew.member.joined", params: { userId: 123 } },
    },
  };
  expect(activitySubject(numeric)).toBe("123");
  expect(
    activitySubject({
      ...numeric,
      payload: {
        ...numeric.payload,
        system: { ...numeric.payload.system, params: { userId: Number.MAX_SAFE_INTEGER + 1 } },
      },
    })
  ).toBeUndefined();
  const unknown = {
    ...numeric,
    payload: { ...numeric.payload, system: { kind: "new.event", params: { userId: 123 } } },
  };
  expect(activitySubject(unknown)).toBeUndefined();
  expect(conversationActivity(unknown, undefined, t)).toBe(en["inbox.preview.system"]);
});
it("does not reinterpret user text as system activity and includes historic authors for display lookup", () => {
  const text = {
    ...message,
    type: "text" as const,
    authorId: "456",
    payload: null,
    body: "[system:crew.member.left]",
  };
  expect(conversationActivity(text, undefined, t)).toBe(text.body);
  expect(activitySubject(text)).toBeUndefined();
  expect(conversationDisplayIds([], [text])).toContain("456");
});

it("preserves revision instructions as literal multiline text after the event label", () => {
  const reason = "Change shot 2.\n保留结尾 <script>alert(1)</script> $&";
  const revision = {
    ...message,
    payload: {
      kind: "system" as const,
      system: { kind: "order.revision_requested", params: { reason } },
    },
  };
  expect(conversationActivity(revision, undefined, t)).toBe(
    `${en["inbox.activity.order.revision_requested"]}\n\n${reason}`
  );
});
it.each([undefined, null, 12, {}, ""])(
  "ignores malformed or missing revision reason %s",
  (reason) => {
    const revision = {
      ...message,
      payload: {
        kind: "system" as const,
        system: { kind: "order.revision_requested", params: { reason } },
      },
    } as NativeMessage;
    expect(conversationActivity(revision, undefined, t)).toBe(
      en["inbox.activity.order.revision_requested"]
    );
  }
);
it("does not expose arbitrary reason parameters from other system events", () => {
  const other = {
    ...message,
    payload: {
      kind: "system" as const,
      system: { kind: "unknown.event", params: { reason: "private reason" } },
    },
  };
  expect(conversationActivity(other, undefined, t)).toBe(en["inbox.preview.system"]);
});
