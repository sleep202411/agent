// Adapted from official Studio elk-canvas-layout-engine.ts. Geometry only; persistence stays with the Mobile movement journal.
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import type {
  CanvasTidyLayoutLane,
  CanvasTidyLayoutNode,
  CanvasTidyLayoutRequest,
  CanvasTidyPosition,
} from "./schema";

const LAYOUT_TIMEOUT_MS = 15_000;

interface ElkLayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
  terminateWorker?: () => void;
}

let elkPromise: Promise<ElkLayoutEngine> | null = null;

function getElk(): Promise<ElkLayoutEngine> {
  elkPromise ??= createElkLayoutEngine();
  return elkPromise;
}

interface PositionedNode extends CanvasTidyLayoutNode {
  x: number;
  y: number;
}

interface ComponentLayout {
  id: string;
  width: number;
  height: number;
  nodes: PositionedNode[];
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Production graph layout pipeline:
 * 1. isolate semantic side lanes;
 * 2. split the remaining graph into weakly connected components;
 * 3. run ELK Layered on every component (cycles, layers, crossings, placement);
 * 4. run ELK Rect Packing over the component rectangles;
 * 5. place semantic lanes and preserve the selection/canvas centre.
 */
export async function layoutCanvasTidyGraph(
  request: CanvasTidyLayoutRequest
): Promise<CanvasTidyPosition[]> {
  const requestedEngine = getElk();
  try {
    const elk = await requestedEngine;
    return await withTimeout(runCanvasTidyGraph(request, elk), LAYOUT_TIMEOUT_MS);
  } catch (error) {
    resetElkLayoutEngine(requestedEngine);
    throw error;
  }
}

async function runCanvasTidyGraph(
  request: CanvasTidyLayoutRequest,
  elk: ElkLayoutEngine
): Promise<CanvasTidyPosition[]> {
  if (request.nodes.length === 0) return [];

  const nodeById = new Map(request.nodes.map((node) => [node.id, node]));
  const laneNodeIds = new Set(request.lanes.flatMap((lane) => lane.nodeIds));
  const graphNodes = request.nodes.filter((node) => !laneNodeIds.has(node.id));
  const graphNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphEdges = request.edges.filter(
    (edge) => graphNodeIds.has(edge.source) && graphNodeIds.has(edge.target)
  );

  const positioned = new Map<string, PositionedNode>();
  if (graphNodes.length > 0) {
    const components = weaklyConnectedComponents(graphNodes, graphEdges);
    const componentLayouts = await Promise.all(
      components.map((component, index) =>
        layoutConnectedComponent(
          `component:${index}`,
          component,
          graphEdges.filter(
            (edge) => component.ids.has(edge.source) && component.ids.has(edge.target)
          ),
          request,
          elk
        )
      )
    );
    const packed = await packComponents(componentLayouts, request, elk);
    packed.forEach((node) => positioned.set(node.id, node));
  }

  placeSemanticLanes(positioned, request.lanes, nodeById);

  // Every node is either in the graph or in exactly one lane. Keeping this as
  // a hard invariant avoids a deceptively successful tidy that drops a card.
  if (positioned.size !== request.nodes.length) {
    const missing = request.nodes.filter((node) => !positioned.has(node.id)).map((node) => node.id);
    throw new Error(`Canvas layout omitted nodes: ${missing.join(", ")}`);
  }

  const originalBounds = boundsOf(
    request.nodes.map((node) => ({ ...node, x: node.position.x, y: node.position.y }))
  );
  const nextNodes = request.nodes.map((node) => positioned.get(node.id)!);
  const nextBounds = boundsOf(nextNodes);
  const offsetX = centre(originalBounds, "x") - centre(nextBounds, "x");
  const offsetY = centre(originalBounds, "y") - centre(nextBounds, "y");

  return request.nodes.map((node) => {
    const result = positioned.get(node.id)!;
    return {
      id: node.id,
      position: {
        x: normalizeZero(Math.round(result.x + offsetX)),
        y: normalizeZero(Math.round(result.y + offsetY)),
      },
    };
  });
}

function weaklyConnectedComponents(
  nodes: CanvasTidyLayoutNode[],
  edges: CanvasTidyLayoutRequest["edges"]
): { nodes: CanvasTidyLayoutNode[]; ids: Set<string> }[] {
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  edges.forEach((edge) => {
    if (edge.source === edge.target) return;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  const visited = new Set<string>();
  const components: { nodes: CanvasTidyLayoutNode[]; ids: Set<string> }[] = [];
  nodes.forEach((seed) => {
    if (visited.has(seed.id)) return;
    const ids = new Set<string>();
    const queue = [seed.id];
    visited.add(seed.id);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor]!;
      ids.add(id);
      [...(adjacency.get(id) ?? [])]
        .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
        .forEach((next) => {
          if (visited.has(next)) return;
          visited.add(next);
          queue.push(next);
        });
    }
    components.push({ nodes: nodes.filter((node) => ids.has(node.id)), ids });
  });
  return components;
}

async function layoutConnectedComponent(
  id: string,
  component: { nodes: CanvasTidyLayoutNode[] },
  edges: CanvasTidyLayoutRequest["edges"],
  request: CanvasTidyLayoutRequest,
  elk: ElkLayoutEngine
): Promise<ComponentLayout> {
  if (component.nodes.length === 1) {
    const node = component.nodes[0]!;
    return { id, width: node.width, height: node.height, nodes: [{ ...node, x: 0, y: 0 }] };
  }

  const graph: ElkNode = {
    id,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": request.direction,
      "elk.edgeRouting": "SPLINES",
      "elk.padding": zeroPadding(),
      "elk.spacing.nodeNode": String(request.nodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(request.layerSpacing),
      "elk.layered.spacing.edgeNodeBetweenLayers": String(Math.max(32, request.nodeSpacing / 2)),
      "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
      "elk.layered.thoroughness": "20",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      // Preserve meaningful author order only as a tie-breaker; a tiny weight
      // lets crossing minimization remain authoritative.
      "elk.layered.considerModelOrder.crossingCounterNodeInfluence": "0.001",
      "elk.separateConnectedComponents": "false",
    },
    children: component.nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: edges.map<ElkExtendedEdge>((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const result = await elk.layout(graph);
  const resultById = new Map((result.children ?? []).map((node) => [node.id, node]));
  const rawNodes = component.nodes.map<PositionedNode>((node) => {
    const resultNode = resultById.get(node.id);
    if (!resultNode || !Number.isFinite(resultNode.x) || !Number.isFinite(resultNode.y)) {
      throw new Error(`ELK did not position canvas node ${node.id}`);
    }
    return { ...node, x: resultNode.x!, y: resultNode.y! };
  });
  const bounds = boundsOf(rawNodes);
  return {
    id,
    width: bounds.width,
    height: bounds.height,
    nodes: rawNodes.map((node) => ({ ...node, x: node.x - bounds.x, y: node.y - bounds.y })),
  };
}

async function packComponents(
  components: ComponentLayout[],
  request: CanvasTidyLayoutRequest,
  elk: ElkLayoutEngine
): Promise<PositionedNode[]> {
  if (components.length === 1) return components[0]!.nodes;

  const packed = await elk.layout({
    id: "canvas-components",
    layoutOptions: {
      "elk.algorithm": "rectpacking",
      "elk.aspectRatio": String(request.componentAspectRatio),
      "elk.padding": zeroPadding(),
      "elk.spacing.nodeNode": String(request.componentSpacing),
      "elk.rectpacking.orderBySize": "true",
      // `trybox` optimizes identical rectangles as one long row/column before
      // aspect-ratio approximation runs — exactly the degenerate layout this
      // product action must prevent for many orphaned assets.
      "elk.rectpacking.trybox": "false",
      "elk.rectpacking.widthApproximation.optimizationGoal": "ASPECT_RATIO_DRIVEN",
      "elk.rectpacking.packing.compaction.iterations": "2",
    },
    children: components.map((component) => ({
      id: component.id,
      width: component.width,
      height: component.height,
    })),
  });
  const placementById = new Map((packed.children ?? []).map((node) => [node.id, node]));
  return components.flatMap((component) => {
    const placement = placementById.get(component.id);
    if (!placement || !Number.isFinite(placement.x) || !Number.isFinite(placement.y)) {
      throw new Error(`ELK did not pack canvas component ${component.id}`);
    }
    return component.nodes.map((node) => ({
      ...node,
      x: node.x + placement.x!,
      y: node.y + placement.y!,
    }));
  });
}

function placeSemanticLanes(
  positioned: Map<string, PositionedNode>,
  lanes: CanvasTidyLayoutLane[],
  nodeById: ReadonlyMap<string, CanvasTidyLayoutNode>
): void {
  const nonEmptyLanes = lanes.filter((lane) => lane.nodeIds.length > 0);
  if (nonEmptyLanes.length === 0) return;

  let occupied =
    positioned.size > 0
      ? boundsOf([...positioned.values()])
      : ({ x: 0, y: 0, width: 0, height: 0 } satisfies Bounds);

  nonEmptyLanes.forEach((lane) => {
    const nodes = lane.nodeIds.map((id) => {
      const node = nodeById.get(id);
      if (!node) throw new Error(`Canvas lane ${lane.id} references missing node ${id}`);
      return node;
    });
    const horizontal = lane.side === "above" || lane.side === "below";
    const primarySize = nodes.reduce(
      (sum, node) => sum + (horizontal ? node.width : node.height),
      0
    );
    const lanePrimarySize = primarySize + lane.nodeGap * Math.max(0, nodes.length - 1);
    let cursor = horizontal
      ? occupied.x + (occupied.width - lanePrimarySize) / 2
      : occupied.y + (occupied.height - lanePrimarySize) / 2;
    const crossSize = Math.max(...nodes.map((node) => (horizontal ? node.height : node.width)));

    nodes.forEach((node) => {
      let x: number;
      let y: number;
      if (lane.side === "left") {
        x = occupied.x - lane.gap - crossSize + (crossSize - node.width) / 2;
        y = cursor;
      } else if (lane.side === "right") {
        x = occupied.x + occupied.width + lane.gap + (crossSize - node.width) / 2;
        y = cursor;
      } else if (lane.side === "above") {
        x = cursor;
        y = occupied.y - lane.gap - crossSize + (crossSize - node.height) / 2;
      } else {
        x = cursor;
        y = occupied.y + occupied.height + lane.gap + (crossSize - node.height) / 2;
      }
      positioned.set(node.id, { ...node, x, y });
      cursor += (horizontal ? node.width : node.height) + lane.nodeGap;
    });
    occupied = boundsOf([...positioned.values()]);
  });
}

function boundsOf(nodes: PositionedNode[]): Bounds {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function centre(bounds: Bounds, axis: "x" | "y"): number {
  return axis === "x" ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2;
}

function zeroPadding(): string {
  return "[top=0,left=0,bottom=0,right=0]";
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

async function createElkLayoutEngine(): Promise<ElkLayoutEngine> {
  if (typeof window === "undefined") {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    return new ELK();
  }
  const { createBrowserTidyEngine } = await import("./worker-client");
  return createBrowserTidyEngine();
}

function resetElkLayoutEngine(expected: Promise<ElkLayoutEngine>): void {
  // A late failure from a retired worker must not terminate a newer retry.
  if (elkPromise !== expected) return;
  const current = elkPromise;
  elkPromise = null;
  void current?.then((engine) => engine.terminateWorker?.()).catch(() => undefined);
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Canvas layout worker timed out")),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
