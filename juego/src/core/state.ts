import type { ThemeId } from './theme';
import { detectLang, type Lang } from './i18n';
import type { MissionId } from '../data/missions';
import type { CharacterId } from '../data/characters';
import type { DifficultyId } from '../data/difficulties';
import type { MissionSummary } from '../sim/simulation';
import type { ScoreResult } from '../sim/score';
import type { AchievementId } from '../sim/achievements';

/**
 * Estado global mínimo.
 * Cumplimiento (Ley 19.628 / 21.719, Chile): NO se guardan datos personales.
 * Solo preferencias, progreso de juego y la selección de partida, en localStorage del propio dispositivo.
 */
export interface Settings {
  theme: ThemeId;
  lang: Lang;
  textSpeed: number; // caracteres por segundo del texto de diálogo
  reducedMotion: boolean;
  ultraLight: boolean; // modo "Ultra Ligero": sin partículas, destellos ni sacudidas
  musicVolume: number; // 0–1
  sfxVolume: number;   // 0–1
  showFps: boolean;
}

export interface Loadout {
  mission: MissionId;
  character: CharacterId;
  difficulty: DifficultyId;
}

export interface Progress {
  best: Partial<Record<MissionId, { score: number; stars: number }>>;
  achievements: AchievementId[];
  readEntries: string[];
  tutorialDone: boolean;
  /** Ya vio el despegue completo: las veces siguientes pasa directo a la estación (se puede saltar igual). */
  launchSeen?: boolean;
  /** Mejor resultado de la misión final «Casa». */
  casa?: { score: number; stars: number };
  /** Veces ganadas, por investigación (y «casa») y por dificultad. */
  wins?: { missions: Partial<Record<MissionId | 'casa', number>>; difficulties: Partial<Record<DifficultyId, number>> };
}

export interface LastResult {
  loadout: Loadout;
  summary: MissionSummary;
  score: ScoreResult;
  newAchievements: AchievementId[];
  newBest: boolean;
  /** Fue el entrenamiento: el informe muestra cómo se ve una misión ganada y lleva a elegir la primera misión. */
  training?: boolean;
}

const SETTINGS_KEY = 'michinautas:settings:v1';
const PROGRESS_KEY = 'michinautas:progress:v1';

/** Equipos modestos (≤ 2 núcleos o ≤ 2 GB) arrancan en modo Ultra Ligero. */
const lowEnd = (): boolean => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 4) <= 2 || (nav.deviceMemory ?? 4) <= 2;
};

const defaults: Settings = {
  theme: 'deep-space',
  lang: detectLang(),
  textSpeed: 40,
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  ultraLight: lowEnd(),
  musicVolume: 0.4,
  sfxVolume: 0.7,
  showFps: false,
};

const emptyProgress: Progress = { best: {}, achievements: [], readEntries: [], tutorialDone: false };

function safeRead<T>(key: string): Partial<T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : {};
  } catch {
    return {}; // modo privado, storage bloqueado o JSON corrupto: seguimos con defaults
  }
}

function safeWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin persistencia: no es crítico */
  }
}

class GameState {
  settings: Settings = { ...defaults, ...safeRead<Settings>(SETTINGS_KEY) };
  progress: Progress = { ...emptyProgress, ...safeRead<Progress>(PROGRESS_KEY) };
  loadout: Loadout | null = null;
  /** Sesión de entrenamiento (tutorial aparte, la primera vez): usa una estación de práctica y al terminar lleva al selector de misión. */
  training = false;
  lastResult: LastResult | null = null;

  saveSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    safeWrite(SETTINGS_KEY, this.settings);
  }

  /** Hard reset: borra todo el progreso (récords, logros, archivo leído, tutorial) y vuelve a empezar. Los ajustes se conservan. */
  resetProgress(): void {
    this.progress = { ...emptyProgress, best: {}, achievements: [], readEntries: [] };
    safeWrite(PROGRESS_KEY, this.progress);
    this.training = false;
    this.loadout = null;
    this.lastResult = null;
  }

  saveProgress(patch: Partial<Progress>): void {
    this.progress = { ...this.progress, ...patch };
    safeWrite(PROGRESS_KEY, this.progress);
  }

  /** Registra logros nuevos y devuelve solo los que no se tenían. */
  unlock(ids: AchievementId[]): AchievementId[] {
    const fresh = ids.filter((id) => !this.progress.achievements.includes(id));
    if (fresh.length) this.saveProgress({ achievements: [...this.progress.achievements, ...fresh] });
    return fresh;
  }

  /** Guarda el mejor puntaje; devuelve true si es récord. */
  recordBest(mission: MissionId, score: number, stars: number): boolean {
    const prev = this.progress.best[mission];
    if (prev && prev.score >= score) return false;
    this.saveProgress({ best: { ...this.progress.best, [mission]: { score, stars: Math.max(stars, prev?.stars ?? 0) } } });
    return true;
  }

  /** Suma una victoria a la investigación y a la dificultad (la misión final no tiene dificultad). */
  recordWin(mission: MissionId | 'casa', difficulty?: DifficultyId): void {
    const w = this.progress.wins ?? { missions: {}, difficulties: {} };
    this.saveProgress({
      wins: {
        missions: { ...w.missions, [mission]: (w.missions[mission] ?? 0) + 1 },
        difficulties: difficulty ? { ...w.difficulties, [difficulty]: (w.difficulties[difficulty] ?? 0) + 1 } : w.difficulties,
      },
    });
  }

  markRead(entryId: string): number {
    if (!this.progress.readEntries.includes(entryId)) this.saveProgress({ readEntries: [...this.progress.readEntries, entryId] });
    return this.progress.readEntries.length;
  }

  /** Detiene animaciones decorativas si el jugador pidió menos movimiento o modo Ultra Ligero. */
  get calm(): boolean {
    return this.settings.reducedMotion || this.settings.ultraLight;
  }
}

export const state = new GameState();
