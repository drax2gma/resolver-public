import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Rule, Solver, TicketInput } from '../types';
import { parseTicketText } from '../parse-ticket';
import { normalizeHu, slugify } from './text';

export interface RawSolver {
  nev: string;
  helyettes?: string;
  szerep: string;
  szervezetek: string[];
  temakorok: string[];
}

export interface TopicDef {
  id: string;
  nev: string;
  kulcsszavak: string[];
}

export interface StoredRule {
  szoveg: string;
  kulcsszavak: string[];
}

export interface RouterConfig {
  szervezetek: string[];
  megoldok: RawSolver[];
  temakorok: TopicDef[];
  szabalyok: StoredRule[];
}

function readRoot(relative: string): string {
  return readFileSync(join(process.env.DATA_DIR ?? process.cwd(), relative), 'utf8');
}

const ruleSchema = z.object({
  szoveg: z.string().min(1),
  kulcsszavak: z.array(z.string()).default([])
});

const routerSchema = z.object({
  szervezetek: z.array(z.string().min(1)).min(1),
  megoldok: z.array(
    z.object({
      nev: z.string().min(1),
      helyettes: z.string().min(1).optional(),
      szerep: z.string().min(1),
      szervezetek: z.array(z.string().min(1)).min(1),
      temakorok: z.array(z.string().min(1)).min(1)
    })
  ),
  temakorok: z.array(
    z.object({
      id: z.string().min(1),
      nev: z.string().min(1),
      kulcsszavak: z.array(z.string())
    })
  ),
  szabalyok: z.array(ruleSchema)
});

export function parseRouterConfig(content: string): RouterConfig {
  const config = routerSchema.parse(parseYaml(content)) as RouterConfig;

  const orgs = new Set<string>();
  for (const org of config.szervezetek) {
    if (orgs.has(org)) throw new Error(`router.yaml: duplikált szervezet: ${org}`);
    orgs.add(org);
  }
  const topics = new Set<string>();
  for (const topic of config.temakorok) {
    if (topics.has(topic.id)) throw new Error(`router.yaml: duplikált témakör-ID: ${topic.id}`);
    topics.add(topic.id);
  }
  return config;
}

let configCache: RouterConfig | null = null;

export function loadRouterConfig(): RouterConfig {
  if (!configCache) configCache = parseRouterConfig(readRoot('router.yaml'));
  return configCache;
}

/** router.yaml szerkesztése után hívd, hogy a következő kérés friss adatot lásson. */
export function invalidateConfigCache(): void {
  configCache = null;
}

export function loadMegoldok(): RawSolver[] {
  return loadRouterConfig().megoldok;
}

export function loadTopics(): TopicDef[] {
  return loadRouterConfig().temakorok;
}

export function loadRules(): Rule[] {
  return loadRouterConfig().szabalyok.map((rule) => ({
    text: rule.szoveg,
    keywords: rule.kulcsszavak
  }));
}

export function buildSolversFrom(config: RouterConfig): Solver[] {
  const names = new Set(config.megoldok.map((solver) => solver.nev));
  const orgSet = new Set(config.szervezetek);
  const topicById = new Map(config.temakorok.map((topic) => [topic.id, topic]));
  const seen = new Set<string>();
  const ids = new Set<string>();

  const solvers: Solver[] = config.megoldok.map((solver) => {
    if (seen.has(solver.nev)) throw new Error(`Duplikált megoldó: ${solver.nev}`);
    seen.add(solver.nev);
    if (solver.szervezetek.length === 0) {
      throw new Error(`router.yaml: nincs szervezet a megoldóhoz: ${solver.nev}`);
    }
    for (const org of solver.szervezetek) {
      if (!orgSet.has(org)) {
        throw new Error(`router.yaml: ismeretlen szervezet (${org}) a(z) ${solver.nev} mellett`);
      }
    }
    if (solver.temakorok.length === 0) {
      throw new Error(`router.yaml: nincs témakör a megoldóhoz: ${solver.nev}`);
    }
    const temakorok = solver.temakorok.map((topicId) => {
      const topic = topicById.get(topicId);
      if (!topic) {
        throw new Error(
          `router.yaml: ismeretlen témakör-ID (${topicId}) a(z) ${solver.nev} mellett`
        );
      }
      return topic.nev;
    });
    if (solver.helyettes && !names.has(solver.helyettes)) {
      throw new Error(
        `router.yaml: ismeretlen helyettes (${solver.helyettes}) a(z) ${solver.nev} mellett`
      );
    }
    const id = slugify(solver.nev);
    if (ids.has(id)) throw new Error(`Duplikált megoldó-ID: ${id}`);
    ids.add(id);
    return {
      id,
      nev: solver.nev,
      szervezet: solver.szervezetek[0],
      szervezetek: solver.szervezetek,
      szerep: solver.szerep,
      helyettesNev: solver.helyettes ?? null,
      helyettesId: null,
      temakorok,
      topicIds: solver.temakorok,
      profileText: `${solver.nev} — ${solver.szerep} — ${solver.szervezetek.join(', ')}. Témák: ${temakorok.join(', ')}.`
    };
  });

  const byName = new Map(solvers.map((solver) => [solver.nev, solver]));
  for (const solver of solvers) {
    if (solver.helyettesNev) {
      const substitute = byName.get(solver.helyettesNev);
      if (!substitute) throw new Error(`Helyettes nem található: ${solver.helyettesNev}`);
      solver.helyettesId = substitute.id;
    }
  }
  return solvers;
}

export function buildSolvers(): Solver[] {
  return buildSolversFrom(loadRouterConfig());
}

export function loadTicketFiles(
  dir = join(process.env.DATA_DIR ?? process.cwd(), 'tickets')
): TicketInput[] {
  const files = readdirSync(dir).filter((name) => name.endsWith('.txt')).sort();
  return files.map((name) => {
    const text = readFileSync(join(dir, name), 'utf8');
    return parseTicketText(text, name.replace(/\.txt$/, ''));
  });
}

export function ticketText(ticket: TicketInput): string {
  return `${ticket.targy}\n${ticket.leiras}`;
}

export function normalizedTicket(ticket: TicketInput): string {
  return normalizeHu(ticketText(ticket));
}
