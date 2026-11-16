import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT } from '../core/config';
import { state } from '../core/state';
import { FONT_DISPLAY, FONT_MONO, tokenColor, tokenCss } from '../core/theme';
import { fadeIn, fadeTo } from '../core/fade';
import { audio } from '../core/audio';
import { UiLayer } from '../core/ui';
import { icon } from '../core/icons';
import { dateLocale, t, t as tr } from '../core/i18n'; // `tr`: donde `t` es el tiempo de la animación
import { queueStationAssets } from '../data/preload';
import { addSvgTexture, michiSvg } from '../core/art';
import { MAP_RASTER, MAP_TEXTURE, stationSvg } from '../core/stationArt';
import { addDrawnProps, drawnPropsReady } from '../core/propArt';
import { MAP_W, MAP_H } from '../sim/stationMap';
import { LAYERS, CISLUNAR, layerLine } from '../data/atmosphere';
import { CHARACTERS, characterRole, type Character } from '../data/characters';
import {
  ASCENT_MS, COUNTDOWN_FROM, COUNTDOWN_START_MS, IGNITION_MS, LAYER_LINE_AT, LIFTOFF_MS,
  altitudeKm, fillName, launchScript, type LaunchLine, type Speaker,
} from '../data/launch';
import { CROWD_KEYS, ensureBangTexture, ensureCrowdTextures, ensureGullTextures, ensureSoftTextures } from '../core/launchArt';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

const W = GAME_WIDTH;
const H = GAME_HEIGHT;
const INK = 0x0e0b33;
const LAND_Y = 626;            // donde termina el mar y empieza la tierra
const ROCKET_X = 1000;
const DECK_Y = 548;            // cubierta de la plataforma de lanzamiento (infraestructura metálica)
const GAP_L = ROCKET_X - 45;   // abertura de la plataforma por donde sale el fuego
const GAP_R = ROCKET_X + 45;
const PIVOT_Y = DECK_Y - 28;   // el cohete gira desde su base (origen abajo)
const ROCKET_SCALE = 0.82;
/** Toberas del cohete (px desde el centro, a escala ROCKET_SCALE): de ahí sale el fuego. */
const NOZZLES = [-16, 0, 16];
const ACCEL = 94;              // px/s² de la subida
const SKY_TOP = -4800;
const END_MS = LIFTOFF_MS + ASCENT_MS;
const HOLD_MS = 1100;          // cuánto se queda una línea de diálogo después de escribirse
const CALM_SPEED = 1.4;

/** Tonos del humo y el vapor del lanzamiento: crema, arena y gris pardo, con un toque anaranjado cerca del fuego. */
const SMOKE_TINTS = [0xfff1e0, 0xeadbc8, 0xcdb9a4, 0xb59f94, 0xf7c9a0];
/** Llama: núcleo blanco-amarillo, cuerpo anaranjado y bordes morados / magenta. */
const FLAME_CORE = [0xfff3b0, 0xffd26a];
const FLAME_MID = [0xff8a1f, 0xff5a1f];
const FLAME_EDGE = [0xb44cff, 0x7a3cff, 0xff4fa8];

