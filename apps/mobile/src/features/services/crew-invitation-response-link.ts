import { z } from "zod";

const invalid = "/crew-invitation-response/invalid";
const invitationPath = /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?crew-invitations\/([^/]+)\/?$/;
const recognizable = /(?:^|\/)crew-invitations(?:\/|[?#]|$)/;

/** External Web invitation IDs must not be interpreted as internal management Crew IDs. */
export function redirectCrewInvitationResponse(
  input: string,
  region: "global" | "cn",
  schemes: readonly string[]
) {
  let decoded = input.split(/[?#]/, 1)[0]!;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* Malformed links are rejected below. */
  }
  let recognized = recognizable.test(decoded);
  try {
    // Custom schemes put the route name in hostname, even with credentials or a port.
    recognized ||= new URL(input).hostname === "crew-invitations";
  } catch {
    /* Router-relative paths are handled below. */
  }
  if (!recognized) return input;
  try {
    if (/[\\\u0000-\u0020%]/.test(input)) return invalid;
    const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
    const relative = input.startsWith("/") && !input.startsWith("//");
    const url = new URL(input, relative ? origin : undefined);
    let path = url.pathname;
    if (!relative && schemes.includes(url.protocol.slice(0, -1))) {
      path = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
    } else if (url.origin !== origin) return invalid;
    if (url.username || url.password || url.port || url.search || url.hash) return invalid;
    const match = invitationPath.exec(path);
    if (!match || !z.string().uuid().safeParse(match[1]).success) return invalid;
    return `/crew-invitation-response/${match[1].toLowerCase()}`;
  } catch {
    return invalid;
  }
}
