import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { buildPrisma } from '../src/infra/db/db.module';

type Command = 'export' | 'inspect' | 'import-local' | 'help';

interface CliOptions {
  command: Command;
  out: string;
  snapshot?: string;
  pageSize: number;
  limit?: number;
  includeFaq: boolean;
  includeAdminVideos: boolean;
  write: boolean;
}

interface JavaEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
  id?: number;
}

interface LegacyProjectListRow {
  id?: number | string | null;
  projectId?: number | string | null;
  ownerId?: number | string | null;
  ownerName?: string | null;
  ownerAvatar?: string | null;
  name?: string | null;
  typeId?: number | string | null;
  bannerLink?: string | null;
  videoLink?: string | null;
  description?: string | null;
  createTime?: string | null;
  review?: number | string | null;
  status?: number | string | null;
  projectStatus?: number | string | null;
  viewStatus?: number | string | null;
  contact?: string | null;
  tag?: string | null;
  background?: string | null;
  [key: string]: unknown;
}

interface LegacyProjectDetail extends LegacyProjectListRow {
  projectStatus?: number | string | null;
}

interface LegacyEpisode {
  id?: number | string | null;
  projectId?: number | string | null;
  title?: string | null;
  introduction?: string | null;
  description?: string | null;
  videoLink?: string | null;
  videoBanner?: string | null;
  duration?: number | string | null;
  videoNumber?: number | string | null;
  sort?: number | string | null;
  videometa?: string | null;
  createTime?: string | null;
  [key: string]: unknown;
}

interface LegacyMember {
  id?: number | string | null;
  userId?: number | string | null;
  userName?: string | null;
  nickName?: string | null;
  avatar?: string | null;
  role?: number | string | null;
  roleId?: number | string | null;
  roleName?: string | null;
  remark?: string | null;
  createTime?: string | null;
  user?: {
    id?: number | string | null;
    name?: string | null;
    nickName?: string | null;
    avatar?: string | null;
    contact?: string | null;
  } | null;
  [key: string]: unknown;
}

interface LegacyFaq {
  faqId?: number | string | null;
  id?: number | string | null;
  projectId?: number | string | null;
  question?: string | null;
  answer?: string | null;
  sort?: number | string | null;
  [key: string]: unknown;
}

interface LegacyIpBundle {
  legacyProjectId: string;
  listRow: LegacyProjectListRow;
  detail: LegacyProjectDetail | null;
  episodes: LegacyEpisode[];
  members: LegacyMember[];
  faqs?: LegacyFaq[];
  errors: string[];
}

interface LegacySnapshot {
  metadata: {
    exportedAt: string;
    adminBaseUrl: string;
    contentBaseUrl: string;
    includeFaq: boolean;
    includeAdminVideos: boolean;
    projectCount: number;
    episodeCount: number;
    memberCount: number;
    faqCount: number;
    errors: string[];
  };
  dictionaries: {
    types: Record<string, string>;
    tags: Record<string, string>;
  };
  projects: LegacyIpBundle[];
  adminVideos?: unknown[];
}

const DEFAULT_OUT = 'outputs/ip-legacy-migration/snapshot.json';
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

loadLocalEnv();

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') {
    printHelp();
    return;
  }

  if (options.command === 'export') {
    await exportSnapshot(options);
    return;
  }

  if (options.command === 'inspect') {
    await inspectSnapshot(options.snapshot ?? options.out);
    return;
  }

  if (options.command === 'import-local') {
    await importLocal(options.snapshot ?? options.out, options);
  }
}

