/**
 * CN IP migration — Java CN MySQL (`fizzdragon_client`) → Postgres ip-commerce.
 *
 * Metadata-only: images/videos stay in OSS; MediaAsset rows reference the public
 * `banner.fizzspace.cn` URL via `external_url` (no binary copy). Same target schema +
 * the proven .com field mapping; source is read DIRECTLY from MySQL (not the HTTP API).
 *
 * Two phases (decoupled so MySQL-read and PG-write use different endpoints/whitelists):
 *   pull               — read CN MySQL → snapshot.cn.json + mapped preview. READ-ONLY, no PG.
 *   push               — read snapshot → upsert into PG. DRY-RUN (prints) unless --write.
 *
 * Env (apps/server/.env.legacy.cn.local, git-ignored):
 *   LEGACY_CN_MYSQL_HOST/PORT/USER/PASSWORD/DB   — source (pull)
 *   DATABASE_URL                                 — target CN RDS PG (push --write only)
 *   LEGACY_CN_MEDIA_BASE                         — default https://banner.fizzspace.cn
 *
 * Usage:
 *   npm --workspace server exec -- tsx scripts/ip-cn-migration.ts pull [--limit N] [--status 5]
 *   npm --workspace server exec -- tsx scripts/ip-cn-migration.ts push [--limit N] [--write]
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import mysql from 'mysql2/promise';
import { config as loadDotenv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
loadDotenv({
  path: resolve(repoRoot, 'apps/server/.env.legacy.cn.local'),
  override: false,
});

const SOURCE_LOCALE = 'zh-CN';
const IMPORT_USER = process.env.LEGACY_IMPORT_USER_ID || 'legacy-cn-import';
const MEDIA_BASE = (
  process.env.LEGACY_CN_MEDIA_BASE || 'https://banner.fizzspace.cn'
).replace(/\/+$/, '');
const DEFAULT_SNAPSHOT = resolve(
  repoRoot,
  'apps/server/outputs/ip-cn-migration/snapshot.cn.json',
);

// ── publication status (client_project.project_status / video_list.review) ──
// 0=draft 3=changes_requested/rejected 5=published 8=hidden  (verified Step 0)
type PubStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'published'
  | 'hidden'
  | 'archived';
function mapStatus(raw: unknown): PubStatus {
  switch (Number(raw)) {
    case 5:
      return 'published';
    case 8:
      return 'hidden';
    case 3:
      return 'changes_requested';
    case 1:
      return 'in_review';
    default:
      return 'draft'; // 0 / null / unknown
  }
}

// ── contributor role (auth_role_list id → IpContributorRole) ──
const ROLE_MAP: Record<number, string> = {
  1: 'director', // 导演
  2: 'writer', // 编剧
  3: 'artist', // 美术
  4: 'producer', // 制片
  5: 'artist', // 出图师
  8: 'editor', // 剪辑
  11: 'performer', // 配音
  19: 'writer', // 漫画编剧
  20: 'director', // 漫画导演
  // 6 AI工程师 / 7 配乐 / 9 宣发 / 10 声音工程师 / 12 发行方 / 13 采购方 / 14 自由创作者 → other
};
function mapRole(roleId: unknown): string {
  return ROLE_MAP[Number(roleId)] ?? 'other';
}

// ── genre / tag code from a Chinese label (extends the .com known map) ──
function taxonomyCode(type: 'genre' | 'tag', label: string): string {
  const n = label.trim().toLowerCase();
  const known: Record<string, string> = {
    'genre:电影': 'film',
    'genre:番剧': 'anime',
    'genre:动画': 'animation',
    'genre:短剧': 'short_drama',
    'genre:纪录片': 'documentary',
    'genre:专题片': 'feature',
    'genre:科幻': 'sci_fi',
    'genre:爱情': 'romance',
    'genre:创造力': 'creativity',
    'genre:悬疑': 'mystery',
    'genre:奇幻': 'fantasy',
    'genre:冒险': 'adventure',
    'genre:动作': 'action',
    'genre:喜剧': 'comedy',
    'genre:剧情': 'drama',
  };
  const mapped = known[`${type}:${n}`];
  if (mapped) return mapped;
  return `legacy_${createHash('sha1').update(`${type}:${n}`).digest('hex').slice(0, 16)}`;
}

// ── deterministic uuid v5 (namespace shared with the .com migration) ──
function legacyUuid(kind: string, value: string): string {
  const ns = Buffer.from('2d3fb7fe7d9a50f1b502a7a87cf7f482', 'hex');
  const h = createHash('sha1').update(ns).update(`${kind}:${value}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// ── media: OSS object key (or full URL) → public external_url ──
function encodePath(key: string): string {
  return key.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}
function toPublicUrl(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('//')) return `https:${v}`;
  return `${MEDIA_BASE}/${encodePath(v)}`;
}

const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const str = (v: unknown) =>
  v === null || v === undefined ? '' : String(v).trim();
const asDate = (v: unknown): Date | undefined => {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// ─────────────────────────── types ───────────────────────────
interface CnSnapshot {
  metadata: {
    pulledAt: string;
    db: string;
    statusFilter: number | null;
    ipCount: number;
    episodeCount: number;
    memberCount: number;
  };
  dictionaries: {
    types: Record<string, string>;
    roles: Record<string, string>;
  };
  ips: CnIp[];
}
interface CnIp {
  id: string;
  ownerId: string;
  ownerName: string | null;
  ownerAvatarUrl: string | null;
  name: string;
  typeId: string | null;
  tagIds: number[];
  description: string | null;
  background: string | null;
  contact: string | null;
  projectStatus: number;
  createTime: string | null;
  coverUrl: string | null;
  trailerUrl: string | null;
  episodes: CnEpisode[];
  members: CnMember[];
}
interface CnEpisode {
  id: string;
  episodeNo: number;
  title: string;
  introduction: string | null;
  coverUrl: string | null;
  videoUrl: string | null;
  durationSeconds: number | null;
  review: number;
  sort: number | null;
  createTime: string | null;
}
interface CnMember {
  id: string;
  userId: string | null;
  roleId: number | null;
  roleName: string | null;
  displayName: string;
  avatarUrl: string | null;
  remark: string | null;
}

// ─────────────────────────── pull (MySQL → snapshot) ───────────────────────────
async function pull(opts: {
  limit?: number;
  status?: number;
  snapshot: string;
}) {
  const db = process.env.LEGACY_CN_MYSQL_DB || 'fizzdragon_client';
  const conn = await mysql.createConnection({
    host: process.env.LEGACY_CN_MYSQL_HOST,
    port: Number(process.env.LEGACY_CN_MYSQL_PORT || 3306),
    user: process.env.LEGACY_CN_MYSQL_USER,
    password: process.env.LEGACY_CN_MYSQL_PASSWORD,
    database: db,
    connectTimeout: 20000,
  });
  const q = async (sql: string, p?: unknown[]) =>
    (await conn.query(sql, p))[0] as any[];

  const types: Record<string, string> = {};
  for (const r of await q('SELECT id, video_type FROM video_type'))
    types[String(r.id)] = r.video_type;
  const roles: Record<string, string> = {};
  for (const r of await q('SELECT id, role_name FROM auth_role_list'))
    roles[String(r.id)] = r.role_name;

  // user display cache
  const users = new Map<
    string,
    { name: string | null; nick: string | null; avatar: string | null }
  >();
  for (const r of await q(
    'SELECT id, name, nick_name, avatar FROM client_user',
  ))
    users.set(String(r.id), {
      name: r.name,
      nick: r.nick_name,
      avatar: r.avatar,
    });
  const userName = (id: string) => {
    const u = users.get(id);
    return str(u?.name) || str(u?.nick) || '' || null;
  };
  const userAvatar = (id: string) => toPublicUrl(users.get(id)?.avatar);

  const where =
    opts.status != null ? `WHERE project_status = ${opts.status}` : '';
  const limit = opts.limit ? `LIMIT ${opts.limit}` : '';
  const cps = await q(
    `SELECT * FROM client_project ${where} ORDER BY id ${limit}`,
  );

  // batch children
  const epByIp = new Map<string, any[]>();
  for (const v of await q('SELECT * FROM video_list')) {
    const k = String(v.project_id);
    (epByIp.get(k) ?? epByIp.set(k, []).get(k)!)!.push(v);
  }
  const memByIp = new Map<string, any[]>();
  for (const m of await q('SELECT * FROM client_project_ip_member')) {
    const k = String(m.project_id);
    (memByIp.get(k) ?? memByIp.set(k, []).get(k)!)!.push(m);
  }

  const ips: CnIp[] = cps.map((cp) => {
    const id = String(cp.id);
    const ownerId = str(cp.owner_id);
    const tagIds: number[] = Array.isArray(cp.tag)
      ? cp.tag
          .map((x: unknown) => Number(x))
          .filter((x: number) => Number.isFinite(x))
      : [];
    const episodes: CnEpisode[] = (epByIp.get(id) ?? [])
      .sort(
        (a, b) => (Number(a.video_number) || 0) - (Number(b.video_number) || 0),
      )
      .map((v, i) => ({
        id: String(v.id),
        // episode_no MUST be unique per IP (DB constraint); video_number is
        // sometimes null/duplicated, so use 1-based sorted position.
        episodeNo: i + 1,
        title: str(v.title) || `第 ${i + 1} 集`,
        introduction: str(v.introduction) || null,
        coverUrl: toPublicUrl(v.video_banner),
        videoUrl: toPublicUrl(v.video_link),
        durationSeconds: parseDuration(v.videoMeta),
        review: Number(v.review) || 0,
        sort: v.sort == null ? null : Number(v.sort),
        createTime: v.create_time
          ? new Date(v.create_time).toISOString()
          : null,
      }));
    const members: CnMember[] = (memByIp.get(id) ?? []).map((m) => {
      const uid = str(m.user_id) || null;
      return {
        id: String(m.id),
        userId: uid,
        roleId: m.role == null ? null : Number(m.role),
        roleName: m.role != null ? (roles[String(m.role)] ?? null) : null,
        displayName:
          (uid && userName(uid)) ||
          (m.role != null ? roles[String(m.role)] : null) ||
          (uid ? `用户 ${uid}` : '成员'),
        avatarUrl: uid ? userAvatar(uid) : null,
        remark: str(m.remark) || null,
      };
    });
    return {
      id,
      ownerId,
      ownerName: ownerId ? userName(ownerId) : null,
      ownerAvatarUrl: ownerId ? userAvatar(ownerId) : null,
      name: str(cp.name) || `IP ${id}`,
      typeId: cp.type_id == null ? null : String(cp.type_id),
      tagIds,
      description: str(cp.description) || null,
      background: str(cp.background) || null,
      contact: str(cp.contact) || null,
      projectStatus: Number(cp.project_status) || 0,
      createTime: cp.create_time
        ? new Date(cp.create_time).toISOString()
        : null,
      coverUrl: toPublicUrl(cp.banner_link),
      trailerUrl: toPublicUrl(cp.video_link),
      episodes,
      members,
    };
  });

  await conn.end();

  const snapshot: CnSnapshot = {
    metadata: {
      pulledAt: new Date().toISOString(),
      db,
      statusFilter: opts.status ?? null,
      ipCount: ips.length,
      episodeCount: ips.reduce((s, i) => s + i.episodes.length, 0),
      memberCount: ips.reduce((s, i) => s + i.members.length, 0),
    },
    dictionaries: { types, roles },
    ips,
  };
  await mkdir(dirname(opts.snapshot), { recursive: true });
  await writeFile(
    opts.snapshot,
    JSON.stringify(snapshot, null, 2) + '\n',
    'utf8',
  );
  console.log(`[pull] wrote ${opts.snapshot}`);
  printPreview(snapshot);
}

function parseDuration(meta: unknown): number | null {
  if (!meta) return null;
  try {
    const m = typeof meta === 'string' ? JSON.parse(meta) : meta;
    const d = Number((m as any)?.duration);
    // ip_episodes has a duration_positive CHECK; 0/negative → null.
    return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────── preview (no PG) ───────────────────────────
function printPreview(s: CnSnapshot) {
  const byStatus: Record<string, number> = {};
  const byGenre: Record<string, number> = {};
  let missingCover = 0,
    withTrailer = 0,
    withEpisodes = 0;
  for (const ip of s.ips) {
    byStatus[mapStatus(ip.projectStatus)] =
      (byStatus[mapStatus(ip.projectStatus)] ?? 0) + 1;
    const label = ip.typeId ? s.dictionaries.types[ip.typeId] : '';
    if (label)
      byGenre[`${label}→${taxonomyCode('genre', label)}`] =
        (byGenre[`${label}→${taxonomyCode('genre', label)}`] ?? 0) + 1;
    if (!ip.coverUrl) missingCover++;
    if (ip.trailerUrl) withTrailer++;
    if (ip.episodes.length) withEpisodes++;
  }
  console.log('\n================= PULL PREVIEW =================');
  console.log(
    `IPs: ${s.ips.length} | episodes: ${s.metadata.episodeCount} | members: ${s.metadata.memberCount}`,
  );
  console.log('status →', JSON.stringify(byStatus));
  console.log('genre  →', JSON.stringify(byGenre));
  console.log(
    `missing cover: ${missingCover} | with trailer: ${withTrailer} | with episodes: ${withEpisodes}`,
  );
  console.log('\n--- 5 sample IPs (mapped) ---');
  for (const ip of s.ips.slice(0, 5)) {
    console.log(
      `\n• ip=${ip.id} "${ip.name}" status=${ip.projectStatus}→${mapStatus(ip.projectStatus)} owner=${ip.ownerId}(${ip.ownerName})`,
    );
    console.log(`  cover: ${ip.coverUrl}`);
    console.log(
      `  genre: ${ip.typeId}→${ip.typeId ? s.dictionaries.types[ip.typeId] : '-'} | tags: ${ip.tagIds.map((t) => s.dictionaries.types[String(t)] ?? t).join(', ')}`,
    );
    console.log(
      `  episodes: ${ip.episodes.length} | members: ${ip.members.length}`,
    );
  }
  console.log('\n(use `push` to dry-run the PG upsert, then `push --write`)');
}

// ─────────────────────────── push (snapshot → PG) ───────────────────────────
async function push(opts: {
  write: boolean;
  limit?: number;
  snapshot: string;
}) {
  const s = JSON.parse(await readFile(opts.snapshot, 'utf8')) as CnSnapshot;
  const ips = opts.limit ? s.ips.slice(0, opts.limit) : s.ips;
  console.log(
    `[push] ${opts.write ? 'WRITE' : 'DRY-RUN'} ips=${ips.length} snapshot=${opts.snapshot}`,
  );

  if (!opts.write) {
    // dry-run: just show what each IP maps to, no DB.
    for (const ip of ips.slice(0, 10)) {
      const status = mapStatus(ip.projectStatus);
      console.log(
        `  ip=${ip.id} -> ips.id=${legacyUuid('ip', ip.id)} status=${status} title="${clamp(ip.name, 160)}" cover=${ip.coverUrl ? 'yes' : 'no'} eps=${ip.episodes.length} contributors=${ip.members.length + 1}`,
      );
    }
    console.log(
      `  …(${ips.length} total). Re-run with --write against CN PG to apply.`,
    );
    return;
  }

  const { buildPrisma } = await import('../src/infra/db/db.module');
  const prisma: PrismaClient = buildPrisma();
  try {
    const loc = await prisma.supportedLocale.findUnique({
      where: { code: SOURCE_LOCALE },
    });
    if (!loc)
      throw new Error(
        `supported_locales is missing '${SOURCE_LOCALE}' (Ip.source_locale FK is Restrict). Seed it first.`,
      );

    let ok = 0;
    const errors: string[] = [];
    for (const ip of ips) {
      try {
        await upsertIp(prisma, s, ip);
        ok++;
        if (ok % 25 === 0) console.log(`  …${ok}/${ips.length}`);
      } catch (e) {
        errors.push(`ip=${ip.id}: ${(e as Error).message}`);
      }
    }
    console.log(`[push] upserted ${ok}/${ips.length}; errors=${errors.length}`);
    errors.slice(0, 20).forEach((e) => console.log('  ! ' + e));
  } finally {
    await prisma.$disconnect();
  }
}

async function upsertIp(prisma: PrismaClient, s: CnSnapshot, ip: CnIp) {
  const ipId = legacyUuid('ip', ip.id);
  const status = mapStatus(ip.projectStatus);
  const title = clamp(ip.name || `IP ${ip.id}`, 160);
  const summary = clamp(ip.description || ip.background || title, 500);
  const description = ip.background || ip.description || null;
  const createdById = ip.ownerId || IMPORT_USER;

  const coverAssetId = await upsertAsset(prisma, ip.coverUrl, 'image');
  const trailerAssetId = await upsertAsset(prisma, ip.trailerUrl, 'video');

  await prisma.ip.upsert({
    where: { id: ipId },
    update: {
      status,
      listingVisibility: status === 'published' ? 'public' : 'private',
      sourceLocale: SOURCE_LOCALE,
      coverAssetId,
      trailerAssetId,
      updatedById: IMPORT_USER,
    },
    create: {
      id: ipId,
      status,
      listingVisibility: status === 'published' ? 'public' : 'private',
      sourceLocale: SOURCE_LOCALE,
      coverAssetId,
      trailerAssetId,
      createdById,
      updatedById: IMPORT_USER,
      createdAt: asDate(ip.createTime),
    },
  });
  await prisma.ipLocalization.upsert({
    where: { ipId_locale: { ipId, locale: SOURCE_LOCALE } },
    update: {
      title,
      summary,
      description,
      status: status === 'published' ? 'published' : 'draft',
    },
    create: {
      id: legacyUuid('ip-localization', `${ip.id}:${SOURCE_LOCALE}`),
      ipId,
      locale: SOURCE_LOCALE,
      title,
      summary,
      description,
      status: status === 'published' ? 'published' : 'draft',
      publishedAt: status === 'published' ? new Date() : undefined,
    },
  });

  // taxonomy: genre (from typeId) + tags (from tagIds)
  const genreLabels =
    ip.typeId && s.dictionaries.types[ip.typeId]
      ? [s.dictionaries.types[ip.typeId]]
      : [];
  const tagLabels = ip.tagIds
    .map((t) => s.dictionaries.types[String(t)])
    .filter(Boolean) as string[];
  await replaceTaxonomy(prisma, ipId, 'genre', genreLabels);
  await replaceTaxonomy(prisma, ipId, 'tag', tagLabels);

  // episodes
  for (const ep of ip.episodes) {
    const episodeId = legacyUuid('episode', ep.id);
    const epStatus = mapStatus(ep.review);
    const cover = await upsertAsset(prisma, ep.coverUrl, 'image');
    const media = await upsertAsset(
      prisma,
      ep.videoUrl,
      'video',
      ep.durationSeconds,
    );
    await prisma.ipEpisode.upsert({
      where: { id: episodeId },
      update: {
        episodeNo: ep.episodeNo,
        sortOrder: ep.episodeNo,
        status: epStatus,
        durationSeconds: ep.durationSeconds ?? undefined,
        coverAssetId: cover,
        mediaAssetId: media,
        updatedById: IMPORT_USER,
      },
      create: {
        id: episodeId,
        ipId,
        episodeNo: ep.episodeNo,
        sortOrder: ep.episodeNo,
        status: epStatus,
        durationSeconds: ep.durationSeconds ?? undefined,
        coverAssetId: cover,
        mediaAssetId: media,
        createdById: IMPORT_USER,
        updatedById: IMPORT_USER,
        createdAt: asDate(ep.createTime),
      },
    });
    const epTitle = clamp(ep.title, 160);
    await prisma.ipEpisodeLocalization.upsert({
      where: { episodeId_locale: { episodeId, locale: SOURCE_LOCALE } },
      update: {
        title: epTitle,
        summary: ep.introduction,
        status: epStatus === 'published' ? 'published' : 'draft',
      },
      create: {
        id: legacyUuid('episode-localization', `${ep.id}:${SOURCE_LOCALE}`),
        episodeId,
        locale: SOURCE_LOCALE,
        title: epTitle,
        summary: ep.introduction,
        status: epStatus === 'published' ? 'published' : 'draft',
        publishedAt: epStatus === 'published' ? new Date() : undefined,
      },
    });
  }

  // contributors: owner first, then members (dedup by userId)
  const seen = new Set<string>();
  const contributors: Array<{
    key: string;
    userId: string | null;
    displayName: string;
    role: string;
    customRole: string | null;
    avatar: string | null;
  }> = [];
  if (ip.ownerId)
    contributors.push({
      key: ip.ownerId,
      userId: ip.ownerId,
      displayName: ip.ownerName || `用户 ${ip.ownerId}`,
      role: 'owner',
      customRole: null,
      avatar: ip.ownerAvatarUrl,
    });
  for (const m of ip.members) {
    const key = m.userId || `m${m.id}`;
    contributors.push({
      key,
      userId: m.userId,
      displayName: m.displayName,
      role: mapRole(m.roleId),
      customRole: m.roleName,
      avatar: m.avatarUrl,
    });
  }
  let order = 0;
  for (const c of contributors) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    const cid = legacyUuid('contributor', `${ip.id}:${c.key}`);
    await prisma.ipContributor.upsert({
      where: { id: cid },
      update: {
        displayName: clamp(c.displayName, 120),
        role: c.role as any,
        customRole: c.customRole ? clamp(c.customRole, 80) : null,
        displayOrder: order,
        removedAt: null,
      },
      create: {
        id: cid,
        ipId,
        userId: c.userId,
        displayName: clamp(c.displayName, 120),
        role: c.role as any,
        customRole: c.customRole ? clamp(c.customRole, 80) : null,
        displayOrder: order,
        metadata: c.avatar ? { legacyAvatar: c.avatar } : {},
      },
    });
    order++;
  }
}

// MediaAsset is keyed by its URL (one OSS object = one row, shared across IPs
// that reference it). external_url carries a global unique constraint, so a
// per-IP-per-purpose id would collide when two IPs share a cover/video.
async function upsertAsset(
  prisma: PrismaClient,
  url: string | null,
  kind: 'image' | 'video',
  durationSeconds?: number | null,
): Promise<string | null> {
  if (!url) return null;
  const id = legacyUuid('media', url);
  await prisma.mediaAsset.upsert({
    where: { id },
    update: {
      kind,
      storageProvider: 'external_url',
      externalUrl: url,
      objectKey: null,
      bucket: null,
      region: null,
      contentType: kind === 'image' ? 'image/jpeg' : 'video/mp4',
      durationSeconds: durationSeconds ?? undefined,
      visibility: 'public',
      status: 'ready',
      source: 'imported',
    },
    create: {
      id,
      kind,
      storageProvider: 'external_url',
      externalUrl: url,
      contentType: kind === 'image' ? 'image/jpeg' : 'video/mp4',
      durationSeconds: durationSeconds ?? undefined,
      visibility: 'public',
      status: 'ready',
      source: 'imported',
    },
  });
  return id;
}

async function replaceTaxonomy(
  prisma: PrismaClient,
  ipId: string,
  type: 'genre' | 'tag',
  labels: string[],
) {
  const uniq = [
    ...new Set(labels.map((l) => clamp(l.trim(), 80)).filter(Boolean)),
  ];
  const termIds: string[] = [];
  for (const [i, label] of uniq.entries()) {
    const code = taxonomyCode(type, label);
    const term = await prisma.ipTaxonomyTerm.upsert({
      where: { type_code: { type, code } },
      update: { status: 'active', archivedAt: null },
      create: {
        id: legacyUuid('taxonomy-term', `${type}:${code}`),
        type,
        code,
        status: 'active',
        displayOrder: type === 'tag' ? 1000 + i : i,
        metadata: { legacyLabel: label },
        createdById: IMPORT_USER,
      },
    });
    await prisma.ipTaxonomyTermLocalization.upsert({
      where: { termId_locale: { termId: term.id, locale: SOURCE_LOCALE } },
      update: { label },
      create: {
        id: legacyUuid(
          'taxonomy-localization',
          `${type}:${code}:${SOURCE_LOCALE}`,
        ),
        termId: term.id,
        locale: SOURCE_LOCALE,
        label,
      },
    });
    termIds.push(term.id);
  }
  const existing = await prisma.ipTaxonomyAssignment.findMany({
    where: { ipId, term: { is: { type } } },
    select: { id: true },
  });
  if (existing.length)
    await prisma.ipTaxonomyAssignment.deleteMany({
      where: { id: { in: existing.map((e) => e.id) } },
    });
  if (termIds.length)
    await prisma.ipTaxonomyAssignment.createMany({
      data: termIds.map((termId, i) => ({
        id: legacyUuid('taxonomy-assignment', `${ipId}:${type}:${termId}`),
        ipId,
        termId,
        source: 'migration' as const,
        displayOrder: type === 'tag' ? 1000 + i : i,
        createdById: IMPORT_USER,
      })),
      skipDuplicates: true,
    });
}

// ─────────────────────────── CLI ───────────────────────────
function parseArgs(argv: string[]) {
  const command = argv[0];
  const o: {
    command?: string;
    write: boolean;
    limit?: number;
    status?: number;
    snapshot: string;
  } = { command, write: false, snapshot: DEFAULT_SNAPSHOT };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') o.write = true;
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--status') o.status = Number(argv[++i]);
    else if (a === '--snapshot') o.snapshot = resolve(repoRoot, argv[++i]);
  }
  return o;
}
async function checkPg() {
  const { buildPrisma } = await import('../src/infra/db/db.module');
  const prisma: PrismaClient = buildPrisma();
  try {
    const [ips, locs, eps, contribs, media, zh] = await Promise.all([
      prisma.ip.count(),
      prisma.supportedLocale.count(),
      prisma.ipEpisode.count(),
      prisma.ipContributor.count(),
      prisma.mediaAsset.count(),
      prisma.supportedLocale.findUnique({ where: { code: SOURCE_LOCALE } }),
    ]);
    console.log(
      `[check-pg] CONNECTED. ips=${ips} ip_episodes=${eps} ip_contributors=${contribs} media_assets=${media} supported_locales=${locs}`,
    );
    console.log(
      `[check-pg] '${SOURCE_LOCALE}' present: ${zh ? 'YES' : 'NO (must seed before push)'}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
// Clears import-owned rows so a re-run starts clean. Safe only because the
// ip-commerce target was verified EMPTY before the first write.
async function reset() {
  const { buildPrisma } = await import('../src/infra/db/db.module');
  const prisma: PrismaClient = buildPrisma();
  try {
    const ip = await prisma.ip.deleteMany({}); // cascades localizations/episodes/contributors/assignments
    const tt = await prisma.ipTaxonomyTerm.deleteMany({
      where: { createdById: IMPORT_USER },
    }); // cascades term localizations
    const m = await prisma.mediaAsset.deleteMany({
      where: { source: 'imported' },
    });
    console.log(
      `[reset] ips=${ip.count} taxonomyTerms=${tt.count} media(imported)=${m.count}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
// Counts rows matching the live public-feed filter (PUBLIC_IP_STATUSES +
// listingVisibility=public + a published localization) — should equal 69.
async function verify() {
  const { buildPrisma } = await import('../src/infra/db/db.module');
  const prisma: PrismaClient = buildPrisma();
  try {
    const byStatus = await prisma.ip.groupBy({ by: ['status'], _count: true });
    console.log(
      '[verify] ips by status:',
      JSON.stringify(byStatus.map((s) => ({ [s.status]: s._count }))),
    );
    const publicCount = await prisma.ip.count({
      where: {
        deletedAt: null,
        status: { in: ['scheduled', 'published'] as any },
        listingVisibility: 'public',
        localizations: { some: { archivedAt: null, status: 'published' } },
      },
    });
    console.log(
      `[verify] PUBLIC-eligible IPs (== plaza count): ${publicCount}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.command === 'verify') return verify();
  if (o.command === 'pull') return pull(o);
  if (o.command === 'push') return push(o);
  if (o.command === 'check-pg') return checkPg();
  if (o.command === 'reset') return reset();
  console.log(`Usage:
  tsx scripts/ip-cn-migration.ts pull  [--status 5] [--limit N] [--snapshot path]   # MySQL -> snapshot (read-only)
  tsx scripts/ip-cn-migration.ts push  [--limit N] [--write]                        # snapshot -> PG (dry-run unless --write)`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});
