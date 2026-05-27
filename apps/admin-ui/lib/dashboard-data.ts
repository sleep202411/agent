export const overviewStats = [
  {
    label: "Queued AI jobs",
    value: "128",
    detail: "23 video jobs waiting for provider capacity",
  },
  {
    label: "Reserved bubbles",
    value: "48.2k",
    detail: "Held for running jobs before final settlement",
  },
  {
    label: "Provider incidents",
    value: "3",
    detail: "Fal video queue latency, Foundry image retry, CN payment callback",
  },
  {
    label: "Manual adjustments",
    value: "17",
    detail: "All changes require audit reason and operator identity",
  },
];

export const operationalQueues = [
  {
    name: "Image generation",
    region: "global",
    health: "Healthy",
    backlog: "42",
    policy: "Fair-share by workspace",
  },
  {
    name: "Video generation",
    region: "global",
    health: "Constrained",
    backlog: "86",
    policy: "VIP priority with capped burst",
  },
  {
    name: "CN payment callbacks",
    region: "cn",
    health: "Watch",
    backlog: "6",
    policy: "Idempotent reconcile every 5 minutes",
  },
];

export const paymentRails = [
  {
    region: "Global",
    site: ".com",
    provider: "Airewa",
    currency: "USD",
    source: "Resolved by site region and checkout country",
  },
  {
    region: "China",
    site: ".cn",
    provider: "WeChat Pay",
    currency: "CNY",
    source: "Resolved by CN deployment",
  },
];
