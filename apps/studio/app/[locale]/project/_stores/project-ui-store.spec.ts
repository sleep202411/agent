import { beforeEach, describe, expect, it } from "vitest";
import { useProjectUIStore } from "./project-ui-store";

describe("project UI drawer state", () => {
  beforeEach(() => {
    useProjectUIStore.setState({
      actorsOpen: false,
      assetsOpen: false,
      crewAssetsOpen: false,
      nodesOpen: false,
      historyOpen: false,
      sectionsOpen: false,
      skillsOpen: false,
      selectedSkillId: null,
      selectedShotId: null,
      directorDeskOpen: false,
    });
  });

  it("treats project assets and crew assets as separate, mutually exclusive panels", () => {
    useProjectUIStore.getState().openAssets();
    expect(useProjectUIStore.getState()).toMatchObject({
      assetsOpen: true,
      crewAssetsOpen: false,
    });

    useProjectUIStore.getState().openCrewAssets();
    expect(useProjectUIStore.getState()).toMatchObject({
      assetsOpen: false,
      crewAssetsOpen: true,
    });

    useProjectUIStore.getState().openNodes();
    expect(useProjectUIStore.getState()).toMatchObject({
      nodesOpen: true,
      crewAssetsOpen: false,
    });
  });
});

it("opens the director-desk overlay without closing the left rail", () => {
  useProjectUIStore.getState().openAssets();
  useProjectUIStore.getState().openDirectorDesk();
  expect(useProjectUIStore.getState()).toMatchObject({
    directorDeskOpen: true,
    assetsOpen: true,
  });
});

it("opens actors exclusively and closes them when switching tools", () => {
  useProjectUIStore.getState().openCrewAssets();
  useProjectUIStore.getState().openActors();
  expect(useProjectUIStore.getState()).toMatchObject({
    actorsOpen: true,
    crewAssetsOpen: false,
    assetsOpen: false,
  });
  useProjectUIStore.getState().openAssets();
  expect(useProjectUIStore.getState().actorsOpen).toBe(false);
});
