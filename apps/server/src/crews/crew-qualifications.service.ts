import {
  Controller,
  Get,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ExperienceLevel as CrewExperienceLevel } from '@prisma/client';
import { z } from 'zod';
import {
  JAVA_CONTENT_URL,
  JAVA_REQUEST_TIMEOUT_MS,
} from '../integrations/java/java-config';

export type CrewQualificationRequirements = {
  experienceLevel: CrewExperienceLevel;
  requiredSkills: string[];
};
const ranks: Record<CrewExperienceLevel, number> = {
  any: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  lead: 4,
  master: 5,
};
const catalogSchema = z.object({
  fdLevels: z.array(
    z.object({
      id: z.number().int().positive().safe(),
      rank: z.number().int().min(1).max(5),
    }),
  ),
  skills: z.record(
    z.string().trim().min(1),
    z.array(z.number().int().positive().safe()).min(1),
  ),
});
const envelopeSchema = z.object({
  code: z.literal(200),
  info: z.object({ id: z.union([z.string(), z.number().int().safe()]) }),
  level: z
    .array(
      z.object({
        id: z.number().int().positive().safe(),
        type: z.number().int().nullish(),
      }),
    )
    .nullable()
    .transform((levels) => levels ?? []),
});
const unavailable = (message: string) =>
  new ServiceUnavailableException({
    code: 'CREW_QUALIFICATIONS_UNAVAILABLE',
    message,
  });

export function qualificationRequirementsKey(
  requirements: CrewQualificationRequirements,
) {
  return JSON.stringify([
    requirements.experienceLevel,
    [...requirements.requiredSkills].sort(),
  ]);
}

/** Current Java relations are authoritative; neither self-reported skills nor cached login levels grant admission. */
@Injectable()
export class CrewQualificationsService {
  onModuleInit() {
    // Deployment unblock: allow missing CREW_QUALIFICATION_CATALOG_JSON so the
    // server can boot without the regional Java catalog. Validation still runs
    // in assertEligible() -> readCatalog(), so recruiting for qualified roles
    // fails clearly at call time rather than at boot.
    //
    // TODO(#557): restore the fail-fast check once the regional Java Admin
    // catalog value is provisioned. See thread with Isaac 2026-09-27.
  }

  catalog() {
    const { catalog } = readCatalog();
    return { skills: Object.keys(catalog.skills).sort() };
  }

  async assertEligible(
    userId: string,
    cookie: string | undefined,
    requirements: CrewQualificationRequirements,
  ) {
    const minimum = ranks[requirements.experienceLevel];
    if (minimum === 0 && requirements.requiredSkills.length === 0) return;
    const { catalog, skills } = readCatalog();
    if (
      requirements.requiredSkills.some(
        (skill) => !skills.has(skill.trim().toLowerCase()),
      )
    )
      throw unavailable(
        'A required skill has no verified certificate mapping in this site’s catalog.',
      );
    if (!cookie || !/^\d+$/.test(userId))
      throw unavailable(
        'A current Java session and user identity are required to verify qualifications.',
      );
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );
    let fdLevels: Set<number>;
    let skillLevels: Set<number>;
    try {
      const response = await fetch(
        `${JAVA_CONTENT_URL}/user/other/user/info?${new URLSearchParams({ UserId: userId })}`,
        {
          method: 'POST',
          redirect: 'error',
          headers: { Accept: 'application/json', Cookie: cookie },
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error('Unavailable');
      const envelope = envelopeSchema.parse(await response.json());
      if (String(envelope.info.id) !== userId)
        throw new Error('Mismatched identity');
      fdLevels = new Set(
        envelope.level
          .filter((level) => level.type === 1)
          .map((level) => level.id),
      );
      skillLevels = new Set(
        envelope.level
          .filter((level) => level.type === 4)
          .map((level) => level.id),
      );
    } catch {
      // Never include cookies, upstream bodies or transport URLs in logs/errors.
      throw unavailable(
        'Current qualifications could not be verified. Please retry.',
      );
    } finally {
      clearTimeout(timeout);
    }
    const rank = Math.max(
      0,
      ...catalog.fdLevels
        .filter((level) => fdLevels.has(level.id))
        .map((level) => level.rank),
    );
    const missingSkills = requirements.requiredSkills.filter(
      (skill) =>
        !skills
          .get(skill.trim().toLowerCase())!
          .some((id) => skillLevels.has(id)),
    );
    if (rank < minimum || missingSkills.length)
      throw new ForbiddenException({
        code: 'CREW_QUALIFICATIONS_REQUIRED',
        message:
          'The required FD rank and verified skill certificates must both be satisfied.',
        requiredFdRank: minimum,
        missingSkills,
      });
  }
}

function readCatalog() {
  let catalog: z.infer<typeof catalogSchema>;
  try {
    catalog = catalogSchema.parse(
      JSON.parse(process.env.CREW_QUALIFICATION_CATALOG_JSON ?? ''),
    );
  } catch {
    throw unavailable(
      'Configure this site’s verified FD and skill certificate catalog before recruiting for qualified roles.',
    );
  }
  const fdIds = new Set(catalog.fdLevels.map((level) => level.id));
  if (
    fdIds.size !== catalog.fdLevels.length ||
    new Set(catalog.fdLevels.map((level) => level.rank)).size !== 5
  )
    throw unavailable(
      'The FD catalog must map distinct Java IDs to all five FD ranks.',
    );
  const skills = new Map<string, number[]>();
  for (const [name, ids] of Object.entries(catalog.skills)) {
    const key = name.trim().toLowerCase();
    if (skills.has(key) || ids.some((id) => fdIds.has(id)))
      throw unavailable(
        'FD ranks and skill certificates need distinct, unambiguous catalog entries.',
      );
    skills.set(key, ids);
  }
  return { catalog, skills };
}

@Controller('crew-qualification-catalog')
export class CrewQualificationCatalogController {
  constructor(private readonly qualifications: CrewQualificationsService) {}
  @Get()
  catalog() {
    return this.qualifications.catalog();
  }
}
