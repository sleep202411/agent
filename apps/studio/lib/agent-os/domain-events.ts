/**
 * Lightweight browser events so product surfaces (Cast, Storyboard) can
 * refresh when Agent OS domain state changes — without coupling to Ably.
 */

export const AGENT_OS_DOMAIN_CHANGED = "fizz:agent-os:domain-changed";

export type AgentOsDomainChangedDetail = {
  projectId: string;
  kind: "characters" | "shots" | "unknown";
};

export function emitAgentOsDomainChanged(detail: AgentOsDomainChangedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENT_OS_DOMAIN_CHANGED, { detail }));
}

export function onAgentOsDomainChanged(
  handler: (detail: AgentOsDomainChangedDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const custom = event as CustomEvent<AgentOsDomainChangedDetail>;
    if (custom.detail) handler(custom.detail);
  };
  window.addEventListener(AGENT_OS_DOMAIN_CHANGED, listener);
  return () => window.removeEventListener(AGENT_OS_DOMAIN_CHANGED, listener);
}
