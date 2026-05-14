/**
 * IP merchandise (衍生品) mock store.
 *
 * One IP can sell five kinds of SKUs (per the product blueprint
 * captured 2026-05-14 from the IP investor PPT):
 *
 *   digital          数字周边 — cover art / scene packs / voice LoRA;
 *                              zero COGS, instant delivery
 *   physical         实物周边 — figurines, posters, merch; cogsRatio
 *                              defaults to 0.3 (matches the PPT example)
 *   custom_content   演一段   — fan-commissioned AI-generated content
 *                              using this IP's characters / scenes;
 *                              zero COGS, the platform's killer SKU
 *   creative_license 二创授权 — limited license for fans to remix
 *   media_license    跨媒介授权 — film / TV / game adaptation rights
 *
 * Each SKU has its own price + currency (CNY / USD / community_score)
 * and a status flag (0 draft / 1 listed / 8 offline). Backend will
 * deduct cogsRatio from priceGross before distributing the rest by
 * the IP cap-table (separate module — not in scope for this round).
 *
 * Mock store is a module-level `Map<ipId, MerchandiseSku[]>` lazy-
 * seeded on first read. Reset via `__resetMerchandiseMockForTest`.
 */

// ─── Types ─────────────────────────────────────────────

export type MerchandiseKind =
  | "digital"
  | "physical"
  | "custom_content"
  | "creative_license"
  | "media_license";

export type MerchandiseCurrency = "CNY" | "USD" | "community_score";

/** 0 = draft (owner only) / 1 = listed (consumer visible) / 8 = offline. */
export type MerchandiseStatus = 0 | 1 | 8;

export interface MerchandiseSku {
  id: string;
  ipId: string;
  kind: MerchandiseKind;
  name: string;
  description?: string;
  /** OSS storage key or full https URL — render via the same path
   *  helpers IP cards already use. Optional for digital licenses
   *  where cover art is irrelevant. */
  cover?: string;
  priceGross: number;
  currency: MerchandiseCurrency;
  /** Fraction (0..1) of priceGross consumed by production / shipping
   *  cost before payout. Digital + custom_content default to 0;
   *  physical defaults to 0.3 (PPT example). */
  cogsRatio: number;
  status: MerchandiseStatus;
  createdAt: number;
  updatedAt: number;
}

// ─── Defaults per kind ─────────────────────────────────

export const DEFAULT_COGS_BY_KIND: Record<MerchandiseKind, number> = {
  digital: 0,
  physical: 0.3,
  custom_content: 0,
  creative_license: 0,
  media_license: 0,
};

// ─── Store ─────────────────────────────────────────────

const store = new Map<string, MerchandiseSku[]>();
let nextIdSeed = 1;

function newId(): string {
  return `m_${Date.now().toString(36)}_${(nextIdSeed++).toString(36)}`;
}

function seedFor(ipId: string): MerchandiseSku[] {
  const now = Date.now();
  return [
    {
      id: newId(),
      ipId,
      kind: "digital",
      name: "Hero portrait pack",
      description: "5 high-resolution portraits of the protagonist.",
      cover: undefined,
      priceGross: 30,
      currency: "community_score",
      cogsRatio: 0,
      status: 1,
      createdAt: now - 7 * 86_400_000,
      updatedAt: now - 7 * 86_400_000,
    },
    {
      id: newId(),
      ipId,
      kind: "physical",
      name: "Acrylic standee",
      description: "Limited run of 200 — ships in 4 weeks.",
      cover: undefined,
      priceGross: 20,
      currency: "USD",
      cogsRatio: 0.3,
      status: 0,
      createdAt: now - 3 * 86_400_000,
      updatedAt: now - 3 * 86_400_000,
    },
    {
      id: newId(),
      ipId,
      kind: "custom_content",
      name: "Personalised 15s scene",
      description:
        "Fan-commissioned 15-second AI clip starring this IP's character — choose a setting and a single line.",
      cover: undefined,
      priceGross: 50,
      currency: "USD",
      cogsRatio: 0,
      status: 1,
      createdAt: now - 1 * 86_400_000,
      updatedAt: now - 1 * 86_400_000,
    },
  ];
}

function getList(ipId: string): MerchandiseSku[] {
  let list = store.get(ipId);
  if (!list) {
    list = seedFor(ipId);
    store.set(ipId, list);
  }
  return list;
}

function cloneSku(sku: MerchandiseSku): MerchandiseSku {
  return { ...sku };
}

// ─── Read ─────────────────────────────────────────────

export function listMerchandise(ipId: string): MerchandiseSku[] {
  return getList(ipId)
    .map(cloneSku)
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Write ────────────────────────────────────────────

export interface CreateMerchandiseInput {
  ipId: string;
  kind: MerchandiseKind;
  name: string;
  description?: string;
  cover?: string;
  priceGross: number;
  currency: MerchandiseCurrency;
  cogsRatio?: number;
  status?: MerchandiseStatus;
}

export function createMerchandise(input: CreateMerchandiseInput): MerchandiseSku {
  const list = getList(input.ipId);
  const now = Date.now();
  const sku: MerchandiseSku = {
    id: newId(),
    ipId: input.ipId,
    kind: input.kind,
    name: input.name,
    description: input.description,
    cover: input.cover,
    priceGross: Math.max(0, input.priceGross),
    currency: input.currency,
    cogsRatio: input.cogsRatio ?? DEFAULT_COGS_BY_KIND[input.kind],
    status: input.status ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  list.push(sku);
  return cloneSku(sku);
}

export interface UpdateMerchandiseInput {
  ipId: string;
  id: string;
  patch: Partial<Omit<MerchandiseSku, "id" | "ipId" | "createdAt" | "updatedAt">>;
}

export function updateMerchandise(input: UpdateMerchandiseInput): MerchandiseSku {
  const list = getList(input.ipId);
  const idx = list.findIndex((s) => s.id === input.id);
  if (idx === -1) throw new Error(`SKU not found: ${input.id}`);
  const next: MerchandiseSku = {
    ...list[idx],
    ...input.patch,
    priceGross:
      input.patch.priceGross != null ? Math.max(0, input.patch.priceGross) : list[idx].priceGross,
    cogsRatio:
      input.patch.cogsRatio != null
        ? Math.max(0, Math.min(1, input.patch.cogsRatio))
        : list[idx].cogsRatio,
    updatedAt: Date.now(),
  };
  list[idx] = next;
  return cloneSku(next);
}

export function deleteMerchandise(ipId: string, id: string): void {
  const list = getList(ipId);
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return;
  list.splice(idx, 1);
}

// ─── Test-only ────────────────────────────────────────

export function __resetMerchandiseMockForTest(ipId?: string): void {
  if (ipId) store.delete(ipId);
  else store.clear();
}
