// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { useAwarenessPeers, type PeerPresence } from "./use-awareness";
let root: Root;
let instances: Awareness[];
let observations: PeerPresence[][];
function makeAwareness() {
  const awareness = new Awareness(new Y.Doc());
  instances.push(awareness);
  awareness.getStates().set(42, { user: { id: "peer", name: "Peer" } });
  return awareness;
}
function Probe({ awareness, localId }: { awareness: Awareness | null; localId?: number }) {
  const peers = useAwarenessPeers(awareness, localId);
  useLayoutEffect(() => {
    observations.push(peers);
  });
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  instances = [];
  observations = [];
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  instances.forEach((a) => {
    a.destroy();
    a.doc.destroy();
  });
});
it.each(["replace", "disconnect", "local identity"])(
  "does not expose obsolete peers during %s",
  async (change) => {
    const first = makeAwareness();
    await act(async () => root.render(<Probe awareness={first} localId={first.clientID} />));
    expect(observations.at(-1)?.map((p) => p.clientId)).toEqual([42]);
    observations = [];
    const next = change === "replace" ? makeAwareness() : change === "disconnect" ? null : first;
    await act(async () =>
      root.render(
        <Probe awareness={next} localId={change === "local identity" ? 42 : next?.clientID} />
      )
    );
    expect(observations[0]).toEqual([]);
    if (change === "replace") expect(observations.at(-1)?.map((p) => p.clientId)).toEqual([42]);
    if (change === "disconnect") expect(observations.at(-1)).toEqual([]);
    if (change === "local identity")
      expect(observations.at(-1)?.some((p) => p.clientId === 42)).toBe(false);
  }
);
