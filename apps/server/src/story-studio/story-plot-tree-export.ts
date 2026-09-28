import { UnprocessableEntityException } from '@nestjs/common';
import {
  InteractiveStoryDraftContent,
  StoryEnding,
} from './interactive-film.schema';
import {
  PlotTree,
  PlotTreeNode,
  PlotTreeTransition,
  PlotTreeSchema,
} from '../crews/templates/project-task-template.types';

export interface PlotTreeExportIssue {
  nodeId?: string;
  kind:
    | 'no_entry'
    | 'no_endings'
    | 'missing_target'
    | 'scene_no_transitions'
    | 'choice_insufficient_transitions'
    | 'unreachable'
    | 'validation';
  message: string;
}

export interface StoryboardClipExportItem {
  clipId: string;
  title: string;
  order: number;
  durationSeconds: number | null;
}

export interface StoryPlotTreeExportResult {
  projectId: string;
  title: string;
  plotTree: PlotTree;
  storyboardClipsByNode?: Record<string, StoryboardClipExportItem[]>;
}

function localizedString(
  textMap: Record<string, string> | undefined | null,
  fallback = '',
): string {
  if (!textMap) return fallback;
  const values = Object.values(textMap);
  const found = values.find(
    (v) => typeof v === 'string' && v.trim().length > 0,
  );
  return found ? found.trim() : fallback;
}

