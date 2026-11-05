import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db';
import { getProvider } from '#lib/server/predict';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const db = getDb();
  const examples = (db.prepare('SELECT COUNT(*) AS c FROM examples').get() as { c: number }).c;
  const stats = (db.prepare('SELECT COUNT(*) AS c FROM topic_stats').get() as { c: number }).c;
  const model = await getProvider().health();
  return json(
    {
      ok: model.ok,
      service: 'resolver-spa',
      db: { examples, stats },
      model,
      time: new Date().toISOString()
    },
    { status: model.ok ? 200 : 503 }
  );
};
