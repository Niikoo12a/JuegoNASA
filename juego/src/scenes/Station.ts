import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT } from '../core/config';
import { state } from '../core/state';
import { tokenColor, tokenCss, FONT_DISPLAY } from '../core/theme';
import { UiLayer, esc, labelDialog } from '../core/ui';
import { fadeIn, fadeTo } from '../core/fade';
import { audio, type Mood } from '../core/audio';
import { settingsHtml, bindSettings } from '../core/settingsPanel';
import { michiFaceSvg, addSvgTexture } from '../core/art';
import { MAP_RASTER, MAP_TEXTURE, stationSvg } from '../core/stationArt';
import { addDrawnProps, drawnPropsReady } from '../core/propArt';
import { MISSIONS, MISSION_DAYS, missionEvents, missionTasks, missionText, realDate, sourceCredit, sourceName, taskLabel, type Mission, type ResearchTask } from '../data/missions';
import { DIFFICULTIES, type Difficulty } from '../data/difficulties';
import { CHARACTERS } from '../data/characters';
import { ROOM_IDS, propPosition, roomName, roomProps, textureAsset, type RoomProp } from '../data/rooms';
import { actionLabel, actionWhy, blockReason, resourceLabel, resourceShort, type ResourceKey } from '../data/actions';
import { CONTROLS, controlAction, keyLabel } from '../data/controls';
import { t } from '../core/i18n';
import { MICHI_ANCHOR, MICHI_ANIMS, michiKey, propKey, type MichiAnim } from '../data/preload';
import { Simulation, type ActionDelta } from '../sim/simulation';
import { FLARE_DURATION_SEC, FLARE_OUTSIDE_HIT, SHELTER_FACTOR, SUIT_LOW, WALK_SPEED, WORLD_SCALE, quality } from '../sim/rules';
import { MINI_DIFFICULTY } from '../sim/minigames';
import {
  GRAVITY, PX_PER_METER, airTime, jumpHeight, createDash, startDash, tickDash, dashSpeedFactor, type DashState,
} from '../sim/physics';
import {
  HALLS, MAP_H, MAP_W, ROOM_RECTS, WALL_H, findRoute, isWalkable, moveOnMap, roomAt, roomCenter, zoneAt, type Obstacle, type Point,
} from '../sim/stationMap';
import { severity } from '../sim/flares';
import { Pool } from '../sim/pool';
import { computeScore } from '../sim/score';
import { earnedAchievements } from '../sim/achievements';
import type { ActionId, Resources, RoomId, SimEvent, Zone } from '../sim/types';
import { icon, type IconName } from '../core/icons';
import { mountDustGame } from '../core/dustGame';
import { mountSealGame } from '../core/sealGame';
import { mountTestPanel } from '../core/testPanelGame';
import { decorateHint, miniFrameHtml, miniMsgsHtml, showMiniResult } from '../core/miniFrame';
import { commanderSvg } from '../core/commander';
import { mountLink } from '../core/casaGames';
import { Spotlight, rectOf, unionRect, type SpotRect } from '../core/spotlight';
import {
  mountAlgae, mountAntennaGame, mountIceDrill, mountHarvestGame, mountHealGame, mountNoisyMessage, mountPedal, moveFocus, MINI_KEYS, PEDAL_PASS, type MiniCallbacks, type MiniGameHandle,
} from '../core/miniGames';
import { mountBiofirmas, mountDnaWorkshop } from '../core/dnaGame';
import { DNA_MAX_BONUS, dnaBonus } from '../sim/dna';
import { mountBelt, mountDelivery, mountRover, type BeltResult } from '../core/finaleGames';
import { finaleScore } from '../sim/finale';
import { ACTION_ICON, RESOURCE_ICON, ROOM_ICON, taskIcon } from '../core/iconMap';

const PROP_TEXTURE_SCALE = 1.25; // los PNG de props se exportan a 1,25× del tamaño 1x
const PROP_SIZE = 0.95;          // tamaño en el mapa respecto del dibujo 1x (un casillero mide ~1,6 michis de alto)
const PROP_PAPER_MARGIN = 17.5;  // px de textura bajo el objeto (borde de papel de 14 px a 1x, exportado a 1,25×)
const MICHI_SCALE = 0.6;
const JUMP_V0 = 1.8;             // m/s: con g lunar sube ~1 m (en la Tierra serían ~16 cm)
const INTERACT_RADIUS = 210;     // px de mapa entre los pies del michi y los de la máquina
const OBSTACLE_R = { interactive: 85, deco: 52 } as const; // los adornos de pared no tienen
const MACHINE_FRONT = 130;        // el michi camina solo hasta este punto frente a la máquina
const HUD_HZ = 10;
const GHOSTS = 4;                // estela del impulso (pool)
const CAMERA_ZOOM = 0.8;         // cámara alejada: se ve más estación alrededor del michi
const CAMERA_LOOK_DOWN = -90;     // px de mapa que la cámara mira bajo los pies del michi (negativo: el michi queda más abajo en la pantalla)
const CAMERA_MARGIN = 450;       // la cámara puede pasar un poco del borde del mapa para que el michi no se quede arriba cerca de los bordes

interface Machine { room: RoomId; at: Point; sprite: Phaser.GameObjects.Image; prop: RoomProp; active?: boolean; }
/**
 * Paso del tutorial: `guide` es el objeto al que apunta la flecha; `manual` pide pulsar «Entendido» (si no, avanza solo al cumplirse).
 * `spot`: lo que ilumina el spotlight (selectores del HUD o `machine:<asset>`); `allow`: lo único que se puede hacer en el paso.
 * `enter`: efecto al llegar al paso (p. ej. abrir la fisura de práctica); `demoFlare`: muestra una cuenta de llamarada de mentira.
 */
interface TutorialStep {
  text: string; done: () => boolean; guide?: string; manual?: boolean; cta?: string;
  spot?: string[]; allow?: { move?: boolean; machine?: string; action?: ActionId }; enter?: () => void; demoFlare?: boolean;
}

type Overlay = 'none' | 'pause' | 'settings' | 'map' | 'actions' | 'intro' | 'controls' | 'minigame';
/** Paneles que detienen el reloj de la misión. */
const PAUSING: ReadonlySet<Overlay> = new Set(['pause', 'settings', 'intro', 'controls', 'minigame']);

/** Cuántas veces más rápido corre el reloj con «Avanzar el día». */
const FFWD_FACTOR = 6;

export class StationScene extends Phaser.Scene {
  private sim!: Simulation;
  private mission!: Mission;
  /** Tareas de esta partida (en el entrenamiento, solo las de práctica). */
  private tasks: ResearchTask[] = [];
  private difficulty!: Difficulty;
  private ui!: UiLayer;
  private timescale = 1;

  private michi!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Ellipse;
  private flareTint!: Phaser.GameObjects.Rectangle;
  private darkTint!: Phaser.GameObjects.Rectangle;
  private pos: Point = roomCenter(START_ROOM);
  private face = 1;
  private jumpT = -1;
  private helmet = false;
  private anim: MichiAnim = 'idle';
  private oneShot = false;
  /** Salud de la última vez que se miró: el michi solo se queja cuando baja (no mientras haya un recurso crítico). */
  private lastHealth = 100;
  private here: RoomId | null = START_ROOM;
  private zone: Zone = 'ship';
  private machines: Machine[] = [];
  private obstacles: Obstacle[] = [];
  private focused: Machine | null = null;
  private route: Point[] = [];
  private openOnArrival = false;
  private dash: DashState = createDash();
  private dashDir: Point = { x: 1, y: 0 };
  private ghostTimer = 0;
  private ghostPool!: Pool<Phaser.GameObjects.Image>;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private overlay: Overlay = 'none';
  /** El jugador aceleró el reloj para no esperar al final de la jornada. */
  private ffwd = false;
  private hudTimer = 0;
  private hudCache = new Map<string, string>();
  private floatPool!: Pool<Phaser.GameObjects.Text>;
  /** Avisos a la vista, por id: un evento nuevo del mismo tipo reemplaza al anterior en vez de apilarse. */
  private toasts = new Map<string, { el: HTMLElement; timer?: Phaser.Time.TimerEvent }>();
  /** Acción sobre la que está el cursor en el panel: sus efectos se dibujan sobre las barras. */
  private previewId: ActionId | null = null;
  private typeTimer?: Phaser.Time.TimerEvent;
  private typing: { text: string; render: () => void } | null = null;
  private tutorial: TutorialStep[] = [];
  private tutorialIndex = -1;
  private spot!: Spotlight;
  private flags = { moved: false, opened: false, map: false, archive: false };
  private ending = false;
  private miniGame?: MiniGameHandle;
  /** El minijuego se juega afuera (superficie): el reloj no se detiene y el traje sigue gastando oxígeno. */
  private miniOutdoor = false;
  /** Ambiente propio del minijuego en curso (la sonda); al cerrarlo vuelve el de la zona. */
  private miniMood: Mood | null = null;
  private breachProp?: Machine;
  private breachMarker?: Phaser.GameObjects.Container;
  private recycler?: { sprite: Phaser.GameObjects.Image; at: Point };
  /** Paneles solares de adorno: se ven sucios mientras haya polvo. */
  private panelSprites: Phaser.GameObjects.Image[] = [];
  private pulses = new Map<Machine, Phaser.Tweens.Tween>();
  private taskTab: 1 | 2 = 1;
  private disposers: (() => void)[] = [];

  constructor() {
    super(SCENES.station);
  }