export function exportPlotTreeFromDraft(
  projectId: string,
  projectTitle: string,
  content: InteractiveStoryDraftContent,
  storyboardClipsByNode?: Record<string, StoryboardClipExportItem[]>,
): StoryPlotTreeExportResult {
  const issues: PlotTreeExportIssue[] = [];
  const entryNodeId = content.graph.entryNodeId;

  if (!entryNodeId) {
    issues.push({
      kind: 'no_entry',
      message: 'Draft does not have an entryNodeId defined.',
    });
  }

  const draftEndings: StoryEnding[] = content.storyBible.endings ?? [];
  const draftEndingMap = new Map<string, StoryEnding>();
  draftEndings.forEach((ending) => {
    draftEndingMap.set(ending.endingId, ending);
  });

  const nodes: PlotTreeNode[] = [];
  const nodeIds = new Set<string>();

  // 1. Process graph nodes (scenes & choices)
  for (const graphNode of content.graph.nodes) {
    nodeIds.add(graphNode.nodeId);

    if (graphNode.kind === 'clip') {
      const transitions: PlotTreeTransition[] = [];
      const exit = graphNode.exit;

      if (exit.kind === 'auto') {
        for (const route of exit.routes) {
          if (!route.target) {
            issues.push({
              nodeId: graphNode.nodeId,
              kind: 'missing_target',
              message: `Clip node ${graphNode.nodeId} has an auto route with a null target.`,
            });
            continue;
          }
          if (route.target.kind === 'node') {
            transitions.push({
              to: route.target.nodeId,
              label: '',
              condition: route.when ? JSON.stringify(route.when) : undefined,
            });
          } else if (route.target.kind === 'ending') {
            transitions.push({
              to: route.target.endingId,
              label: '',
              condition: route.when ? JSON.stringify(route.when) : undefined,
            });
          }
        }
      } else if (exit.kind === 'choice') {
        for (const choice of exit.choices) {
          if (!choice.target) {
            issues.push({
              nodeId: graphNode.nodeId,
              kind: 'missing_target',
              message: `Clip choice ${choice.choiceId} in node ${graphNode.nodeId} has a null target.`,
            });
            continue;
          }
          const label = localizedString(choice.label, choice.choiceId);
          if (choice.target.kind === 'node') {
            transitions.push({
              to: choice.target.nodeId,
              label,
              condition: choice.visibleWhen
                ? JSON.stringify(choice.visibleWhen)
                : undefined,
            });
          } else if (choice.target.kind === 'ending') {
            transitions.push({
              to: choice.target.endingId,
              label,
              condition: choice.visibleWhen
                ? JSON.stringify(choice.visibleWhen)
                : undefined,
            });
          }
        }
      }

      if (transitions.length < 1) {
        issues.push({
          nodeId: graphNode.nodeId,
          kind: 'scene_no_transitions',
          message: `Scene node ${graphNode.nodeId} must have at least 1 transition.`,
        });
      }

      nodes.push({
        id: graphNode.nodeId,
        type: 'scene',
        content: {
          title: graphNode.name || graphNode.clipKey,
          description: graphNode.description || '',
          clipKey: graphNode.clipKey,
        },
        transitions,
      });
    } else if (graphNode.kind === 'decision') {
      const transitions: PlotTreeTransition[] = [];
      const exit = graphNode.exit;

      if (exit.kind === 'choice') {
        for (const choice of exit.choices) {
          if (!choice.target) {
            issues.push({
              nodeId: graphNode.nodeId,
              kind: 'missing_target',
              message: `Choice ${choice.choiceId} in decision ${graphNode.nodeId} has a null target.`,
            });
            continue;
          }
          const label = localizedString(choice.label, choice.choiceId);
          if (choice.target.kind === 'node') {
            transitions.push({
              to: choice.target.nodeId,
              label,
              condition: choice.visibleWhen
                ? JSON.stringify(choice.visibleWhen)
                : undefined,
            });
          } else if (choice.target.kind === 'ending') {
            transitions.push({
              to: choice.target.endingId,
              label,
              condition: choice.visibleWhen
                ? JSON.stringify(choice.visibleWhen)
                : undefined,
            });
          }
        }
      } else if (exit.kind === 'auto') {
        for (const route of exit.routes) {
          if (!route.target) {
            issues.push({
              nodeId: graphNode.nodeId,
              kind: 'missing_target',
              message: `Decision node ${graphNode.nodeId} auto route has a null target.`,
            });
            continue;
          }
          if (route.target.kind === 'node') {
            transitions.push({
              to: route.target.nodeId,
              label: '',
              condition: route.when ? JSON.stringify(route.when) : undefined,
            });
          } else if (route.target.kind === 'ending') {
            transitions.push({
              to: route.target.endingId,
              label: '',
              condition: route.when ? JSON.stringify(route.when) : undefined,
            });
          }
        }
      }

      if (transitions.length < 2) {
        issues.push({
          nodeId: graphNode.nodeId,
          kind: 'choice_insufficient_transitions',
          message: `Choice node ${graphNode.nodeId} must have at least 2 transitions.`,
        });
      }

      const prompt =
        exit.kind === 'choice' ? localizedString(exit.prompt, '') : '';

      nodes.push({
        id: graphNode.nodeId,
        type: 'choice',
        content: {
          prompt,
        },
        transitions,
      });
    }
  }

  // 2. Add genuine ending nodes from storyBible.endings
  if (draftEndings.length === 0) {
    issues.push({
      kind: 'no_endings',
      message: 'Draft has no endings defined in storyBible.endings.',
    });
  } else {
    for (const ending of draftEndings) {
      nodeIds.add(ending.endingId);
      nodes.push({
        id: ending.endingId,
        type: 'ending',
        content: {
          title: localizedString(ending.title, ending.endingId),
          kind: ending.kind,
        },
        transitions: [],
      });
    }
  }

  // 3. Check for transition targets that don't exist in nodeIds
  for (const node of nodes) {
    for (const t of node.transitions) {
      if (!nodeIds.has(t.to)) {
        issues.push({
          nodeId: node.id,
          kind: 'missing_target',
          message: `Transition target ${t.to} does not exist in nodes or endings.`,
        });
      }
    }
  }

  // 4. Check reachability from entryNodeId
  if (entryNodeId && nodeIds.has(entryNodeId)) {
    const visited = new Set<string>();
    const queue: string[] = [entryNodeId];
    visited.add(entryNodeId);

    const nodeTransitionsMap = new Map<string, PlotTreeTransition[]>(
      nodes.map((n) => [n.id, n.transitions]),
    );

    while (queue.length > 0) {
      const current = queue.shift()!;
      const trs = nodeTransitionsMap.get(current) ?? [];
      for (const t of trs) {
        if (nodeIds.has(t.to) && !visited.has(t.to)) {
          visited.add(t.to);
          queue.push(t.to);
        }
      }
    }

    for (const n of nodes) {
      if (!visited.has(n.id)) {
        issues.push({
          nodeId: n.id,
          kind: 'unreachable',
          message: `Node ${n.id} is unreachable from entryNodeId ${entryNodeId}.`,
        });
      }
    }
  }

  if (issues.length > 0) {
    throw new UnprocessableEntityException({
      projectId,
      ready: false,
      issues,
    });
  }

  const rawTree = {
    title: projectTitle || 'Untitled Story',
    description:
      content.storyBible.synopsis || content.storyBible.logline || '',
    startNodeId: entryNodeId!,
    nodes,
  };

  const parsed = PlotTreeSchema.safeParse(rawTree);
  if (!parsed.success) {
    throw new UnprocessableEntityException({
      projectId,
      ready: false,
      issues: parsed.error.issues.map((i) => ({
        kind: 'validation' as const,
        message: `${i.path.join('.')}: ${i.message}`,
      })),
    });
  }

  return {
    projectId,
    title: projectTitle,
    plotTree: parsed.data,
    ...(storyboardClipsByNode ? { storyboardClipsByNode } : {}),
  };
}
