import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * One canonical blank production home. Domain entities live outside the rich
 * text document; the editor persists only portable, generic document nodes.
 */
export function createDefaultProductionDocument(): Prisma.InputJsonObject {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { id: randomUUID() } }],
  };
}
