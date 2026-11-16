import { t } from './i18n';
import { alertFx } from './miniFx';
/**
 * Minijuego de limpiar los paneles: dos paneles solares con su pata de abajo, cubiertos de polvo, y un cepillo.
 * Se limpia a mano: arrastrando el ratón o el dedo, o con las flechas del teclado. Al sacar casi todo el polvo, termina.
 * Solo usa DOM y canvas (sin Phaser): lo monta la escena de la estación dentro de un panel.
 */
const W = 380;
const H = 500;
/** Dos paneles solares a los lados de un mástil, con su pata de abajo (como el panel del mapa). */
const PANELS = [{ x: 22, y: 26, w: 150, h: 330 }, { x: 208, y: 26, w: 150, h: 330 }];
const AREA = { x: 22, y: 26, w: 336, h: 330 };    // zona con celdas (los dos paneles juntos): ahí cae el polvo
const BRUSH_R = 22;                               // radio de limpieza del cepillo
const DONE_AT = 0.96;                             // fracción de polvo limpiada para terminar
const KEY_STEP = 18;

export interface DustGame {
  /** Mueve el cepillo (teclado): limpia por donde pasa. */
  nudge(dx: number, dy: number): void;
  destroy(): void;
}

interface Options {
  /** Polvo acumulado en los paneles (0–1): más polvo, más manchas. */
  dust: number;
  onProgress(fraction: number): void;
  onDone(): void;
}

const BRUSH_SVG = `<svg viewBox="0 0 96 96" width="86" height="86" aria-hidden="true">
  <g transform="rotate(-35 48 48)">
    <rect x="40" y="2" width="14" height="46" rx="6" fill="#9b7bff" stroke="#0e0b33" stroke-width="4"/>
    <rect x="22" y="44" width="50" height="14" rx="5" fill="#c4c2e0" stroke="#0e0b33" stroke-width="4"/>
    <path d="M26 58 v26 M34 58 v30 M42 58 v32 M50 58 v32 M58 58 v30 M66 58 v26" stroke="#0e0b33" stroke-width="7" stroke-linecap="round"/>
    <path d="M26 58 v26 M34 58 v30 M42 58 v32 M50 58 v32 M58 58 v30 M66 58 v26" stroke="#e3bd84" stroke-width="3.5" stroke-linecap="round"/>
  </g></svg>`;