function parseArgs(args: string[]): CliOptions {
  const command = (args[0] ?? 'help') as Command;
  const options: CliOptions = {
    command: ['export', 'inspect', 'import-local'].includes(command)
      ? command
      : 'help',
    out: resolve(repoRoot, DEFAULT_OUT),
    pageSize: 100,
    includeFaq: false,
    includeAdminVideos: false,
    write: false,
  };

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--out' && next) {
      options.out = resolve(repoRoot, next);
      i += 1;
    } else if (arg === '--snapshot' && next) {
      options.snapshot = resolve(repoRoot, next);
      i += 1;
    } else if (arg === '--page-size' && next) {
      options.pageSize = Math.max(1, Number(next) || options.pageSize);
      i += 1;
    } else if (arg === '--limit' && next) {
      options.limit = Math.max(1, Number(next) || 1);
      i += 1;
    } else if (arg === '--include-faq') {
      options.includeFaq = true;
    } else if (arg === '--include-admin-videos') {
      options.includeAdminVideos = true;
    } else if (arg === '--write') {
      options.write = true;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Usage:
  npm --workspace server exec -- tsx scripts/ip-legacy-migration.ts export [--out outputs/ip-legacy-migration/snapshot.json] [--limit 20]
  npm --workspace server exec -- tsx scripts/ip-legacy-migration.ts inspect --snapshot outputs/ip-legacy-migration/snapshot.json
  npm --workspace server exec -- tsx scripts/ip-legacy-migration.ts import-local --snapshot outputs/ip-legacy-migration/snapshot.json [--write]

Required env for export:
  LEGACY_ADMIN_BEARER       Bearer token value, without "Bearer "
  LEGACY_ADMIN_COOKIE       Raw Cookie header copied from admin browser

Optional env:
  LEGACY_ADMIN_BASE_URL     Default: https://admin.fizzdragon.com
  LEGACY_CONTENT_BASE_URL   Default: https://fizzdragon.com/content
  LEGACY_OSS_BUCKET         Optional bucket name stored on imported MediaAsset rows
  LEGACY_OSS_REGION         Optional region stored on imported MediaAsset rows
  LEGACY_SOURCE_LOCALE      Default: zh-CN
  LEGACY_IMPORT_USER_ID     Default: legacy-java-import

Env file:
  The script auto-loads apps/server/.env.legacy.local when present.
  Override with LEGACY_ENV_FILE=/absolute/path/to/file.

Safety:
  export and inspect never write database rows.
  import-local is dry-run unless --write is passed.
`);
}

function loadLocalEnv(): void {
  const defaultEnvFile = resolve(repoRoot, 'apps/server/.env.legacy.local');
  const envFile = process.env.LEGACY_ENV_FILE
    ? resolve(repoRoot, process.env.LEGACY_ENV_FILE)
    : defaultEnvFile;
  if (existsSync(envFile)) {
    loadDotenv({ path: envFile, override: false });
  }
}

async function exportSnapshot(options: CliOptions): Promise<void> {
  const adminBaseUrl = env(
    'LEGACY_ADMIN_BASE_URL',
    'https://admin.fizzdragon.com',
  );
  const contentBaseUrl = env(
    'LEGACY_CONTENT_BASE_URL',
    'https://fizzdragon.com/content',
  );
  const auth = buildAuthHeaders();
  const errors: string[] = [];

  const dictionaries = {
    types: await tryFetchDictionary(
      contentBaseUrl,
      '/vedio/type/list',
      auth,
      errors,
    ),
    tags: await tryFetchTagDictionary(contentBaseUrl, auth, errors),
  };

  const projectRows = await fetchPagedAdminList<LegacyProjectListRow>({
    baseUrl: adminBaseUrl,
    path: '/admin/data/project/list',
    pageSize: options.pageSize,
    auth,
    errors,
    query: { status: '' },
  });
  const limitedRows = options.limit
    ? projectRows.slice(0, options.limit)
    : projectRows;

  const adminVideos = options.includeAdminVideos
    ? await fetchPagedAdminList<LegacyEpisode>({
        baseUrl: adminBaseUrl,
        path: '/admin/data/video/list',
        pageSize: options.pageSize,
        auth,
        errors,
        query: { status: '', videoType: '', start: '', end: '' },
      })
    : undefined;
  const adminVideosByProject = groupByProjectId(adminVideos ?? []);

  const projects: LegacyIpBundle[] = [];
  for (const [index, row] of limitedRows.entries()) {
    const legacyProjectId = stringId(row.projectId ?? row.id);
    if (!legacyProjectId) {
      errors.push(`project row ${index + 1}: missing project id`);
      continue;
    }

    const bundleErrors: string[] = [];
    const adminProjectVideos = adminVideosByProject.get(legacyProjectId) ?? [];
    const [detail, episodes, members, faqs] = await Promise.all([
      safeFetchProjectDetail(
        contentBaseUrl,
        legacyProjectId,
        auth,
        bundleErrors,
      ),
      adminVideos
        ? Promise.resolve(adminProjectVideos)
        : safeFetchEpisodes(
            contentBaseUrl,
            legacyProjectId,
            auth,
            bundleErrors,
          ),
      safeFetchMembers(contentBaseUrl, legacyProjectId, auth, bundleErrors),
      options.includeFaq
        ? safeFetchFaqs(contentBaseUrl, legacyProjectId, auth, bundleErrors)
        : Promise.resolve(undefined),
    ]);

    projects.push({
      legacyProjectId,
      listRow: row,
      detail,
      episodes,
      members,
      ...(faqs ? { faqs } : {}),
      errors: bundleErrors,
    });

    console.log(
      `[export] ${projects.length}/${limitedRows.length} project=${legacyProjectId} episodes=${episodes.length} members=${members.length}`,
    );
  }

  const snapshot: LegacySnapshot = {
    metadata: {
      exportedAt: new Date().toISOString(),
      adminBaseUrl,
      contentBaseUrl,
      includeFaq: options.includeFaq,
      includeAdminVideos: options.includeAdminVideos,
      projectCount: projects.length,
      episodeCount: projects.reduce((sum, p) => sum + p.episodes.length, 0),
      memberCount: projects.reduce((sum, p) => sum + p.members.length, 0),
      faqCount: projects.reduce((sum, p) => sum + (p.faqs?.length ?? 0), 0),
      errors,
    },
    dictionaries,
    projects,
  };

  if (adminVideos) snapshot.adminVideos = adminVideos;

  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(
    options.out,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
  console.log(`[export] wrote ${options.out}`);
  await inspectSnapshot(options.out);
}

async function inspectSnapshot(path: string): Promise<void> {
  const snapshot = await readSnapshot(path);
  const missingDetail = snapshot.projects.filter((p) => !p.detail).length;
  const missingCover = snapshot.projects.filter(
    (p) => !firstString(p.detail ?? p.listRow, ['bannerLink']),
  ).length;
  const missingTrailer = snapshot.projects.filter(
    (p) => !firstString(p.detail ?? p.listRow, ['videoLink']),
  ).length;
  const noEpisodes = snapshot.projects.filter(
    (p) => p.episodes.length === 0,
  ).length;
  const projectErrors = snapshot.projects.flatMap((p) =>
    p.errors.map((error) => `${p.legacyProjectId}: ${error}`),
  );
  const typeCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const project of snapshot.projects) {
    const detail = project.detail ?? project.listRow;
    const typeId = stringId(detail.typeId);
    const typeName = typeId ? snapshot.dictionaries.types[typeId] : '';
    const typeKey = typeName || typeId || '(empty)';
    typeCounts.set(typeKey, (typeCounts.get(typeKey) ?? 0) + 1);
    for (const tag of parseLegacyTagNames(
      detail.tag,
      snapshot.dictionaries.tags,
    )) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const report = [
    '# IP Legacy Migration Inspection',
    '',
    `- Snapshot: ${path}`,
    `- Exported at: ${snapshot.metadata.exportedAt}`,
    `- Projects: ${snapshot.projects.length}`,
    `- Episodes: ${snapshot.metadata.episodeCount}`,
    `- Members: ${snapshot.metadata.memberCount}`,
    `- Missing detail: ${missingDetail}`,
    `- Missing cover: ${missingCover}`,
    `- Missing trailer: ${missingTrailer}`,
    `- Projects without episodes: ${noEpisodes}`,
    `- Export errors: ${snapshot.metadata.errors.length + projectErrors.length}`,
    '',
    '## Top Legacy Types',
    ...topEntries(typeCounts).map(([name, count]) => `- ${name}: ${count}`),
    '',
    '## Top Legacy Tags',
    ...topEntries(tagCounts).map(([name, count]) => `- ${name}: ${count}`),
    '',
    '## Errors',
    ...(snapshot.metadata.errors.length || projectErrors.length
      ? [...snapshot.metadata.errors, ...projectErrors].map(
          (error) => `- ${error}`,
        )
      : ['- none']),
    '',
  ].join('\n');

  const reportPath = path.replace(/\.json$/i, '.inspection.md');
  await writeFile(reportPath, report, 'utf8');
  console.log(report);
  console.log(`[inspect] wrote ${reportPath}`);
}

async function importLocal(path: string, options: CliOptions): Promise<void> {
  const snapshot = await readSnapshot(path);
  const prisma: PrismaClient = buildPrisma();
  const sourceLocale = env('LEGACY_SOURCE_LOCALE', 'zh-CN');
  const importUserId = env('LEGACY_IMPORT_USER_ID', 'legacy-java-import');
  const rows = options.limit
    ? snapshot.projects.slice(0, options.limit)
    : snapshot.projects;

  console.log(
    `[import-local] ${options.write ? 'WRITE' : 'DRY-RUN'} projects=${rows.length} source=${path}`,
  );

  try {
    for (const project of rows) {
      const detail = project.detail ?? project.listRow;
      const legacyProjectId = project.legacyProjectId;
      const ipId = legacyUuid('ip', legacyProjectId);
      const title = requiredText(detail.name, `IP ${legacyProjectId}`);
      const summary = clamp(
        firstString(detail, ['description', 'background']) || title,
        500,
      );
      const description = firstString(detail, ['background', 'description']);
      const createdById = stringId(detail.ownerId) || importUserId;
      const typeId = stringId(detail.typeId);
      const typeName = typeId ? snapshot.dictionaries.types[typeId] : '';
      const tags = unique([
        ...(typeName ? [typeName] : []),
        ...parseLegacyTagNames(detail.tag, snapshot.dictionaries.tags),
      ]);
      const status = mapPublicationStatus(detail, project.listRow);
      const coverAssetId = await maybeUpsertAsset({
        prisma,
        id: legacyUuid('project-cover', legacyProjectId),
        raw: firstString(detail, ['bannerLink']),
        kind: 'image',
        write: options.write,
      });
      const trailerAssetId = await maybeUpsertAsset({
        prisma,
        id: legacyUuid('project-trailer', legacyProjectId),
        raw: firstString(detail, ['videoLink']),
        kind: 'video',
        write: options.write,
      });

      if (options.write) {
        await prisma.ip.upsert({
          where: { id: ipId },
          update: {
            ipType: mapIpType(typeName),
            status,
            listingVisibility: status === 'published' ? 'public' : 'private',
            sourceLocale,
            coverAssetId,
            trailerAssetId,
            updatedById: importUserId,
          },
          create: {
            id: ipId,
            ipType: mapIpType(typeName),
            status,
            listingVisibility: status === 'published' ? 'public' : 'private',
            sourceLocale,
            coverAssetId,
            trailerAssetId,
            createdById,
            updatedById: importUserId,
            createdAt: parseDate(detail.createTime) ?? undefined,
          },
        });

        await prisma.ipLocalization.upsert({
          where: {
            ipId_locale: {
              ipId,
              locale: sourceLocale,
            },
          },
          update: {
            title,
            summary,
            description,
            genres: typeName ? [typeName] : [],
            tags,
            status: status === 'published' ? 'published' : 'draft',
          },
          create: {
            id: legacyUuid(
              'ip-localization',
              `${legacyProjectId}:${sourceLocale}`,
            ),
            ipId,
            locale: sourceLocale,
            title,
            summary,
            description,
            genres: typeName ? [typeName] : [],
            tags,
            status: status === 'published' ? 'published' : 'draft',
            publishedAt: status === 'published' ? new Date() : undefined,
          },
        });
      }

      await importEpisodes({
        prisma,
        write: options.write,
        ipId,
        sourceLocale,
        importUserId,
        legacyProjectId,
        episodes: project.episodes,
      });
      await importContributors({
        prisma,
        write: options.write,
        ipId,
        legacyProjectId,
        importUserId,
        owner: detail,
        members: project.members,
      });

      console.log(
        `[import-local] ${options.write ? 'upserted' : 'checked'} project=${legacyProjectId} ip=${ipId}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function importEpisodes(input: {
  prisma: PrismaClient;
  write: boolean;
  ipId: string;
  sourceLocale: string;
  importUserId: string;
  legacyProjectId: string;
  episodes: LegacyEpisode[];
}): Promise<void> {
  const sorted = [...input.episodes].sort(
    (a, b) => numberValue(a.videoNumber) - numberValue(b.videoNumber),
  );
  for (const [index, episode] of sorted.entries()) {
    const legacyEpisodeId =
      stringId(episode.id) || `${input.legacyProjectId}:${index + 1}`;
    const episodeId = legacyUuid('episode', legacyEpisodeId);
    const episodeNo = numberValue(episode.videoNumber) || index + 1;
    const title = requiredText(episode.title, `Episode ${episodeNo}`);
    const summary = clamp(
      firstString(episode, ['introduction', 'description']) || title,
      500,
    );
    const durationSeconds = parseDurationSeconds(episode);
    const coverAssetId = await maybeUpsertAsset({
      prisma: input.prisma,
      id: legacyUuid('episode-cover', legacyEpisodeId),
      raw: firstString(episode, ['videoBanner']),
      kind: 'image',
      write: input.write,
    });
    const mediaAssetId = await maybeUpsertAsset({
      prisma: input.prisma,
      id: legacyUuid('episode-media', legacyEpisodeId),
      raw: firstString(episode, ['videoLink']),
      kind: 'video',
      durationSeconds,
      write: input.write,
    });

    if (!input.write) continue;
    await input.prisma.ipEpisode.upsert({
      where: { id: episodeId },
      update: {
        episodeNo,
        sortOrder: episodeNo,
        status: 'published',
        durationSeconds,
        coverAssetId,
        mediaAssetId,
        updatedById: input.importUserId,
      },
      create: {
        id: episodeId,
        ipId: input.ipId,
        episodeNo,
        sortOrder: episodeNo,
        status: 'published',
        durationSeconds,
        coverAssetId,
        mediaAssetId,
        createdById: input.importUserId,
        updatedById: input.importUserId,
        createdAt: parseDate(episode.createTime) ?? undefined,
      },
    });
    await input.prisma.ipEpisodeLocalization.upsert({
      where: {
        episodeId_locale: {
          episodeId,
          locale: input.sourceLocale,
        },
      },
      update: {
        title,
        summary,
        description: firstString(episode, ['introduction', 'description']),
        status: 'published',
      },
      create: {
        id: legacyUuid(
          'episode-localization',
          `${legacyEpisodeId}:${input.sourceLocale}`,
        ),
        episodeId,
        locale: input.sourceLocale,
        title,
        summary,
        description: firstString(episode, ['introduction', 'description']),
        status: 'published',
        publishedAt: new Date(),
      },
    });
  }
}

async function importContributors(input: {
  prisma: PrismaClient;
  write: boolean;
  ipId: string;
  legacyProjectId: string;
  importUserId: string;
  owner: LegacyProjectDetail | LegacyProjectListRow;
  members: LegacyMember[];
}): Promise<void> {
  const contributors = input.members.length
    ? input.members
    : [
        {
          userId: input.owner.ownerId,
          userName: input.owner.ownerName,
          role: 10,
          roleName: 'Owner',
          avatar: input.owner.ownerAvatar,
        } satisfies LegacyMember,
      ];
  const seen = new Set<string>();

  for (const [index, member] of contributors.entries()) {
    const user = member.user ?? null;
    const userId = stringId(member.userId ?? user?.id);
    const displayName =
      firstString(user ?? {}, ['name', 'nickName']) ||
      firstString(member, ['userName', 'nickName', 'roleName', 'remark']) ||
      (userId ? `User ${userId}` : 'Creator');
    const key = userId || `${displayName}:${index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!input.write) continue;
    await input.prisma.ipContributor.upsert({
      where: {
        id: legacyUuid('contributor', `${input.legacyProjectId}:${key}`),
      },
      update: {
        displayName,
        role: mapContributorRole(member),
        customRole: firstString(member, ['roleName', 'remark']),
        displayOrder: index,
        removedAt: null,
      },
      create: {
        id: legacyUuid('contributor', `${input.legacyProjectId}:${key}`),
        ipId: input.ipId,
        userId,
        displayName,
        role: mapContributorRole(member),
        customRole: firstString(member, ['roleName', 'remark']),
        displayOrder: index,
        metadata: {
          legacyAvatar:
            firstString(user ?? {}, ['avatar']) ||
            firstString(member, ['avatar']),
        },
      },
    });
  }
}

async function maybeUpsertAsset(input: {
  prisma: PrismaClient;
  id: string;
  raw?: string;
  kind: 'image' | 'video';
  durationSeconds?: number | null;
  write: boolean;
}): Promise<string | null> {
  const raw = input.raw?.trim();
  if (!raw) return null;
  if (!input.write) return input.id;
  const isExternal = /^https?:\/\//i.test(raw);
  await input.prisma.mediaAsset.upsert({
    where: { id: input.id },
    update: {
      kind: input.kind,
      storageProvider: isExternal ? 'external_url' : 'aliyun_oss',
      externalUrl: isExternal ? raw : null,
      objectKey: isExternal ? null : trimLeadingSlash(raw),
      bucket: isExternal ? null : env('LEGACY_OSS_BUCKET', undefined),
      region: isExternal ? null : env('LEGACY_OSS_REGION', undefined),
      contentType: input.kind === 'image' ? 'image/jpeg' : 'video/mp4',
      durationSeconds: input.durationSeconds ?? undefined,
      visibility: 'public',
      status: 'ready',
    },
    create: {
      id: input.id,
      kind: input.kind,
      storageProvider: isExternal ? 'external_url' : 'aliyun_oss',
      externalUrl: isExternal ? raw : null,
      objectKey: isExternal ? null : trimLeadingSlash(raw),
      bucket: isExternal ? null : env('LEGACY_OSS_BUCKET', undefined),
      region: isExternal ? null : env('LEGACY_OSS_REGION', undefined),
      contentType: input.kind === 'image' ? 'image/jpeg' : 'video/mp4',
      durationSeconds: input.durationSeconds ?? undefined,
      visibility: 'public',
      status: 'ready',
    },
  });
  return input.id;
}

function buildAuthHeaders(): HeadersInit {
  const bearer =
    process.env.LEGACY_ADMIN_BEARER ?? process.env.LEGACY_ADMIN_TOKEN;
  const cookie = process.env.LEGACY_ADMIN_COOKIE;
  if (!bearer) {
    throw new Error(
      'Missing LEGACY_ADMIN_BEARER. Put the production token in local env, not in git.',
    );
  }
  if (!cookie) {
    throw new Error(
      'Missing LEGACY_ADMIN_COOKIE. Put the copied Cookie header in local env, not in git.',
    );
  }
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Authorization: `Bearer ${bearer}`,
    Cookie: cookie,
  };
}

async function fetchPagedAdminList<T>(input: {
  baseUrl: string;
  path: string;
  pageSize: number;
  auth: HeadersInit;
  errors: string[];
  query: Record<string, string>;
}): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  for (let page = 1; ; page += 1) {
    const url = new URL(input.path, input.baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(input.pageSize));
    for (const [key, value] of Object.entries(input.query))
      url.searchParams.set(key, value);
    const json = await requestJson<JavaEnvelope<unknown>>(url, {
      method: 'POST',
      headers: input.auth,
    });
    const pageData = extractRows<T>(json.data ?? json);
    rows.push(...pageData.rows);
    total = pageData.total ?? total;
    console.log(
      `[fetch] ${input.path} page=${page} rows=${pageData.rows.length} total=${total ?? '?'}`,
    );
    if (pageData.rows.length === 0) break;
    if (total != null && rows.length >= total) break;
    if (page > 10_000) {
      input.errors.push(`${input.path}: stopped after 10000 pages`);
      break;
    }
  }
  return rows;
}

async function tryFetchDictionary(
  baseUrl: string,
  path: string,
  auth: HeadersInit,
  errors: string[],
): Promise<Record<string, string>> {
  try {
    const json = await requestJson<JavaEnvelope<Record<string, string>>>(
      new URL(path, baseUrl),
      {
        method: 'GET',
        headers: auth,
      },
    );
    return normalizeDictionary(json.data);
  } catch (error) {
    errors.push(`${path}: ${message(error)}`);
    return {};
  }
}

async function tryFetchTagDictionary(
  baseUrl: string,
  auth: HeadersInit,
  errors: string[],
): Promise<Record<string, string>> {
  try {
    const json = await requestJson<JavaEnvelope<unknown>>(
      new URL('/vedio/type/tag/list', baseUrl),
      {
        method: 'GET',
        headers: auth,
      },
    );
    const data = json.data;
    if (data && typeof data === 'object' && 'all' in data) {
      return normalizeDictionary((data as { all?: unknown }).all);
    }
    return normalizeDictionary(data);
  } catch (error) {
    errors.push(`/vedio/type/tag/list: ${message(error)}`);
    return {};
  }
}

async function safeFetchProjectDetail(
  baseUrl: string,
  projectId: string,
  auth: HeadersInit,
  errors: string[],
): Promise<LegacyProjectDetail | null> {
  try {
    const json = await postForm<LegacyProjectDetail>(
      baseUrl,
      '/project/query',
      { projectId },
      auth,
    );
    return json ?? null;
  } catch (error) {
    errors.push(`/project/query: ${message(error)}`);
    return null;
  }
}

async function safeFetchEpisodes(
  baseUrl: string,
  projectId: string,
  auth: HeadersInit,
  errors: string[],
): Promise<LegacyEpisode[]> {
  try {
    const url = new URL('/vedio/video/list', baseUrl);
    url.searchParams.set('projectId', projectId);
    const json = await requestJson<
      JavaEnvelope<LegacyEpisode[] | { list?: LegacyEpisode[] }>
    >(url, {
      method: 'POST',
      headers: auth,
    });
    return extractRows<LegacyEpisode>(json.data).rows;
  } catch (error) {
    errors.push(`/vedio/video/list: ${message(error)}`);
    return [];
  }
}

function groupByProjectId(
  episodes: LegacyEpisode[],
): Map<string, LegacyEpisode[]> {
  const grouped = new Map<string, LegacyEpisode[]>();
  for (const episode of episodes) {
    const projectId = stringId(episode.projectId);
    if (!projectId) continue;
    const rows = grouped.get(projectId) ?? [];
    rows.push(episode);
    grouped.set(projectId, rows);
  }
  for (const rows of grouped.values()) {
    rows.sort(
      (left, right) =>
        numericSort(left.videoNumber ?? left.sort ?? left.id) -
        numericSort(right.videoNumber ?? right.sort ?? right.id),
    );
  }
  return grouped;
}

function numericSort(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function safeFetchMembers(
  baseUrl: string,
  projectId: string,
  auth: HeadersInit,
  errors: string[],
): Promise<LegacyMember[]> {
  try {
    const url = new URL('/project/ip/member/list', baseUrl);
    url.searchParams.set('projectId', projectId);
    const json = await requestJson<
      JavaEnvelope<LegacyMember[] | { list?: LegacyMember[] }>
    >(url, {
      method: 'GET',
      headers: auth,
    });
    return extractRows<LegacyMember>(json.data).rows;
  } catch (error) {
    errors.push(`/project/ip/member/list: ${message(error)}`);
    return [];
  }
}

async function safeFetchFaqs(
  baseUrl: string,
  projectId: string,
  auth: HeadersInit,
  errors: string[],
): Promise<LegacyFaq[]> {
  try {
    const url = new URL('/project/faq/list', baseUrl);
    url.searchParams.set('projectId', projectId);
    const json = await requestJson<
      JavaEnvelope<LegacyFaq[] | { list?: LegacyFaq[] }>
    >(url, {
      method: 'GET',
      headers: auth,
    });
    return extractRows<LegacyFaq>(json.data).rows;
  } catch (error) {
    errors.push(`/project/faq/list: ${message(error)}`);
    return [];
  }
}

async function postForm<T>(
  baseUrl: string,
  path: string,
  body: Record<string, string>,
  auth: HeadersInit,
): Promise<T | null> {
  const res = await requestJson<JavaEnvelope<T>>(new URL(path, baseUrl), {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.data ?? null;
}

async function requestJson<T>(url: URL, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.pathname}`);
  const json = (await res.json()) as JavaEnvelope<unknown>;
  if (typeof json.code === 'number' && json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || `code ${json.code} ${url.pathname}`);
  }
  return json as T;
}

