import { expect, it, vi } from "vitest";
import type { IpCreatorIp } from "@/src/lib/ip-commerce/api";
import { normalizeCreatorIp } from "./ip-public-detail";
vi.mock("@/src/env", () => ({ env: {} }));

it("attributes an editor's preview to the authoritative IP owner", () => {
  const ip = { createdById: "owner", viewerAccess: { owner: false } } as IpCreatorIp;
  expect(normalizeCreatorIp(ip, "editor").createdById).toBe("owner");
});
it("does not invent an owner for editor previews on an older backend", () => {
  const ip = { viewerAccess: { owner: false } } as IpCreatorIp;
  expect(normalizeCreatorIp(ip, "editor").createdById).toBeNull();
});
it("retains owner attribution for an owner's preview on an older backend", () => {
  const ip = { viewerAccess: { owner: true } } as IpCreatorIp;
  expect(normalizeCreatorIp(ip, "owner").createdById).toBe("owner");
});
