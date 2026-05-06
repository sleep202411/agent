"use client";

/**
 * Root-level hook: opens a single EntityEventsClient WS per user and
 * dispatches the right Redux touch action on every incoming
 * `entity_changed` frame. One mount for the whole app (put in a top
 * layout), lifetime = logged-in session.
 *
 * Mapping: entity → touch action. Touch actions invalidate cached
 * lists so whatever panel / page is reading that data will refetch
 * on next render cycle.
 */
import { useEffect } from "react";
import type { EntityEvent } from "@repo/shared/entity-events";
import { useAppDispatch, useAppStore } from "@/src/store";
import {
  touchProjectList,
  touchWorld,
  touchEpisodes,
  touchScript,
  touchCharacters,
  touchScenes,
  touchProps,
  touchStoryboard,
} from "@/src/store/slices/projectSlice";
import { refreshProjectDetail } from "@/src/store/slices/assistantSlice";
import { openEntityEventsClient } from "./entity-events-client";

export function useEntityEventsSession(opts: { enabled: boolean }) {
  const dispatch = useAppDispatch();
  const store = useAppStore();

  useEffect(() => {
    if (!opts.enabled) return;
    const client = openEntityEventsClient({
      onOpen: () => console.log("[entity-events] WS connected"),
      onEntityChanged: (event: EntityEvent) => {
        console.log("[entity-events] received:", event);
        switch (event.entity) {
          case "project": {
            dispatch(touchProjectList());
            // Refetch project detail so header/breadcrumb/params panel see
            // the new name/description/imagePath. `touchProjectList` alone
            // only bumps the list version; the detail slice is its own
            // source of truth.
            const targetProjectId = event.projectId ?? store.getState().project.currentProjectId;
            if (targetProjectId) {
              void refreshProjectDetail(dispatch, targetProjectId);
            }
            break;
          }
          case "world":
            dispatch(touchWorld());
            break;
          case "episode":
            dispatch(touchEpisodes());
            break;
          case "script":
            // Bump both: episodesVersion drives the sidebar red dot
            // (script is part of the Episodes panel data model), and
            // scriptVersion drives the top Script tab indicator.
            console.log("[entity-events] script change → touchScript + touchEpisodes");
            dispatch(touchEpisodes());
            dispatch(touchScript());
            break;
          case "character":
            dispatch(touchCharacters());
            break;
          case "scene":
            dispatch(touchScenes());
            break;
          case "prop":
            dispatch(touchProps());
            break;
          case "storyboard":
          case "shot":
            dispatch(touchStoryboard());
            break;
          default:
            break;
        }
      },
    });
    return () => {
      client.close();
    };
  }, [dispatch, store, opts.enabled]);
}
