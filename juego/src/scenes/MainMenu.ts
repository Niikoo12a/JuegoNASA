import Phaser from 'phaser';
import { audio } from '../core/audio';
import { SCENES, GAME_WIDTH, GAME_HEIGHT } from '../core/config';
import { state } from '../core/state';
import { UiLayer, labelDialog } from '../core/ui';
import { fadeTo, fadeIn } from '../core/fade';
import { settingsHtml, bindSettings, langButtonsHtml } from '../core/settingsPanel';
import { ACHIEVEMENT_IDS, achievementText, achievementTitle } from '../data/achievements';
import { icon } from '../core/icons';
import { ACHIEVEMENT_ICON } from '../core/iconMap';
import { t } from '../core/i18n';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super(SCENES.menu);
  }

  preload(): void {
    this.load.image('cover', 'game/cover.jpg');
  }

  create(): void {
    audio.setMood('menu');
    state.training = false; // volver al menú cancela un entrenamiento a medias
    fadeIn(this);
    // portada ilustrada (el título MICHINAUTAS va dentro de la imagen; abajo queda un h1 solo para lectores de pantalla)
    const cover = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'cover');
    cover.setScale(Math.max(GAME_WIDTH / cover.width, GAME_HEIGHT / cover.height));

    const ui = new UiLayer(this, /* html */ `
      <div class="menu menu--cover">
        <div class="menu__lang" aria-label="${t('settings.lang')}">${langButtonsHtml()}</div>
        <h1 class="sr-only">MICHINAUTAS</h1>
        <p class="body menu__subtitle">${t('menu.subtitle')}</p>
        <nav class="menu__actions" aria-label="${t('menu.nav')}">
          <button class="mn-btn menu__play" data-action="play">${icon('rocket')}${t('menu.play')}</button>
          <button class="mn-btn mn-btn--secondary" data-action="archive">${icon('book')}${t('archive.title')}</button>
          <div class="menu__more">
            <button class="mn-btn mn-btn--secondary mn-btn--sm" data-action="achievements">${icon('trophy')}${t('menu.achievements')}</button>
            <button class="mn-btn mn-btn--secondary mn-btn--sm" data-action="settings">${icon('gear')}${t('settings.title')}</button>
            <button class="mn-btn mn-btn--secondary mn-btn--sm" data-action="credits">${icon('info')}${t('menu.credits')}</button>
          </div>
        </nav>
        <button class="mn-btn mn-btn--secondary mn-btn--sm menu__debug" data-action="debug">${icon('flask')}${t('lab.open')}</button>
        <button class="mn-btn mn-btn--secondary mn-btn--sm menu__reset" data-action="reset">${icon('retry')}${t('menu.reset')}</button>
      </div>
      <div class="modal" data-modal hidden></div>`);

    const modal = ui.q('[data-modal]');
    const openModal = (html: string): void => {
      modal.innerHTML = `<div class="mn-panel modal__panel" role="dialog" aria-modal="true">${html}</div>`;
      labelDialog(modal);
      modal.hidden = false;
      ui.focusFirst('.modal [data-action]');
    };
    const closeModal = (): void => {
      modal.hidden = true;
      ui.focusFirst();
    };

    ui.on('play', () => this.play())
      .on('close', closeModal)
      .on('archive', () => fadeTo(this, SCENES.archive))
      .on('settings', () => openModal(settingsHtml()))
      .on('achievements', () => {
        const owned = state.progress.achievements.filter((id) => ACHIEVEMENT_IDS.includes(id)); // ignora logros que ya no existen (p. ej. el de ciencia)
        const items = ACHIEVEMENT_IDS
          .map((id) => `<li class="achievement ${owned.includes(id) ? 'is-earned' : ''}"><span class="achievement__medal" aria-hidden="true">${owned.includes(id) ? icon(ACHIEVEMENT_ICON[id]) : '?'}</span>
            <span><strong>${achievementTitle(id)}</strong><small>${achievementText(id)}</small></span></li>`)
          .join('');
        openModal(`<h2 class="mn-panel__title">${t('menu.achievements.title', { n: owned.length, total: ACHIEVEMENT_IDS.length })}</h2>
          <ul class="achievement-list">${items}</ul>
          <div class="mn-panel__footer"><button class="mn-btn mn-btn--sm" data-action="close">${t('common.close')}</button></div>`);
      })
      .on('reset', () =>
        openModal(`
          <h2 class="mn-panel__title">${t('menu.reset')}</h2>
          <p class="mn-panel__body">${t('menu.reset.body')}</p>
          <div class="mn-panel__footer">
            <button class="mn-btn mn-btn--secondary mn-btn--sm" data-action="close">${t('common.back')}</button>
            <button class="mn-btn mn-btn--sm" data-action="reset-confirm">${icon('retry')}${t('menu.reset.confirm')}</button>
          </div>`))
      .on('reset-confirm', () => {
        state.resetProgress(); // todo de cero: Jugar vuelve a empezar por el entrenamiento con tutorial
        this.play();
      })
      .on('debug', () => fadeTo(this, SCENES.miniLab))
      .on('credits', () =>
        openModal(`
          <h2 class="mn-panel__title">${t('menu.credits')}</h2>
          <p class="mn-panel__body">${t('credits.team')}</p>
          <p class="mn-panel__body">${t('credits.nasa')}</p>
          <p class="mn-panel__body">${t('credits.data')}</p>
          <p class="mn-panel__body">${t('credits.audio')}</p>
          <p class="mn-panel__body">${t('credits.fonts')}</p>
          <div class="mn-panel__footer"><button class="mn-btn mn-btn--sm" data-action="close">${t('common.close')}</button></div>`),
      );

    bindSettings(ui, () => this.scene.restart()); // el tema redibuja el canvas con los nuevos colores; el idioma, todos los textos
    this.input.keyboard?.on('keydown-ESC', () => !modal.hidden && closeModal());
    ui.focusFirst();
  }

  /** Jugar: directo a elegir misión. La primera vez, antes, una sesión de entrenamiento aparte (estación de práctica con el Huerto lunar). */
  private play(): void {
    if (state.progress.tutorialDone) return fadeTo(this, SCENES.select);
    state.training = true;
    state.loadout = { mission: 'huerto-lunar', character: 'miu', difficulty: 'cadete' };
    fadeTo(this, SCENES.launch);
  }
}
