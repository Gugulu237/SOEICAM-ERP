// Exercise the installed Postgres.js bind serializers with parameter types
// described by real PostgreSQL, rather than PGlite's different JS binding rules.
const { mergeUserTypes } = await import(new URL('./types.js', import.meta.resolve('postgres')));
const { serializers } = mergeUserTypes({ numeric: { to: 1700, from: [1700], serialize: String, parse: Number } });
export function postgresAdapter(db) {
  return { unsafe: async (query, params = []) => {
    if (!params.length) return (await db.query(query)).rows;
    const { queryParams } = await db.describeQuery(query);
    const bound = params.map((value, i) => value == null ? null : (serializers[queryParams[i].dataTypeID] || String)(value));
    // Values are already wire-format text; do not serialize them a second time.
    const wireText = Object.fromEntries(queryParams.map(({ dataTypeID }) => [dataTypeID, String]));
    return (await db.query(query, bound, { serializers: wireText })).rows;
  } };
}
