import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db';
import { RouterFileError, saveRouterSource } from '#lib/server/router-files';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    throw error(403, 'Érvénytelen origin');
  }

  let body: { content?: unknown; baseHash?: unknown };
  try {
    body = (await request.json()) as { content?: unknown; baseHash?: unknown };
  } catch {
    throw error(400, 'Érvénytelen kérés');
  }

  if (typeof body.content !== 'string' || typeof body.baseHash !== 'string') {
    throw error(400, 'Hiányzó content vagy baseHash');
  }

  try {
    const result = saveRouterSource(getDb(), body.content, body.baseHash);
    return json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RouterFileError) throw error(err.status, err.message);
    throw error(500, (err as Error).message);
  }
};
