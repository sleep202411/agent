import { PrismaClient, CrewProductionKind } from '@prisma/client';
import { DEFAULT_SERIES_TASK_TEMPLATE } from '../../src/crews/templates/project-task-template.types';

export async function seedTaskTemplates(prisma: PrismaClient) {
  await prisma.projectTaskTemplate.upsert({
    where: {
      projectType_version: {
        projectType: CrewProductionKind.series,
        version: 1,
      },
    },
    create: {
      projectType: CrewProductionKind.series,
      name: '短剧全流程标准模板',
      version: 1,
      active: true,
      definition: DEFAULT_SERIES_TASK_TEMPLATE as any,
    },
    update: {
      name: '短剧全流程标准模板',
      active: true,
      definition: DEFAULT_SERIES_TASK_TEMPLATE as any,
    },
  });
  console.log('Seeded series task template v1.');
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedTaskTemplates(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