  create(): void {
    audio.setMood('station');
    const l = state.loadout;
    if (!l) {
      this.scene.start(SCENES.menu);
      return;
    }
    if (!this.textures.exists(MAP_TEXTURE) || !drawnPropsReady(this.textures)) {
      // normalmente los rasteriza la pantalla del cohete; esto cubre entradas directas (recarga en desarrollo)
      void Promise.all([addSvgTexture(this.textures, MAP_TEXTURE, stationSvg(), MAP_W, MAP_H, MAP_RASTER), addDrawnProps(this.textures)])
        .then(() => this.scene.restart());
      return;
    }
    this.mission = MISSIONS.find((m) => m.id === l.mission)!;
    this.difficulty = DIFFICULTIES.find((d) => d.id === l.difficulty)!;
    this.tasks = missionTasks(this.mission, state.training);
    const scale = Number(new URLSearchParams(location.search).get('timescale'));
    this.timescale = Number.isFinite(scale) && scale >= 1 ? Math.min(scale, 50) : 1; // herramienta de QA (tests E2E)

    this.sim = new Simulation({
      days: MISSION_DAYS,
      dayLengthSec: this.difficulty.dayLengthSec,
      drain: this.difficulty.drain,
      tasks: this.tasks,
      events: missionEvents(this.mission),
      seed: Date.now() & 0xffff,
    });
    Object.assign(this, { pos: roomCenter(START_ROOM), face: 1, jumpT: -1, helmet: false, anim: 'idle', oneShot: false, here: START_ROOM, zone: 'ship',
      focused: null, route: [], openOnArrival: false, dash: createDash(), dashDir: { x: 1, y: 0 }, ghostTimer: 0,
      overlay: 'none', ffwd: false, hudTimer: 0, tutorialIndex: -1, ending: false, lastHealth: 100, breachProp: undefined, breachMarker: undefined, recycler: undefined, panelSprites: [], miniGame: undefined, miniOutdoor: false, miniMood: null, pulses: new Map(), taskTab: 1, toasts: new Map(), previewId: null });
    this.flags = { moved: false, opened: false, map: false, archive: false };
    this.hudCache.clear();
    this.machines = [];
    this.obstacles = [];
    this.disposers = [];

    fadeIn(this, 500);
    this.buildWorld();
    this.createMichi();
    this.darkTint = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, tokenColor('space-900'), 0).setOrigin(0).setScrollFactor(0).setDepth(9000);
    this.darkTint.setAlpha(darknessFor(this.sim.res.energy));
    this.flareTint = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, tokenColor('nebula-magenta'), 0).setOrigin(0).setScrollFactor(0).setDepth(9001);
    this.ghostPool = new Pool(
      // estela blanca: silueta del michi (tinte en modo relleno)
      () => this.add.image(0, 0, michiKey(false, 'walk')).setOrigin(MICHI_ANCHOR.x, MICHI_ANCHOR.y).setVisible(false).setTint(tokenColor('comet-cyan')).setTintMode(Phaser.TintModes.FILL).setBlendMode(Phaser.BlendModes.ADD), // aura azul del impulso
      (g) => g.setVisible(false).setAlpha(1),
      GHOSTS,
    );
    this.floatPool = new Pool(
      () => this.add.text(0, 0, '', { fontFamily: FONT_DISPLAY, fontSize: '26px', fontStyle: '700', stroke: tokenCss('space-900'), strokeThickness: 6 }).setOrigin(0.5).setDepth(9500).setVisible(false),
      (t) => t.setVisible(false).setAlpha(1),
      12,
    );
    const cam = this.cameras.main;
    cam.setBounds(0, -CAMERA_MARGIN, MAP_W, MAP_H + CAMERA_MARGIN * 2).setRoundPixels(true).setZoom(CAMERA_ZOOM);
    cam.startFollow(this.michi, true, 0.14, 0.14).setFollowOffset(0, -CAMERA_LOOK_DOWN);
    cam.centerOn(this.pos.x, this.pos.y + CAMERA_LOOK_DOWN);

    this.buildHud();
    this.splitCameras();
    this.bindInput();
    this.onLocation(START_ROOM, 'ship');
    this.startTutorial();

    this.events.on(Phaser.Scenes.Events.RESUME, () => this.ui.q('[data-overlay]').hidden || this.ui.focusFirst('.modal [data-action]'));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.disposers.forEach((d) => d()));
  }

  /**
   * El zoom de la cámara principal también achicaría el HUD (DOM) y los velos de pantalla completa:
   * esos van en una cámara aparte sin zoom, y todo lo que se agregue al mundo después queda solo en la principal.
   */
  private splitCameras(): void {
    const screenOnly: Phaser.GameObjects.GameObject[] = [this.ui.dom, this.darkTint, this.flareTint];
    const hudCam = this.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    hudCam.inputEnabled = false; // los clics van a la cámara del mundo (máquinas y piso)
    this.cameras.main.ignore(screenOnly);
    hudCam.ignore(this.children.list.filter((o) => !screenOnly.includes(o)));
    const onAdded = (o: Phaser.GameObjects.GameObject): void => void (screenOnly.includes(o) || hudCam.ignore(o));
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
    this.disposers.push(() => this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded));
  }

  // ======================================================== mundo (un solo plano continuo)
  private buildWorld(): void {
    this.add.image(0, 0, MAP_TEXTURE).setOrigin(0).setScale(1 / MAP_RASTER).setDepth(-1000);
    const k = PROP_SIZE / PROP_TEXTURE_SCALE;
    for (const room of ROOM_IDS) {
      for (const p of roomProps(room, this.mission.id)) {
        let at = propPosition(room, p);
        // el PNG trae un margen de papel bajo el objeto: se baja ese margen para que quede apoyado en el piso
        // los objetos de la jornada siempre llevan contorno
        const img = this.add.image(at.x, at.y + PROP_PAPER_MARGIN * k, propKey(textureAsset(p, !!p.missions))).setOrigin(0.5, 1).setScale(k).setDepth(at.y);
        // el objeto no se sale de su sala: su dibujo (sin el margen transparente) queda dentro del piso, sin montarse sobre las paredes
        const r = ROOM_RECTS[room];
        const half = img.displayWidth / 2 - PROP_PAPER_MARGIN * k;
        at = { x: Phaser.Math.Clamp(at.x, r.x + half, r.x + r.w - half), y: at.y };
        img.setX(at.x);
        if (p.asset === 'reciclador-aire') this.recycler = { sprite: img, at };
        if (p.asset === 'panel-solar' && p.kind === 'deco') this.panelSprites.push(img);
        if (p.kind === 'wall' || p.kind === 'poster') {
          img.setDepth(at.y - 500); // colgado de la pared: siempre detrás del michi
          if (p.kind === 'poster') this.addMachine(room, p, img, at); // se puede leer, pero no estorba al caminar
          continue;
        }
        this.obstacles.push({ x: at.x, y: at.y, r: OBSTACLE_R[p.kind] });
        if (p.kind === 'interactive') this.addMachine(room, p, img, at);
      }
    }
  }

  private addMachine(room: RoomId, p: RoomProp, sprite: Phaser.GameObjects.Image, at: Point): void {
    const m: Machine = { room, at, sprite, prop: p };
    this.machines.push(m);
    sprite.setInteractive({ useHandCursor: true });
    sprite.on('pointerdown', () => {
      if ((this.overlay !== 'none' && this.overlay !== 'actions') || !this.tutorialAllowsMachine(m)) return;
      audio.unlock();
      if (this.nearestMachine() === m) this.openActions();
      else this.walkTo({ x: m.at.x, y: m.at.y + MACHINE_FRONT }, true);
    });
  }

  /** Lista de tareas: las hechas quedan tachadas. */
  /** Lista de tareas en dos pestañas: las propias de la investigación y, solo cuando se terminan, "Avisar a la Tierra". */
  private renderTasks(): void {
    const unlocked = this.sim.stage2Unlocked && this.tasks.some((t) => t.stage === 2);
    if (!unlocked && this.taskTab === 2) this.taskTab = 1;
    this.ui.q('[data-tab2]').hidden = !unlocked;
    this.ui.el.querySelectorAll<HTMLElement>('.hud__tab').forEach((b) => {
      const on = Number(b.dataset.tab) === this.taskTab;
      b.classList.toggle('is-current', on);
      b.setAttribute('aria-selected', String(on));
    });
    const html = this.tasks.filter((t) => (t.stage ?? 1) === this.taskTab).map((t) => {
      const n = this.sim.taskProgress(t);
      const done = n >= t.count;
      return `<li class="mn-check ${done ? 'is-done' : ''}"><span class="mn-check__box" aria-hidden="true">${done ? icon('check') : ''}</span>
        <span class="mn-check__text">${icon(taskIcon(t))}${esc(taskLabel(t))}</span><span class="mn-check__meta">${n}/${t.count}</span></li>`;
    }).join('');
    this.setHtml('[data-tasks]', html);
  }

  /**
   * Avisos en los bordes: si un recurso está crítico (o hay una llamarada y no estás protegido),
   * una flecha en el borde de la pantalla apunta a la sala que lo resuelve; si la sala se ve, el aviso queda sobre su máquina.
   */
  private updateGuides(): void {
    const needs = new Map<string, Set<IconName>>(); // máquina (asset) → iconos del motivo
    const add = (asset: string, ic: IconName): void => void needs.set(asset, (needs.get(asset) ?? new Set<IconName>()).add(ic));
    for (const key of this.sim.criticals) if (key !== 'radiation') add(key === 'energy' && !(this.sim.comp.dust > 0.05 && this.sim.light > 0) ? BIKE_ASSET : GUIDE_ASSET[key], RESOURCE_ICON[key]);
    if (this.sim.breach) add(BREACH_GUIDE, 'wind');
    if (!this.sim.radioOk) add('consola-antena', 'antenna'); // la antena falló: hay que repararla
    const guide = this.tutorialIndex >= 0 ? this.tutorial[this.tutorialIndex]?.guide : undefined;
    if (guide) add(guide, 'info');
    if (this.sim.probeReady && this.tutorialIndex < 0) add('consola-antena', 'antenna'); // la sonda espera en la Antena
    const incoming = this.sim.incomingFlare;
    const outside = !this.sim.sheltered;
    let flareSecs: number | null = null; // cuenta de la llamarada junto a la Esclusa
    if (outside && this.sim.flareActive) add(DOOR_ASSET, 'radiation');
    else if (outside && incoming) {
      add(DOOR_ASSET, 'radiation');
      flareSecs = Math.ceil(incoming.inSec);
    } else if (outside && this.sim.suit <= SUIT_LOW && this.zone === 'surface') add(DOOR_ASSET, 'helmet');
    for (const asset of needs.keys()) if (this.guideTarget(asset)?.room === this.here) needs.delete(asset); // ya estás ahí
    if (this.sim.ended || PAUSING.has(this.overlay)) needs.clear();

    const box = this.ui.q('[data-guides]');
    for (const el of [...box.children] as HTMLElement[]) if (!needs.has(el.dataset.guide!)) el.remove();
    const cam = this.cameras.main;
    const view = cam.worldView;
    const margin = { left: 70, right: GAME_WIDTH - 70, top: 215, bottom: GAME_HEIGHT - 70 }; // arriba: bajo el reloj y las tareas
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    for (const [asset, icons] of needs) {
      const m = this.guideTarget(asset);
      if (!m) continue;
      let el = box.querySelector<HTMLElement>(`[data-guide="${asset}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'hud__guide';
        el.dataset.guide = asset;
        el.innerHTML = `<span class="hud__guide-arrow">${GUIDE_ARROW}</span><span class="hud__guide-label"><span class="hud__guide-icons" data-icons></span><span data-text></span></span>`;
        box.append(el);
      }
      // resumen: por qué (iconos) y adónde (la sala, que es donde la flecha desaparece)
      const sig = [...icons].join(',');
      if (el.dataset.icons !== sig) {
        el.dataset.icons = sig;
        el.querySelector<HTMLElement>('[data-icons]')!.innerHTML = [...icons].map((ic) => icon(ic)).join('');
      }
      const text = flareSecs !== null && asset === DOOR_ASSET ? `${roomName(m.room)} · ${flareSecs} s` : roomName(m.room);
      const label = el.querySelector<HTMLElement>('.hud__guide-label [data-text]')!;
      if (label.textContent !== text) label.textContent = text;
      const sx = (m.at.x - view.x) * cam.zoom; // de mapa a pantalla (la cámara está alejada)
      const sy = (m.at.y - GUIDE_LIFT - view.y) * cam.zoom;
      const bodyY = sy + GUIDE_LIFT * cam.zoom; // la máquina misma, bajo el punto de la flecha
      // máquina a la vista: la flecha la señala desde arriba, aunque tenga que quedarse bajo el reloj y las tareas
      const onScreen = sx > margin.left && sx < margin.right && bodyY > margin.top && sy < margin.bottom;
      let x = sx;
      let y = onScreen ? Math.max(sy, margin.top) : sy;
      let angle = 90; // apunta hacia abajo, a la máquina
      if (!onScreen) {
        const dx = sx - cx;
        const dy = sy - cy;
        const tx = dx > 0 ? (margin.right - cx) / dx : dx < 0 ? (margin.left - cx) / dx : Infinity;
        const ty = dy > 0 ? (margin.bottom - cy) / dy : dy < 0 ? (margin.top - cy) / dy : Infinity;
        const t = Math.min(tx, ty);
        x = cx + dx * t;
        y = cy + dy * t;
        angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
      el.classList.toggle('is-onscreen', onScreen);
      el.classList.toggle('is-low', y > GAME_HEIGHT * 0.75); // abajo: la etiqueta va sobre la flecha (no tapa el pie)
      el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      el.style.setProperty('--angle', `${angle.toFixed(0)}deg`);
    }
  }

  /** Adónde guía una flecha: la máquina de ese objeto o, para la salida de la nave, la Esclusa. */
  private guideTarget(asset: string): { room: RoomId; at: Point; name: string } | null {
    if (asset === BREACH_GUIDE && this.breachProp) return { room: this.breachProp.room, at: this.breachProp.at, name: machineName(this.breachProp) };
    if (asset === DOOR_ASSET) return { room: 'esclusa', at: roomCenter('esclusa'), name: roomName('esclusa') };
    const m = this.machines.find((x) => x.prop.asset === asset);
    return m ? { room: m.room, at: m.at, name: machineName(m) } : null;
  }

  /** Sin niebla alrededor: la estación solo se oscurece (pareja) a medida que baja la energía. */
  private updateDarkness(dt: number): void {
    const target = darknessFor(this.sim.res.energy);
    this.darkTint.setAlpha(this.darkTint.alpha + (target - this.darkTint.alpha) * Math.min(1, dt * 3));
  }

  private createMichi(): void {
    for (const helmet of [false, true]) {
      for (const [anim, cfg] of Object.entries(MICHI_ANIMS) as [MichiAnim, (typeof MICHI_ANIMS)[MichiAnim]][]) {
        const key = michiKey(helmet, anim);
        if (this.anims.exists(key)) this.anims.remove(key); // el tripulante pudo cambiar entre partidas
        this.anims.create({ key, frames: this.anims.generateFrameNumbers(key), frameRate: cfg.fps, repeat: cfg.loop ? -1 : 0 });
      }
    }
    this.shadow = this.add.ellipse(this.pos.x, this.pos.y, 70, 18, 0x000000, 0.3);
    this.michi = this.add.sprite(this.pos.x, this.pos.y, michiKey(false, 'idle')).setOrigin(MICHI_ANCHOR.x, MICHI_ANCHOR.y).setScale(MICHI_SCALE);
    this.michi.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => (this.oneShot = false));
    this.michi.play(michiKey(false, 'idle'));
  }

  private playAnim(anim: MichiAnim, oneShot = false): void {
    if (this.oneShot && !oneShot) return;
    if (anim === this.anim && !oneShot && this.michi.anims.isPlaying) return;
    this.anim = anim;
    this.oneShot = oneShot;
    this.michi.play(michiKey(this.helmet, anim));
  }

  // ======================================================== loop
  update(_time: number, deltaMs: number): void {
    if (!this.sim || this.ending) return;
    const dt = deltaMs / 1000;
    const paused = PAUSING.has(this.overlay);
    const simPaused = this.tutorialIndex >= 0 || (paused && !(this.overlay === 'minigame' && this.miniOutdoor)); // afuera el tiempo corre aunque se juegue; en el tutorial el reloj está detenido
    if (!simPaused) {
      if (this.ffwd && this.overlay !== 'none') this.setFfwd(false);
      this.sim.tick(dt * this.timescale * (this.ffwd ? FFWD_FACTOR : 1));
      this.checkHealthLoss();
      for (const ev of this.sim.drainEvents()) this.onSimEvent(ev);
      tickDash(this.dash, dt);
    }
    this.updatePlayer(dt, paused);
    this.updateDarkness(dt);
    this.updateGuides();
    this.updatePanels();
    this.updateBrokenAlerts();
    this.updateSpot();
    this.hudTimer += dt;
    if (this.hudTimer >= 1 / HUD_HZ) {
      this.hudTimer = 0;
      this.renderHud();
    }
  }

  private updatePlayer(dt: number, paused: boolean): void {
    const k = this.keys;
    const canMove = !paused && this.overlay !== 'map' && !this.sim.ended && this.tutorialAllowsMove();
    const input = { x: 0, y: 0 };
    if (canMove) {
      input.x = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0);
      input.y = (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0);
    }
    if (input.x !== 0 || input.y !== 0) {
      this.route = []; // el teclado manda: cancela la caminata automática
      this.openOnArrival = false;
      this.dashDir = { ...input };
    }
    const dashing = this.dash.remaining > 0;
    if (canMove && dashing && input.x === 0 && input.y === 0 && !this.route.length) Object.assign(input, this.dashDir);
    const speed = WALK_SPEED * dashSpeedFactor(this.dash);

    let moving = false;
    if (input.x !== 0 || input.y !== 0) {
      const next = moveOnMap(this.pos, input, speed, dt, this.obstacles);
      moving = next.x !== this.pos.x || next.y !== this.pos.y;
      this.pos = next;
      this.flags.moved ||= moving;
      if (input.x !== 0) this.face = Math.sign(input.x);
    } else if (canMove && this.route.length) {
      moving = this.followRoute(speed, dt);
    }

    if (this.jumpT >= 0) {
      this.jumpT += dt;
      if (this.jumpT > airTime(JUMP_V0, GRAVITY.moon)) this.jumpT = -1;
    }
    if (!this.oneShot) this.playAnim(moving ? 'walk' : 'idle');

    const loc = roomAt(this.pos);
    const zone = zoneAt(this.pos);
    if (loc !== this.here || zone !== this.zone) this.onLocation(loc, zone);

    const lift = this.jumpT >= 0 ? jumpHeight(JUMP_V0, GRAVITY.moon, this.jumpT) * PX_PER_METER : 0;
    this.michi.setPosition(this.pos.x, this.pos.y - lift).setDepth(this.pos.y + 0.5);
    // giro de papel: la escala X se acerca suavemente a ±1
    const target = this.face * MICHI_SCALE;
    this.michi.scaleX += (target - this.michi.scaleX) * Math.min(1, dt * 14);
    this.shadow.setPosition(this.pos.x, this.pos.y).setDepth(this.pos.y - 0.5).setScale(1 - Math.min(0.5, lift / 120));
    if (dashing && moving) this.dropGhost(dt);

    this.updateFocus();
  }

  /** Avanza por la ruta automática; devuelve si se movió. Al llegar, abre la máquina si se pidió. */
  private followRoute(speed: number, dt: number): boolean {
    let step = speed * Math.min(dt, 0.1);
    while (step > 0 && this.route.length) {
      const t = this.route[0];
      const dx = t.x - this.pos.x;
      const dy = t.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 2) this.face = Math.sign(dx);
      if (d <= step) {
        this.pos = { ...t };
        this.route.shift();
        step -= d;
      } else {
        this.pos = { x: this.pos.x + (dx / d) * step, y: this.pos.y + (dy / d) * step };
        step = 0;
      }
    }
    if (!this.route.length && this.openOnArrival) {
      this.openOnArrival = false;
      if (this.nearestMachine()) this.openActions();
    }
    return true;
  }

  private walkTo(target: Point, openOnArrival: boolean): boolean {
    if (this.sim.ended) return false;
    const route = findRoute(this.pos, target);
    if (!route.length) return false;
    this.route = route;
    this.openOnArrival = openOnArrival;
    return true;
  }

  /** Cambio de sala, pasillo o zona al caminar: avisa a la simulación, pone o saca el casco y actualiza el HUD. */
  private onLocation(loc: RoomId | null, zone: Zone): void {
    const fromHall = this.here === null;
    const zoneChanged = zone !== this.zone;
    this.here = loc;
    this.zone = zone;
    this.sim.enter(loc, zone);
    if ((loc && fromHall) || zoneChanged) audio.play('door');
    this.setHelmet(zone === 'surface');
    if (!this.miniMood) audio.setMood(ZONE_MOOD[zone]);
    this.ui.el.dataset.room = loc ?? 'pasillo';
    if (this.overlay === 'actions') this.closeOverlay();
  }

  /** Teletransporte de rescate (traje vacío): el michi aparece en la Esclusa. */
  private rescue(): void {
    this.route = [];
    this.openOnArrival = false;
    this.pos = roomCenter('esclusa');
    this.onLocation('esclusa', 'ship');
    this.cameras.main.centerOn(this.pos.x, this.pos.y + CAMERA_LOOK_DOWN);
  }

  private nearestMachine(): Machine | null {
    if (this.sim.inHall || this.sim.ended) return null;
    let best: Machine | null = null;
    let bestD = INTERACT_RADIUS;
    for (const m of this.machines) {
      if (m.room !== this.sim.room || !this.tutorialAllowsMachine(m)) continue;
      const d = Math.hypot(this.pos.x - m.at.x, this.pos.y - m.at.y);
      if (d < bestD) [best, bestD] = [m, d];
    }
    return best;
  }

  /**
   * Las máquinas se ven normales; cuando se puede interactuar con ellas (se pueden hacer, sirven de algo o una tarea las pide)
   * toman su contorno blanco y palpitan (los objetos propios de la jornada llevan el contorno siempre y solo palpitan al poder usarse).
   * Con movimiento reducido solo cambia el contorno.
   */
  private updateMachines(): void {
    const base = PROP_SIZE / PROP_TEXTURE_SCALE;
    for (const m of this.machines) {
      const want = !this.sim.ended && ((m.prop.asset === 'consola-antena' && this.sim.probeReady) || (m.prop.actions ?? []).some((a) => this.sim.available(a)
        && (this.sim.useful(a) || this.sim.tasks.some((t) => t.kind === 'action' && t.action === a && this.sim.taskProgress(t) < t.count && (t.stage !== 2 || this.sim.stage2Unlocked)))));
      // los de la jornada mantienen el contorno; la antena y los paneles cambian de dibujo con su estado (rota, sucios)
      const tex = propKey(textureAsset({ ...m.prop, asset: this.stateAsset(m.prop.asset) }, want || !!m.prop.missions));
      if (m.sprite.texture.key !== tex) m.sprite.setTexture(tex);
      if (want === !!m.active) continue;
      m.active = want;
      const old = this.pulses.get(m);
      if (old) {
        old.stop();
        this.pulses.delete(m);
        m.sprite.setScale(base);
      }
      if (want && !state.calm) {
        this.pulses.set(m, this.tweens.add({ targets: m.sprite, scale: base * 1.03, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut' }));
      }
    }
  }

  /** Resalta la máquina a mano (pulso suave) y muestra la pista de la tecla E. */
  private updateFocus(): void {
    const m = this.overlay === 'none' || this.overlay === 'actions' ? this.nearestMachine() : null;
    if (m !== this.focused) {
      this.focused?.sprite.clearTint();
      this.focused = m;
      m?.sprite.setTint(0xfff3c4);
      if (!m && this.overlay === 'actions') this.closeOverlay();
    }
    const prompt = this.ui.q('[data-prompt]');
    prompt.hidden = !m || this.overlay !== 'none';
    if (m) this.setText('[data-prompt-label]', t(m.prop.kind === 'poster' ? 'hud.read' : 'hud.use', { name: machineName(m) }));
  }

  // ---------- salto e impulso
  private jump(): void {
    if (this.overlay !== 'none' || this.jumpT >= 0 || this.sim.ended || this.tutorialIndex >= 0) return;
    this.jumpT = 0;
    audio.play('jump');
  }

  private tryDash(): void {
    if ((this.overlay !== 'none' && this.overlay !== 'actions') || this.tutorialIndex >= 0) return;
    if (this.sim.ended) return;
    if (!startDash(this.dash)) {
      audio.play('error'); // sin carga: el impulso se recarga solo
      return;
    }
    if (!this.route.length) this.dashDir = this.dashDir.x || this.dashDir.y ? this.dashDir : { x: this.face, y: 0 };
    this.ghostTimer = 0;
    audio.play('jump');
  }

  /** Estela del impulso: copias celestes y brillantes del michi (aura azul) que se desvanecen (pool; se omite en Ultra Ligero o con movimiento reducido). */
  private dropGhost(dt: number): void {
    if (state.calm || state.settings.ultraLight) return;
    this.ghostTimer -= dt;
    if (this.ghostTimer > 0) return;
    this.ghostTimer = 0.04;
    const g = this.ghostPool.acquire();
    if (!g) return;
    g.setTexture(this.michi.texture.key, this.michi.frame.name).setPosition(this.michi.x, this.michi.y)
      .setScale(this.michi.scaleX, this.michi.scaleY).setDepth(this.michi.depth - 0.2).setAlpha(0.65).setVisible(true);
    this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => this.ghostPool.release(g) });
  }

  // ======================================================== simulación → pantalla
  private setFfwd(on: boolean): void {
    this.ffwd = on;
    const b = this.ui?.el.querySelector<HTMLElement>('[data-ffwd]');
    if (!b) return;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('mn-btn--secondary', !on);
  }

  private onSimEvent(ev: SimEvent): void {
    // al empezar un nuevo día o ante cualquier alerta, el tiempo vuelve a la velocidad normal
    if (this.ffwd && ev.type !== 'breachRepaired' && ev.type !== 'panelsRestored') this.setFfwd(false);
    switch (ev.type) {
      case 'dayStart': {
        audio.play('day');
        this.pulse(this.ui.q('[data-day]'), 'is-tick');
        const light = ev.light >= 1 ? t('day.light.day') : ev.light > 0 ? t('day.light.dusk') : t('day.light.night');
        const tip = ev.light === 0 && ev.day === 5 ? this.hint(t('tip.night')) : undefined;
        this.toast('day', t('day.start', { day: ev.day, date: realDate(this.mission, ev.day) }), 'info', ALERT_MS, tip ? `${light} · ${tip}` : light, ev.light > 0 ? 'sun' : 'moon');
        break;
      }
      case 'flareWarning': {
        audio.play('radio');
        const where = !this.sim.sheltered ? t('flare.goBack') : this.sim.res.energy > 0 ? t('flare.warn.inside') : t('flare.warn.noEnergy');
        const tip = this.sim.sheltered ? undefined : this.hint(ev.forecasted ? t('tip.flare.forecasted') : t('tip.flare.late'));
        this.toast('flare', t('flare.warning', { flare: flareName(ev.event.classType) }), 'danger', ev.inSec * 1000, tip ? `${where} · ${tip}` : where); // queda hasta que llega
        break;
      }
      case 'flareStart': {
        const sev = severity(ev.event.classType);
        const where = !this.sim.sheltered ? t('flare.goBack') : this.sim.res.energy > 0 ? t('flare.start.shielded') : t('flare.start.noEnergy');
        const tip = this.sim.sheltered ? undefined : this.hint(ev.forecasted ? t('tip.flare.startForecasted') : t('tip.flare.startLate'));
        this.toast('flare', t('flare.start', { flare: flareName(ev.event.classType), date: realDate(this.mission, ev.event.day), source: sourceName(this.mission) }), 'danger', FLARE_DURATION_SEC * 1000, tip ? `${where} · ${tip}` : where);
        audio.play('alarm');
        if (!state.calm && sev !== 'minor') this.cameras.main.shake(500, sev === 'severe' ? 0.006 : 0.003);
        this.flareTint.setAlpha(sev === 'severe' ? 0.22 : 0.14);
        if (!state.calm) this.tweens.add({ targets: this.flareTint, alpha: 0.06, duration: 800, yoyo: true, repeat: Math.floor(FLARE_DURATION_SEC / 1.6) });
        break;
      }
      case 'flareEnd':
        this.tweens.killTweensOf(this.flareTint);
        this.flareTint.setAlpha(0);
        this.float(`+${ev.dose} ${resourceShort('radiation')}`, 'nebula-magenta');
        // la decisión, con el dato real de la llamarada: lo que recibiste y lo que habría pasado en el otro lugar
        if (!ev.exposed) this.toast('flare', t('flare.end.shielded', { dose: ev.dose, outside: FLARE_OUTSIDE_HIT }), 'ok', FLARE_RESULT_MS);
        else this.toast('flare', t('flare.end.exposed', { dose: ev.dose, inside: Math.round(ev.total * SHELTER_FACTOR) }), 'danger', FLARE_RESULT_MS);
        break;
      case 'flareHit': // te encontró afuera: el golpe de radiación entero, de una vez
        audio.play('hurt');
        this.float(`+${ev.dose} ${resourceShort('radiation')}`, 'nebula-magenta');
        if (!state.calm) this.cameras.main.shake(400, 0.006);
        this.toast('flare', t('flare.hit', { n: ev.dose }), 'danger', FLARE_RESULT_MS, t('flare.goBack'));
        break;
      case 'actionDone':
        this.showDelta(ev.delta);
        this.playAnim('use', true);
        audio.play(ACTIONS_DELAYED.has(ev.action) ? 'radio' : 'confirm');
        if (ACTIONS_DELAYED.has(ev.action)) this.toast('radio', t('alert.sent'), 'info');
        break;
      case 'actionResolved':
        audio.play('radio');
        if (ev.message === 'linkRestored') this.dismissToast('antenna');
        if (ev.message === 'forecast') {
          this.toast('radio', t(ev.flares === 0 ? 'forecast.quiet' : ev.flares === 1 ? 'forecast.one' : 'forecast.many', { n: ev.flares }), 'ok');
        }
        break;
      case 'stageUnlocked':
        audio.play('achievement');
        this.taskTab = 2;
        this.renderTasks();
        this.toast('stage', t(this.sim.probeReady ? 'probe.ready' : 'alert.stage2'), 'ok'); // con sonda: primero la sonda, después la Tierra
        break;
      case 'taskDone': {
        audio.play('achievement'); // sin cartel: el avance se ve en la lista de tareas
        this.renderTasks();
        this.pulse(this.ui.q('.hud__tasks'), 'is-tick');
        break;
      }
      case 'critical': {
        audio.play('error');
        this.pulse(this.ui.q(`[data-res="${ev.resource}"]`), 'is-alarm');
        const advice: Record<keyof Resources, string> = {
          energy: t('tip.critical.energy'),
          oxygen: t('tip.critical.oxygen'),
          food: t('tip.critical.food'),
          health: t('tip.critical.health'),
          radiation: t('tip.critical.radiation'),
        };
        this.toast(`critical-${ev.resource}`, t('alert.critical', { resource: resourceLabel(ev.resource) }), 'danger', ALERT_MS, this.hint(advice[ev.resource]));
        break;
      }
      case 'breachOpened':
        audio.play('alarm');
        this.spawnBreach(ev.room);
        this.toast('breach', t('alert.breach'), 'danger', Infinity, this.hint(t('tip.breach', { room: roomName(ev.room) }))); // queda a la vista hasta que se repara
        this.pulse(this.ui.q('[data-res="oxygen"]'), 'is-alarm');
        break;
      case 'antennaFault':
        audio.play('alarm');
        this.toast('antenna', t('alert.antennaFault'), 'danger', Infinity, this.hint(t('tip.antennaFault'))); // queda a la vista hasta que se repara
        break;
      case 'breachRepaired':
        this.removeBreach();
        this.dismissToast('breach');
        audio.play('confirm');
        break;
      case 'dustStorm':
        audio.play('error');
        this.toast('dust', t('alert.dust'), 'danger', Infinity, this.hint(t('tip.dust'))); // queda a la vista hasta limpiar
        this.pulse(this.ui.q('[data-res="energy"]'), 'is-alarm');
        break;
      case 'panelsFailing':
        audio.play('error');
        if (this.sim.light < 1) {
          // sin sol no hay nada que limpiar: solo queda la reserva y la bicicleta
          this.toast('panels', t('alert.panels.dark'), 'danger', ALERT_MS, this.hint(t('tip.panels.dark')));
        } else {
          this.toast('dust', t('alert.panels.dust'), 'danger', Infinity, this.hint(t('tip.panels.dust')));
        }
        this.pulse(this.ui.q('[data-res="energy"]'), 'is-alarm');
        break;
      case 'panelsRestored':
        audio.play('confirm');
        break;
      case 'suitLow':
        audio.play('error');
        this.toast('suit', t('alert.suitLow'), 'danger');
        break;
      case 'suitEmpty':
        audio.play('hurt');
        if (this.overlay === 'minigame') this.closeOverlay(); // se acabó el oxígeno limpiando: se cancela, sin costo ni efecto
        this.rescue();
        this.toast('suit', t('alert.suitEmpty', { n: ev.oxygenLost, h: ev.healthLost }), 'danger', ALERT_MS, this.hint(t('tip.suit')));
        break;
      case 'gameOver':
      case 'missionComplete':
        this.finish();
        break;
    }
  }

  private setHelmet(on: boolean): void {
    if (this.helmet === on) return;
    this.helmet = on;
    this.oneShot = false;
    this.michi.play(michiKey(on, this.anim));
  }

  /**
   * Parte el texto en trozos: los nombres de los atributos (energía, oxígeno, comida, salud, radiación) salen aparte
   * para mostrarlos en grande, con su color y su icono.
   */
  private splitAttributes(text: string): { text: string; key?: keyof Resources }[] {
    const keys = ['energy', 'oxygen', 'food', 'health', 'radiation'] as (keyof Resources)[];
    const names = new Map<string, keyof Resources>();
    for (const key of keys) for (const name of [resourceLabel(key), resourceShort(key)]) names.set(name.toLowerCase(), key);
    const escaped = [...names.keys()].sort((x, y) => y.length - x.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    const out: { text: string; key?: keyof Resources }[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ text: m[0], key: names.get(m[0].toLowerCase()) });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  /** HTML del texto con las primeras `n` letras visibles; lo demás ocupa su lugar (invisible) para que el cuadro no crezca. */
  private tipHtml(parts: { text: string; key?: keyof Resources }[], n: number): string {
    let pos = 0;
    return parts.map((p) => {
      const start = pos;
      pos += p.text.length;
      const shown = Math.max(0, Math.min(p.text.length, n - start));
      const body = `${esc(p.text.slice(0, shown))}<span class="hud__tip-rest">${esc(p.text.slice(shown))}</span>`;
      if (!p.key) return body;
      const icn = `<span class="attr__icon" ${shown < p.text.length ? 'style="visibility:hidden"' : ''}>${icon(RESOURCE_ICON[p.key])}</span>`;
      return `<span class="attr" style="color:${tokenCss(RESOURCE_COLOR[p.key])}">${body}${icn}</span>`;
    }).join('');
  }

  /** La Comandante «habla»: el texto sale letra a letra, la boca se abre y suena un pitido, como en una novela gráfica. */
  private speak(text: string): void {
    this.typeTimer?.remove();
    this.typeTimer = undefined;
    const el = this.ui.q('[data-tip-text]');
    const portrait = this.ui.q('[data-portrait]');
    this.ui.q('[data-tip]').setAttribute('aria-label', text);
    const parts = this.splitAttributes(text);
    const render = (n: number): void => void (el.innerHTML = this.tipHtml(parts, n));
    portrait.classList.remove('is-open');
    if (state.calm) {
      render(text.length);
      audio.blip();
      this.typing = null;
      return;
    }
    this.typing = { text, render: () => render(text.length) };
    let n = 0;
    let pause = 0;
    render(0);
    this.typeTimer = this.time.addEvent({
      delay: 34, loop: true,
      callback: () => {
        if (pause > 0) { pause--; portrait.classList.remove('is-open'); return; }
        n++;
        render(n);
        const ch = text[n - 1];
        if (ch === ' ') portrait.classList.remove('is-open');
        else {
          portrait.classList.toggle('is-open', n % 2 === 1);
          if (n % 2 === 0) audio.blip();
          if (',.;:?!'.includes(ch)) pause = ch === ',' ? 3 : 7;
        }
        if (n >= text.length) this.finishSpeaking();
      },
    });
  }

  /** Termina de escribir al instante (clic en el texto) o al llegar al final. */
  private finishSpeaking(): void {
    this.typeTimer?.remove();
    this.typeTimer = undefined;
    this.typing?.render();
    this.typing = null;
    this.time.delayedCall(90, () => this.ui.q('[data-portrait]').classList.remove('is-open'));
  }

  /** Gesto de dolor una sola vez cada vez que la salud baja de verdad (no por tener algo crítico). */
  private checkHealthLoss(): void {
    const hp = this.sim.res.health;
    if (hp < this.lastHealth - 1) {
      this.lastHealth = hp;
      this.playAnim('hurt', true);
      this.pulse(this.ui.q('[data-res="health"]'), 'is-loss');
    } else if (hp > this.lastHealth) this.lastHealth = hp;
  }

  /** Reinicia una animación corta de una clase sobre un elemento del HUD y la quita al terminar. */
  private pulse(el: Element, cls: string): void {
    if (state.calm) return;
    el.classList.remove(cls);
    void (el as HTMLElement).offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }

  private showDelta(d: ActionDelta): void {
    let i = 0;
    for (const [key, v] of Object.entries(d) as [ResourceKey, number][]) {
      if (!v) continue;
      this.time.delayedCall(i++ * 220, () => this.float(`${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))} ${resourceShort(key)}`, RESOURCE_COLOR[key]));
    }
  }

  /** Texto flotante sobre el michi, tomado del pool (sin crear objetos nuevos cada vez). */
  private float(text: string, color: string): void {
    const t = this.floatPool.acquire();
    if (!t) return;
    t.setText(text).setColor(tokenCss(color)).setPosition(this.michi.x, this.michi.y - 120).setVisible(true).setAlpha(1);
    if (state.calm) {
      this.time.delayedCall(1100, () => this.floatPool.release(t));
      return;
    }
    this.tweens.add({ targets: t, y: t.y - 60, alpha: 0, duration: 1200, ease: 'Quad.out', onComplete: () => this.floatPool.release(t) });
  }

  // ======================================================== acciones y caminatas
  private act(id: ActionId): void {
    if (this.tutorialIndex >= 0 && this.tutorial[this.tutorialIndex]?.allow?.action !== id) return audio.play('error');
    const check = this.sim.canAct(id);
    if (!check.ok) {
      audio.play('error');
      this.toast('blocked', blockReason(check.reason!), 'danger');
      return;
    }
    if (id === 'cleanDust') return this.openDustGame(id); // limpiar a mano: el costo se cobra al terminar
    if (id === 'cleanTestPanel') return this.openTestPanelGame();
    if (id === 'growLights') return this.openAlgaeGame();
    if (id === 'repair') return this.openSealGame();
    if (id === 'repairAntenna') return this.openAntennaFlow();
    if (id === 'tellEarth') return this.openLinkGame();
    if (id === 'pedal') return this.openPedalGame();
    if (id === 'eva') return this.openBiosignatureGame();
    if (id === 'analyze') return this.openBioTestsGame();
    if (id === 'harvest') return this.openHarvestGame();
    if (id === 'heal') return this.openHealGame();
    this.sim.act(id);
    for (const ev of this.sim.drainEvents()) this.onSimEvent(ev);
    this.renderActions();
  }

  // ---------- minijuegos: todos a pantalla completa y sin texto (el reloj se detiene; el costo y el efecto se aplican al terminar)
  /**
   * Minijuego a pantalla completa con el marco común: el juego, la pista de los primeros segundos (gesto y teclas) y el botón Salir.
   * Al terminar muestra 1 a 3 estrellas y la ganancia real; `finish` aplica la acción y devuelve su efecto.
   */
  private openFullMini(cfg: { hint: string; mount: (root: HTMLElement, cb: MiniCallbacks) => MiniGameHandle; finish: (result?: number) => ActionDelta | null | undefined; outdoor?: boolean; next?: () => void; failed?: (result?: number) => string | null; wide?: boolean; mood?: Mood }): void {
    this.closeOverlay(!!cfg.mood);
    this.miniOutdoor = !!cfg.outdoor;
    if (cfg.mood) { this.miniMood = cfg.mood; audio.setMood(cfg.mood); } // la sonda trae su propia música
    this.openModal(`${miniFrameHtml('close-actions')}
      ${cfg.outdoor ? `<div class="mini-suit" aria-label="${t('mini.suit')}">${icon('helmet')}<div class="mini-suit__track"><div class="mini-suit__fill" data-mini-suit></div></div></div>` : ''}`, 'minigame', 'modal__panel--full');
    const frame = this.ui.q('[data-overlay]');
    if (cfg.wide) frame.querySelector('.mini-full')?.classList.add('mini-full--wide'); // apaisado: aprovecha la pantalla del PC
    const msgs = this.ui.q('[data-msgs]');
    msgs.innerHTML = miniMsgsHtml(cfg.hint);
    this.ui.q('[data-hud]').classList.add('is-mini'); // las stats y los mensajes quedan a la vista sobre el minijuego
    this.miniGame = cfg.mount(this.ui.q('[data-mini-stage]'), {
      onProgress: () => undefined,
      onDone: (result) => {
        const failure = cfg.failed?.(result) ?? null; // no se alcanzó la meta: no hay estrellas ni efecto
        if (failure) {
          audio.play('error');
          this.toast('mini', failure, 'danger');
        } else {
          audio.play('achievement');
          showMiniResult(msgs, frame, result ?? 1, this.gainHtml(cfg.finish(result)));
        }
        for (const ev of this.sim.drainEvents()) this.onSimEvent(ev);
        this.time.delayedCall(MINI_RESULT_MS, () => {
          if (this.overlay !== 'minigame') return;
          if (cfg.next) cfg.next(); // minijuego encadenado (p. ej. cables y después el mensaje)
          else this.closeOverlay();
        });
      },
    });
    decorateHint(msgs, this.miniGame);
  }

  /** Multiplicador de tiempo de los minijuegos según la dificultad (Cadete más, Comandante menos). */
  private get miniTime(): number {
    return MINI_DIFFICULTY[this.difficulty.id].time;
  }

  /** Lo que dio la acción en verde («+8 Energía» con el icono del atributo) y, abajo, chico y en rojo, lo que se perdió (con su icono). */
  private gainHtml(d: ActionDelta | null | undefined): string {
    if (!d) return '';
    const entries = Object.entries(d) as [ResourceKey, number][];
    const item = (key: ResourceKey, sign: string, v: number): string => `${icon(RESOURCE_ICON[key])}<b>${sign}${Math.round(Math.abs(v))}</b><i>${esc(resourceShort(key))}</i>`;
    const gains = entries
      .filter(([key, v]) => key !== 'radiation' && Math.round(v) > 0)
      .map(([key, v]) => `<span class="mini-gain">${item(key, '+', v)}</span>`)
      .join('');
    const losses = entries
      .filter(([key, v]) => (key === 'radiation' ? Math.round(v) > 0 : Math.round(v) < 0))
      .map(([key, v]) => `<span class="mini-loss__item">${item(key, key === 'radiation' ? '+' : '−', v)}</span>`)
      .join('');
    return gains + (losses ? `<span class="mini-loss">${losses}</span>` : '');
  }

  private openDustGame(action: 'cleanDust'): void {
    this.openFullMini({
      hint: t('hint.dust'),
      mount: (root, cb) => ({ ...mountDustGame(root, { dust: this.sim.comp.dust, ...cb }), gesture: 'drag', keys: ['← ↑ → ↓'] }),
      finish: (r) => this.sim.act(action, quality(r ?? 1)), // lo que queda sucio se suma después como resto de polvo
      outdoor: true, // en la superficie el traje sigue gastando oxígeno mientras limpias
    });
  }

  /** Panel de pruebas (Energía del Sol): limpiarlo y orientarlo al Sol. Se juega afuera: el traje sigue gastando. */
  private openTestPanelGame(): void {
    this.openFullMini({ hint: t('hint.testPanel'), mount: (root, cb) => ({ ...mountTestPanel(root, cb, this.miniTime), gesture: 'drag', keys: ['← ↑ → ↓'] }), finish: (r) => this.sim.act('cleanTestPanel', quality(r ?? 1)), outdoor: true });
  }

  /** Cultivo de algas (Huerto lunar): mantener luz, nutrientes y temperatura en su franja (en Cadete, sin la temperatura). */
  private openAlgaeGame(): void {
    this.openFullMini({
      hint: t('hint.algae'),
      mount: (root, cb) => mountAlgae(root, cb, MINI_DIFFICULTY[this.difficulty.id]),
      finish: (r) => this.sim.act('growLights', quality(r ?? 1)),
      failed: (r) => ((r ?? 1) > 0 ? null : t('alert.algaeFail')), // no se llenó la barra a tiempo: se pierde, sin costo ni efecto
    });
  }

  private openSealGame(): void {
    this.openFullMini({ hint: t('hint.seal'), mount: (root, cb) => ({ ...mountSealGame(root, cb), gesture: 'drag', keys: ['← ↑ → ↓'] }), finish: (r) => this.sim.act('repair', quality(r ?? 1)) });
  }

  /**
   * Avisar a la Tierra: si la señal está floja primero se conectan los cables; después se recupera el mensaje dañado por la estática.
   * El aviso (la acción) se cobra al terminar el mensaje; su calidad cuenta para la ganancia.
   */
  /** Reconectar con la Tierra (para irse): apuntar la antena y elegir el canal. Solo se desbloquea al terminar la investigación y con la antena sana. */
  private openLinkGame(): void {
    this.openFullMini({ hint: t('hint.casaLink'), mount: (root, cb) => mountLink(root, (r) => cb.onDone(r.score)), finish: (r) => this.sim.act('tellEarth', quality(r ?? 1)), outdoor: true });
  }

  private openAntennaFlow(): void {
    const message = (): void => this.openFullMini({ hint: t('hint.message'), mount: (root, cb) => mountNoisyMessage(root, cb), finish: (r) => this.sim.act('repairAntenna', quality(r ?? 1)), outdoor: true });
    if (this.sim.comp.antenna < 0.7) this.openFullMini({ hint: t('hint.wires'), mount: (root, cb) => mountAntennaGame(root, cb), finish: () => undefined, next: message, outdoor: true });
    else message();
  }

  /** Taladro de hielo: mantener el taladro sobre el punto hasta que el hielo se rompa; la ciencia ganada escala con la calidad. Se juega afuera: el traje sigue gastando. */
  private openBiosignatureGame(): void {
    this.openFullMini({ hint: t('hint.drill'), mount: (root, cb) => mountIceDrill(root, cb), finish: (r) => this.sim.act('eva', quality(r ?? 1)), outdoor: true });
  }

  /** Bicicleta de energía: seguir el ritmo con los dos pedales. */
  private openPedalGame(): void {
    this.openFullMini({
      hint: t('hint.pedal'),
      mount: (root, cb) => mountPedal(root, cb, this.miniTime),
      finish: (r) => this.sim.act('pedal', quality(r ?? 1)),
      failed: (r) => ((r ?? 1) > PEDAL_PASS ? null : t('alert.pedalFail')),
    });
  }

  /** Curarse: tratar cada herida manteniendo apretado. */
  private openHealGame(): void {
    this.openFullMini({ hint: t('hint.heal'), mount: (root, cb) => mountHealGame(root, cb, this.miniTime), finish: (r) => this.sim.act('heal', quality(r ?? 1)) });
  }

  /** Cosechar; si se diseñó el ADN de papel (opcional), la cosecha rinde un poco más (sin taller, ×1: igual que siempre). */
  private openHarvestGame(): void {
    this.openFullMini({ hint: t('hint.harvest'), mount: (root, cb) => mountHarvestGame(root, cb, this.miniTime), finish: (r) => this.sim.act('harvest', quality(r ?? 1) * dnaBonus(this.sim.stats.dna)) });
  }

  /** Taller de ADN de papel (opcional, en el Rack de plantas): no cuesta recursos; su nota da el bonus de las cosechas siguientes. */
  private openDnaGame(): void {
    this.openFullMini({
      hint: t('hint.dna'),
      mount: (root, cb) => mountDnaWorkshop(root, { mission: this.mission.id, hard: this.difficulty.id === 'comandante', onDone: (score) => cb.onDone(score) }),
      finish: (r) => { this.sim.setDna(r ?? 0); return undefined; },
    });
  }

  /**
   * La sonda (última tarea de la investigación): contacto por cables → cinturón de asteroides → alunizaje → rover lunar.
   * Se maneja a distancia desde la Antena: el reloj se detiene (no es `outdoor`). Nunca se pierde: jugar mal solo baja el puntaje.
   * Nota = 0,2 × contacto + 0,3 × cinturón + 0,5 × luna; las baterías y chips del cinturón dan tiempo y pistas al rover.
   */
  private runProbe(): void {
    const hard = this.difficulty.id === 'comandante';
    const seed = this.mission.id.length * 977 + this.sim.day;
    let belt: BeltResult = { score: 0, batteries: 0, chips: 0, algae: 0, hull: 3 };
    const rover = (): void => this.openFullMini({
      hint: t('hint.rover'),
      wide: true, mood: 'moon',
      mount: (root, cb) => mountRover(root, { hard, batteries: belt.batteries, chips: belt.chips, onDone: (r) => {
        this.sim.completeProbe(finaleScore(1, belt.score, r.score), r.rocks, belt.batteries + belt.chips + belt.algae);
        if (this.sim.stats.probe) this.toast('stage', t('probe.done'), 'ok');
        cb.onDone(r.score);
      } }),
      finish: () => undefined,
    });
    const delivery = (): void => this.openFullMini({ hint: t('hint.delivery'), wide: true, mood: 'space', mount: (root, cb) => mountDelivery(root, () => cb.onDone()), finish: () => undefined, next: rover });
    const asteroids = (): void => this.openFullMini({
      hint: t('hint.belt'), wide: true, mood: 'space',
      mount: (root, cb) => mountBelt(root, { hard, seed, calm: state.calm, onDone: (r) => { belt = r; cb.onDone(r.score); } }),
      finish: () => undefined, next: delivery,
    });
    this.openFullMini({ hint: t('hint.probeContact'), mount: (root, cb) => mountAntennaGame(root, cb), finish: () => undefined, next: asteroids });
  }

  /** Biofirmas: analizar una muestra de hielo ya recogida con tres pruebas independientes. Se juega afuera: el traje sigue gastando. */
  private openBioTestsGame(): void {
    this.openFullMini({
      hint: t('hint.bio'),
      mount: (root, cb) => mountBiofirmas(root, { hard: this.difficulty.id === 'comandante', seed: this.sim.day * 31 + this.sim.stats.bioTests * 7, onDone: (score) => cb.onDone(score) }),
      finish: (r) => this.sim.act('analyze', quality(r ?? 1)),
      outdoor: true,
    });
  }

  /** La fractura sale del reciclador de oxígeno: el reciclador de la sala se cambia por su versión rota, que es lo que hay que reparar. */
  private spawnBreach(room: RoomId): void {
    const rec = this.recycler;
    if (!rec || room !== 'soporte' || this.breachProp) return;
    const k = PROP_SIZE / PROP_TEXTURE_SCALE;
    const prop: RoomProp = { asset: 'reciclador-roto', kind: 'interactive', x: 0, y: 0, actions: ['repair'], nameKey: 'machine.brokenRecycler' };
    rec.sprite.setVisible(false);
    const sprite = this.add.image(rec.at.x, rec.at.y + PROP_PAPER_MARGIN * k, propKey('reciclador-roto')).setOrigin(0.5, 1).setScale(k).setDepth(rec.at.y);
    const m: Machine = { room, at: rec.at, sprite, prop };
    sprite.setInteractive({ useHandCursor: true });
    sprite.on('pointerdown', () => {
      if ((this.overlay !== 'none' && this.overlay !== 'actions') || !this.tutorialAllowsMachine(m)) return;
      audio.unlock();
      if (this.nearestMachine() === m) this.openActions();
      else this.walkTo({ x: m.at.x, y: m.at.y + MACHINE_FRONT }, true);
    });
    this.machines.push(m);
    this.breachProp = m;
    this.breachMarker = this.makeBreachMarker(rec.at.x, rec.at.y - sprite.displayHeight - 36);
  }

  /** Marcador sobre la máquina rota: una flecha roja sólida que apunta hacia abajo y empuja hacia ella (quieta si se pidió menos movimiento). */
  private makeBreachMarker(x: number, y: number): Phaser.GameObjects.Container {
    const arrow = this.add.graphics();
    const pts = [[-10, -34], [10, -34], [10, -6], [26, -6], [0, 24], [-26, -6], [-10, -6]].map(([px, py]) => new Phaser.Math.Vector2(px, py));
    arrow.fillStyle(tokenColor('danger'), 1).fillPoints(pts, true);
    arrow.lineStyle(5, tokenColor('space-900'), 1).strokePoints(pts, true, true);
    const box = this.add.container(x, y, [arrow]).setDepth(9001);
    if (!state.calm) this.tweens.add({ targets: box, y: y + 10, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    return box;
  }

  /** Reparado: el reciclador vuelve a verse entero. */
  private removeBreach(): void {
    const m = this.breachProp;
    if (!m) return;
    this.pulses.get(m)?.stop();
    this.pulses.delete(m);
    m.sprite.destroy();
    this.breachMarker?.destroy();
    this.breachMarker = undefined;
    this.machines = this.machines.filter((x) => x !== m);
    if (this.focused === m) this.focused = null;
    this.recycler?.sprite.setVisible(true);
    this.breachProp = undefined;
  }


  // ======================================================== HUD (HTML)
  private buildHud(): void {
    const bar = (key: keyof Resources, cls: string): string => `
      <div class="mn-bar ${cls}" role="progressbar" aria-label="${resourceLabel(key)}" aria-valuemin="0" aria-valuemax="100" data-res="${key}">
        <span class="mn-bar__label">${icon(RESOURCE_ICON[key])}<span class="mn-bar__name">${resourceLabel(key)}</span></span>
        <div class="mn-bar__track"><div class="mn-bar__fill" data-fill></div><div class="mn-bar__ghost" data-ghost hidden></div></div>
        <span class="mn-bar__value" data-value>0</span>
        <span class="mn-bar__delta" data-delta hidden></span>
      </div>`;
    const system = (key: string, ic: IconName, label: string): string => `
      <div class="hud__sys" data-sys="${key}">
        <span class="hud__sys-label">${icon(ic)}${label}</span>
        <span class="hud__sys-state" data-sys-state></span>
      </div>`;
    this.ui = new UiLayer(this, /* html */ `
      <div class="hud" data-hud>
        <div class="hud__clock mn-panel">
          <div class="hud__clock-row"><span class="mn-chip mn-chip--outline" data-day></span><span class="hud__light" data-light></span></div>
          <div class="hud__daybar" aria-hidden="true"><i data-daybar></i></div>
          <button class="mn-btn mn-btn--secondary mn-btn--sm hud__ff" data-action="ffwd" data-ffwd aria-pressed="false">${icon('skip')}${t('hud.ffwd')}</button>
        </div>
        <div class="hud__guides" data-guides aria-live="polite"></div>
        <div class="hud__restip mn-panel" data-res-tip hidden role="tooltip"></div>
        <div class="hud__left">
          <!-- los 3 recursos que deciden la misión, grandes; comida y salud compactas (crecen si entran en peligro) -->
          <section class="hud__stats mn-panel" data-stats aria-label="${t('hud.stats')}">
            <div class="hud__primary">${bar('oxygen', 'mn-bar--oxygen')}${bar('energy', 'mn-bar--energy')}${bar('radiation', 'mn-bar--radiation')}</div>
            <div class="hud__secondary">${bar('food', 'mn-bar--hunger')}${bar('health', 'mn-bar--health')}</div>
          </section>
          <section class="hud__suit mn-panel" data-suit hidden aria-label="${t('hud.suit')}">
            <div class="mn-bar mn-bar--oxygen" role="progressbar" aria-label="${t('hud.suit')}" aria-valuemin="0" aria-valuemax="100" data-suit-bar>
              <span class="mn-bar__label">${icon('helmet')}${t('guide.suit')}</span>
              <div class="mn-bar__track"><div class="mn-bar__fill" data-fill></div></div>
              <span class="mn-bar__value" data-value></span>
            </div>
          </section>
          <section class="hud__systems mn-panel" data-systems hidden aria-label="${t('hud.systems')}">
            ${system('leak', 'oxygen', t('sys.recycler'))}${system('panels', 'panel', t('sys.panels'))}${system('radio', 'antenna', t('sys.radio'))}
          </section>
          <!-- todos los mensajes van aquí, debajo de las stats: nunca al centro de la pantalla -->
          <div class="hud__countdown" data-countdown hidden>${icon('radiation')}<span data-countdown-text></span></div>
          <div class="hud__toasts" data-toasts role="status" aria-live="polite"></div>
          <div class="hud__msgs" data-msgs></div>
        </div>
        <div class="hud__top-right">
          <section class="hud__tasks mn-panel" aria-label="${t('hud.research')}">
            <span class="hud__tasks-name">${esc(missionText(this.mission.id, 'name'))}</span>
            <div class="hud__tabs" role="tablist" aria-label="${t('hud.tasks')}">
              <button class="hud__tab" role="tab" data-action="tasks-tab" data-tab="2" data-tab2 hidden>${t('hud.tellEarth')}</button>
            </div>
            <ul class="mn-checklist" data-tasks></ul>
          </section>
          <span class="caption-mono hud__fps" data-fps hidden></span>
        </div>
        <button class="hud__prompt" data-prompt data-action="use" hidden><span class="mn-key">E</span> <span data-prompt-label></span></button>
        <button class="mn-btn mn-btn--secondary mn-btn--sm hud__tutorial-skip" data-action="tutorial-skip">${icon('skip')}${t('tutorial.skip')}</button>
        <div class="hud__tip" data-tip hidden>
          <div class="hud__tip-portrait" data-portrait aria-hidden="true">${commanderSvg()}</div>
          <div class="hud__tip-box mn-dialogue">
            <p class="mn-dialogue__name">${t('commander.name')}</p>
            <p class="mn-dialogue__text" data-tip-text data-action="tip-skip" aria-hidden="true"></p>
            <div class="hud__tip-actions" data-tip-actions hidden>
              <button class="mn-btn mn-btn--sm" data-action="tutorial-next">${icon('check')}${t('tutorial.ok')}</button>
            </div>
          </div>
        </div>
        <div class="hud__touch" aria-label="${t('hud.touch')}">
          <button class="mn-btn mn-btn--secondary mn-btn--icon" data-action="touch-pause" aria-label="${t('control.pause')}">${icon('pause')}</button>
          <button class="mn-btn mn-btn--secondary mn-btn--icon" data-action="touch-map" aria-label="${t('hud.map')}">${icon('map')}</button>
          <button class="mn-btn mn-btn--secondary mn-btn--icon" data-action="touch-jump" aria-label="${t('hud.jump')}">${icon('jump')}</button>
          <button class="mn-btn mn-btn--secondary mn-btn--icon" data-action="touch-dash" aria-label="${t('hud.dash')}">${icon('dash')}</button>
        </div>
        <aside class="hud__actions mn-panel" data-actions hidden aria-label="${t('hud.actions')}"></aside>
        <p class="hud__source" title="${esc(sourceCredit(this.mission))}">${icon('antenna')}${esc(t('hud.source', { source: sourceName(this.mission) }))}</p>
        <div class="spot" data-spot hidden><div class="spot__dim" data-spot-dim></div><div class="spot__ring" data-spot-ring hidden></div></div>
      </div>
      <div class="modal" data-overlay hidden></div>`, 'screen screen--clear');

    this.ui
      .on('ffwd', () => this.setFfwd(!this.ffwd))
      .on('resume', () => this.closeOverlay())
      .on('close', () => (this.overlay === 'settings' || this.overlay === 'controls' ? this.openPause() : this.closeOverlay()))
      .on('controls', () => this.openControls())
      .on('tutorial-start', () => this.runTutorial())
      .on('tutorial-decline', () => {
        this.closeOverlay();
        this.endTutorial();
      })
      .on('settings', () => this.openSettings())
      .on('archive', () => this.openArchive())
      .on('read-entry', (el) => this.openArchive(el.dataset.entry))
      .on('dna', () => this.openDnaGame())
      .on('call-probe', () => this.runProbe())
      .on('quit', () => fadeTo(this, SCENES.menu))
      .on('act', (el) => this.act(el.dataset.id as ActionId))
      .on('close-actions', () => this.closeOverlay())
      .on('use', () => this.overlay === 'none' && this.nearestMachine() && this.openActions())
      .on('touch-pause', () => this.overlay === 'none' && this.openPause())
      .on('touch-map', () => this.toggleMap())
      .on('touch-jump', () => this.jump())
      .on('touch-dash', () => this.tryDash())
      .on('tasks-tab', () => { if (this.tutorialIndex >= 0) return; this.taskTab = this.taskTab === 2 ? 1 : 2; this.renderTasks(); }) // alterna entre la investigación y "Avisar a la Tierra"
      .on('tip-skip', () => { if (this.typing) this.finishSpeaking(); })
      .on('tutorial-next', () => this.nextTutorial(true))
      .on('tutorial-skip', () => this.endTutorial());
    this.disposers.push(bindSettings(this.ui, () => undefined));
    this.spot = new Spotlight(this.ui.q('[data-spot]'), GAME_WIDTH, GAME_HEIGHT);
    this.bindResTips();
    this.bindPreview();
  }

  /** Al poner el cursor (o el foco) sobre una barra: qué es, y una imagen de dónde se recupera. */
  private bindResTips(): void {
    const tip = this.ui.q('[data-res-tip]');
    const show = (bar: HTMLElement): void => {
      const key = bar.dataset.res as keyof Resources;
      const sources = RES_SOURCES[key];
      const where = sources.length
        ? `<div class="hud__restip-where"><span class="hud__restip-title">${t('hud.where')}</span>${sources.map((x) => `<span class="hud__restip-src"><img src="game/props/${x.asset}.svg" alt="" width="64" height="58"><span>${esc(t(x.label))}</span></span>`).join('')}</div>`
        : `<div class="hud__restip-where"><span class="hud__restip-src">${icon('shield')}<span>${esc(t('where.shelter'))}</span></span></div>`;
      tip.innerHTML = `<strong class="hud__restip-name">${esc(resourceLabel(key))}</strong><p>${esc(t(`resource.${key}.desc`))}</p>${where}`;
      tip.hidden = false;
      const hud = this.ui.q('[data-hud]');
      const hr = hud.getBoundingClientRect();
      const k = hr.width / (hud.offsetWidth || 1);
      const br = bar.getBoundingClientRect();
      tip.style.left = `${((br.right - hr.left) / k + 14).toFixed(0)}px`;
      tip.style.top = `${Math.max(8, (br.top - hr.top) / k - 12).toFixed(0)}px`;
    };
    const hide = (): void => void (tip.hidden = true);
    this.ui.el.addEventListener('pointerover', (ev) => {
      const bar = (ev.target as HTMLElement).closest<HTMLElement>('[data-res]');
      if (bar) show(bar);
    });
    this.ui.el.addEventListener('pointerout', (ev) => {
      if ((ev.target as HTMLElement).closest('[data-res]')) hide();
    });
    this.ui.el.addEventListener('focusin', (ev) => {
      const bar = (ev.target as HTMLElement).closest<HTMLElement>('[data-res]');
      if (bar) show(bar);
    });
    this.ui.el.addEventListener('focusout', hide);
  }

  private renderHud(): void {
    const s = this.sim;
    for (const key of RES_KEYS) {
      const v = Math.round(s.res[key]);
      const id = `res-${key}`;
      const critical = key === 'radiation' ? s.res[key] >= 80 : s.res[key] <= 20; // mismo valor real que usa la simulación para avisar
      const sig = `${v}|${critical}`;
      if (this.hudCache.get(id) === sig) continue;
      const prev = this.hudCache.get(id);
      this.hudCache.set(id, sig);
      const el = this.ui.q(`[data-res="${key}"]`);
      if (prev !== undefined) {
        const delta = v - Number(prev.split('|')[0]);
        if (Math.abs(delta) >= 3) this.pulse(el, (key === 'radiation' ? delta < 0 : delta > 0) ? 'is-gain' : 'is-loss'); // radiación: subir es malo
      }
      el.setAttribute('aria-valuenow', String(v));
      (el.querySelector('[data-fill]') as HTMLElement).style.width = `${v}%`;
      (el.querySelector('[data-value]') as HTMLElement).textContent = key === 'radiation' ? `${v}%` : String(v);
      el.classList.toggle('is-critical', critical);
    }
    this.setText('[data-day]', t('hud.day', { day: s.day, days: s.config.days }));
    this.setText('[data-light]', s.light >= 1 ? t('hud.light.day') : s.light > 0 ? t('hud.light.dusk') : t('hud.light.night'));
    (this.ui.q('[data-daybar]') as HTMLElement).style.width = `${Math.round(s.dayProgress * 100)}%`;
    this.renderSuit();
    this.renderSystems();
    this.renderMiniSuit();
    const incoming = s.incomingFlare;
    const countdown = this.ui.q('[data-countdown]');
    const demo = this.tutorialIndex >= 0 && !!this.tutorial[this.tutorialIndex]?.demoFlare; // tutorial: cuenta de muestra, sin llamarada real
    countdown.hidden = !incoming && !demo;
    if (demo && !incoming) {
      this.setText('[data-countdown-text]', t('hud.countdown', { flare: flareName(DEMO_FLARE), s: 10 }));
      countdown.classList.remove('is-safe');
    } else if (incoming) {
      this.setText('[data-countdown-text]', t('hud.countdown', { flare: flareName(incoming.event.classType), s: Math.ceil(incoming.inSec) }));
      countdown.classList.toggle('is-safe', s.sheltered);
    }
    this.renderTasks();
    this.updateMachines();

    const fps = this.ui.q('[data-fps]');
    fps.hidden = !state.settings.showFps;
    if (state.settings.showFps) fps.textContent = `${Math.round(this.game.loop.actualFps)} FPS`;
    if (this.overlay === 'actions') this.renderActions();
    this.renderPreview();
    if (this.overlay === 'map') this.renderMapMarker();
    this.checkTutorial();
  }

  /** Equipos bajo las barras: cada fila aparece solo cuando algo falla (fuga, paneles, radio) o mientras llega el pronóstico. */
  private renderSystems(): void {
    const s = this.sim;
    const night = s.light === 0;
    const rows: Record<string, { text: string; bad: boolean; show: boolean }> = {
      leak: { text: t('sys.leak'), bad: true, show: !!s.breach },
      panels: { text: night ? t('sys.noSun') : `${Math.round(s.panelEfficiency * s.light * 100)}%`, bad: true, show: !s.panelsOk },
      radio: { text: !s.radioOk ? t('sys.weak') : t('sys.forecast'), bad: !s.radioOk, show: !s.radioOk || s.forecasted },
    };
    this.ui.q('[data-systems]').hidden = !Object.values(rows).some((r) => r.show);
    for (const [key, row] of Object.entries(rows)) {
      const id = `sys-${key}`;
      const sig = `${row.text}|${row.bad}|${row.show}`;
      if (this.hudCache.get(id) === sig) continue;
      this.hudCache.set(id, sig);
      const el = this.ui.q(`[data-sys="${key}"]`);
      el.hidden = !row.show;
      el.classList.toggle('is-bad', row.bad);
      (el.querySelector('[data-sys-state]') as HTMLElement).textContent = row.text;
    }
  }

  /** Barra del traje: aparece al salir de la nave y se esconde cuando vuelve a estar llena adentro. */
  /** Barra de oxígeno del traje dentro del minijuego de afuera (el HUD queda tapado), sin texto: se ve cuánto aire queda mientras limpias. */
  private renderMiniSuit(): void {
    if (this.overlay !== 'minigame' || !this.miniOutdoor) return;
    const fill = this.ui.el.querySelector<HTMLElement>('[data-mini-suit]');
    if (!fill) return;
    const v = Math.max(0, Math.min(100, this.sim.suit));
    fill.style.width = `${v}%`;
    fill.parentElement!.classList.toggle('is-critical', v <= SUIT_LOW);
  }

  /** Barra del traje debajo de las stats: aparece al salir a la superficie y se esconde cuando vuelve a estar llena (el oxígeno de la nave es una de las 5 barras). */
  private renderSuit(): void {
    const s = this.sim;
    const panel = this.ui.q('[data-suit]');
    panel.hidden = this.zone !== 'surface' && s.suit >= 99.5;
    if (panel.hidden) return;
    const v = Math.round(s.suit);
    const bar = this.ui.q('[data-suit-bar]');
    bar.setAttribute('aria-valuenow', String(v));
    (bar.querySelector('[data-fill]') as HTMLElement).style.width = `${v}%`;
    this.setText('[data-suit-bar] [data-value]', `${Math.ceil(s.suitSecondsLeft)} s`);
    bar.classList.toggle('is-critical', this.zone === 'surface' && v <= SUIT_LOW);
  }

  private setText(sel: string, text: string): void {
    if (this.hudCache.get(sel) === text) return;
    this.hudCache.set(sel, text);
    this.ui.q(sel).textContent = text;
  }

  private setHtml(sel: string, html: string): void {
    if (this.hudCache.get(sel) === html) return;
    this.hudCache.set(sel, html);
    this.ui.q(sel).innerHTML = html;
  }

  /**
   * Aviso en la pila bajo las barras (nunca al centro ni sobre los controles). `id` agrupa un evento: la llamarada pasa de
   * «en camino» a «llegó» y a su resultado en el mismo aviso, sin apilar copias. `ms`: cuánto dura (Infinity: hasta cerrarlo por id).
   * `hint`: 2.ª línea corta con qué hacer.
   */
  private toast(id: string, text: string, tone: 'info' | 'ok' | 'danger', ms = ALERT_MS, hint?: string, ic: IconName = toastIcon(id)): void {
    const box = this.ui.q('[data-toasts]');
    const entry = this.toasts.get(id) ?? { el: document.createElement('div') };
    this.toasts.delete(id);
    this.toasts.set(id, entry); // el orden del Map es de antigüedad: este pasa a ser el más nuevo
    entry.el.className = `hud__toast hud__toast--${tone}`;
    entry.el.innerHTML = `<span class="hud__toast-icon">${icon(ic)}</span><span class="hud__toast-text">${esc(text)}</span>${hint ? `<span class="hud__toast-hint">${esc(hint)}</span>` : ''}`;
    if (tone === 'danger') box.prepend(entry.el); // lo urgente, arriba
    else box.append(entry.el);
    entry.timer?.remove();
    entry.timer = Number.isFinite(ms) ? this.time.delayedCall(Math.max(ALERT_MS, ms / this.timescale), () => this.dismissToast(id)) : undefined;
    if (this.toasts.size > TOAST_MAX) {
      // se va el más antiguo de los avisos comunes; la fisura y la llamarada se quedan mientras duren
      const others = [...this.toasts.keys()].filter((k) => k !== id);
      const old = others.find((k) => !TOAST_STICKY.has(k)); // las de algo roto nunca se desplazan: se van al repararlo
      if (old) this.dismissToast(old);
    }
  }

  private dismissToast(id: string): void {
    const entry = this.toasts.get(id);
    if (!entry) return;
    this.toasts.delete(id);
    entry.timer?.remove();
    entry.el.classList.add('is-leaving');
    window.setTimeout(() => entry.el.remove(), state.calm ? 0 : TOAST_OUT_MS);
  }

  /** Pista de la Comandante para la 2.ª línea del aviso (solo en dificultades con pistas y fuera del tutorial). */
  private hint(text: string): string | undefined {
    return this.difficulty.hints && this.tutorialIndex < 0 ? text : undefined;
  }

  /** Al pasar por una acción del panel (cursor o foco): las barras muestran qué sube y qué baja antes de decidir. */
  private bindPreview(): void {
    const actId = (node: EventTarget | null): ActionId | null =>
      ((node instanceof HTMLElement ? node.closest<HTMLElement>('[data-action="act"]')?.dataset.id : undefined) as ActionId | undefined) ?? null;
    const set = (id: ActionId | null): void => {
      if (this.previewId === id) return;
      this.previewId = id;
      this.renderPreview();
    };
    this.ui.el.addEventListener('pointerover', (ev) => { const id = actId(ev.target); if (id) set(id); });
    this.ui.el.addEventListener('pointerout', (ev) => { if (actId(ev.target)) set(actId(ev.relatedTarget)); });
    this.ui.el.addEventListener('focusin', (ev) => set(actId(ev.target)));
    this.ui.el.addEventListener('focusout', (ev) => set(actId(ev.relatedTarget)));
  }

  /** Segmento fantasma sobre cada barra afectada (brillo si mejora, franja si empeora) y el número del cambio al lado. */
  private renderPreview(): void {
    const id = this.overlay === 'actions' ? this.previewId : null;
    const delta = id ? this.sim.preview(id) : {};
    this.ui.q('[data-stats]').classList.toggle('is-previewing', !!id);
    for (const key of RES_KEYS) {
      const d = Math.round(delta[key] ?? 0);
      const v = Math.max(0, Math.min(100, this.sim.res[key]));
      const sig = `${d}|${Math.round(v)}`;
      if (this.hudCache.get(`ghost-${key}`) === sig) continue;
      this.hudCache.set(`ghost-${key}`, sig);
      const el = this.ui.q(`[data-res="${key}"]`);
      const ghost = el.querySelector<HTMLElement>('[data-ghost]')!;
      const tag = el.querySelector<HTMLElement>('[data-delta]')!;
      el.classList.toggle('is-affected', d !== 0);
      ghost.hidden = tag.hidden = d === 0;
      if (!d) continue;
      const to = Math.max(0, Math.min(100, v + d));
      const tone = (key === 'radiation' ? d < 0 : d > 0) ? 'is-good' : 'is-bad'; // radiación: subir es malo
      ghost.className = `mn-bar__ghost ${d > 0 ? 'is-up' : 'is-down'} ${tone}`;
      ghost.style.left = `${Math.min(v, to)}%`;
      ghost.style.width = `${Math.abs(to - v)}%`;
      tag.className = `mn-bar__delta ${tone}`;
      tag.textContent = `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
    }
  }

  // ---------- paneles ----------
  private openActions(): void {
    this.overlay = 'actions';
    this.flags.opened = true;
    this.ui.q('[data-actions]').hidden = false;
    this.renderActions();
    this.ui.focusFirst('[data-actions] [data-action="act"]:not([disabled]), [data-actions] [data-action="read-entry"]');
  }

  private renderActions(): void {
    const m = this.focused ?? this.nearestMachine();
    if (!m) return;
    const ids = this.machineActions();
    const chips = (d: ActionDelta): string =>
      (Object.entries(d) as [ResourceKey, number][])
        .filter(([, v]) => v)
        .map(([k, v]) => {
          const good = k === 'radiation' ? v < 0 : v > 0;
          return `<span class="delta ${good ? 'delta--good' : 'delta--bad'}">${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))} ${resourceShort(k)}</span>`;
        })
        .join('');
    const items = ids.map((id, i) => {
      const check = this.sim.canAct(id);
      const pending = this.sim.isPending(id);
      return `<li class="action">
        <button class="mn-btn mn-btn--sm action__btn" data-action="act" data-id="${id}" ${check.ok ? '' : 'disabled'}><span class="mn-key">${i + 1}</span>${icon(ACTION_ICON[id])}${actionLabel(id)}</button>
        <div class="action__deltas">${chips(this.sim.preview(id))}</div>
        <p class="body-sm action__why">${pending ? t('action.waiting') : check.ok ? actionWhy(id) : blockReason(check.reason!)}</p>
      </li>`;
    });
    this.setHtml('[data-actions]', `
      <div class="hud__actions-head"><h2 class="mn-panel__title">${icon(ROOM_ICON[m.room])}${esc(machineName(m))}</h2>
      <button class="mn-btn mn-btn--secondary mn-btn--sm" data-action="close-actions" aria-label="${t('common.close')}">${icon('close')}</button></div>
      <ul class="action-list">${items.join('')}</ul>
      ${m.prop.asset === 'rack-plantas' && this.tutorialIndex < 0 ? this.dnaHtml() : ''}
      ${m.prop.asset === 'consola-antena' && this.sim.probeReady && this.tutorialIndex < 0 ? `<button class="mn-btn mn-btn--sm action__btn" data-action="call-probe">${icon('antenna')}${t('probe.call')}</button>
      <p class="body-sm action__why">${t('probe.callWhy')}</p>` : ''}
      ${m.prop.entry ? `<p class="body-sm action__why">${t('poster.body')}</p>
      <button class="mn-btn mn-btn--sm action__btn" data-action="read-entry" data-entry="${esc(m.prop.entry)}">${icon('book')}${t('chapter.readReal')}</button>` : ''}`);
  }

  /** Rack de plantas: el taller opcional de ADN de papel (una vez por jornada) o el bonus que ya da a la cosecha. */
  private dnaHtml(): string {
    if (this.sim.stats.dna > 0) return `<p class="body-sm action__why">${icon('check')}${t('dna.done', { n: Math.round((dnaBonus(this.sim.stats.dna) - 1) * 100) })}</p>`;
    return `<button class="mn-btn mn-btn--secondary mn-btn--sm action__btn" data-action="dna" ${this.sim.ended ? 'disabled' : ''}>${icon('flask')}${t('dna.open')}</button>
      <p class="body-sm action__why">${t('dna.openWhy', { n: Math.round(DNA_MAX_BONUS * 100) })}</p>`;
  }

  /** Dibujo según el estado: la antena con falla se ve rota; los paneles con polvo, sucios (el de pruebas, mientras esté por limpiar). */
  private stateAsset(asset: string): string {
    if (asset === 'consola-antena' && !this.sim.radioOk) return 'consola-antena-rota';
    if (asset === 'panel-solar' && (this.mission.id === 'paneles-solares' ? this.sim.useful('cleanTestPanel') : this.sim.useful('cleanDust'))) return 'panel-solar-sucio';
    return asset;
  }

  /** Paneles de adorno: sucios mientras la estación tenga polvo en sus paneles. */
  private updatePanels(): void {
    const tex = propKey(this.sim.useful('cleanDust') ? 'panel-solar-sucio' : 'panel-solar');
    for (const img of this.panelSprites) if (img.texture.key !== tex) img.setTexture(tex);
  }

  /** Mientras algo esté roto (fractura, antena, paneles con polvo) su alerta queda en pantalla; al repararlo, se va. */
  private updateBrokenAlerts(): void {
    if (this.sim.ended) return;
    const keep = (id: string, broken: boolean, show: () => void): void => {
      if (broken && !this.toasts.has(id)) show();
      else if (!broken && this.toasts.has(id) && STICKY_ALERTS.has(id)) this.dismissToast(id);
    };
    keep('breach', !!this.sim.breach, () => this.toast('breach', t('alert.breach'), 'danger', Infinity, this.hint(t('tip.breach', { room: roomName(this.sim.breach!) }))));
    keep('antenna', !this.sim.radioOk, () => this.toast('antenna', t('alert.antennaFault'), 'danger', Infinity, this.hint(t('tip.antennaFault'))));
    keep('dust', this.sim.useful('cleanDust'), () => this.toast('dust', t('alert.dust'), 'danger', Infinity, this.hint(t('tip.dust'))));
  }

  /** Acciones de la máquina que tienes cerca (cada máquina tiene las suyas). */
  private machineActions(): ActionId[] {
    const ids = (this.focused ?? this.nearestMachine())?.prop.actions ?? [];
    const only = this.tutorialIndex >= 0 ? this.tutorial[this.tutorialIndex]?.allow?.action : undefined;
    return only ? ids.filter((id) => id === only) : ids; // en el tutorial no se ofrece lo que no se está enseñando
  }

  /** Mapa (solo para mirar): el plano a escala y una carita de michi donde estás. */
  private toggleMap(): void {
    if (this.overlay === 'map') return this.closeOverlay();
    if (this.tutorialIndex >= 0) return;
    if (this.overlay !== 'none' && this.overlay !== 'actions') return;
    this.closeOverlay();
    this.overlay = 'map';
    this.flags.map = true;
    const k = MAP_SCALE;
    // una sola silueta: salas y pasillos se funden (filtro «gota») y el borde solo rodea el conjunto, con las esquinas de unión suavizadas
    const shapes = [...HALLS.map((h) => ({ x: h.x * k, y: h.y * k, w: h.w * k, h: h.h * k })),
      ...ROOM_IDS.map((id) => ({ x: ROOM_RECTS[id].x * k, y: (ROOM_RECTS[id].y - WALL_H) * k, w: ROOM_RECTS[id].w * k, h: (ROOM_RECTS[id].h + WALL_H) * k }))];
    const shapeRects = (extra: string): string => shapes.map((r) => `<rect x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" rx="8" ${extra}/>`).join('');
    const here = this.here ? shapes[HALLS.length + ROOM_IDS.indexOf(this.here)] : undefined;
    const halls = `<defs><filter id="map-goo" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4"/>
        <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"/></filter></defs>
      <g filter="url(#map-goo)" class="map__edge">${shapeRects('stroke-width="7"')}</g>
      <g filter="url(#map-goo)" class="map__fill">${shapeRects('')}</g>
      ${here ? `<rect class="map__here" x="${f(here.x + 2)}" y="${f(here.y + 2)}" width="${f(here.w - 4)}" height="${f(here.h - 4)}" rx="7"/>` : ''}`;
    const rooms = ROOM_IDS.map((id) => {
      const r = ROOM_RECTS[id];
      return `<div class="map__room ${id === this.here ? 'is-here' : ''}" data-room="${id}"
        style="left:${f(r.x * k)}px;top:${f((r.y - WALL_H) * k)}px;width:${f(r.w * k)}px;height:${f((r.h + WALL_H) * k)}px">
        ${icon(ROOM_ICON[id])}<span class="map__name">${esc(roomName(id))}</span></div>`;
    }).join('');
    const ch = CHARACTERS.find((c) => c.id === state.loadout!.character)!;
    this.openModal(`
      <h2 class="mn-panel__title">${t('map.title')}</h2>
      <div class="map" style="width:${f(MAP_W * k)}px;height:${f(MAP_H * k)}px">
        <svg class="map__plan" viewBox="0 0 ${f(MAP_W * k)} ${f(MAP_H * k)}" aria-hidden="true">${halls}</svg>${rooms}
        <span class="map__me" data-map-me role="img" aria-label="${t('map.me')}">${michiFaceSvg(ch)}</span></div>
      <div class="mn-panel__footer"><button class="mn-btn mn-btn--sm" data-action="close">${t('common.close')}</button></div>`, 'map', 'modal__panel--wide');
    this.renderMapMarker();
  }

  private renderMapMarker(): void {
    const me = this.ui.el.querySelector<HTMLElement>('[data-map-me]');
    if (!me) return;
    me.style.left = `${f(this.pos.x * MAP_SCALE)}px`;
    me.style.top = `${f(this.pos.y * MAP_SCALE)}px`;
  }

  private openPause(): void {
    this.overlay = 'pause';
    this.openModal(`
      <div class="pause__actions" aria-label="${t('control.pause')}">
        <button class="mn-btn" data-action="resume">${icon('play')}${t('pause.resume')}</button>
        <button class="mn-btn mn-btn--secondary" data-action="archive">${icon('book')}${t('archive.title')}</button>
        <button class="mn-btn mn-btn--secondary" data-action="controls">${icon('keyboard')}${t('pause.controls')}</button>
        <button class="mn-btn mn-btn--secondary" data-action="settings">${icon('gear')}${t('settings.title')}</button>
        <button class="mn-btn mn-btn--secondary" data-action="quit">${icon('home')}${t('pause.quit')}</button>
      </div>`, 'pause');
  }

  private openSettings(): void {
    this.openModal(settingsHtml(false), 'settings'); // sin idioma: cambiarlo reinicia la escena y se perdería la misión
  }

  private openArchive(entry?: string): void {
    this.flags.archive = true;
    if (this.overlay !== 'pause') this.openPause();
    this.scene.launch(SCENES.archive, { from: SCENES.station, entry });
    this.scene.pause();
  }

  private openModal(html: string, overlay: Overlay, extra = ''): void {
    this.overlay = overlay;
    this.ui.q('[data-actions]').hidden = true;
    const modal = this.ui.q('[data-overlay]');
    modal.innerHTML = `<div class="mn-panel modal__panel ${extra}" role="dialog" aria-modal="true">${html}</div>`;
    labelDialog(modal);
    modal.hidden = false;
    this.ui.focusFirst('.modal [data-action]');
  }

  /** `keepMood`: el siguiente minijuego encadenado trae su música (la sonda), así que no se vuelve a la de la zona entre fases. */
  private closeOverlay(keepMood = false): void {
    this.miniGame?.destroy();
    this.miniGame = undefined;
    this.miniOutdoor = false;
    if (this.miniMood && !keepMood) audio.setMood(ZONE_MOOD[this.zone]);
    if (!keepMood) this.miniMood = null;
    this.ui.q('[data-msgs]').innerHTML = '';
    this.ui.q('[data-hud]').classList.remove('is-mini');
    this.overlay = 'none';
    this.ui.q('[data-overlay]').hidden = true;
    this.ui.q('[data-actions]').hidden = true;
    this.previewId = null;
    this.renderPreview();
  }

  // ---------- tutorial ----------
  /** Entrenamiento de la primera vez (sesión aparte): muestra los controles y deja elegir entre el tutorial guiado o saltarlo. */
  private startTutorial(): void {
    if (!state.training) return;
    this.openModal(`
      <h2 class="mn-panel__title">${t('tutorial.title')}</h2>
      ${controlsHtml(true)}
      <p class="mn-panel__body">${t('tutorial.intro')}</p>
      <div class="mn-panel__footer">
        <button class="mn-btn mn-btn--secondary" data-action="tutorial-decline">${icon('skip')}${t('tutorial.skip')}</button>
        <button class="mn-btn" data-action="tutorial-start">${icon('play')}${t('tutorial.start')}</button>
      </div>`, 'intro', 'modal__panel--wide');
    this.ui.focusFirst('.modal [data-action="tutorial-start"]');
  }

  /** Pausa → Controles: lista de teclas y opción de repetir el tutorial. */
  private openControls(): void {
    this.openModal(`
      <h2 class="mn-panel__title">${t('controls.title')}</h2>
      ${controlsHtml()}
      <div class="mn-panel__footer">
        <button class="mn-btn mn-btn--secondary" data-action="close">${t('common.back')}</button>
        <button class="mn-btn" data-action="tutorial-start">${icon('retry')}${t('tutorial.repeat')}</button>
      </div>`, 'controls', 'modal__panel--wide');
  }

  /**
   * Tutorial guiado con el reloj detenido y todo bloqueado menos el paso actual (spotlight encima de lo que se enseña).
   * Explica cada barra (qué es, cómo subirla y dónde) y los eventos; en el entrenamiento se practica cosechar y sellar una fisura
   * abierta a propósito, y se muestran una tormenta de polvo y una llamarada de muestra. Al repetirlo en una misión real, solo se explica.
   */
  private runTutorial(): void {
    this.closeOverlay();
    this.flags = { ...this.flags, moved: false, opened: false, map: false };
    const done = (action: ActionId): boolean => (this.sim.stats.actionsBy[action] ?? 0) >= 1;
    const read = (text: string, spot?: string[], extra: Partial<TutorialStep> = {}): TutorialStep => ({ text, done: () => false, manual: true, spot, ...extra });
    const stat = (key: keyof Resources): TutorialStep => read(t(`tutorial.${key}`), [`[data-res="${key}"]`]);
    const own = this.mission.tutorial;
    const practice: TutorialStep[] = [
      { text: t('tutorial.harvest'), done: () => done('harvest'), guide: 'rack-plantas', spot: ['machine:rack-plantas'], allow: { move: true, machine: 'rack-plantas', action: 'harvest' } },
      read(t('tutorial.foodUp'), ['[data-res="food"]']),
      read(t('tutorial.breach'), ['[data-sys="leak"]', '[data-res="oxygen"]'], { enter: () => this.sim.forceBreach('soporte') }),
      { text: t('tutorial.repair'), done: () => done('repair'), guide: BREACH_GUIDE, spot: [`machine:${BREACH_GUIDE}`], allow: { move: true, machine: BREACH_GUIDE, action: 'repair' } },
      read(t('tutorial.dust'), ['[data-sys="panels"]', '[data-res="energy"]'], { enter: () => this.sim.forceDustStorm() }),
      read(t('tutorial.flare'), ['[data-countdown]', '[data-res="radiation"]'], { demoFlare: true }),
    ];
    this.tutorial = [
      read(t('tutorial.welcome')),
      read(t('tutorial.stats'), ['.hud__stats']),
      stat('energy'), stat('oxygen'), stat('food'), stat('health'), stat('radiation'),
      ...(state.training ? practice : [read(missionText(this.mission.id, 'tutorial'), [`machine:${own.asset}`], { guide: own.asset })]),
      read(t('tutorial.clock'), ['.hud__clock']),
      ...(state.training
        ? [ // la investigación de práctica es una sola (cosechar, ya hecha): falta avisar a la Tierra y se ve la misión ganada
          read(t('tutorial.tasksTraining'), ['.hud__tasks']),
          { text: t('tutorial.tellEarth'), done: () => false, guide: 'consola-antena', spot: ['machine:consola-antena'], allow: { move: true, machine: 'consola-antena', action: 'tellEarth' as ActionId } },
        ]
        : [read(t('tutorial.tasks'), ['.hud__tasks']), read(t('tutorial.done'))]),
    ];
    this.tutorialIndex = 0;
    this.ui.q('[data-hud]').classList.add('is-tutorial');
    this.showTutorial();
  }

  private showTutorial(): void {
    const step = this.tutorial[this.tutorialIndex];
    step.enter?.();
    for (const ev of this.sim.drainEvents()) this.onSimEvent(ev); // la fisura o la tormenta de práctica se ven al instante
    this.speak(step.text);
    this.ui.q('[data-tip-actions]').hidden = false;
    const next = this.ui.q('[data-action="tutorial-next"]');
    next.hidden = !step.manual; // los pasos con tarea avanzan solos
    next.innerHTML = `${icon('check')}${esc(step.cta ?? t('tutorial.ok'))}`;
    this.ui.q('[data-tip]').hidden = false;
    this.renderHud();
  }

  /** En el tutorial solo se camina en los pasos de práctica. */
  private tutorialAllowsMove(): boolean {
    return this.tutorialIndex < 0 || !!this.tutorial[this.tutorialIndex]?.allow?.move;
  }

  /** En el tutorial solo responde la máquina del paso (las demás no se resaltan ni se abren). */
  private tutorialAllowsMachine(m: Machine): boolean {
    return this.tutorialIndex < 0 || this.tutorial[this.tutorialIndex]?.allow?.machine === m.prop.asset;
  }

  /** Spotlight sobre lo que enseña el paso; se recalcula cada frame porque la cámara se mueve. Oculto en pausa y en los minijuegos. */
  private updateSpot(): void {
    const step = this.tutorialIndex >= 0 ? this.tutorial[this.tutorialIndex] : undefined;
    if (!step || (this.overlay !== 'none' && this.overlay !== 'actions')) return this.spot.hide();
    const rects = (step.spot ?? []).map((target) => (target.startsWith('machine:') ? this.machineRect(target.slice(8)) : this.hudRect(target)));
    this.spot.show(unionRect(rects), !!step.allow?.move, [this.michiRect()]); // el personaje siempre queda iluminado
  }

  /** El michi en la pantalla, dentro de un círculo con un poco de aire alrededor. */
  private michiRect(): SpotRect {
    const b = this.michi.getBounds();
    const cam = this.cameras.main;
    const v = cam.worldView;
    const size = Math.max(b.width, b.height) * cam.zoom + 52;
    const cx = (b.centerX - v.x) * cam.zoom;
    const cy = (b.centerY - v.y) * cam.zoom;
    return { x: cx - size / 2, y: cy - size / 2, w: size, h: size, round: true };
  }

  private hudRect(selector: string): SpotRect | null {
    const el = this.ui.el.querySelector(selector);
    return el ? rectOf(el, this.ui.el, GAME_WIDTH) : null;
  }

  /** Caja de una máquina en la pantalla (de mapa a pantalla, como las flechas de guía). */
  private machineRect(asset: string): SpotRect | null {
    const m = asset === BREACH_GUIDE ? this.breachProp : this.machines.find((x) => x.prop.asset === asset);
    if (!m) return null;
    const b = m.sprite.getBounds();
    const cam = this.cameras.main;
    const v = cam.worldView;
    return { x: (b.x - v.x) * cam.zoom, y: (b.y - v.y) * cam.zoom, w: b.width * cam.zoom, h: b.height * cam.zoom };
  }

  /** Quita el tutorial de la pantalla (diálogo, spotlight y bloqueos) y lo marca como visto. */
  private clearTutorial(): void {
    this.tutorialIndex = -1;
    this.ui.q('[data-tip]').hidden = true;
    this.ui.q('[data-hud]').classList.remove('is-tutorial');
    this.spot.hide();
    state.saveProgress({ tutorialDone: true });
  }

  private checkTutorial(): void {
    if (this.tutorialIndex < 0) return;
    if (this.tutorial[this.tutorialIndex].done()) this.nextTutorial(false);
  }

  private nextTutorial(manual: boolean): void {
    if (this.tutorialIndex < 0) return;
    if (manual || this.tutorialIndex < this.tutorial.length) this.tutorialIndex++;
    if (this.tutorialIndex >= this.tutorial.length) return this.endTutorial();
    this.showTutorial();
  }

  private endTutorial(): void {
    this.clearTutorial();
    if (!state.training) return;
    // fin del entrenamiento: se descarta la estación de práctica y se elige la primera misión
    state.training = false;
    state.loadout = null;
    this.ending = true;
    fadeTo(this, SCENES.select);
  }

  // ---------- entrada ----------
  /**
   * Teclado en los minijuegos: las flechas mueven la herramienta (o el foco entre botones) y Espacio, Enter, 1-4 y A/S/D van al minijuego.
   * Espacio y Enter que el minijuego no usa aprietan el botón con foco (no hacen saltar al michi de fondo). Devuelve true si la tecla se consumió.
   */
  private handleMiniKey(ev: KeyboardEvent, key: string): boolean {
    if (key.startsWith('arrow')) {
      const dx = key === 'arrowright' ? 1 : key === 'arrowleft' ? -1 : 0;
      const dy = key === 'arrowdown' ? 1 : key === 'arrowup' ? -1 : 0;
      if (this.miniGame?.nudge) this.miniGame.nudge(dx, dy);
      else moveFocus(this.ui.q('[data-mini-stage]'), dx, dy);
      ev.preventDefault();
      return true;
    }
    if (!MINI_KEYS.has(key)) return false;
    if (this.miniGame?.key && (ev.repeat || this.miniGame.key(key, true))) { // la repetición de una tecla mantenida no cuenta como otro toque
      ev.preventDefault();
      return true;
    }
    return key === ' ' || key === 'enter';
  }

  private bindInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keyup', (ev: KeyboardEvent) => {
      const key = ev.key.toLowerCase();
      if (this.overlay === 'minigame' && MINI_KEYS.has(key) && this.miniGame?.key?.(key, false)) ev.preventDefault();
    });
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on('keydown', (ev: KeyboardEvent) => {
      audio.unlock();
      const key = ev.key.toLowerCase();
      if (this.overlay === 'minigame' && this.handleMiniKey(ev, key)) return;
      if (this.tutorialIndex >= 0 && key === 'enter' && this.overlay === 'none' && this.tutorial[this.tutorialIndex]?.manual) {
        this.nextTutorial(true); // Enter = «Entendido» en los pasos de leer
        ev.preventDefault();
        return;
      }
      if (key === 'escape' || key === 'p') {
        if (this.overlay === 'none') this.openPause();
        else if (this.overlay === 'settings') this.openPause();
        else this.closeOverlay();
      } else if (key === 'm') this.toggleMap();
      else if (key === 'shift') this.tryDash();
      else if (key === ' ') {
        this.jump();
        ev.preventDefault();
      } else if (key === 'e' && this.overlay === 'none') {
        if (this.nearestMachine()) this.openActions();
      } else if ((key === 'e' || key === '1' || key === '2') && this.overlay === 'actions') {
        const id = this.machineActions()[key === '2' ? 1 : 0]; // E (o 1) confirma la acción; 2 es la segunda, si la máquina la tiene
        if (id) this.act(id);
      }
    });
    // clic o toque en el piso: caminar hasta ahí (alternativa al teclado)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length || this.overlay !== 'none' || !this.tutorialAllowsMove()) return;
      audio.unlock();
      const at = this.cameras.main.getWorldPoint(p.x, p.y); // la cámara del HUD no tiene zoom: se usa la del mundo
      if (isWalkable(at)) this.walkTo(at, false);
    });
  }

  // ---------- fin ----------
  private finish(): void {
    if (this.ending) return;
    this.ending = true;
    const summary = this.sim.summary();
    const score = computeScore(summary);
    const training = state.training; // el entrenamiento termina ganado para mostrar cómo se ve; no cuenta récords ni logros
    if (this.tutorialIndex >= 0) this.clearTutorial();
    const newAchievements = training ? [] : state.unlock(earnedAchievements(summary));
    const newBest = training ? false : state.recordBest(this.mission.id, score.score, score.stars);
    if (summary.won && !training) state.recordWin(this.mission.id, state.loadout!.difficulty);
    state.lastResult = { loadout: state.loadout!, summary, score, newAchievements, newBest, training };
    audio.play(summary.won ? 'achievement' : 'hurt');
    this.playAnim(summary.won ? 'smile' : 'hurt', true);
    if (summary.cause === 'radiation') { // radiación 100: muere de una, sin viaje de regreso
      this.closeOverlay();
      this.toast('end', t('alert.radiationDead'), 'danger');
      audio.play('alarm');
      if (!state.calm) this.cameras.main.shake(600, 0.01);
      this.flareTint.setAlpha(0.45);
      this.time.delayedCall(1600, () => fadeTo(this, SCENES.report, 500));
      return;
    }
    this.toast('end', summary.won ? t('alert.won') : t('alert.lost'), summary.won ? 'ok' : 'danger');
    this.time.delayedCall(1600, () => fadeTo(this, SCENES.returnTrip, 500)); // viaje de regreso a la Tierra y después el informe
  }
}

