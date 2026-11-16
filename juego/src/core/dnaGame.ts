import { t } from './i18n';
import {
  BIO_TESTS, DNA_PROBLEMS, STRAINS, bioScore, dnaCostFor, dnaEfficiencyFor, dnaFit, dnaScoreFor, makeSample, needsMoreTests,
  type BioTest, type DnaDesign, type DnaProblem, type Fn, type Sensor, type Strain, type StrainId, type Switch,
} from '../sim/dna';
import type { MissionId } from '../data/missions';
import type { MiniGameHandle } from './miniGames';

/**
 * Laboratorio de biología en DOM (sin Phaser): «Taller de ADN de papel» (armar → probar → ajustar) y «Biofirmas» (tres pruebas).
 * Cada pieza lleva forma + texto, no solo color (accesible). La lógica vive en `sim/dna.ts`.
 */
const W = 380;
const H = 500;
const BOX = `width:${W}px;height:${H}px;background:#18144e;color:#f5f5f2;border:4px solid #0e0b33;border-radius:14px;box-sizing:border-box;font:600 14px Arial,sans-serif;overflow-x:hidden;overflow-y:auto`;

const SENSORS: { id: Sensor; shape: string }[] = [{ id: 'light', shape: '☀' }, { id: 'radiation', shape: '☢' }, { id: 'temperature', shape: '🌡' }];
const FNS: { id: Fn; shape: string }[] = [{ id: 'pigment', shape: '◐' }, { id: 'photosynthesis', shape: '❋' }, { id: 'oxygen', shape: '○' }];
const SWITCHES: { id: Switch; shape: string }[] = [{ id: 'always', shape: '●' }, { id: 'onDetect', shape: '◌' }];

const STRAIN_SHAPE: Record<StrainId, string> = { brisa: '☁', escudo: '⛨', polar: '❄' };

const piece = (kind: 'strain' | 'sensor' | 'fn' | 'sw', id: string, label: string, shape: string, on: boolean, hint: boolean): string =>
  `<button class="mn-btn mn-btn--sm" data-k="${kind}" data-id="${id}" aria-pressed="${on}" style="min-width:100px;min-height:42px;margin:2px;${on ? 'outline:3px solid #ffcb47;' : ''}${hint ? 'box-shadow:0 0 0 2px #5ad6b2;' : ''}">${shape} ${label}</button>`;

export function mountDnaWorkshop(root: HTMLElement, opts: { mission: MissionId; hard: boolean; onDone(score: number): void }): MiniGameHandle {
  const problem: DnaProblem = DNA_PROBLEMS[opts.mission];
  const design: Partial<DnaDesign> = {};
  let strain: Strain | undefined;
  let attempt = 1;
  let best = 0;
  let timer = 0;
  let dead = false;
  const full = (): boolean => !!(design.sensor && design.fn && design.sw && strain);
  const problemText = t(`dna.problem.${problem.sensor}`);
  const render = (extra = ''): void => {
    const cost = design.fn && design.sw && strain ? Math.round(dnaCostFor(design as DnaDesign, strain) * 100) : 0;
    root.innerHTML = `<div style="${BOX};padding:10px">
      <div style="font-size:15px">🧬 ${t('dna.title')} · ${t('dna.attempt', { n: attempt })}</div>
      <p style="margin:6px 0">${problemText}</p>
      <div>${t('dna.strain')}: ${STRAINS.map((s) => piece('strain', s.id, t(`dna.strain.${s.id}`), STRAIN_SHAPE[s.id], strain?.id === s.id, !opts.hard && s.good === problem.sensor)).join('')}</div>
      <p style="margin:2px 0 4px;min-height:18px;font-size:12px;color:#cfeaff">${strain ? t(`dna.strainTrait.${strain.id}`) : t('dna.strain.pick')}</p>
      <div>${t('dna.sensor')}: ${SENSORS.map((s) => piece('sensor', s.id, t(`dna.sensor.${s.id}`), s.shape, design.sensor === s.id, !opts.hard && s.id === problem.sensor)).join('')}</div>
      <div>${t('dna.fn')}: ${FNS.map((s) => piece('fn', s.id, t(`dna.fn.${s.id}`), s.shape, design.fn === s.id, false)).join('')}</div>
      <div>${t('dna.sw')}: ${SWITCHES.map((s) => piece('sw', s.id, t(`dna.sw.${s.id}`), s.shape, design.sw === s.id, false)).join('')}</div>
      <div style="margin-top:8px">${t('dna.cost')}: <b>${cost} %</b>${opts.hard ? '' : ` · ${t('dna.hintMarked')}`}</div>
      <div style="height:12px;background:#0e0b33;border-radius:6px;margin:4px 0"><i style="display:block;height:100%;width:${Math.min(100, cost / 0.15)}%;background:${cost > 10 ? '#ff7a59' : '#5ad6b2'};border-radius:6px"></i></div>
      ${extra}
      <button class="mn-btn" data-test ${full() ? '' : 'disabled'} style="margin-top:6px;min-height:46px;width:100%">${t('dna.test')}</button></div>`;
    root.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.k === 'strain') strain = STRAINS.find((x) => x.id === b.dataset.id);
      else (design as Record<string, string>)[b.dataset.k!] = b.dataset.id!;
      render();
    }));
    root.querySelector('[data-test]')?.addEventListener('click', () => { if (full()) test(); });
  };
  const test = (): void => {
    const d = design as DnaDesign;
    let sec = 0;
    const tick = (): void => {
      if (dead) return;
      sec++;
      const active = d.sw === 'always' || [2, 6, 10].some((e) => Math.abs(sec - e) <= 1);
      const responds = d.sensor === problem.sensor && active;
      root.innerHTML = `<div style="${BOX};padding:14px;font-size:15px">
        <div>🧪 ${t('dna.capsule')} · ${sec}/12 s</div><p>${problemText}</p>
        ${[0, 1, 2].map(() => `<div style="height:26px;margin:10px 0;border-radius:6px;border:3px solid #0e0b33;background:${responds ? '#5ad6b2' : '#c4c2e0'};transition:background .2s"></div>`).join('')}
        <p>${responds ? t('dna.responds') : t('dna.waits')}</p></div>`;
      if (sec >= 12) { finishAttempt(); return; }
      timer = window.setTimeout(tick, 400); // 12 s de cápsula comprimidos a ~5 s de juego
    };
    tick();
  };
  /** Una frase que explica qué pasó, para que cada intento enseñe algo. */
  const reason = (d: DnaDesign, s: Strain): string => {
    if (d.sensor !== problem.sensor) return t('dna.why.sensor');
    if (d.fn !== problem.fn) return t('dna.why.fn');
    if (s.good !== problem.sensor) return t('dna.why.strain');
    if (dnaCostFor(d, s) > 0.1) return t('dna.why.cost');
    return t('dna.why.good');
  };
  const finishAttempt = (): void => {
    const d = design as DnaDesign;
    const s = strain!;
    best = Math.max(best, dnaScoreFor(d, problem, s));
    const msg = `${t('dna.fit')}: ${Math.round(dnaFit(d, problem) * 100)} % · ${t('dna.efficiency')}: ${Math.round(dnaEfficiencyFor(d, s) * 100)} %`;
    if (attempt >= 2) {
      root.innerHTML = `<div style="${BOX};padding:14px;font-size:15px"><p>${msg}</p><p>${reason(d, s)}</p><p>${t('dna.tradeoff')}</p></div>`;
      timer = window.setTimeout(() => { if (!dead) opts.onDone(best); }, 1400);
      return;
    }
    attempt = 2;
    render(`<p style="margin:2px 0;font-size:13px">${msg}</p><p style="margin:2px 0;font-size:13px;color:#cfeaff">${reason(d, s)}</p><button class="mn-btn mn-btn--secondary mn-btn--sm" data-keep>${t('dna.keep')}</button>`);
    root.querySelector('[data-keep]')?.addEventListener('click', () => opts.onDone(best));
  };
  render();
  return { destroy() { dead = true; clearTimeout(timer); } };
}

