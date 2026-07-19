"use client";

import { useRef, type RefObject } from "react";
import { useGSAP } from "@gsap/react";
import type { StoryAgentRunDto } from "@repo/shared/story-agent";
import gsap from "gsap";
import { projectStoryDomainIdsToCanvasNodeIds } from "./story-project-canvas-model";

gsap.registerPlugin(useGSAP);

const REVEAL_FRESHNESS_MS = 30_000;

export function useStoryAgentNodeReveal({
  run,
  draftRevision,
  layoutRevision,
  projectionReconciled,
  renderedNodeCount,
  scopeRef,
}: {
  run: StoryAgentRunDto | null;
  draftRevision: number;
  layoutRevision: number | null;
  projectionReconciled: boolean;
  renderedNodeCount: number;
  scopeRef: RefObject<HTMLElement | null>;
}) {
  const revealedRunIdRef = useRef<string | null>(null);

  useGSAP(
    () => {
      if (
        !run ||
        run.status !== "succeeded" ||
        run.resultDraftRevision === null ||
        run.resultLayoutRevision === null ||
        run.resultDraftRevision > draftRevision ||
        layoutRevision === null ||
        run.resultLayoutRevision > layoutRevision ||
        !projectionReconciled ||
        revealedRunIdRef.current === run.id ||
        Date.now() - Date.parse(run.revealStartedAt ?? run.completedAt ?? "") >
          REVEAL_FRESHNESS_MS ||
        !scopeRef.current
      ) {
        return;
      }

      const renderedNodes = [
        ...scopeRef.current.querySelectorAll<HTMLElement>("[data-story-node-id]"),
      ];
      const renderedNodeIds = renderedNodes.flatMap((element) => {
        const nodeId = element.dataset.storyNodeId;
        return nodeId ? [nodeId] : [];
      });
      const affectedCanvasIds = new Set(
        projectStoryDomainIdsToCanvasNodeIds(run.affectedNodeIds, renderedNodeIds)
      );
      const createdCanvasIds = new Set(
        projectStoryDomainIdsToCanvasNodeIds(run.createdNodeIds, renderedNodeIds)
      );
      const nodes = renderedNodes.filter((element) =>
        affectedCanvasIds.has(element.dataset.storyNodeId ?? "")
      );
      if (nodes.length === 0) return;

      revealedRunIdRef.current = run.id;
      const created = nodes.filter((element) =>
        createdCanvasIds.has(element.dataset.storyNodeId ?? "")
      );
      const changed = nodes.filter(
        (element) => !createdCanvasIds.has(element.dataset.storyNodeId ?? "")
      );
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        if (created.length > 0) {
          gsap.fromTo(
            created,
            { autoAlpha: 0, scale: 0.82, y: 18 },
            {
              autoAlpha: 1,
              scale: 1,
              y: 0,
              duration: 0.72,
              ease: "back.out(1.45)",
              stagger: 0.08,
              clearProps: "transform,opacity,visibility",
            }
          );
        }
        if (changed.length > 0) {
          gsap.fromTo(
            changed,
            { autoAlpha: 0.42, scale: 0.96 },
            {
              autoAlpha: 1,
              scale: 1,
              duration: 0.48,
              ease: "power2.out",
              stagger: 0.045,
              clearProps: "transform,opacity,visibility",
            }
          );
        }
      });

      media.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(nodes, { clearProps: "transform,opacity,visibility" });
      });

      return () => media.revert();
    },
    {
      scope: scopeRef,
      dependencies: [
        draftRevision,
        layoutRevision,
        projectionReconciled,
        renderedNodeCount,
        run?.id,
        run?.status,
      ],
      revertOnUpdate: true,
    }
  );
}