const ACTIONS_DELAYED = new Set<ActionId>(['repairAntenna', 'forecast']);
/** Sala que repara cada recurso crítico (avisos en los bordes). */
const GUIDE_ASSET: Record<Exclude<keyof Resources, 'radiation'>, string> = {
  energy: 'estacion-limpieza', oxygen: 'reciclador-aire', food: 'rack-plantas', health: 'camilla-medica',
};
/** Sin polvo que limpiar (o sin sol), la energía se recupera pedaleando. */
const BIKE_ASSET = 'bicicleta-estatica';
/** De dónde se recupera cada barra (imagen del objeto y su lugar). La radiación no se puede sacar. */
const RES_SOURCES: Record<keyof Resources, { asset: string; label: 'where.bike' | 'where.panel' | 'where.recycler' | 'where.plants' | 'where.bed' }[]> = {
  energy: [{ asset: 'bicicleta-estatica', label: 'where.bike' }, { asset: 'panel-solar', label: 'where.panel' }],
  oxygen: [{ asset: 'reciclador-aire', label: 'where.recycler' }],
  food: [{ asset: 'rack-plantas', label: 'where.plants' }],
  health: [{ asset: 'camilla-medica', label: 'where.bed' }],
  radiation: [],
};
/** La Esclusa: adonde guía la flecha cuando hay que volver a la nave. */
const DOOR_ASSET = 'esclusa';
const BREACH_GUIDE = 'reciclador-roto';
/** Clase de la llamarada de muestra del tutorial (no ocurre: solo se ve la cuenta regresiva). */
const DEMO_FLARE = 'M2.0';
/** Flecha sólida (cuerpo + punta) que apunta a la derecha; el CSS la gira hacia el objetivo. */
const GUIDE_LIFT = 290; // px de mapa sobre los pies de la máquina donde se dibuja la flecha
const GUIDE_ARROW = '<svg class="hud__guide-svg" viewBox="0 0 60 40" aria-hidden="true"><path d="M5 14h27V5l23 15-23 15v-9H5z"/></svg>';
/** Sala donde empieza cada jornada. */
const START_ROOM: RoomId = 'puente';
/** Nombre que se muestra de una máquina: el suyo propio o el de su sala. */
const machineName = (m: Machine): string => (m.prop.nameKey ? t(m.prop.nameKey) : roomName(m.room));

