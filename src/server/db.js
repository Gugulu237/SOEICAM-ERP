import 'server-only';
import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { isTransactionConflict } from './transaction-errors.js';
const context = new AsyncLocalStorage();
export function database() {
  if (context.getStore()) return context.getStore();
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('The Supabase database connection is not configured.'), { status:503 });
  // Keep the bounded pool warm while a person reviews a form. Closing it after
  // twenty seconds made the next navigation pay the remote TLS handshake again.
  return globalThis.__soeicamDatabase ||= postgres(process.env.DATABASE_URL, { max:5, prepare:false, ssl:process.env.DATABASE_SSL === 'disable' ? false : 'require', connect_timeout:10, idle_timeout:120, types: { numeric:{ to:1700, from:[1700], serialize:String, parse:Number } } });
}
export async function transaction(run) {
  if (context.getStore()) return run();
  // Retry only after begin() has rolled the aborted transaction back and
  // released its connection. Connection loss can leave COMMIT ambiguous.
  const db = database();
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.begin(async sql => {
        await sql.unsafe('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        return context.run(sql, run);
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt >= 3) throw error;
      // Bounded jitter separates competing staff requests; no connection is
      // held while waiting. Nested work retries with its outer transaction.
      await delay(20 * 2 ** attempt + Math.floor(Math.random() * 20));
    }
  }
}
