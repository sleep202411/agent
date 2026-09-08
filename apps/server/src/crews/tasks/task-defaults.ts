import { CrewTaskStatus, type Prisma } from '@prisma/client';

export const DEFAULT_CREW_TASK_WORKFLOW_STATES = [
  {
    name: 'Backlog',
    color: '#8B919B',
    semantic: CrewTaskStatus.open,
    systemKey: 'backlog',
    position: 0,
  },
  {
    name: 'To do',
    color: '#8B919B',
    semantic: CrewTaskStatus.open,
    systemKey: CrewTaskStatus.open,
    position: 1,
  },
  {
    name: 'In progress',
    color: '#63A8FF',
    semantic: CrewTaskStatus.in_progress,
    systemKey: CrewTaskStatus.in_progress,
    position: 2,
  },
  {
    name: 'In review',
    color: '#E9B949',
    semantic: CrewTaskStatus.submitted,
    systemKey: CrewTaskStatus.submitted,
    position: 3,
  },
  {
    name: 'Changes requested',
    color: '#EF646B',
    semantic: CrewTaskStatus.revision_requested,
    systemKey: CrewTaskStatus.revision_requested,
    position: 4,
  },
  {
    name: 'Completed',
    color: '#58B889',
    semantic: CrewTaskStatus.approved,
    systemKey: CrewTaskStatus.approved,
    position: 5,
  },
  {
    name: 'Cancelled',
    color: '#6F7580',
    semantic: CrewTaskStatus.cancelled,
    systemKey: CrewTaskStatus.cancelled,
    position: 6,
  },
] as const;

export function defaultCrewTaskView(
  crewId: string,
  createdByUserId: string,
): Prisma.CrewTaskViewCreateManyInput {
  return {
    crewId,
    name: 'issues',
    layout: 'board',
    groupBy: 'status',
    filters: {},
    sorts: [{ field: 'rank', direction: 'asc' }],
    visibleFields: [
      'number',
      'status',
      'priority',
      'assignees',
      'cycle',
      'estimate',
      'points',
      'dueAt',
    ],
    completedMode: 'all',
    showSubIssues: true,
    showEmptyGroups: false,
    position: 0,
    isSystem: true,
    createdByUserId,
  };
}