function extractRows<T>(data: unknown): { rows: T[]; total?: number } {
  if (Array.isArray(data)) return { rows: data as T[] };
  if (!data || typeof data !== 'object') return { rows: [] };
  const obj = data as Record<string, unknown>;
  const rows =
    firstArray<T>(obj, ['list', 'records', 'rows', 'items', 'data']) ??
    (Array.isArray(obj.result) ? (obj.result as T[]) : []);
  const total = firstNumber(obj, ['total', 'sum', 'count']);
  return { rows, total };
}

function firstArray<T>(
  obj: Record<string, unknown>,
  keys: string[],
): T[] | null {
  for (const key of keys) {
    if (Array.isArray(obj[key])) return obj[key] as T[];
  }
  return null;
}

function firstNumber(
  obj: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) return Number(value);
  }
  return undefined;
}

function normalizeDictionary(data: unknown): Record<string, string> {
  if (!data) return {};
  if (Array.isArray(data)) {
    return Object.fromEntries(
      data
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const obj = row as Record<string, unknown>;
          const id = stringId(obj.id ?? obj.typeId ?? obj.tagId);
          const name = firstString(obj, [
            'name',
            'typeName',
            'tagName',
            'label',
          ]);
          return id && name ? [id, name] : null;
        })
        .filter((entry): entry is [string, string] => !!entry),
    );
  }
  if (typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [key, String(value)]),
    );
  }
  return {};
}

