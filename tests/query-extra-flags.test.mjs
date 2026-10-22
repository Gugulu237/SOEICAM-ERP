import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { whereClause } from '../src/server/query.js';

test('custom JSON flags bind with the text type actually sent by Postgres.js while native booleans keep their SQL type', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE locations (id text, is_active boolean, extra_data jsonb);
      INSERT INTO locations VALUES ('yes',true,'{"field_return_bin":true}'),('no',false,'{"field_return_bin":false}'),('absent',true,'{}');`);
    const schema = { fields: { id: { type: 'string' }, is_active: { type: 'boolean' } } };
    const cases = [
      [{ field_return_bin: true }, ['yes']], [{ field_return_bin: false }, ['no']],
      [{ field_return_bin: { $ne: false } }, ['absent', 'yes']],
      [{ field_return_bin: { $in: [true, null] } }, ['absent', 'yes']],
      [{ field_return_bin: { $nin: [true] } }, ['absent', 'no']],
      [{ field_return_bin: { $in: [true, false] } }, ['no', 'yes']],
      [{ is_active: true }, ['absent', 'yes']], [{ field_return_bin: true, is_active: true }, ['yes']],
    ];
    let index = 0;
    for (const [filter, expected] of cases) {
      const params = [], sql = 'SELECT id FROM locations WHERE ' + whereClause(filter, schema, params) + ' ORDER BY id';
      // Describe with the JS argument types, as the real driver does. Relying on
      // PGlite's automatic coercion alone hides the original text=boolean error.
      const argumentTypes = params.map(value => typeof value === 'boolean' ? 'boolean' : 'text');
      await db.exec('PREPARE flags_' + ++index + '(' + argumentTypes.join(',') + ') AS ' + sql);
      assert.deepEqual((await db.query(sql, params)).rows.map(row => row.id), expected);
    }
  } finally { await db.close(); }
});