const smooth = (a: number, b: number, x: number): number => {
  const k = Phaser.Math.Clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

interface Gull {
  img: Phaser.GameObjects.Image;
  homeX: number;
  homeY: number;
  flying: boolean;
}

/**
 * Pantalla de carga: el despegue visto desde la costa, al amanecer.
 * Control de misión (torre) habla directo con el tripulante elegido mientras corre el conteo regresivo;
 * T-6 enciende los motores principales (vapor, temblor, gaviotas asustadas) y T-0 los propulsores y el despegue.
 * La carga real corre en paralelo: la pantalla nunca avanza más allá del final de la subida hasta que todo esté cargado.
 */
export class LaunchLoadingScene extends Phaser.Scene {
  private ready = false;
  private done = false;
  /** El jugador pidió saltar el despegue: se llega a la estación apenas termine la carga. */
  private skip = false;
  private calm = false;
  private light = false;
  private speed = 1;
  private clock = 0;
  private loadProgress = 0;

  private crew!: Character;
  private rocket!: Phaser.GameObjects.Image;
  private arms: Phaser.GameObjects.Rectangle[] = [];
  private gulls: Gull[] = [];
  private link!: Phaser.GameObjects.Graphics;
  private radioLight!: Phaser.GameObjects.Arc;

  // efectos de fuego y humo
  private emIgnition: Emitter[] = [];
  private emBooster: Emitter[] = [];
  private emSmoke: Emitter[] = [];
  private emTrail: Emitter | null = null;
  private flameCore: Phaser.GameObjects.Image[] = [];
  private flameEdge: Phaser.GameObjects.Image[] = [];
  private glowDeck!: Phaser.GameObjects.Image;
  private glowViolet!: Phaser.GameObjects.Image;
  private crowd: Phaser.GameObjects.Image[] = [];
  private flashes: Array<[number, number]> = [];

  // interfaz fija (no tiembla con la cámara)
  private portraitControl!: Phaser.GameObjects.Image;
  private portraitCrew!: Phaser.GameObjects.Image;
  private speakerName!: Phaser.GameObjects.Text;
  private speakerText!: Phaser.GameObjects.Text;
  private ui: Phaser.GameObjects.GameObject[] = [];
  private panelLabel!: Phaser.GameObjects.Text;
  private panelValue!: Phaser.GameObjects.Text;

  // guion
  private queue: LaunchLine[] = [];
  private lineText = '';
  private typed = 0;
  private lineDone = true;
  private heldMs = 0;
  private lastCount = -1;
  private layerShown = 0;
  private ignited = false;
  private lifted = false;
  private camOff = 0;
  private prevTarget = 0;
  private thrust = 0;
  private flashTimer = 0;
  private rumbleTimer = 0;
  private trailStopped = false;
  private smokeStopped = false;

  constructor() {
    super(SCENES.launch);
  }

  create(): void {
    audio.setMood('launch');
    const loadout = state.loadout;
    if (!loadout) {
      this.scene.start(SCENES.select);
      return;
    }
    this.crew = CHARACTERS.find((c) => c.id === loadout.character) ?? CHARACTERS[0];
    this.calm = state.calm;
    this.light = state.settings.ultraLight;
    this.speed = this.calm ? CALM_SPEED : 1;
    this.resetRun();

    ensureSoftTextures(this);
    ensureCrowdTextures(this);
    ensureGullTextures(this);
    ensureBangTexture(this);
    this.cameras.main.setScroll(0, 0);

    fadeIn(this, 500);
    this.buildSky();
    this.buildLand();
    this.buildHangar();
    this.buildPad();
    this.buildControlTower();
    this.buildCrowdAndPress();
    this.buildRocket();
    this.buildEffects();
    this.buildUi();
    this.queue = launchScript();

    this.startLoading(loadout);
    this.bindSkip();
    if (state.progress.launchSeen) this.skip = true; // solo la primera vez se ve el despegue entero
    this.ready = true;
  }

  private resetRun(): void {
    Object.assign(this, {
      ready: false, done: false, skip: false, clock: 0, loadProgress: 0, queue: [], lineText: '', typed: 0, lineDone: true, heldMs: 0,
      lastCount: -1, layerShown: 0, ignited: false, lifted: false, camOff: 0, prevTarget: 0, thrust: 0, flashTimer: 0,
      rumbleTimer: 0, trailStopped: false, smokeStopped: false,
      arms: [], gulls: [], crowd: [], flashes: [], emIgnition: [], emBooster: [], emSmoke: [], emTrail: null, ui: [],
    });
  }

  /** Carga real de los assets de la estación (igual que antes; la animación decide cuándo se ve el final). */
  private startLoading(loadout: NonNullable<typeof state.loadout>): void {
    queueStationAssets(this.load, loadout);
    // el plano y los objetos dibujados se rasterizan en paralelo; la carga termina cuando está todo
    let files = 0;
    let map = this.textures.exists(MAP_TEXTURE) && drawnPropsReady(this.textures);
    const sync = (): void => void (this.loadProgress = Math.min(files, map ? 1 : 0.95));
    void Promise.all([addSvgTexture(this.textures, MAP_TEXTURE, stationSvg(), MAP_W, MAP_H, MAP_RASTER), addDrawnProps(this.textures)]).then(() => {
      map = true;
      sync();
    });
    this.load.on(Phaser.Loader.Events.PROGRESS, (v: number) => {
      files = v;
      sync();
    });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      files = 1;
      sync();
    });
    this.load.start();
  }

  // ───────────────────────── Escenario ─────────────────────────

  /** Cielo alto (desde el amanecer en el horizonte hasta el espacio), con estrellas y nubes teñidas por el sol. */
  private buildSky(): void {
    const g = this.add.graphics().setDepth(0);
    const stops: Array<[number, number]> = [
      [LAND_Y, 0xffd9a0], [540, 0xffa97a], [440, 0xe07d9a], [300, 0x8a5fae], [120, 0x3f3f8f],
      [-300, 0x1d2a6b], [-1200, 0x121a52], [-2500, 0x0a0b33], [SKY_TOP, 0x05051f],
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const [y0, c0] = stops[i];
      const [y1, c1] = stops[i + 1];
      g.fillGradientStyle(c1, c1, c0, c0, 1).fillRect(0, y1, W, y0 - y1 + 1);
    }
    const rnd = new Phaser.Math.RandomDataGenerator(['dawn']);
    for (let i = 0; i < 320; i++) {
      const y = rnd.between(SKY_TOP, 330);
      g.fillStyle(0xffffff, Phaser.Math.Clamp((330 - y) / 1500, 0.1, 0.95)).fillCircle(rnd.between(0, W), y, rnd.frac() > 0.9 ? 1.7 : 1);
    }

    // el sol asomando por el mar
    this.add.image(250, 592, 'puff').setScale(8).setTint(0xffc27a).setAlpha(0.7).setDepth(1);
    this.add.circle(250, 596, 46, 0xfff1c2).setDepth(1);

    // nubes bajas teñidas de rosa y más arriba cada vez más frías
    const clouds = this.add.graphics().setDepth(1.5);
    for (let i = 0; i < 14; i++) {
      const y = rnd.between(-1300, 500);
      const warm = Phaser.Math.Clamp((y + 100) / 600, 0, 1);
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(0xb9c7ff), Phaser.Display.Color.ValueToColor(0xffb199), 100, Math.round(warm * 100));
      clouds.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 0.7);
      const cx = rnd.between(0, W);
      [[0, 0, 54], [46, 8, 40], [-44, 10, 36], [16, -18, 34]].forEach(([dx, dy, r]) => clouds.fillCircle(cx + dx, y + dy, r));
    }
  }

  private buildLand(): void {
    const sea = this.add.graphics().setDepth(2);
    sea.fillGradientStyle(0xf0a07a, 0xf0a07a, 0x5b4a86, 0x5b4a86, 1).fillRect(0, 586, W, LAND_Y - 586);
    const rnd = new Phaser.Math.RandomDataGenerator(['sea']);
    for (let i = 0; i < 26; i++) {
      const w = rnd.between(30, 90);
      sea.fillStyle(0xffe2a8, rnd.between(25, 70) / 100).fillRect(250 - w / 2 + rnd.between(-120, 120), rnd.between(590, LAND_Y - 4), w, 2);
    }
    const hills = this.add.graphics().setDepth(3);
    hills.fillStyle(0x4a3f78, 1).fillEllipse(60, 612, 420, 70).fillEllipse(560, 620, 560, 46);

    const land = this.add.graphics().setDepth(4);
    land.fillGradientStyle(0x3d3f63, 0x3d3f63, 0x1d2340, 0x1d2340, 1).fillRect(-40, LAND_Y, W + 80, H - LAND_Y + 40);
    land.fillStyle(0xff9a6b, 0.35).fillRect(-40, LAND_Y, W + 80, 3);
  }

  /** Plataforma de lanzamiento: cubierta de acero con abertura para el fuego, torre de servicio, brazos, mástil y tanque de agua. */
  private buildPad(): void {
    const steel = 0x7d7aa0;
    const dark = 0x5a5880;
    const g = this.add.graphics().setDepth(5);
    // foso del fuego y deflector
    g.fillStyle(0x14122e, 1).fillRect(GAP_L - 6, DECK_Y, GAP_R - GAP_L + 12, LAND_Y - DECK_Y + 30);
    g.fillStyle(0x3a3a5c, 1).lineStyle(2.6, INK, 1).fillTriangle(GAP_L, LAND_Y + 26, GAP_R, LAND_Y + 26, ROCKET_X, LAND_Y - 40).strokeTriangle(GAP_L, LAND_Y + 26, GAP_R, LAND_Y + 26, ROCKET_X, LAND_Y - 40);
    // patas de la plataforma (celosía)
    g.lineStyle(3, dark, 1);
    const legs = [[850, GAP_L - 8], [GAP_R + 8, 1150]];
    legs.forEach(([x0, x1]) => {
      g.lineBetween(x0 + 6, DECK_Y + 26, x0 + 6, LAND_Y + 8).lineBetween(x1 - 6, DECK_Y + 26, x1 - 6, LAND_Y + 8);
      const levels = [DECK_Y + 26, DECK_Y + 56, DECK_Y + 86, LAND_Y + 8];
      for (let i = 0; i < levels.length - 1; i++) {
        g.lineBetween(x0 + 6, levels[i], x1 - 6, levels[i + 1]).lineBetween(x1 - 6, levels[i], x0 + 6, levels[i + 1]);
        g.lineBetween(x0 + 6, levels[i + 1], x1 - 6, levels[i + 1]);
      }
    });
    // cubiertas
    const deck = this.add.graphics().setDepth(6);
    deck.fillStyle(steel, 1).lineStyle(2.6, INK, 1);
    [[850, GAP_L], [GAP_R, 1150]].forEach(([x0, x1]) => deck.fillRect(x0, DECK_Y, x1 - x0, 26).strokeRect(x0, DECK_Y, x1 - x0, 26));
    deck.fillStyle(0xdcdcec, 1).fillRect(850, DECK_Y - 2, GAP_L - 850, 4).fillRect(GAP_R, DECK_Y - 2, 1150 - GAP_R, 4);
    // soportes que sostienen el cohete
    deck.fillStyle(dark, 1).fillRect(GAP_L - 8, DECK_Y - 18, 12, 18).strokeRect(GAP_L - 8, DECK_Y - 18, 12, 18).fillRect(GAP_R - 4, DECK_Y - 18, 12, 18).strokeRect(GAP_R - 4, DECK_Y - 18, 12, 18);

    // torre de servicio (celosía) con brazos que se retiran al encender
    const tx0 = 1108;
    const tx1 = 1146;
    const top = 170;
    deck.lineStyle(5, steel, 1).lineBetween(tx0, DECK_Y, tx0, top).lineBetween(tx1, DECK_Y, tx1, top);
    deck.lineStyle(2.4, dark, 1);
    for (let y = DECK_Y; y > top + 36; y -= 38) {
      deck.lineBetween(tx0, y, tx1, y - 38).lineBetween(tx1, y, tx0, y - 38).lineBetween(tx0, y - 38, tx1, y - 38);
    }
    deck.fillStyle(0xff6b7a, 1).fillRect(tx0 - 3, top - 8, tx1 - tx0 + 6, 8).lineStyle(2.6, INK, 1).strokeRect(tx0 - 3, top - 8, tx1 - tx0 + 6, 8);
    [236, 306, 376, 446].forEach((y, i) => {
      const arm = this.add.rectangle(tx0, y, i === 0 ? 70 : 62, i === 0 ? 12 : 7, steel).setOrigin(1, 0.5).setStrokeStyle(2, INK).setDepth(6);
      this.arms.push(arm);
    });

    // mástil pararrayos y tanque de agua (supresión de sonido: el vapor que sale al encender)
    deck.lineStyle(3, dark, 1).lineBetween(862, DECK_Y, 862, 150);
    deck.fillStyle(0xff6b7a, 1).fillCircle(862, 148, 4);
    const tank = this.add.graphics().setDepth(5);
    tank.lineStyle(3, dark, 1).lineBetween(1190, 470, 1190, LAND_Y + 6).lineBetween(1240, 470, 1240, LAND_Y + 6).lineBetween(1190, 560, 1240, 500);
    tank.fillStyle(0xdcdcec, 1).lineStyle(2.6, INK, 1).fillCircle(1215, 450, 40).strokeCircle(1215, 450, 40);
    tank.fillStyle(0x4cc3f5, 0.6).fillCircle(1215, 462, 28);
    tank.lineStyle(4, dark, 1).lineBetween(1180, 470, 1150, DECK_Y);
  }

  /** Torre de control: cabina de vidrio encendida, antena con luz, radar y gaviotas posadas en el techo. */
  private buildControlTower(): void {
    const g = this.add.graphics().setDepth(8);
    g.fillStyle(0xd9d4e6, 1).lineStyle(2.6, INK, 1);
    g.fillRect(105, 420, 50, 236).strokeRect(105, 420, 50, 236);
    g.fillRect(86, 632, 88, 24).strokeRect(86, 632, 88, 24);
    g.fillStyle(0xff6b7a, 1).fillRect(105, 470, 50, 18).fillRect(105, 530, 50, 18).strokeRect(105, 470, 50, 18).strokeRect(105, 530, 50, 18);
    // cabina de control
    g.fillStyle(0x2b3a6b, 1).fillRect(70, 360, 120, 64).strokeRect(70, 360, 120, 64);
    for (let i = 0; i < 5; i++) g.fillStyle(i % 2 === 0 ? 0xffd98a : 0xfff0c2, 1).fillRect(76 + i * 23, 368, 19, 26);
    g.fillStyle(0xf5f5f2, 1).fillRect(60, 346, 140, 16).strokeRect(60, 346, 140, 16);
    // baranda y antena
    g.lineStyle(2.4, INK, 1).lineBetween(62, 346, 62, 332).lineBetween(198, 346, 198, 332).lineBetween(62, 332, 198, 332);
    g.lineStyle(4, INK, 1).lineBetween(130, 346, 130, 292);
    this.radioLight = this.add.circle(130, 288, 5, 0xff4d5e).setDepth(8);
    if (!this.calm) this.tweens.add({ targets: this.radioLight, alpha: 0.2, duration: 600, yoyo: true, repeat: -1 });
    const radar = this.add.rectangle(176, 330, 30, 5, 0xdcdcec).setStrokeStyle(1.5, INK).setDepth(8);
    this.add.rectangle(176, 336, 4, 10, INK).setDepth(8);
    if (!this.calm) this.tweens.add({ targets: radar, scaleX: 0.15, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    // enlace directo torre ⇄ cohete (punteado)
    this.link = this.add.graphics().setDepth(3);
    const nose = new Phaser.Math.Vector2(ROCKET_X, PIVOT_Y - 0.97 * 420 * ROCKET_SCALE - 10);
    const from = new Phaser.Math.Vector2(130, 288);
    this.link.lineStyle(2, tokenColor('comet-cyan'), 1);
    const len = from.distance(nose);
    const dir = nose.clone().subtract(from).normalize();
    for (let d = 0; d < len; d += 22) {
      const a = from.clone().add(dir.clone().scale(d));
      const b = from.clone().add(dir.clone().scale(Math.min(d + 9, len)));
      this.link.lineBetween(a.x, a.y, b.x, b.y);
    }
    this.link.setAlpha(0.28);

    // gaviotas posadas, mirando hacia el cohete
    [74, 98, 154, 176, 194].forEach((x, i) => {
      const img = this.add.image(x, 346, 'gull-perch').setOrigin(0.5, 0.8).setDepth(9).setScale(0.9 + (i % 2) * 0.1);
      this.gulls.push({ img, homeX: x, homeY: 346, flying: false });
    });
  }

  /** Gentío diminuto frente al cohete, con pancartas grandes y legibles, la prensa y una valla al frente. */
  private buildCrowdAndPress(): void {
    const rnd = new Phaser.Math.RandomDataGenerator(['crowd']);
    const rows = [
      { y: 700, s: 0.5, x0: 242, n: 15, dx: 22 },
      { y: 690, s: 0.46, x0: 252, n: 14, dx: 23 },
      { y: 680, s: 0.42, x0: 246, n: 15, dx: 22 },
    ];
    // pancarta principal entre dos postes, bien por encima del público (letra grande, tinta oscura sobre dorado)
    const banner = this.add.graphics().setDepth(11);
    banner.lineStyle(4, 0x5a5880, 1).lineBetween(222, 520, 222, 690).lineBetween(656, 520, 656, 690);
    banner.fillStyle(0xffcb47, 1).lineStyle(3.5, INK, 1).fillRoundedRect(210, 516, 458, 58, 10).strokeRoundedRect(210, 516, 458, 58, 10);
    this.add.text(439, 546, t('launch.banner'), { fontFamily: FONT_DISPLAY, fontSize: '34px', fontStyle: '700', color: '#0e0b33' }).setOrigin(0.5).setDepth(11).setResolution(2);

    for (const row of rows) {
      for (let i = 0; i < row.n; i++) {
        this.addAnimal(row.x0 + i * row.dx + rnd.between(-5, 5), row.y, rnd.pick(CROWD_KEYS), row.s, 12 + row.y / 1000).setFlipX(rnd.frac() > 0.5);
      }
    }

    // carteles en alto, sostenidos por el público: blancos, letra grande y sin solaparse entre sí
    const signs = this.add.graphics().setDepth(12.9);
    const boards: Array<[number, number, string]> = [[318, 184, t('launch.sign.go', { name: this.crew.name.toUpperCase() })], [522, 212, t('launch.sign.moon')]];
    boards.forEach(([x, w, text]) => {
      signs.lineStyle(3, 0x5a5880, 1).lineBetween(x, 650, x, 674);
      signs.fillStyle(0xf5f5f2, 1).lineStyle(3, INK, 1).fillRoundedRect(x - w / 2, 596, w, 38, 8).strokeRoundedRect(x - w / 2, 596, w, 38, 8);
      this.add.text(x, 615, text, { fontFamily: FONT_DISPLAY, fontSize: '24px', fontStyle: '700', color: '#0e0b33' }).setOrigin(0.5).setDepth(13).setResolution(2);
    });

    // prensa: tres camarógrafos y dos reporteros (más pequeños que el cohete, como el resto del público)
    const press = this.add.graphics().setDepth(13);
    [596, 620, 644].forEach((x) => {
      this.addAnimal(x, 700, rnd.pick(CROWD_KEYS), 0.5, 12.7);
      press.fillStyle(0x5a5880, 1).lineStyle(1.6, INK, 1).fillRect(x - 2, 662, 14, 9).strokeRect(x - 2, 662, 14, 9);
      press.fillStyle(0x4cc3f5, 1).fillRect(x + 12, 664, 5, 5);
      this.flashes.push([x + 18, 666]);
    });
    [672, 696].forEach((x) => {
      this.addAnimal(x, 700, rnd.pick(CROWD_KEYS), 0.5, 12.7);
      press.lineStyle(2, INK, 1).lineBetween(x + 9, 662, x + 9, 654);
      press.fillStyle(0xff6b7a, 1).fillCircle(x + 9, 652, 3);
    });
    // cartel «EN VIVO»
    const live = this.add.graphics().setDepth(13);
    live.fillStyle(0xff4d5e, 1).lineStyle(2.4, INK, 1).fillRoundedRect(640, 622, 86, 24, 8).strokeRoundedRect(640, 622, 86, 24, 8);
    const dot = this.add.circle(654, 634, 5, 0xffffff).setDepth(13);
    this.add.text(692, 634, t('launch.live'), { fontFamily: FONT_MONO, fontSize: '14px', fontStyle: '700', color: '#ffffff' }).setOrigin(0.5).setDepth(13).setResolution(2);
    if (!this.calm) this.tweens.add({ targets: dot, alpha: 0.2, duration: 500, yoyo: true, repeat: -1 });

    // valla de seguridad al frente
    const fence = this.add.graphics().setDepth(14);
    fence.fillStyle(0xdcdcec, 1).lineStyle(2.4, INK, 1);
    for (let x = 232; x <= 720; x += 40) fence.fillRect(x, 702, 5, 18).strokeRect(x, 702, 5, 18);
    fence.fillRect(232, 705, 493, 4).strokeRect(232, 705, 493, 4).fillRect(232, 713, 493, 3).strokeRect(232, 713, 493, 3);
  }

  /** Capas lejanas: cordillera brumosa, un hangar grande de ensamblaje y otro bajo, con luces, velados por la distancia. */
  private buildHangar(): void {
    const far = this.add.graphics().setDepth(1.8);
    far.fillStyle(0xb98aa6, 0.55).fillEllipse(420, 592, 520, 60).fillEllipse(900, 596, 640, 54).fillEllipse(1200, 590, 420, 64);

    const g = this.add.graphics().setDepth(3.5);
    const wall = 0x8e7fb0;
    const roof = 0x6f6299;
    const base = LAND_Y + 10;
    g.lineStyle(2, 0x5a4f8c, 1);
    // hangar bajo de techo curvo
    g.fillStyle(wall, 1).fillRect(440, base - 44, 120, 44).strokeRect(440, base - 44, 120, 44);
    g.fillStyle(roof, 1).fillEllipse(500, base - 44, 120, 34);
    g.fillStyle(0x4a3f78, 1).fillRect(482, base - 32, 36, 32);
    // edificio de ensamblaje alto (puerta vertical enorme, bandera)
    g.fillStyle(wall, 1).fillRect(590, base - 126, 140, 126).strokeRect(590, base - 126, 140, 126);
    g.fillStyle(roof, 1).fillRect(584, base - 134, 152, 10).strokeRect(584, base - 134, 152, 10);
    g.fillStyle(0x4a3f78, 1).fillRect(646, base - 104, 28, 104);
    g.fillStyle(0xf5f5f2, 0.55).fillRect(596, base - 118, 40, 18).fillRect(684, base - 118, 40, 18);
    g.lineStyle(2, 0x5a4f8c, 1).lineBetween(728, base - 134, 728, base - 166);
    g.fillStyle(0xff6b7a, 1).fillTriangle(728, base - 166, 748, base - 160, 728, base - 154);
    // cobertizos y luces
    g.fillStyle(wall, 1).fillRect(760, base - 22, 44, 22).fillRect(812, base - 16, 30, 16);
    g.fillStyle(0xffd98a, 1);
    [455, 535, 600, 716, 770, 790].forEach((x) => g.fillRect(x, base - 14, 4, 4));
    // velo de distancia: tiñe todo hacia el color del horizonte
    g.fillStyle(0xf0b08c, 0.22).fillRect(430, base - 170, 430, 180);
  }

  private addAnimal(x: number, y: number, key: string, scale: number, depth: number): Phaser.GameObjects.Image {
    const img = this.add.image(x, y, key).setOrigin(0.5, 1).setScale(scale).setDepth(depth).setData('baseY', y);
    this.crowd.push(img);
    return img;
  }

  private buildRocket(): void {
    this.rocket = this.add.image(ROCKET_X, PIVOT_Y, 'rocket').setOrigin(0.5, 0.97).setScale(ROCKET_SCALE).setDepth(8);
  }

  /** Llamas (violeta + naranja), humo/vapor (crema y arena) y brillos; las partículas se omiten en Ultra Ligero. */
  private buildEffects(): void {
    // llama de sprites: siempre presente, es lo único que se ve en Ultra Ligero
    NOZZLES.forEach(() => {
      this.flameEdge.push(this.add.image(ROCKET_X, PIVOT_Y, 'puff').setOrigin(0.5, 0.12).setTint(0x8a3cff).setBlendMode(Phaser.BlendModes.ADD).setDepth(7).setVisible(false));
      this.flameCore.push(this.add.image(ROCKET_X, PIVOT_Y, 'puff').setOrigin(0.5, 0.12).setTint(0xff9a2e).setBlendMode(Phaser.BlendModes.ADD).setDepth(7.5).setVisible(false));
    });
    this.glowDeck = this.add.image(ROCKET_X, DECK_Y + 10, 'puff').setScale(5, 2.6).setTint(0xff8a3d).setBlendMode(Phaser.BlendModes.ADD).setDepth(7.8).setAlpha(0);
    this.glowViolet = this.add.image(ROCKET_X, DECK_Y + 30, 'puff').setScale(3.4, 1.8).setTint(0x9b5cff).setBlendMode(Phaser.BlendModes.ADD).setDepth(7.8).setAlpha(0);

    if (this.light) return;
    const at = (x: number, y: number, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, depth: number): Emitter =>
      this.add.particles(x, y, 'puff', { emitting: false, ...cfg }).setDepth(depth);
    const add = Phaser.BlendModes.ADD;

    // T-6: motores principales (llama pálida violeta con borde anaranjado)
    this.emIgnition = [
      at(ROCKET_X, PIVOT_Y, { x: NOZZLES, speedY: { min: 150, max: 230 }, speedX: { min: -8, max: 8 }, scale: { start: 0.2, end: 0.03 }, alpha: { start: 0.9, end: 0 }, lifespan: { min: 300, max: 480 }, frequency: 16, quantity: 1, tint: [0xe9d6ff, 0xb67bff, 0xff8a3d], blendMode: add }, 7.6),
    ];
    // T-0: propulsores laterales (núcleo amarillo, cuerpo naranja, borde morado)
    this.emBooster = [
      at(ROCKET_X, PIVOT_Y, { x: NOZZLES, speedY: { min: 240, max: 340 }, speedX: { min: -10, max: 10 }, scale: { start: 0.32, end: 0.05 }, alpha: { start: 1, end: 0 }, lifespan: { min: 350, max: 600 }, frequency: 16, quantity: 1, tint: FLAME_CORE, blendMode: add }, 7.7),
      at(ROCKET_X, PIVOT_Y, { x: NOZZLES, speedY: { min: 190, max: 290 }, speedX: { min: -18, max: 18 }, scale: { start: 0.45, end: 0.08 }, alpha: { start: 0.9, end: 0 }, lifespan: { min: 450, max: 750 }, frequency: 16, quantity: 1, tint: FLAME_MID, blendMode: add }, 7.6),
      at(ROCKET_X, PIVOT_Y, { x: NOZZLES, speedY: { min: 150, max: 250 }, speedX: { min: -30, max: 30 }, scale: { start: 0.65, end: 0.1 }, alpha: { start: 0.5, end: 0 }, lifespan: { min: 550, max: 900 }, frequency: 20, quantity: 1, tint: FLAME_EDGE, blendMode: add }, 7.5),
    ];
    // humo y vapor: salen por la abertura y se esparcen por encima del borde de la plataforma
    const smoke = (dir: 1 | -1, freq: number): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig => ({
      x: { min: -40, max: 40 }, y: { min: -10, max: 10 },
      speedX: dir < 0 ? { min: -340, max: -90 } : { min: 90, max: 340 }, speedY: { min: -80, max: 10 },
      scale: { start: 0.5, end: 2.8 }, alpha: { start: 0.85, end: 0 }, rotate: { min: 0, max: 360 },
      lifespan: { min: 2800, max: 4200 }, frequency: freq, quantity: 1, tint: SMOKE_TINTS,
    });
    const steam: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
      x: { min: -40, max: 40 }, speedX: { min: -70, max: 70 }, speedY: { min: -210, max: -60 },
      scale: { start: 0.4, end: 2.2 }, alpha: { start: 0.7, end: 0 }, rotate: { min: 0, max: 360 },
      lifespan: { min: 2200, max: 3400 }, frequency: 60, quantity: 1, tint: [0xffffff, 0xf4efff, 0xfff1e0],
    };
    this.emSmoke = [
      at(ROCKET_X, LAND_Y - 6, smoke(-1, 45), 9),
      at(ROCKET_X, LAND_Y - 6, smoke(1, 45), 9),
      at(ROCKET_X, DECK_Y + 6, steam, 7),
    ];
    // estela de humo tibio detrás del cohete durante la subida baja
    this.emTrail = at(ROCKET_X, PIVOT_Y, {
      speedX: { min: -40, max: 40 }, speedY: { min: 20, max: 110 }, scale: { start: 0.7, end: 2.6 }, alpha: { start: 0.65, end: 0 },
      rotate: { min: 0, max: 360 }, lifespan: { min: 2200, max: 3000 }, frequency: 40, quantity: 1, tint: SMOKE_TINTS,
    }, 7.2);
  }

  // ───────────────────────── Interfaz fija ─────────────────────────

  private fixed<T extends Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T): T {
    o.setScrollFactor(0).setDepth(100);
    this.ui.push(o);
    return o;
  }

  private buildUi(): void {
    const frame = tokenColor('constellation');
    const bg = this.fixed(this.add.graphics());
    bg.fillStyle(tokenColor('space-900'), 0.9).lineStyle(2, frame, 1);
    bg.fillRoundedRect(24, 22, 720, 118, 16).strokeRoundedRect(24, 22, 720, 118, 16);
    bg.fillRoundedRect(1046, 22, 210, 98, 16).strokeRoundedRect(1046, 22, 210, 98, 16);
    // marcos de los retratos
    bg.lineStyle(3, frame, 1).strokeCircle(78, 81, 42).strokeCircle(690, 81, 42);

    // retratos: Control (Comandante Nébula) a la izquierda y el tripulante elegido a la derecha
    this.portraitControl = this.fixed(this.add.image(78, 81, `michi-${this.crew.id}`)).setScale(0.25).setVisible(false);
    this.portraitCrew = this.fixed(this.add.image(690, 81, `michi-${this.crew.id}`)).setScale(0.25).setAlpha(0.4);
    const nebula: Character = { ...CHARACTERS[0], name: t('commander.name'), fur: '#f5f5f2', furDark: '#c4c2e0', antennae: undefined, eyeScale: undefined };
    void addSvgTexture(this.textures, 'michi-nebula', michiSvg(nebula, tokenCss('nebula-violet')), 160, 160).then(() => {
      if (this.sys.isActive()) this.portraitControl.setTexture('michi-nebula').setVisible(true).setAlpha(0.4);
    });

    this.speakerName = this.fixed(this.add.text(140, 32, '', { fontFamily: FONT_DISPLAY, fontSize: '18px', fontStyle: '700', color: tokenCss('comet-cyan') }));
    this.fixed(this.add.text(610, 36, t('launch.link'), { fontFamily: FONT_MONO, fontSize: '12px', color: tokenCss('comet-cyan') }).setOrigin(1, 0));
    this.speakerText = this.fixed(this.add.text(140, 62, '', { fontFamily: FONT_DISPLAY, fontSize: '22px', color: tokenCss('ink'), wordWrap: { width: 470 }, lineSpacing: 4 }));

    this.panelLabel = this.fixed(this.add.text(1151, 38, t('launch.panel.liftoff'), { fontFamily: FONT_MONO, fontSize: '13px', color: tokenCss('ink-muted') }).setOrigin(0.5));
    this.panelValue = this.fixed(this.add.text(1151, 76, `T-${COUNTDOWN_FROM}`, { fontFamily: FONT_MONO, fontSize: '46px', fontStyle: '700', color: tokenCss('ink-muted') }).setOrigin(0.5));
  }

  // ───────────────────────── Bucle ─────────────────────────

  update(_time: number, delta: number): void {
    if (!this.ready) return;
    let next = this.clock + delta * this.speed;
    // la animación no puede terminar antes que la carga real
    if (this.loadProgress < 1) next = Math.min(next, END_MS - 300);
    this.clock = next;
    const t = this.clock;

    this.stepCues(t);
    this.stepDialogue(t, delta);
    this.stepCountdown(t);
    this.stepRocket(t);
    this.stepFlames(t);
    this.stepGulls(t);
    this.stepPress(delta);

    if ((t >= END_MS || this.skip) && this.loadProgress >= 1 && !this.done) this.arrive();
  }

  /** Eventos únicos: encendido (T-6) y despegue (T-0). */
  private stepCues(t: number): void {
    if (!this.ignited && t >= IGNITION_MS) {
      this.ignited = true;
      audio.play('thrust');
      this.emIgnition.forEach((e) => e.start());
      this.emSmoke.forEach((e) => e.start());
      // los brazos de la torre se retiran
      this.tweens.add({ targets: this.arms, scaleX: 0.04, duration: 1100, ease: 'Sine.in' });
      this.scareGulls();
      this.cheerCrowd(2);
    }
    if (!this.lifted && t >= LIFTOFF_MS) {
      this.lifted = true;
      audio.play('thrust');
      this.emIgnition.forEach((e) => e.stop());
      this.emBooster.forEach((e) => e.start());
      this.emTrail?.start();
      this.cheerCrowd(5);
      if (!this.calm) this.cameras.main.flash(260, 255, 200, 120);
      this.tweens.add({ targets: this.link, alpha: 0, duration: 900 });
    }
    // retumbar: el sonido de los motores se renueva mientras dura
    if (this.ignited && t < LIFTOFF_MS + 7500 && t >= this.rumbleTimer) {
      this.rumbleTimer = t + 1300;
      if (t > IGNITION_MS + 100) audio.play('thrust');
    }
  }

  // ── diálogo con cola: cada línea se escribe, se sostiene y luego pasa la siguiente ──

  private stepDialogue(t: number, delta: number): void {
    // datos de la atmósfera: una línea por capa al cruzarla
    const a = this.ascent(t);
    const layers = [...LAYERS, CISLUNAR];
    while (this.layerShown < layers.length && this.lifted && a >= LAYER_LINE_AT[this.layerShown]) {
      const layer = layers[this.layerShown++];
      this.queue.push({ at: t, who: 'control', text: layerLine(layer.id) });
    }

    if (!this.lineDone) {
      this.typed = this.calm ? this.lineText.length : Math.min(this.lineText.length, this.typed + (delta * state.settings.textSpeed) / 1000);
      this.speakerText.setText(this.lineText.slice(0, Math.floor(this.typed)));
      if (this.typed >= this.lineText.length) {
        this.lineDone = true;
        this.heldMs = 0;
      }
      return;
    }
    this.heldMs += delta * this.speed;
    const nextLine = this.queue[0];
    if (nextLine && t >= nextLine.at && (this.heldMs >= HOLD_MS || this.lineText === '')) {
      this.queue.shift();
      this.say(nextLine.who, fillName(nextLine.text, this.crew.name));
    }
  }

  private say(who: Speaker, text: string): void {
    this.lineText = text;
    this.typed = 0;
    this.lineDone = false;
    this.speakerText.setText('');
    const control = who === 'control';
    this.speakerName.setText(control ? `${t('commander.name')} · ${t('launch.control')}` : `${this.crew.name} · ${characterRole(this.crew.id)}`)
      .setColor(control ? tokenCss('comet-cyan') : tokenCss(this.crew.accent));
    this.portraitControl.setAlpha(control ? 1 : 0.4);
    this.portraitCrew.setAlpha(control ? 0.4 : 1);
    audio.play('radio');
    this.pingRadio(control);
    this.tweens.add({ targets: this.link, alpha: this.lifted ? 0 : 0.8, duration: 160, yoyo: true });
  }

  /** Ondas de radio desde la antena de la torre (o desde la nariz del cohete cuando habla el tripulante). */
  private pingRadio(fromTower: boolean): void {
    if (this.calm) return;
    const x = fromTower ? 130 : this.rocket.x;
    const y = fromTower ? 288 : this.rocket.y - 0.97 * 420 * this.rocket.scale - 10;
    for (let i = 0; i < 2; i++) {
      const ring = this.add.circle(x, y, 8).setStrokeStyle(2, tokenColor('comet-cyan')).setDepth(9).setAlpha(0);
      this.tweens.add({
        targets: ring, scale: 5, alpha: { from: 0.9, to: 0 }, duration: 800, delay: i * 220, ease: 'Sine.out',
        onStart: () => ring.setAlpha(0.9), onComplete: () => ring.destroy(),
      });
    }
  }

  // ── conteo regresivo y altitud ──

  private stepCountdown(t: number): void {
    if (t < LIFTOFF_MS) {
      const n = t < COUNTDOWN_START_MS ? COUNTDOWN_FROM : Math.max(0, Math.ceil((LIFTOFF_MS - t) / 1000));
      if (t >= COUNTDOWN_START_MS && n !== this.lastCount) {
        this.lastCount = n;
        this.panelValue.setText(`T-${n}`).setColor(n <= 3 ? tokenCss('solar-coral') : tokenCss('star-gold'));
        audio.play('click');
        if (!this.calm) this.tweens.add({ targets: this.panelValue, scale: { from: 1.25, to: 1 }, duration: 260, ease: 'Back.out' });
      }
      return;
    }
    if (this.lastCount !== -2) {
      this.lastCount = -2;
      this.panelLabel.setText(tr('launch.panel.altitude'));
      this.panelValue.setColor(tokenCss('star-gold')).setFontSize(32);
    }
    const km = altitudeKm(this.ascent(t));
    this.panelValue.setText(`${Math.round(km).toLocaleString(dateLocale())} km`);
  }

  /** Fracción de la subida, 0–1. */
  private ascent(t: number): number {
    return Phaser.Math.Clamp((t - LIFTOFF_MS) / ASCENT_MS, 0, 1);
  }

  // ── cohete: levanta desde la base, el aire lo hace oscilar, la cámara lo sigue y la tierra tiembla ──

  private stepRocket(t: number): void {
    const s = Math.max(0, (t - LIFTOFF_MS) / 1000);
    const a = this.ascent(t);
    const off = 0.5 * ACCEL * s * s;

    // balanceo: el empuje lo inclina al encender, rebota al soltarse y el aire lo sacude más arriba (Max-Q)
    let angle = 0;
    if (!this.calm) {
      if (t >= IGNITION_MS && t < LIFTOFF_MS) {
        const k = Math.min(1, (t - IGNITION_MS) / 1500);
        angle = -0.9 * k + Math.sin(t * 0.09) * 0.14 * k;
      } else if (t >= LIFTOFF_MS) {
        const damp = Math.exp(-s / 1.8);
        const maxQ = Math.exp(-((s - 7.2) ** 2) / 3.4);
        angle = -0.9 * Math.cos(s * 5) * damp + 2.4 * Math.sin(s * 3.6) * damp + 1.1 * maxQ * Math.sin(s * 9) + 1.0 * (1 - Math.exp(-s / 3));
      }
    }
    const scale = ROCKET_SCALE * (1 - 0.3 * a);
    this.rocket.setPosition(ROCKET_X + angle * 5, PIVOT_Y - off).setAngle(angle).setScale(scale);

    // la cámara sigue al cohete y lo suelta al final para que salga por arriba
    const target = Math.max(0, off - 50);
    this.camOff += (target - this.prevTarget) * (1 - smooth(0.7, 0.95, a));
    this.prevTarget = target;

    // temblor de la tierra: leve desde el encendido, fuerte al despegar y se calma al subir
    let amp = 0;
    if (!this.calm) {
      if (t >= IGNITION_MS) amp = 1.6 * smooth(IGNITION_MS, IGNITION_MS + 1500, t);
      if (t >= LIFTOFF_MS) amp = 1.6 + 7 * Math.exp(-s / 3.2);
      if (s > 8) amp *= 1 - smooth(8, 10.5, s);
    }
    this.cameras.main.setScroll((Math.random() - 0.5) * 2 * amp, -this.camOff + (Math.random() - 0.5) * 2 * amp);
    // el público también se estremece
    this.crowd.forEach((c) => c.setAngle(amp > 1.2 ? (Math.random() - 0.5) * amp * 0.5 : 0));

    // el humo se corta cuando ya no hay nada que lo alimente
    if (!this.trailStopped && a > 0.55) {
      this.trailStopped = true;
      this.emTrail?.stop();
    }
    if (!this.smokeStopped && s > 6) {
      this.smokeStopped = true;
      this.emSmoke.forEach((e) => e.stop());
      this.emBooster.forEach((e) => e.stop());
    }
  }

  /** Posición de las toberas (bajo la base del cohete, siguiendo su inclinación). */
  private nozzle(drop = 6): Phaser.Math.Vector2 {
    const r = this.rocket.rotation;
    const d = drop * this.rocket.scale;
    return new Phaser.Math.Vector2(this.rocket.x - Math.sin(r) * d, this.rocket.y + Math.cos(r) * d);
  }

  private stepFlames(t: number): void {
    // potencia: 0 apagado → 0,45 motores principales → 1 con propulsores
    const target = t >= LIFTOFF_MS ? 1 : this.ignited ? 0.45 : 0;
    this.thrust += (target - this.thrust) * 0.06;
    const n = this.nozzle();
    this.emIgnition.concat(this.emBooster).forEach((e) => e.setPosition(n.x, n.y));
    this.emTrail?.setPosition(n.x, n.y);

    const flick = 1 + Math.sin(t * 0.06) * 0.1 + Math.random() * 0.05;
    const p = this.thrust;
    const booster = Phaser.Math.Clamp((p - 0.45) / 0.55, 0, 1);
    const k = this.rocket.scale / ROCKET_SCALE;
    const r = this.rocket.rotation;
    NOZZLES.forEach((dx, i) => {
      const x = n.x + Math.cos(r) * dx * k;
      const y = n.y + Math.sin(r) * dx * k;
      this.flameEdge[i].setVisible(p > 0.02).setPosition(x, y).setRotation(r)
        .setScale((0.12 + 0.2 * booster) * k, (0.55 + 1.0 * booster) * flick * k).setAlpha(0.55 + 0.35 * booster);
      this.flameCore[i].setVisible(p > 0.02).setPosition(x, y).setRotation(r)
        .setTint(booster > 0.2 ? 0xffb347 : 0xd9b4ff)
        .setScale((0.08 + 0.12 * booster) * k, (0.4 + 0.7 * booster) * flick * k).setAlpha(0.7 + 0.3 * booster);
    });

    // resplandor sobre la plataforma: se apaga cuando el cohete ya está lejos
    const height = Math.max(0, PIVOT_Y - this.rocket.y);
    const lit = 1 - smooth(120, 900, height);
    this.glowDeck.setAlpha((0.2 + 0.5 * booster) * Math.min(1, p / 0.45) * lit * flick);
    this.glowViolet.setAlpha(0.25 * Math.min(1, p / 0.45) * lit);
  }

  // ── gaviotas ──

  private scareGulls(): void {
    this.gulls.forEach((gull, i) => {
      this.time.delayedCall(i * 140, () => {
        const bang = this.add.image(gull.homeX, gull.homeY - 48, 'bang').setDepth(10).setScale(0);
        audio.play('error');
        this.tweens.add({ targets: bang, scale: 1, duration: 200, ease: 'Back.out' });
        // tras el susto, echan a volar hacia el lado contrario al cohete (izquierda) y salen de la pantalla
        this.time.delayedCall(520, () => {
          bang.destroy();
          gull.flying = true;
          gull.img.setFlipX(true);
          this.tweens.add({ targets: gull.img, x: -90 - i * 12, duration: 2600 + i * 180, ease: 'Sine.in' });
          this.tweens.add({ targets: gull.img, y: gull.homeY - 120 - i * 26, duration: 1500, ease: 'Sine.out' });
        });
      });
    });
  }

  private stepGulls(t: number): void {
    const up = Math.floor(t / 110) % 2 === 0;
    this.gulls.forEach((g) => {
      if (g.flying) g.img.setTexture(up ? 'gull-up' : 'gull-down');
    });
  }

  // ── público y prensa ──

  /** El público salta de emoción (menos intenso con movimiento reducido). */
  private cheerCrowd(times: number): void {
    if (this.calm) return;
    this.crowd.forEach((c, i) => {
      this.tweens.killTweensOf(c);
      const base = c.getData('baseY') as number;
      c.setY(base);
      this.tweens.add({ targets: c, y: base - 12, duration: 190, delay: (i % 9) * 55, yoyo: true, repeat: times, ease: 'Sine.out' });
    });
  }

  /** Destellos de las cámaras de la prensa (pequeños y espaciados: ≤ 3 por segundo). */
  private stepPress(delta: number): void {
    if (this.calm || !this.ignited) return;
    this.flashTimer -= delta;
    if (this.flashTimer > 0) return;
    this.flashTimer = 380;
    const [x, y] = Phaser.Utils.Array.GetRandom(this.flashes);
    const flash = this.add.image(x, y, 'puff').setScale(0.7).setDepth(15).setAlpha(0.9);
    this.tweens.add({ targets: flash, alpha: 0, scale: 0.3, duration: 180, onComplete: () => flash.destroy() });
  }

  // ───────────────────────── Salida ─────────────────────────

  /** El despegue se puede saltar con clic, Espacio, Esc o el botón (igual al de la historia). Si la carga no terminó, se espera a que termine. */
  private bindSkip(): void {
    const ui = new UiLayer(this, `<button class="mn-btn mn-btn--secondary mn-btn--sm story__skip launch__skip" data-action="skip">${icon('skip')}${t('common.skip')}</button>`, 'screen screen--clear');
    const request = (): void => void (this.skip = true);
    ui.on('skip', request);
    this.input.on('pointerdown', request);
    this.input.keyboard?.on('keydown-SPACE', request);
    this.input.keyboard?.on('keydown-ESC', request);
  }

  private arrive(): void {
    this.done = true;
    if (!state.progress.launchSeen) state.saveProgress({ launchSeen: true });
    this.tweens.add({ targets: this.ui, alpha: 0, duration: 250 });
    this.time.delayedCall(150, () => fadeTo(this, SCENES.flight, 400));
  }
}
