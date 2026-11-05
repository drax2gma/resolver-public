import { json } from '@sveltejs/kit';
import { loadTicketFiles } from '#lib/server/data';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  return json({ tickets: loadTicketFiles() });
};
