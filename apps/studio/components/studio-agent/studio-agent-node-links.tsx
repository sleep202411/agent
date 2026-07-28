"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Which names in an assistant's reply point at something the creator can go and
 * look at.
 *
 * The agent writes node ids inline — `scene_harbour_dawn_prose`, sometimes
 * prefixed as `clip:new_scene` — and the creator's obvious next move is to see
 * the thing. Turning those into links is easy to get WRONG, though: the same
 * reply also contains `exit`, `text`, `zh-CN`, and any other code span the model
 * felt like typing. Linking all of them produces dead affordances, which teach
 * the creator to stop trusting the ones that work.
 *
 * So resolution is against reality, never against a pattern: a span becomes a
 * link only when the surface it is rendered in says a node by that name exists.
 * This context is how the surface says so. Absent — a conversation rendered
 * somewhere with no canvas — every span stays plain text, which is the correct
 * answer rather than a degraded one.
 */
export interface StudioAgentNodeLinks {
  /** Ids of nodes that exist right now. */
  has: (nodeId: string) => boolean;
  /** Take the creator to it. */
  focus: (nodeId: string) => void;
}

const StudioAgentNodeLinkContext = createContext<StudioAgentNodeLinks | null>(null);

export function StudioAgentNodeLinkProvider({
  has,
  focus,
  children,
}: StudioAgentNodeLinks & { children: ReactNode }) {
  const value = useMemo<StudioAgentNodeLinks>(() => ({ has, focus }), [focus, has]);
  return (
    <StudioAgentNodeLinkContext.Provider value={value}>
      {children}
    </StudioAgentNodeLinkContext.Provider>
  );
}

export function useStudioAgentNodeLinks(): StudioAgentNodeLinks | null {
  return useContext(StudioAgentNodeLinkContext);
}

/**
 * The node this code span names, or null when it names nothing.
 *
 * Two forms, because the agent writes both: the bare id, and a `kind:id`
 * reference it uses when disambiguating for the reader. The prefix is stripped
 * and re-checked rather than pattern-matched — `zh-CN` also contains a
 * separator, and it is not a node.
 */
export function resolveStudioAgentNodeReference(
  text: string,
  links: StudioAgentNodeLinks
): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes(" ") || trimmed.length > 128) return null;
  if (links.has(trimmed)) return trimmed;
  const separator = trimmed.indexOf(":");
  if (separator <= 0) return null;
  const suffix = trimmed.slice(separator + 1);
  return suffix && links.has(suffix) ? suffix : null;
}
