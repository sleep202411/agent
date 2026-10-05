import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
type Sql = Pick<import('@electric-sql/pglite').PGlite, 'query'>;
/** Small SQL fixture for folder side effects; real Prisma/ACL coverage lives in the PostgreSQL suite. */
export const deliveryFolderSql = `
CREATE TABLE crew_task_delivery_folders(task_id uuid PRIMARY KEY,crew_id text NOT NULL,folder_id uuid NOT NULL,created_by_user_id text NOT NULL);
CREATE TABLE fixture_asset_nodes(id uuid PRIMARY KEY,crew_id text NOT NULL,parent_id uuid,name text NOT NULL,kind text NOT NULL,status text NOT NULL DEFAULT 'active',folder_key text);
`;
export function deliveryFolderAdapter(sql: Sql) {
  const raw = (
    parts: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => {
    const query = Array.isArray(parts)
      ? Prisma.sql(parts as TemplateStringsArray, ...values)
      : (parts as Prisma.Sql);
    return sql.query(query.text, query.values);
  };
  type Node = {
    id: string;
    crewId: string;
    parentId: string | null;
    name: string;
    kind: string;
    status: string;
    folderKey: string | null;
  };
  const columns =
    'id,crew_id AS "crewId",parent_id AS "parentId",name,kind,status,folder_key AS "folderKey"';
  return {
    $executeRaw: raw,
    $queryRaw: async (
      parts: TemplateStringsArray | Prisma.Sql,
      ...values: unknown[]
    ) => (await raw(parts, ...values)).rows,
    crewAssetNode: {
      findFirst: async ({ where }: { where: Partial<Node> }) =>
        (
          await sql.query<Node>(
            `SELECT ${columns} FROM fixture_asset_nodes WHERE crew_id=$1 AND ($2::uuid IS NULL OR id=$2) AND ($3::text IS NULL OR folder_key=$3) LIMIT 1`,
            [where.crewId, where.id ?? null, where.folderKey ?? null],
          )
        ).rows[0] ?? null,
      findMany: async ({ where }: { where: Partial<Node> }) =>
        (
          await sql.query<Node>(
            `SELECT ${columns} FROM fixture_asset_nodes WHERE crew_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND status='active'`,
            [where.crewId, where.parentId ?? null],
          )
        ).rows,
      create: async ({
        data,
      }: {
        data: Pick<Node, 'crewId' | 'parentId' | 'name' | 'kind'>;
      }) => {
        const id = randomUUID();
        await sql.query(
          'INSERT INTO fixture_asset_nodes(id,crew_id,parent_id,name,kind) VALUES($1,$2,$3,$4,$5)',
          [id, data.crewId, data.parentId, data.name, data.kind],
        );
        return { id, ...data, status: 'active' };
      },
    },
  };
}
