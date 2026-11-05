import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db';
import { submitFeedback } from '#lib/server/feedback';
import type { FeedbackRequest } from '#lib/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  let body: Partial<FeedbackRequest>;
  try {
    body = (await request.json()) as Partial<FeedbackRequest>;
  } catch {
    throw error(400, 'Érvénytelen kérés');
  }

  if (typeof body.ticketText !== 'string' || !body.ticketText.trim()) {
    throw error(400, 'Hiányzó jegy szöveg');
  }
  if (typeof body.primaryId !== 'string' || !body.primaryId) {
    throw error(400, 'Hiányzó elsődleges megoldó');
  }
  if (body.verdict !== 'up' && body.verdict !== 'down') {
    throw error(400, 'Érvénytelen visszajelzés');
  }

  try {
    submitFeedback(getDb(), {
      ticketText: body.ticketText,
      primaryId: body.primaryId,
      verdict: body.verdict,
      suggestedSolverId: typeof body.suggestedSolverId === 'string' ? body.suggestedSolverId : null,
      suggestedOrg: typeof body.suggestedOrg === 'string' ? body.suggestedOrg : null,
      comment: typeof body.comment === 'string' ? body.comment : null
    });
  } catch (err) {
    throw error(400, (err as Error).message);
  }

  return json({ ok: true });
};
