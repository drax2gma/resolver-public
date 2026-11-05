import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSolversFrom, parseRouterConfig } from '../src/lib/server/data';
import { RouterFileError, validateRouterContent } from '../src/lib/server/router-files';

const config = parseRouterConfig(readFileSync('router.yaml', 'utf8'));

describe('router.yaml', () => {
  it('builds the full solver list from the merged config', () => {
    expect(buildSolversFrom(config)).toHaveLength(22);
  });

  it('rejects an unknown organisation', () => {
    const bad = structuredClone(config);
    bad.megoldok[0]!.szervezetek = ['NemLetezo'];
    expect(() => buildSolversFrom(bad)).toThrow(/ismeretlen szervezet/);
  });

  it('rejects an unknown topic id', () => {
    const bad = structuredClone(config);
    bad.megoldok[0]!.temakorok = ['nem_letezo'];
    expect(() => buildSolversFrom(bad)).toThrow(/ismeretlen témakör-ID/);
  });

  it('rejects an unknown substitute', () => {
    const bad = structuredClone(config);
    bad.megoldok[0]!.helyettes = 'Nincs Ilyen';
    expect(() => buildSolversFrom(bad)).toThrow(/ismeretlen helyettes/);
  });

  it('rejects duplicate solver names', () => {
    const bad = structuredClone(config);
    bad.megoldok.push(structuredClone(bad.megoldok[0]!));
    expect(() => buildSolversFrom(bad)).toThrow(/Duplikált megoldó/);
  });

  it('rejects invalid YAML on save', () => {
    expect(() => validateRouterContent('szervezetek: [')).toThrow(RouterFileError);
  });

  it('rejects empty content', () => {
    expect(() => validateRouterContent('')).toThrow(/üres fájl/);
  });
});
