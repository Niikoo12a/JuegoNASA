import { describe, expect, it } from 'vitest';
import { BIO_TESTS, DNA_PROBLEMS, bioScore, dnaCost, dnaEfficiency, dnaFit, dnaBonus, dnaScore, makeSample, needsMoreTests, STRAINS, dnaCostFor, dnaScoreFor, type DnaDesign } from '../../src/sim/dna';

const design = (over: Partial<DnaDesign> = {}): DnaDesign => ({ sensor: 'light', fn: 'photosynthesis', sw: 'onDetect', ...over });

describe('laboratorio: ADN de papel', () => {
  it('cada jornada tiene su problema y la mejor respuesta es sensor + función que coinciden', () => {
    expect(Object.keys(DNA_PROBLEMS).sort()).toEqual(['hielo-lunar', 'huerto-lunar', 'paneles-solares']);
    for (const p of Object.values(DNA_PROBLEMS)) {
      const best = dnaScore({ sensor: p.sensor, fn: p.fn, sw: 'onDetect' }, p);
      for (const sensor of ['light', 'radiation', 'temperature'] as const) {
        for (const fn of ['pigment', 'photosynthesis', 'oxygen'] as const) expect(dnaScore({ sensor, fn, sw: 'onDetect' }, p)).toBeLessThanOrEqual(best + 1e-9);
      }
    }
  });

  it('la función solo ayuda si el sensor coincide', () => {
    const p = DNA_PROBLEMS['paneles-solares']; // radiación
    expect(dnaFit({ sensor: 'light', fn: 'pigment', sw: 'always' }, p)).toBeLessThan(dnaFit({ sensor: 'radiation', fn: 'pigment', sw: 'always' }, p));
  });

  it('«solo cuando detecta» paga el 40 % del costo y «siempre encendido» el completo', () => {
    expect(dnaCost(design({ sw: 'always' }))).toBeCloseTo(0.15);
    expect(dnaCost(design({ sw: 'onDetect' }))).toBeCloseTo(0.06);
    expect(dnaEfficiency(design({ sw: 'always' }))).toBe(0);
    expect(dnaEfficiency(design({ sw: 'onDetect' }))).toBeGreaterThan(0.5);
  });

  it('el taller es opcional y solo ayuda: la cosecha queda entre ×1 y ×1,25', () => {
    expect(dnaBonus(0)).toBeCloseTo(1);
    expect(dnaBonus(1)).toBeCloseTo(1.25);
    expect(dnaBonus(-3)).toBeCloseTo(1);
    expect(dnaBonus(9)).toBeCloseTo(1.25);
  });
});

describe('laboratorio: biofirmas', () => {
  it('con vida las tres pruebas coinciden; sin vida el espectro coincide pero las otras dos no', () => {
    let alive = 0;
    for (let seed = 1; seed < 60; seed++) {
      const s = makeSample(seed, false);
      expect(s.result.spectrum).toBe(true); // los orgánicos solos no prueban vida
      expect(s.result.repeat).toBe(s.alive);
      expect(s.result.control).toBe(s.alive);
      if (s.alive) alive++;
    }
    expect(alive).toBeGreaterThan(5);
    expect(alive).toBeLessThan(55);
    expect(BIO_TESTS).toHaveLength(3);
  });

  it('Comandante ofrece más huellas y la respuesta cae dentro', () => {
    const e = makeSample(5, false);
    const i = makeSample(5, true);
    expect(i.options).toBeGreaterThan(e.options);
    expect(i.answer).toBeGreaterThanOrEqual(0);
    expect(i.answer).toBeLessThan(i.options);
  });

  it('el puntaje queda entre 0 y 1; informar con una sola prueba pide más pruebas', () => {
    const s = makeSample(3, false);
    expect(bioScore(s, s.answer, 3, s.alive)).toBeCloseTo(1);
    expect(bioScore(s, -1, 0, !s.alive)).toBe(0);
    expect(needsMoreTests(1)).toBe(true);
    expect(needsMoreTests(2)).toBe(false);
  });
});

describe('cepas', () => {
  const p = DNA_PROBLEMS['huerto-lunar'];
  const good: DnaDesign = { sensor: p.sensor, fn: p.fn, sw: 'onDetect' };
  it('la cepa ideal para el problema puntúa más que una inadecuada', () => {
    const ideal = STRAINS.find((s) => s.good === p.sensor)!;
    const other = STRAINS.find((s) => s.good !== p.sensor)!;
    expect(dnaScoreFor(good, p, ideal)).toBeGreaterThan(dnaScoreFor(good, p, other));
  });
  it('el puntaje queda entre 0 y 1', () => {
    for (const s of STRAINS) {
      expect(dnaScoreFor(good, p, s)).toBeLessThanOrEqual(1);
      expect(dnaScoreFor({ sensor: 'radiation', fn: 'oxygen', sw: 'always' }, p, s)).toBeGreaterThanOrEqual(0);
    }
  });
  it('el costo escala con la cepa', () => {
    expect(dnaCostFor(good, STRAINS[0])).toBeLessThan(dnaCostFor(good, STRAINS[2]));
  });
});
