import "server-only";

/** Fetches every row for a query, paginating past PostgREST's 1000-row default page size. */
export async function selectAllRows<T>(
  runQuery: (from: number, to: number) => Promise<{ data: T[] | null }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data } = await runQuery(from, from + PAGE - 1);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
