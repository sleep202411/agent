import type { Prisma } from '@prisma/client';

type SqlClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export function publisherTestClient(sql: SqlClient) {
  return {
    $queryRaw: async (
      query: TemplateStringsArray | Prisma.Sql,
      ...values: unknown[]
    ) => {
      const statement =
        'text' in query
          ? { text: query.text, values: query.values }
          : {
              text: query.reduce(
                (text, part, i) => text + (i ? `$${i}` : '') + part,
                '',
              ),
              values,
            };
      return (await sql.query(statement.text, statement.values)).rows;
    },
    ipPublisherAssignment: {
      deleteMany: ({ where }: { where: { ipId: string } }) =>
        sql.query('DELETE FROM assignments WHERE ip_id = $1', [where.ipId]),
      createMany: async ({
        data,
      }: {
        data: Array<{
          ipId: string;
          publisherId: string;
          displayOrder: number;
          createdById: string;
        }>;
      }) => {
        for (const row of data) {
          await sql.query('INSERT INTO assignments VALUES ($1, $2, $3, $4)', [
            row.ipId,
            row.publisherId,
            row.displayOrder,
            row.createdById,
          ]);
        }
      },
      findMany: async ({ where }: { where: { ipId: string } }) => {
        const result = await sql.query<{
          id: string;
          status: string;
          display_order: number;
        }>(
          'SELECT p.id, p.status, a.display_order FROM assignments a JOIN ip_publishers p ON p.id = a.publisher_id WHERE a.ip_id = $1 ORDER BY a.display_order',
          [where.ipId],
        );
        return result.rows.map((row) => ({
          displayOrder: row.display_order,
          publisher: {
            id: row.id,
            code: row.id,
            names: {},
            logoUrl: '',
            websiteUrl: null,
            displayOrder: 0,
            status: row.status,
          },
        }));
      },
    },
  };
}
