import { getLang } from './i18n';
import { state } from './state';
import { GUIDES, takeGuide, type GuideKey, type ScriptLine } from '../data/earthGuides';
import type { MiniGameHandle } from './miniGames';

/**
 * Guía de «Control Tierra» antes de un minijuego: una transmisión corta (retrato de antena, texto que se escribe solo) que explica qué se hace
 * y por qué ayuda a la misión. Un toque, Enter o Espacio avanzan; «Saltar» la cierra. Cada guía sale una vez por sesión.
 */
const TIERRA_FACE = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#10243a"/><circle cx="32" cy="34" r="22" fill="#1d5a8a"/><path d="M14 30c4 14 14 22 28 20 0-8-6-18-14-22-5-2-10-1-14 2z" fill="#3a9a5a"/><g transform="rotate(-30 32 34)"><path d="M18 34a14 10 0 0 0 28 0z" fill="#e8eef5"/><path d="M32 34V18" stroke="#e8eef5" stroke-width="2"/><circle cx="32" cy="17" r="2.5" fill="#ffcb47"/></g><path d="M44 12a14 14 0 0 1 8 8M42 6a22 22 0 0 1 14 14" fill="none" stroke="#9fe7c8" stroke-width="2" stroke-linecap="round"/></svg>';
const NAME = { es: 'Control Tierra', en: 'Earth Control' };
const SKIP = { es: 'Saltar', en: 'Skip' };

/** ¿Hay que mostrar esta guía ahora? (la primera vez de la sesión). */
export const shouldGuide = (key: GuideKey): boolean => takeGuide(key);

/**
 * Muestra la guía y, al terminar, monta el minijuego en el mismo escenario. El asa que devuelve reenvía flechas y teclas al juego
 * una vez montado; mientras suena la guía, Enter y Espacio la avanzan.
 */
export function mountGuided(root: HTMLElement, key: GuideKey, mount: (root: HTMLElement) => MiniGameHandle, onMounted?: (h: MiniGameHandle) => void): MiniGameHandle {
  const lang = getLang();
  const lines: ScriptLine[] = GUIDES[key];
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let inner: MiniGameHandle | null = null;
  let i = -1;
  let timer = 0;
  let full = '';
  let shown = 0;
  let closed = false;
  const box = document.createElement('div');
  box.className = 'egd';
  box.innerHTML = `<button class="mn-btn mn-btn--secondary mn-btn--sm egd__skip" data-skip>${SKIP[lang]}</button>
    <div class="egd__box"><span class="egd__who"></span><div class="egd__face"></div><p class="egd__text" aria-live="polite"></p><p class="egd__note" hidden></p><span class="egd__next" aria-hidden="true">▼</span></div>`;
  root.appendChild(box);
  const bx = box.querySelector<HTMLElement>('.egd__box')!;
  const who = box.querySelector<HTMLElement>('.egd__who')!;
  const face = box.querySelector<HTMLElement>('.egd__face')!;
  const text = box.querySelector<HTMLElement>('.egd__text')!;
  const note = box.querySelector<HTMLElement>('.egd__note')!;
  const mark = box.querySelector<HTMLElement>('.egd__next')!;
  const finishLine = (): void => { window.clearInterval(timer); timer = 0; shown = full.length; text.textContent = full; mark.style.visibility = 'visible'; };
  const close = (): void => {
    if (closed) return;
    closed = true;
    window.clearInterval(timer);
    box.remove();
    inner = mount(root);
    onMounted?.(inner);
  };
  const next = (): void => {
    if (closed) return;
    if (timer) return finishLine();
    i++;
    if (i >= lines.length) return close();
    const line = lines[i];
    full = lang === 'es' ? line.es : line.en;
    const narra = line.who === 'NARRA';
    who.textContent = narra ? '' : NAME[lang];
    who.hidden = narra;
    face.hidden = narra;
    if (!narra) face.innerHTML = TIERRA_FACE;
    bx.classList.toggle('no-face', narra);
    text.classList.toggle('is-narra', narra);
    text.classList.toggle('is-whisper', line.fx === 'whisper');
    note.hidden = !line.note;
    note.textContent = line.note ? line.note[lang] : '';
    if (line.fx === 'dim' && !state.calm && !reduce) { // guiño de la historia: la luz cae un instante
      const dim = document.createElement('div');
      dim.className = 'egd__dim';
      root.appendChild(dim);
      window.setTimeout(() => dim.remove(), 1600);
    }
    mark.style.visibility = 'hidden';
    shown = 0;
    text.textContent = '';
    if (reduce) return finishLine();
    timer = window.setInterval(() => { shown++; text.textContent = full.slice(0, shown); if (shown >= full.length) finishLine(); }, 24);
  };
  box.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-skip]')) close(); else next(); });
  next();
  return {
    get gesture() { return inner?.gesture; },
    get keys() { return inner?.keys; },
    nudge(dx, dy) { inner?.nudge?.(dx, dy); },
    key(k, down) {
      if (inner) return inner.key?.(k, down) ?? false;
      if (down && (k === ' ' || k === 'enter')) next();
      return true;
    },
    destroy() { closed = true; window.clearInterval(timer); box.remove(); inner?.destroy(); },
  };
}
