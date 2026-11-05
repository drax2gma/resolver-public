import { json } from '@sveltejs/kit';
import { getOrgs, getRules, getSolvers } from '#lib/server/repo';
import { readRouterSource } from '#lib/server/router-files';
import { getTopics } from '#lib/server/topics';
import type { RouterResponse } from '#lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  const solvers = getSolvers();
  const source = readRouterSource();
  const response: RouterResponse = {
    solvers: solvers.map(({ id, nev, szervezet, szerep }) => ({ id, nev, szervezet, szerep })),
    orgs: getOrgs(),
    counts: {
      solvers: solvers.length,
      topics: getTopics().length,
      rules: getRules().length
    },
    source: {
      content: source.content,
      hash: source.hash,
      lines: source.content.trimEnd().split('\n').length
    }
  };
  return json(response);
};