function drawPanel(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // pata de abajo: mástil central, tirantes diagonales, caja de conexiones y placa de apoyo en el suelo
  ctx.fillStyle = '#9a98c8';
  ctx.strokeStyle = '#0e0b33';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.ellipse(190, 470, 92, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#0e0b33'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(190, 456); ctx.lineTo(120, 462); ctx.moveTo(190, 456); ctx.lineTo(260, 462); ctx.moveTo(190, 420); ctx.lineTo(132, 458); ctx.moveTo(190, 420); ctx.lineTo(248, 458); ctx.stroke();
  ctx.strokeStyle = '#c4c2e0'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(190, 456); ctx.lineTo(120, 462); ctx.moveTo(190, 456); ctx.lineTo(260, 462); ctx.moveTo(190, 420); ctx.lineTo(132, 458); ctx.moveTo(190, 420); ctx.lineTo(248, 458); ctx.stroke();
  ctx.fillStyle = '#c4c2e0'; ctx.strokeStyle = '#0e0b33'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(176, 340, 28, 128, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#9a98c8';
  ctx.beginPath(); ctx.roundRect(160, 380, 60, 34, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffcb47'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(190, 397, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#18144e';
  ctx.beginPath(); ctx.roundRect(208, 420, 34, 22, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#5ad6b2';
  ctx.beginPath(); ctx.arc(225, 431, 4, 0, Math.PI * 2); ctx.fill();
  // brazos que unen cada panel con el mástil
  ctx.strokeStyle = '#0e0b33'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(176, 352); ctx.lineTo(120, 340); ctx.moveTo(204, 352); ctx.lineTo(260, 340); ctx.stroke();
  ctx.strokeStyle = '#c4c2e0'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(176, 352); ctx.lineTo(120, 340); ctx.moveTo(204, 352); ctx.lineTo(260, 340); ctx.stroke();
  // los dos paneles
  for (const { x, y, w, h } of PANELS) {
    ctx.fillStyle = '#c4c2e0';
    ctx.strokeStyle = '#0e0b33';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.roundRect(x - 9, y - 9, w + 18, h + 18, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2a3f8f';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
    const glass = ctx.createLinearGradient(x, y, x + w, y + h);
    glass.addColorStop(0, 'rgba(76,195,245,.24)'); glass.addColorStop(0.5, 'rgba(76,195,245,0)'); glass.addColorStop(1, 'rgba(14,11,51,.32)');
    ctx.fillStyle = glass;
    ctx.fillRect(x, y, w, h);
    // celdas: 3 columnas × 6 filas
    ctx.strokeStyle = '#4cc3f5';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) { ctx.moveTo(x + (w / 3) * i, y); ctx.lineTo(x + (w / 3) * i, y + h); }
    for (let j = 1; j < 6; j++) { ctx.moveTo(x, y + (h / 6) * j); ctx.lineTo(x + w, y + (h / 6) * j); }
    ctx.stroke();
    ctx.strokeStyle = '#0e0b33';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
    // tornillos del marco y brillo
    ctx.fillStyle = '#e4e3f2';
    ctx.lineWidth = 2;
    for (const [bx, by] of [[x - 4, y - 4], [x + w + 4, y - 4], [x - 4, y + h + 4], [x + w + 4, y + h + 4]]) { ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath(); ctx.moveTo(x + 12, y + 12); ctx.lineTo(x + 78, y + 12); ctx.lineTo(x + 36, y + 120); ctx.lineTo(x + 12, y + 120); ctx.fill();
  }
}

/** Manchas de polvo irregulares (como en el boceto) y granitos sueltos sobre el vidrio. */
function drawDust(ctx: CanvasRenderingContext2D, dust: number): void {
  ctx.clearRect(0, 0, W, H);
  const patches = 8 + Math.round(Math.min(1, dust) * 8);
  for (let p = 0; p < patches; p++) {
    const panel = PANELS[p % 2]; // las manchas se reparten entre los dos paneles
    const cx = panel.x + 24 + Math.random() * (panel.w - 48);
    const cy = panel.y + 24 + Math.random() * (panel.h - 48);
    const r = 17 + Math.random() * 15;
    ctx.fillStyle = Math.random() < 0.5 ? '#b4ae9e' : '#9c9684';
    ctx.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.65 + Math.random() * 0.5);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr * 0.8;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(cx + (Math.random() - 0.5) * r * 1.2, cy + (Math.random() - 0.5) * r, 1.8 + Math.random() * 2, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.fillStyle = '#b4ae9e';
  for (let i = 0; i < 40 + dust * 60; i++) {
    const panel = PANELS[i % 2];
    ctx.beginPath(); ctx.arc(panel.x + 8 + Math.random() * (panel.w - 16), panel.y + 8 + Math.random() * (panel.h - 16), 1.5 + Math.random() * 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

function dustPixels(ctx: CanvasRenderingContext2D): number {
  const data = ctx.getImageData(AREA.x, AREA.y, AREA.w, AREA.h).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 16) if (data[i] > 40) n++; // se muestrea 1 de cada 4 píxeles
  return n;
}

/** Monta el minijuego dentro de `root` (se vacía antes). */
export function mountDustGame(root: HTMLElement, opts: Options): DustGame {
  root.innerHTML = `<div class="dust" style="width:${W}px;height:${H}px">
    <canvas class="dust__panel" width="${W}" height="${H}"></canvas>
    <canvas class="dust__dirt" width="${W}" height="${H}" aria-label="${t('mini.dust')}" role="img"></canvas>
    <div class="dust__brush is-demo" aria-hidden="true">${BRUSH_SVG}</div></div>`;
  const wrap = root.firstElementChild as HTMLElement;
  const [panel, dirt] = [...wrap.querySelectorAll('canvas')] as HTMLCanvasElement[];
  const brush = wrap.querySelector<HTMLElement>('.dust__brush')!;
  drawPanel(panel.getContext('2d')!);
  const dctx = dirt.getContext('2d', { willReadFrequently: true })!;
  drawDust(dctx, opts.dust);
  let total = Math.max(1, dustPixels(dctx));
  let gusted = false;
  let cx = AREA.x + AREA.w / 2;
  let cy = AREA.y + AREA.h + 60;
  let drawing = false;
  let finished = false;
  let last: { x: number; y: number } | null = null;
  let timer = 0;

  const place = (): void => {
    brush.classList.remove('is-demo'); // al tocar, el cepillo deja de mostrar la demostración
    brush.style.transform = `translate(${cx - 14}px, ${cy - 70}px)`;
  };
  const check = (): void => {
    let fraction = Math.min(1, 1 - dustPixels(dctx) / total);
    if (!gusted && fraction >= 0.5 && fraction < 0.85) { // evento: una ráfaga de viento trae 3 manchas nuevas
      gusted = true;
      const before = dustPixels(dctx);
      for (let k = 0; k < 3; k++) {
        const pn = PANELS[k % 2];
        const gx = pn.x + 30 + Math.random() * (pn.w - 60);
        const gy = pn.y + 30 + Math.random() * (pn.h - 60);
        dctx.fillStyle = '#b4ae9e';
        dctx.beginPath(); dctx.ellipse(gx, gy, 26 + Math.random() * 8, 20, Math.random(), 0, Math.PI * 2); dctx.fill();
      }
      total += Math.max(0, dustPixels(dctx) - before);
      alertFx(root, '💨', '#4cc3f5');
      fraction = Math.min(1, 1 - dustPixels(dctx) / total);
    }
    opts.onProgress(fraction);
    if (fraction >= DONE_AT && !finished) {
      finished = true;
      dctx.clearRect(0, 0, W, H);
      opts.onDone();
    }
  };
  const scrub = (nx: number, ny: number): void => {
    if (finished) return;
    dctx.save();
    dctx.globalCompositeOperation = 'destination-out';
    dctx.lineWidth = BRUSH_R * 2;
    dctx.lineCap = 'round';
    dctx.beginPath();
    dctx.moveTo(last?.x ?? nx, last?.y ?? ny);
    dctx.lineTo(nx, ny);
    dctx.stroke();
    dctx.restore();
    last = { x: nx, y: ny };
    window.clearTimeout(timer);
    timer = window.setTimeout(check, 60); // se mide al terminar el trazo, no en cada movimiento
  };
  const toLocal = (ev: PointerEvent): { x: number; y: number } => {
    const r = dirt.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
  };
  const move = (ev: PointerEvent): void => {
    const p = toLocal(ev);
    cx = p.x; cy = p.y;
    place();
    if (drawing) scrub(cx, cy);
  };
  const down = (ev: PointerEvent): void => {
    drawing = true;
    last = null;
    dirt.setPointerCapture(ev.pointerId);
    move(ev);
    ev.preventDefault();
  };
  const up = (): void => { drawing = false; last = null; };
  dirt.addEventListener('pointerdown', down);
  dirt.addEventListener('pointermove', move);
  dirt.addEventListener('pointerup', up);
  dirt.addEventListener('pointercancel', up);
  brush.style.transform = `translate(${cx - 14}px, ${cy - 70}px)`; // posición inicial: la demostración la anima
  opts.onProgress(0);

  return {
    nudge(dx, dy) {
      cx = Math.min(W - 6, Math.max(6, cx + dx * KEY_STEP));
      cy = Math.min(H - 6, Math.max(6, cy + dy * KEY_STEP));
      place();
      scrub(cx, cy);
    },
    destroy() {
      window.clearTimeout(timer);
      finished = true;
    },
  };
}