async function readSnapshot(path: string): Promise<LegacySnapshot> {
  return JSON.parse(
    await readFile(resolve(repoRoot, path), 'utf8'),
  ) as LegacySnapshot;
}

function legacyUuid(kind: string, value: string): string {
  const namespace = Buffer.from('2d3fb7fe7d9a50f1b502a7a87cf7f482', 'hex');
  const hash = createHash('sha1')
    .update(namespace)
    .update(`${kind}:${value}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20, 32)}`;
}

function mapIpType(
  typeName: string | undefined,
): 'series' | 'film_short' | 'other' {
  if (!typeName) return 'series';
  if (/短片|电影|广告|宣传|纪录片|动画|视频|影视/.test(typeName))
    return 'film_short';
  if (/其他|收藏/.test(typeName)) return 'other';
  return 'series';
}

function mapPublicationStatus(
  project: LegacyProjectDetail | LegacyProjectListRow,
  adminRow?: LegacyProjectListRow,
):
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'published'
  | 'hidden'
  | 'archived' {
  const review = legacyStatusToken(project.review);
  if (review) {
    if (review === '8') return 'hidden';
    if (review === '5' || review === '2') return 'published';
    if (review === '3') return 'changes_requested';
    if (review === '1') return 'in_review';
    if (review === '0') return 'draft';
  }

  const statusValues = [
    project.projectStatus,
    project.viewStatus,
    project.status,
    adminRow?.projectStatus,
    adminRow?.viewStatus,
    adminRow?.status,
  ]
    .map(legacyStatusToken)
    .filter(Boolean);

  if (
    statusValues.includes('8') ||
    hasLegacyStatusText(project, adminRow, /下架|下线|offline|hidden/i)
  )
    return 'hidden';
  if (
    statusValues.includes('5') ||
    hasLegacyStatusText(project, adminRow, /通过|approved|publish|public/i)
  )
    return 'published';
  if (
    statusValues.includes('3') ||
    hasLegacyStatusText(project, adminRow, /拒绝|不通过|驳回|reject|refuse/i)
  )
    return 'changes_requested';
  if (statusValues.includes('1')) return 'in_review';
  if (statusValues.includes('0')) return 'in_review';

  return 'draft';
}

function legacyStatusToken(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
}

function hasLegacyStatusText(
  project: LegacyProjectDetail | LegacyProjectListRow,
  adminRow: LegacyProjectListRow | undefined,
  pattern: RegExp,
): boolean {
  const text = [
    project.review,
    project.projectStatus,
    project.viewStatus,
    project.status,
    adminRow?.projectStatus,
    adminRow?.viewStatus,
    adminRow?.status,
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(' ');
  return pattern.test(text);
}

function mapContributorRole(member: LegacyMember): string {
  const role = Number(member.role ?? member.roleId);
  if (role === 10) return 'owner';
  if (role === 8) return 'producer';
  return 'member';
}

function parseLegacyTagNames(
  raw: unknown,
  tagDictionary: Record<string, string>,
): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return unique(
        parsed
          .map((id) => tagDictionary[String(id)] ?? String(id))
          .filter(Boolean),
      );
    }
  } catch {
    // Fall through to delimiter parsing.
  }
  return unique(
    trimmed
      .split(/[,|;、\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => tagDictionary[tag] ?? tag),
  );
}

function parseDurationSeconds(episode: LegacyEpisode): number | null {
  if (typeof episode.duration === 'number') return Math.round(episode.duration);
  if (typeof episode.duration === 'string' && episode.duration.trim()) {
    const parsed = Number(episode.duration);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  if (episode.videometa) {
    try {
      const meta = JSON.parse(episode.videometa) as { duration?: unknown };
      if (typeof meta.duration === 'number') return Math.round(meta.duration);
    } catch {
      return null;
    }
  }
  return null;
}

function firstString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function stringId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function requiredText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function clamp(value: string, length: number): string {
  return value.length > length ? value.slice(0, length) : value;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '');
}

function topEntries(
  map: Map<string, number>,
  limit = 20,
): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function env(name: string, fallback: string | undefined): string;
function env(name: string, fallback: undefined): string | undefined;
function env(name: string, fallback: string | undefined): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
