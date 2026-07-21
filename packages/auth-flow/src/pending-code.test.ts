// @vitest-environment jsdom

/**
 * What survives a dismissed dialog, and for exactly how long.
 *
 * The record exists to close one trap: the SMS lands, the user closes the
 * dialog to read it, reopens — and the identifier step refuses to send
 * while the cooldown runs, with no way back to the code screen. So its
 * lifetime is that cooldown and nothing else; past it, Continue sends a
 * fresh code and there is nothing left to be stranded by.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { clearPendingCode, readPendingCode, writePendingCode } from "./pending-code";
import { armResendDeadline, clearResendDeadline } from "./resend-clock";
import type { NormalizedIdentifier } from "./types";

const ACCOUNT: NormalizedIdentifier = { kind: "phone", account: "13800138000" };
const NOW = 1_700_000_000_000;
const STORAGE_KEY = "fd.auth.pendingCode";

beforeEach(() => {
  clearResendDeadline();
  clearPendingCode();
  window.sessionStorage.clear();
});

describe("readPendingCode", () => {
  it("returns the code that was written, while the cooldown runs", () => {
    armResendDeadline(NOW + 60_000);
    writePendingCode({ account: ACCOUNT, mode: "signin" });
    expect(readPendingCode(NOW)).toEqual({ account: ACCOUNT, mode: "signin" });
  });

  it("returns nothing once the cooldown has lapsed", () => {
    armResendDeadline(NOW + 60_000);
    writePendingCode({ account: ACCOUNT, mode: "reset" });

    expect(readPendingCode(NOW + 60_001)).toBeNull();
    // And it is gone for good — a later read inside a NEW cooldown must
    // not resurrect a code from the previous window.
    armResendDeadline(NOW + 120_000);
    expect(readPendingCode(NOW + 61_000)).toBeNull();
  });

  it("returns nothing when nothing was ever sent", () => {
    armResendDeadline(NOW + 60_000);
    expect(readPendingCode(NOW)).toBeNull();
  });

  it("survives a reload — sessionStorage, not module memory", () => {
    armResendDeadline(NOW + 60_000);
    writePendingCode({ account: ACCOUNT, mode: "reset" });

    // What a fresh page load sees: storage intact, mirror empty.
    clearPendingCode();
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ account: ACCOUNT, mode: "reset" }));

    expect(readPendingCode(NOW)).toEqual({ account: ACCOUNT, mode: "reset" });
  });

  it("ignores anything it did not write itself", () => {
    armResendDeadline(NOW + 60_000);
    for (const raw of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ mode: "signin" }),
      JSON.stringify({ account: ACCOUNT }),
      JSON.stringify({ account: ACCOUNT, mode: "elsewhere" }),
      JSON.stringify({ account: { kind: "fax", account: "1" }, mode: "signin" }),
      JSON.stringify({ account: { kind: "phone", account: "" }, mode: "signin" }),
    ]) {
      clearPendingCode();
      window.sessionStorage.setItem(STORAGE_KEY, raw);
      expect(readPendingCode(NOW), raw).toBeNull();
    }
  });

  it("keeps only the most recent send", () => {
    armResendDeadline(NOW + 60_000);
    writePendingCode({ account: ACCOUNT, mode: "signin" });
    writePendingCode({ account: { kind: "email", account: "a@b.com" }, mode: "reset" });
    expect(readPendingCode(NOW)).toEqual({
      account: { kind: "email", account: "a@b.com" },
      mode: "reset",
    });
  });
});
