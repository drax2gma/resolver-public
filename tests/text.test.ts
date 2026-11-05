import { describe, expect, it } from 'vitest';
import { buildSolvers, buildSolversFrom, parseRouterConfig } from '../src/lib/server/data';
import { parseTicketText } from '../src/lib/parse-ticket';
import { extractTopics } from '../src/lib/server/topics';
import { jaccard, normalizeHu } from '../src/lib/server/text';
import { readFileSync } from 'node:fs';

describe('text', () => {
  it('normalizes Hungarian accents and punctuation', () => {
    expect(normalizeHu('Fájlszerver – újraindult, Hiba!')).toBe('fajlszerver ujraindult hiba');
  });

  it('computes token similarity', () => {
    expect(jaccard('SQL Server adatbázis', 'SQL Server mentés')).toBeGreaterThan(0);
    expect(jaccard('alma körte', 'traktor')).toBe(0);
  });
});

describe('topics', () => {
  it('extracts windows/cluster topics', () => {
    const text = readFileSync('tickets/DEMO-001.txt', 'utf8');
    const topics = extractTopics(text);
    expect(topics).toContain('windows_server');
    expect(topics).toContain('cluster');
    expect(topics).toContain('backup');
  });

  it('extracts AD and SSO topics', () => {
    expect(extractTopics('Active Directory csoporttagság, új fiók')).toContain('ad');
    expect(extractTopics('SSO, OTP, SMS')).toContain('sso');
  });
});

describe('data', () => {
  it('builds 22 solvers with orgs, topics and substitutes', () => {
    const solvers = buildSolvers();
    expect(solvers).toHaveLength(22);
    expect(new Set(solvers.map((s) => s.nev)).size).toBe(22);
    expect(solvers.every((s) => s.szervezetek.length > 0)).toBe(true);
    expect(solvers.every((s) => s.topicIds.length > 0)).toBe(true);
    const withSubstitute = solvers.filter((s) => s.helyettesId);
    expect(withSubstitute.length).toBeGreaterThan(0);
  });

  it('parses a ticket file', () => {
    const text = readFileSync('tickets/DEMO-008.txt', 'utf8');
    const ticket = parseTicketText(text);
    expect(ticket.externalId).toBe('DEMO-008');
    expect(ticket.targy).toContain('VPN');
    expect(ticket.prioritas).toBe('Magas');
    expect(ticket.leiras.length).toBeGreaterThan(20);
  });
});

const minimalRouter = `
szervezetek: [Windows]
megoldok:
  - nev: Teszt Elek
    szerep: Windows Admin
    szervezetek: [Windows]
    temakorok: [windows_server]
temakorok:
  - id: windows_server
    nev: Windows szerver
    kulcsszavak: [windows]
szabalyok: []
`;

describe('router schema', () => {
  it('parses the simplified router', () => {
    const config = parseRouterConfig(minimalRouter);
    expect(config.megoldok[0]?.temakorok).toEqual(['windows_server']);
    expect(config.temakorok[0]?.nev).toBe('Windows szerver');
    expect(config.szabalyok).toEqual([]);
  });

  it('rejects an unknown topic id', () => {
    const broken = minimalRouter.replace(
      'temakorok: [windows_server]',
      'temakorok: [nincs_ilyen]'
    );
    expect(() => buildSolversFrom(parseRouterConfig(broken))).toThrow(/ismeretlen témakör-ID/);
  });

  it('rejects a duplicate solver', () => {
    const broken = minimalRouter.replace(
      '    temakorok: [windows_server]',
      '    temakorok: [windows_server]\n  - nev: Teszt Elek\n    szerep: Windows Admin\n    szervezetek: [Windows]\n    temakorok: [windows_server]'
    );
    expect(() => buildSolversFrom(parseRouterConfig(broken))).toThrow(/Duplikált megoldó/);
  });
});
