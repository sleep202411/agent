import type { Prisma, PrismaClient } from '@prisma/client';

type Models = keyof Prisma.TypeMap['model'];
type Operations<M extends Models> = Prisma.TypeMap['model'][M]['operations'];
type Hook<
  M extends Models,
  O extends keyof Operations<M>,
> = Operations<M>[O] extends {
  args: infer A;
  result: infer R;
}
  ? (context: {
      args: A;
      query: (args: A) => Promise<R>;
      operation: O;
      model: M;
    }) => Promise<unknown>
  : never;
type AnyHook = (context: {
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
  operation: string;
  model: string;
}) => Promise<unknown>;
type QueryExtension = {
  query: {
    [M in Models as Uncapitalize<M>]?: {
      [O in keyof Operations<M>]?: Hook<M, O>;
    } & { $allOperations?: AnyHook };
  } & { $allModels?: { $allOperations?: AnyHook } };
};

/**
 * Fault-injection queries preserve the client API. Keep their argument/result
 * types, but avoid synthesizing a recursive extended client for every test.
 * With this schema, Prisma's inferred $extends result makes full tsc spend
 * minutes expanding hundreds of unrelated model delegates per call.
 */
export function extendPrismaQueries(
  db: PrismaClient,
  extension: QueryExtension,
): PrismaClient {
  const extend = db.$extends as unknown as (
    extension: QueryExtension,
  ) => PrismaClient;
  return extend.call(db, extension) as PrismaClient;
}
