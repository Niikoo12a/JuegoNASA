import { createRng } from './rng';

/**
 * Laboratorio de biología (lógica pura, sin DOM): «ADN de papel» y «Biofirmas».
 * [MODELO] Los porcentajes de costo son del juego, no mediciones. [REAL en concepto] La NASA diseña microbios (p. ej. levadura)
 * para que fabriquen nutrientes a pedido. Sin bioseguridad: un diseño malo solo rinde menos bonus, nunca castiga.
 */
export type Sensor = 'light' | 'radiation' | 'temperature';
export type Fn = 'pigment' | 'photosynthesis' | 'oxygen';
export type Switch = 'always' | 'onDetect';
export interface DnaDesign { sensor: Sensor; fn: Fn; sw: Switch; }
export interface DnaProblem { sensor: Sensor; fn: Fn; }

/** Problema del invernadero en cada jornada (la clave es el id de la investigación). */
export const DNA_PROBLEMS = {
  'huerto-lunar': { sensor: 'light', fn: 'photosynthesis' },  // poca luz
  'paneles-solares': { sensor: 'radiation', fn: 'pigment' },  // pico de radiación (llamarada)
  'hielo-lunar': { sensor: 'temperature', fn: 'oxygen' },     // noche larga y frío
} as const satisfies Record<string, DnaProblem>;

/** Carga metabólica de cada función para el alga; «solo cuando detecta» paga el 40 %. */
export const FN_COST: Record<Fn, number> = { pigment: 0.10, photosynthesis: 0.15, oxygen: 0.15 };
export const ON_DETECT_FACTOR = 0.4;
const MAX_COST = 0.15;

export const dnaCost = (d: DnaDesign): number => FN_COST[d.fn] * (d.sw === 'always' ? 1 : ON_DETECT_FACTOR);
/** La función solo ayuda si el sensor coincide con el problema («sentir → responder»). */
export const dnaFit = (d: DnaDesign, p: DnaProblem): number => (d.sensor !== p.sensor ? 0.15 : d.fn === p.fn ? 1 : 0.45);
export const dnaEfficiency = (d: DnaDesign): number => Math.max(0, Math.min(1, 1 - dnaCost(d) / MAX_COST));
/** 0,6 × ajuste al problema + 0,4 × eficiencia (menor costo). */
export const dnaScore = (d: DnaDesign, p: DnaProblem): number => 0.6 * dnaFit(d, p) + 0.4 * dnaEfficiency(d);

// ------------------------------------------------------------------ cepas
/**
 * [REAL en concepto] Una cepa es una variante de un microbio con rasgos propios. [PROPUESTA] Las tres cepas del juego (Brisa, Escudo y Polar)
 * son inventadas para enseñar a elegir según el problema; sus números son un [MODELO] y no miden nada real.
 */
export type StrainId = 'brisa' | 'escudo' | 'polar';
export interface Strain { id: StrainId; /** Problema que mejor aguanta. */ good: Sensor; /** Multiplica el costo para el alga (menor = más económica). */ costMod: number; }
export const STRAINS: readonly Strain[] = [
  { id: 'brisa', good: 'light', costMod: 0.9 },
  { id: 'escudo', good: 'radiation', costMod: 1 },
  { id: 'polar', good: 'temperature', costMod: 1.1 },
];
/** La cepa ideal para el problema rinde al 100 %; una poco adecuada, al 55 %. */
export const strainFit = (s: Strain, p: DnaProblem): number => (s.good === p.sensor ? 1 : 0.55);
export const dnaCostFor = (d: DnaDesign, s: Strain): number => dnaCost(d) * s.costMod;
export const dnaEfficiencyFor = (d: DnaDesign, s: Strain): number => Math.max(0, Math.min(1, 1 - dnaCostFor(d, s) / MAX_COST));
/** 80 % circuito (0,6 ajuste + 0,4 eficiencia con el costo de la cepa) + 20 % cepa adecuada. Entre 0 y 1. */
export const dnaScoreFor = (d: DnaDesign, p: DnaProblem, s: Strain): number => 0.8 * (0.6 * dnaFit(d, p) + 0.4 * dnaEfficiencyFor(d, s)) + 0.2 * strainFit(s, p);

/** El taller es opcional: un buen circuito suma hasta un 25 % a cada cosecha; sin taller (o con uno malo) la cosecha queda como siempre. */
export const DNA_MAX_BONUS = 0.25;
export const dnaBonus = (score: number): number => 1 + DNA_MAX_BONUS * Math.max(0, Math.min(1, score));

// ------------------------------------------------------------------ biofirmas: tres pruebas independientes
export type BioTest = 'spectrum' | 'repeat' | 'control';
export const BIO_TESTS: readonly BioTest[] = ['spectrum', 'repeat', 'control'];
export interface BioSample {
  /** ¿La muestra tiene indicio biológico? (si no, son orgánicos sin vida, que también aparecen en el espectro) */
  alive: boolean;
  /** Resultado de cada prueba: true = «coincide» (apunta a vida). */
  result: Record<BioTest, boolean>;
  /** Cuántas huellas hay para elegir en el espectro y cuál es la correcta. */
  options: number;
  answer: number;
}

/**
 * [MODELO] Con vida: las tres pruebas coinciden. Sin vida: el espectro «coincide» igual (los orgánicos solos no prueban vida),
 * pero no se repite y no se distingue del control. Por eso una sola prueba no basta.
 * En Comandante hay más huellas para elegir en el espectro (4 en vez de 2).
 */
export function makeSample(seed: number, hard: boolean): BioSample {
  const rnd = createRng(seed);
  const alive = rnd() < 0.5;
  const options = hard ? 4 : 2;
  return { alive, result: { spectrum: true, repeat: alive, control: alive }, options, answer: Math.floor(rnd() * options) };
}

/** 0,5 × huella bien elegida + 0,3 × pruebas hechas antes de informar (máx. 3) + 0,2 × clasificación final correcta. */
export function bioScore(sample: BioSample, pickedPeak: number, testsDone: number, reportedAlive: boolean): number {
  return 0.5 * (pickedPeak === sample.answer ? 1 : 0) + 0.3 * (Math.min(3, testsDone) / 3) + 0.2 * (reportedAlive === sample.alive ? 1 : 0);
}
/** Informar con menos de dos pruebas da un aviso amistoso («falsa alarma posible»), sin castigo. */
export const needsMoreTests = (testsDone: number): boolean => testsDone < 2;
