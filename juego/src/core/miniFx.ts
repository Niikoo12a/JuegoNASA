/**
 * Efectos visuales cortos para los eventos sorpresa de los minijuegos (sin texto, pensados para 7–12 años):
 * un símbolo grande que aparece y se desvanece, y un destello de color en el borde. Respetan «reducir movimiento» desde el CSS.
 */
const host = (root: HTMLElement): HTMLElement => {
  const wrap = (root.firstElementChild as HTMLElement | null) ?? root;
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  return wrap;
};

/** Símbolo grande en el centro (p. ej. ⚡, 💨, ⭐) que dura ~1 s. */
export function pop(root: HTMLElement, glyph: string, color = '#ffcb47'): void {
  const el = document.createElement('div');
  el.className = 'mfx-pop';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = glyph;
  el.style.color = color;
  host(root).appendChild(el);
  window.setTimeout(() => el.remove(), 1100);
}

/** Marco de color que titila 3 veces (~0,9 s) para avisar que pasó algo. */
export function flash(root: HTMLElement, color = '#ffcb47'): void {
  const el = document.createElement('div');
  el.className = 'mfx-flash';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--mfx', color);
  host(root).appendChild(el);
  window.setTimeout(() => el.remove(), 1000);
}

/** Aviso completo de un evento: símbolo + marco. */
export const alertFx = (root: HTMLElement, glyph: string, color = '#ffcb47'): void => { pop(root, glyph, color); flash(root, color); };

/** Entero al azar en [a, b]. */
export const between = (a: number, b: number): number => a + Math.random() * (b - a);
