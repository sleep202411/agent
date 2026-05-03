/**
 * Producer Workbench overview — projects table, pending checkpoints,
 * finance summary, top stat cards. Backed by a single mock fixture
 * mirroring the PRD's `/studio?view=workbench` design.
 */

import { useQuery } from "@tanstack/react-query";
import { crewKeys, delay } from "./shared";
import type { ProducerOverview } from "./types";

async function fetchProducerOverview(): Promise<ProducerOverview> {
  await delay(180);
  return {
    projects: [
      {
        id: "1",
        name: "赛博山海经预告片组",
        status: "In Production",
        phase: "Storyboarding",
        progress: 35,
        budget: 28000,
        spent: 9800,
        members: 6,
        urgentCheckpoints: 1,
        pendingTasks: 3,
        deadline: "2026-04-10",
        health: "warning",
      },
      {
        id: "2",
        name: "深港品牌宣传片",
        status: "In Production",
        phase: "Video Gen",
        progress: 62,
        budget: 45000,
        spent: 28500,
        members: 4,
        urgentCheckpoints: 0,
        pendingTasks: 1,
        deadline: "2026-04-22",
        health: "good",
      },
      {
        id: "3",
        name: "Algorithm Goddess OST",
        status: "Not Started",
        phase: "Design Phase",
        progress: 5,
        budget: 12000,
        spent: 0,
        members: 2,
        urgentCheckpoints: 0,
        pendingTasks: 0,
        deadline: "2026-05-01",
        health: "good",
      },
    ],
    pendingCheckpoints: [
      {
        id: "cp2",
        project: "赛博山海经",
        stage: "Storyboard",
        sla: "6h until timeout",
        urgent: true,
      },
      {
        id: "cp5",
        project: "深港品牌",
        stage: "AI Image Gen",
        sla: "Due tomorrow",
        urgent: false,
      },
    ],
    finance: {
      totalBudget: 85000,
      totalSpent: 38300,
      escrowHeld: 22400,
      pendingRelease: 8500,
    },
    stats: {
      activeProjects: 2,
      pendingCheckpoints: 2,
      dueThisWeek: 5,
      totalTeam: 12,
    },
  };
}

export function useProducerOverview() {
  return useQuery({
    queryKey: crewKeys.producerOverview,
    queryFn: fetchProducerOverview,
  });
}
