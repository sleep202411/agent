#!/usr/bin/env node
// Read-only COM rollout report. Never reads Secret objects or runs pod commands.
import { spawnSync } from "node:child_process";

const expected = process.argv[2];
const context = process.argv[3] ?? "aks-fizzdragon-com";
if (!/^[0-9a-f]{40}$/.test(expected ?? "")) {
  console.error(
    "Usage: node deploy/diagnose-com-server.mjs <expected-full-image-sha> [kubectl-context]"
  );
  process.exit(2);
}
const namespace = "fizzdragon-com";
const selector = "app.kubernetes.io/instance=fizzdragon,app.kubernetes.io/component=server";
const failures = [];
function get(ns, resource, ...args) {
  const result = spawnSync(
    "kubectl",
    [
      "--context",
      context,
      "--request-timeout=10s",
      "-n",
      ns,
      "get",
      resource,
      ...args,
      "-o",
      "json",
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 }
  );
  if (result.error || result.status !== 0) {
    // Do not dump arbitrary CLI output; the operator can inspect access locally.
    failures.push({
      resource: `${ns}/${resource}`,
      reason:
        result.error?.code ??
        (/forbidden|unauthorized/i.test(result.stderr ?? "")
          ? "access denied"
          : "kubectl read failed"),
    });
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    failures.push({ resource, reason: "invalid JSON response" });
    return null;
  }
}
const app = get("argocd", "application", "fizzdragon-com");
const deployment = get(namespace, "deployment", "fizzdragon-server");
const pods = get(namespace, "pods", "-l", selector);
const service = get(namespace, "service", "fizzdragon-server");
const endpoints = get(
  namespace,
  "endpointslices",
  "-l",
  "kubernetes.io/service-name=fizzdragon-server"
);
const ingress = get(namespace, "ingress");
const desired = deployment?.spec?.template?.spec?.containers?.find(
  (c) => c.name === "server"
)?.image;
const states = (items = []) =>
  items.map((c) => ({
    name: c.name,
    ready: c.ready,
    restartCount: c.restartCount,
    image: c.image,
    imageID: c.imageID,
    waiting: c.state?.waiting?.reason,
    terminated: c.state?.terminated && {
      reason: c.state.terminated.reason,
      exitCode: c.state.terminated.exitCode,
    },
    lastTermination: c.lastState?.terminated && {
      reason: c.lastState.terminated.reason,
      exitCode: c.lastState.terminated.exitCode,
    },
  }));
const podRows = (pods?.items ?? []).map((p) => ({
  name: p.metadata.name,
  deleting: Boolean(p.metadata.deletionTimestamp),
  phase: p.status?.phase,
  ready: p.status?.conditions?.find((c) => c.type === "Ready")?.status === "True",
  initContainers: states(p.status?.initContainerStatuses),
  containers: states(p.status?.containerStatuses),
}));
const desiredReplicas = deployment?.spec?.replicas ?? 1;
const currentPods = podRows.filter((p) => !p.deleting);
const readyOnExpected = currentPods.filter(
  (p) =>
    p.ready && p.containers.some((c) => c.name === "server" && c.image?.endsWith(`:${expected}`))
);
const rolloutVerified = Boolean(
  deployment &&
  pods &&
  desired?.endsWith(`:${expected}`) &&
  deployment.status?.observedGeneration >= deployment.metadata.generation &&
  desiredReplicas > 0 &&
  deployment.status?.updatedReplicas === desiredReplicas &&
  deployment.status?.availableReplicas === desiredReplicas &&
  deployment.status?.replicas === desiredReplicas &&
  currentPods.length === desiredReplicas &&
  readyOnExpected.length === desiredReplicas
);
const report = {
  expectedImageTag: expected,
  context,
  namespace,
  readOnly: true,
  argo: app && {
    targetRevision: app.spec?.source?.targetRevision,
    syncedRevision: app.status?.sync?.revision,
    sync: app.status?.sync?.status,
    health: app.status?.health?.status,
    operationPhase: app.status?.operationState?.phase,
    conditions: app.status?.conditions?.map((c) => ({ type: c.type })),
  },
  deployment: deployment && {
    desiredImage: desired,
    generation: deployment.metadata.generation,
    observedGeneration: deployment.status?.observedGeneration,
    desiredReplicas,
    updatedReplicas: deployment.status?.updatedReplicas ?? 0,
    availableReplicas: deployment.status?.availableReplicas ?? 0,
    conditions: deployment.status?.conditions?.map((c) => ({
      type: c.type,
      status: c.status,
      reason: c.reason,
    })),
  },
  pods: podRows,
  service: service && { selector: service.spec?.selector, ports: service.spec?.ports },
  endpoints:
    endpoints &&
    endpoints.items.map((s) => ({
      name: s.metadata.name,
      ports: s.ports,
      targets: s.endpoints?.map((e) => ({ pod: e.targetRef?.name, conditions: e.conditions })),
    })),
  ingress:
    ingress &&
    ingress.items.flatMap((i) =>
      (i.spec?.rules ?? []).flatMap((r) =>
        (r.http?.paths ?? [])
          .filter((p) => p.backend?.service?.name === "fizzdragon-server")
          .map((p) => ({
            name: i.metadata.name,
            host: r.host,
            path: p.path,
            backend: p.backend.service,
          }))
      )
    ),
  serverRolloutVerified: rolloutVerified,
  note: "Rollout evidence is separate from authenticated route acceptance. Inspect db-migrate logs for init failures, server logs for startup failures, and CSI/events for volume-mount failures. Keep secret values out of shared logs.",
  readFailures: failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length || !rolloutVerified) process.exitCode = 1;
