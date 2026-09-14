/** Local-only TV fixtures. Run from apps/server with npm run seed:tv-local. */
import '../src/config/load-env';
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const fixtures = [
  ['the-predator', 'The Predator', '猎食者', '獵食者'],
  ['guizhou-fast-earth-core', 'Signal from Earth', '地心来信', '地心來信'],
  ['children-eighth-day', 'The Eighth Day', '第八日的孩子', '第八日的孩子'],
  ['lunar-colony', 'Lunar Colony', '月球殖民地', '月球殖民地'],
  ['three-second-world', 'Three Second World', '三秒世界', '三秒世界'],
  [
    'city-of-measuring-tapes',
    'City of Measuring Tapes',
    '卷尺之城',
    '捲尺之城',
  ],
  ['twin-cities-hong-kong', 'Twin Cities', '双城记', '雙城記'],
  ['jinling', 'A Dream of Jinling', '入梦金陵', '入夢金陵'],
] as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const target = new URL(connectionString);
  if (
    process.env.NODE_ENV === 'production' ||
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.port !== '5433' ||
    !/^\/fizzdragon(?:_[a-z0-9_]+)?$/.test(target.pathname)
  ) {
    throw new Error(
      'TV fixtures require a local fizzdragon development database on port 5433.',
    );
  }

  const publicDir = resolve(__dirname, '../../web/public');
  const outputDir = resolve(publicDir, '_dev/tv');
  const origin = 'http://localhost:9527';
  mkdirSync(outputDir, { recursive: true });
  // Generate actual playable files, without calling an AI provider or storage service.
  for (const [slug] of fixtures) {
    const source = resolve(
      publicDir,
      slug === 'jinling'
        ? 'jinling-rumeng/preview/story/sc03-lantern.png'
        : `made-with-fizz/${slug}.jpg`,
    );
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      source,
      '-vf',
      'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1',
      '-frames:v',
      '1',
      resolve(outputDir, `${slug}.jpg`),
    ]);
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      resolve(outputDir, `${slug}.jpg`),
      '-vf',
      "zoompan=z='1+on*0.0004':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=192:s=1280x720:fps=24",
      '-t',
      '8',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      resolve(outputDir, `${slug}.mp4`),
    ]);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    await prisma.$transaction(
      async (tx) => {
        const locales = [
          ['en-US', 'English', 'English'],
          ['zh-CN', 'Simplified Chinese', '简体中文'],
          ['zh-HK', 'Traditional Chinese', '繁體中文'],
        ] as const;
        for (const [code, displayName, nativeName] of locales) {
          await tx.supportedLocale.upsert({
            where: { code },
            update: {},
            create: { code, displayName, nativeName },
          });
        }
        for (const [index, [slug, ...titles]] of fixtures.entries()) {
          const n = index + 1;
          // Repair the existing local IP fixture IDs; never clear other content.
          const ipId = `019d0000-200${n}-7000-8000-${String(n).padStart(12, '0')}`;
          const coverAssetId = `019f0000-7701-7000-8000-${String(n).padStart(12, '0')}`;
          const trailerAssetId = `019f0000-7702-7000-8000-${String(n).padStart(12, '0')}`;
          for (const [id, extension, kind, contentType] of [
            [coverAssetId, 'jpg', 'image', 'image/jpeg'],
            [trailerAssetId, 'mp4', 'video', 'video/mp4'],
          ] as const) {
            const data = {
              kind,
              contentType,
              storageProvider: 'external_url' as const,
              externalUrl: `${origin}/_dev/tv/${slug}.${extension}`,
              width: 1280,
              height: 720,
              sizeBytes: BigInt(
                statSync(resolve(outputDir, `${slug}.${extension}`)).size,
              ),
              durationSeconds: kind === 'video' ? 8 : null,
              status: 'ready' as const,
              visibility: 'public' as const,
              moderationStatus: 'approved' as const,
              source: 'system' as const,
              metadata: {
                localFixture: 'tv',
                generatedFromRepositoryArtwork: true,
              },
              createdByUserId: 'local-tv-demo',
              deletedAt: null,
            };
            await tx.mediaAsset.upsert({
              where: { id },
              update: data,
              create: { id, ...data },
            });
          }
          const publishedAt = new Date(Date.UTC(2026, 8, 7, 0, 0, 8 - index));
          const data = {
            status: 'published' as const,
            listingVisibility: 'public' as const,
            sourceLocale: 'en-US',
            coverAssetId,
            trailerAssetId,
            copyrightOwner: 'FizzDragon',
            aiDisclosure: {
              localDemo: true,
              preview: '8-second motion study from repository artwork',
            },
            publishedAt,
            deletedAt: null,
            archivedAt: null,
            suspendedAt: null,
          };
          await tx.ip.upsert({
            where: { id: ipId },
            update: data,
            create: { id: ipId, createdById: 'local-tv-demo', ...data },
          });
          for (const [localeIndex, [locale]] of locales.entries()) {
            const localData = {
              title: titles[localeIndex],
              coverAssetId,
              status: 'published' as const,
              subtitle: ['Local demo', '本地演示', '本地示範'][localeIndex],
              summary: [
                'A local preview made from FizzDragon artwork for testing browsing and playback.',
                '使用 FizzDragon 现有画面制作的本地预览，用于体验列表浏览与播放。',
                '使用 FizzDragon 現有畫面製作的本地預覽，用於體驗列表瀏覽與播放。',
              ][localeIndex],
              description: null,
              publishedAt,
              archivedAt: null,
            };
            await tx.ipLocalization.upsert({
              where: { ipId_locale: { ipId, locale } },
              update: localData,
              create: { ipId, locale, ...localData },
            });
          }
        }
      },
      { timeout: 30_000 },
    );
    console.log(
      `Seeded ${fixtures.length} local IPs with covers and 8-second demo previews.`,
    );
    console.log(`Open ${origin}/zh-CN/tv`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Local TV seed failed.',
  );
  process.exitCode = 1;
});