const PEAK_SHAPES = ['▲', '■', '●', '◆'];

export function mountBiofirmas(root: HTMLElement, opts: { hard: boolean; seed: number; onDone(score: number): void }): MiniGameHandle {
  const sample = makeSample(opts.seed, opts.hard);
  const done = new Set<BioTest>();
  let picked = -1;
  let warned = false;
  let timer = 0;
  let dead = false;
  const box = (inner: string): string => `<div style="${BOX};padding:12px">${inner}</div>`;
  const testLabel = (k: BioTest): string => t(`bio.test.${k}`);
  const render = (note = ''): void => {
    const specDone = done.has('spectrum');
    root.innerHTML = box(`
      <div>🔬 ${t('bio.title')}: ${t('bio.question')}</div>
      <div style="margin:8px 0">${BIO_TESTS.map((k) => `<button class="mn-btn mn-btn--sm" data-test="${k}" ${done.has(k) || (k !== 'spectrum' && !specDone) ? 'disabled' : ''} style="min-height:46px;margin:3px">${done.has(k) ? '✔' : '▶'} ${testLabel(k)}</button>`).join('')}</div>
      ${specDone ? `<div>${t('bio.pick')}: ${Array.from({ length: sample.options }, (_, i) => `<button class="mn-btn mn-btn--sm" data-peak="${i}" aria-pressed="${picked === i}" style="min-width:64px;min-height:44px;margin:3px;${picked === i ? 'outline:3px solid #ffcb47;' : ''}">${PEAK_SHAPES[i]}</button>`).join('')}</div>` : ''}
      <div style="margin-top:8px">${[...done].map((k) => `<div>${sample.result[k] ? '🟢' : '🔴'} ${testLabel(k)}: ${sample.result[k] ? t('bio.match') : t('bio.noMatch')}</div>`).join('')}</div>
      <p style="min-height:36px">${note}</p>
      <button class="mn-btn" data-report="1" style="min-height:48px;width:100%;margin-top:4px">${t('bio.reportYes')}</button>
      <button class="mn-btn mn-btn--secondary" data-report="0" style="min-height:48px;width:100%;margin-top:6px">${t('bio.reportNo')}</button>`);
    root.querySelectorAll<HTMLButtonElement>('[data-test]').forEach((b) => b.addEventListener('click', () => { done.add(b.dataset.test as BioTest); render(); }));
    root.querySelectorAll<HTMLButtonElement>('[data-peak]').forEach((b) => b.addEventListener('click', () => { picked = Number(b.dataset.peak); render(); }));
    root.querySelectorAll<HTMLButtonElement>('[data-report]').forEach((b) => b.addEventListener('click', () => report(b.dataset.report === '1')));
  };
  const report = (alive: boolean): void => {
    if (needsMoreTests(done.size) && !warned) {
      warned = true;
      render(t('bio.moreTests'));
      return;
    }
    const score = bioScore(sample, picked, done.size, alive);
    root.innerHTML = box(`<p>${alive ? t('bio.reportedYes') : t('bio.reportedNo')}</p><p>${t('bio.lesson')}</p>`);
    timer = window.setTimeout(() => { if (!dead) opts.onDone(score); }, 2200);
  };
  render();
  return { destroy() { dead = true; clearTimeout(timer); } };
}