/** Tabla de controles: en el entrenamiento inicial solo los básicos (caminar, usar y pausa); completa en Pausa → Controles. */
const controlsHtml = (basicOnly = false): string => `
  <ul class="controls">${CONTROLS.filter((c) => !basicOnly || c.basic).map((c) => `<li class="controls__row">
    <span class="controls__keys">${c.keys.map((k) => `<span class="mn-key">${esc(keyLabel(k))}</span>`).join('')}${c.alt ? ` <span class="controls__alt">${esc(t('control.alt'))}</span>` : ''}</span>
    <span class="controls__action">${esc(controlAction(c.id))}</span></li>`).join('')}
  </ul>
  <p class="controls__pointer">${esc(t('control.pointer'))}</p>`;
const ALERT_MS = 4500;
/** Música de cada zona de la estación. */
const ZONE_MOOD: Record<Zone, Mood> = { ship: 'station', greenhouse: 'greenhouse', surface: 'surface' };
const TOAST_MAX = 3;      // avisos a la vista a la vez
const TOAST_OUT_MS = 220; // salida del aviso (igual que la transición del CSS)
const TOAST_STICKY = new Set(['breach', 'antenna', 'dust', 'flare']); // no se desplazan por avisos nuevos
/** Alertas de algo roto: se quedan mientras dure la falla y se van solas al repararla (ver `updateBrokenAlerts`). */
const STICKY_ALERTS: ReadonlySet<string> = new Set(['breach', 'antenna', 'dust']);
const RES_KEYS: (keyof Resources)[] = ['energy', 'oxygen', 'food', 'health', 'radiation'];
/** Icono de cada aviso según lo que es (los críticos llevan el icono de su recurso). */
const TOAST_ICON: Record<string, IconName> = {
  flare: 'radiation', breach: 'wind', antenna: 'antenna', dust: 'panel', panels: 'panel', suit: 'helmet', radio: 'antenna', stage: 'flask', day: 'sun', end: 'rocket',
};
const toastIcon = (id: string): IconName =>
  TOAST_ICON[id] ?? (id.startsWith('critical-') ? RESOURCE_ICON[id.slice('critical-'.length) as keyof Resources] : 'alert');
const FLARE_RESULT_MS = 7000;
/** Tamaño de la llamarada en palabras, con su clase GOES real entre paréntesis (p. ej. "enorme (X9.3)"). */
const flareName = (classType: string): string => `${t(`flare.size.${severity(classType)}`)} (${classType})`;
/** Cuánto se ve la pista de cada minijuego. */
/** Cuánto queda a la vista el resultado (estrellas y ganancia) antes de cerrar el minijuego. */
const MINI_RESULT_MS = 1800;
/** Color (token) de cada recurso en los textos flotantes y en el resultado de los minijuegos. */
const RESOURCE_COLOR: Record<ResourceKey, string> = { energy: 'star-gold', oxygen: 'comet-cyan', food: 'solar-coral', health: 'aurora-teal', radiation: 'nebula-magenta' };
/** Oscuridad según la energía: con 60 o más, luz plena; sin energía, casi a oscuras. */
const darknessFor = (energy: number): number => (Math.min(60, Math.max(0, 60 - energy)) / 60) * 0.72;
/** Escala del plano dentro del mapa (M). */
const MAP_SCALE = 0.2 / WORLD_SCALE; // el mapa del menú mide lo mismo aunque el plano sea más grande
const f = (n: number): string => n.toFixed(1);
