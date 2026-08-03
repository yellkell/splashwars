/**
 * The game's front door and back door — title screen and game over, both
 * built from the same pointer-driven CardBoard as the upgrades.
 *
 * TITLE: the banner hangs in the air, a "how to play" plate sits over the
 * two MODE cards — DEFENSE and DUEL. Point at one and pull the trigger.
 *
 * GAME OVER: your run's numbers on a plate (wave, kills, score), with AGAIN
 * and MENU cards under it. AGAIN drops you straight into wave 1.
 *
 * This system owns the app phase transitions; EnemySystem's wave director
 * simply refuses to run outside `playing`.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { CardBoard } from '../ui/cardBoard.js';
import { crispTexture, logicalCanvas } from '../ui/crispCanvas.js';
import { setTitleBannerVisible } from '../arena/banner.js';
import { app } from '../game/appState.js';
import { resetRun, run } from '../game/run.js';
import { resetTower, tower } from '../game/tower.js';
import { resetBank } from '../game/shop.js';
import { TurretSystem } from './TurretSystem.js';
import { EnemySystem } from './EnemySystem.js';
import { DuelSystem } from './DuelSystem.js';
import * as sfx from '../audio/sfx.js';

const _cam = new Vector3();

// The info plate's logical canvas size (drawn at 2× by crispCanvas).
const PLATE_W = 1024;
const PLATE_H = 420;

export class MenuSystem extends createSystem({}) {
  private board!: CardBoard;
  private plate!: Mesh;
  private plateCanvas!: HTMLCanvasElement;
  private plateTex!: CanvasTexture;
  /** The phase the current board was built for ('' = no board). */
  private shownFor = '';

  init(): void {
    this.board = new CardBoard(this.world.scene);
    this.buildPlate();
  }

  /**
   * Start (or restart) a run in the CURRENT mode.
   *
   * DEFENSE: if the tower is already planted (AGAIN after a wipe) we keep
   * its spot and go straight to the fight; from the title we go to PLACING
   * first — plant the tower, then the waves come.
   *
   * DUEL: no tower — the decks appear and the match starts immediately.
   */
  startRun(): void {
    resetRun();
    resetBank();
    this.world.getSystem(TurretSystem)?.resetField();
    this.board.hide();
    this.plate.visible = false;
    this.shownFor = '';
    if (app.mode === 'duel') {
      app.phase = 'playing';
      this.world.getSystem(DuelSystem)?.startMatch();
      sfx.waveHorn();
      return;
    }
    if (tower.placed) {
      resetTower();
      app.phase = 'playing';
      this.world.getSystem(EnemySystem)?.startFresh();
      sfx.waveHorn();
    } else {
      app.phase = 'placing';
      this.world
        .getSystem(EnemySystem)
        ?.setSign('POINT AT THE FLOOR — PLANT THE TOWER', '#1fc4c9');
    }
  }

  update(delta: number): void {
    // The big SPLASH WARS sign belongs to the title screen ONLY — during a
    // fight it's clutter floating over the wave lane.
    setTitleBannerVisible(app.phase === 'title');

    // Show/refresh the board when the phase asks for one.
    if (app.phase === 'title' && this.shownFor !== 'title') this.showTitle();
    if (app.phase === 'gameover' && this.shownFor !== 'gameover') this.showGameOver();
    if ((app.phase === 'playing' || app.phase === 'placing') && this.shownFor !== '') {
      this.board.hide();
      this.plate.visible = false;
      this.shownFor = '';
    }

    this.world.camera.getWorldPosition(_cam);
    this.board.update(delta, _cam);
    if (this.plate.visible) this.plate.lookAt(_cam.x, this.plate.position.y, _cam.z);
  }

  // --- Boards. -------------------------------------------------------------

  private showTitle(): void {
    this.shownFor = 'title';
    this.drawPlate('title');
    this.plate.visible = true;
    // Two games: point at the one you want.
    this.board.show(
      [
        {
          id: 'defense',
          title: 'DEFENSE',
          blurb: 'Ten waves of THE THIRST. One tower of juice. Build the maze.',
          effectLine: 'JUICE UP!',
          color: '#f0299b',
          scale: 1.05,
        },
        {
          id: 'duel',
          title: 'DUEL',
          blurb: 'One rival, two decks. Mine minerals, buy juice, soak them first.',
          effectLine: '1 V 1',
          color: '#63c4ff',
          scale: 1.05,
        },
      ],
      {
        // Sits at a natural pointing height: a hand held level at chest
        // height lands mid-card without you having to aim down at it.
        y: 1.35,
        distance: 2.1,
        onPick: (id) => {
          app.mode = id as 'defense' | 'duel';
          this.startRun();
        },
      },
    );
  }

  private showGameOver(): void {
    this.shownFor = 'gameover';
    this.drawPlate('gameover');
    this.plate.visible = true;
    this.board.show(
      [
        {
          id: 'again',
          title: 'AGAIN',
          blurb: app.mode === 'duel' ? 'Rematch — fresh decks' : 'Same spot, fresh reservoir',
          color: '#1fc4c9',
        },
        {
          id: 'menu',
          title: 'MENU',
          blurb: 'Catch your breath',
          color: '#7c8a94',
        },
      ],
      {
        y: 1.3,
        distance: 2.1,
        onPick: (id) => {
          if (id === 'again') this.startRun();
          else {
            // Back to the title: the tower comes up too, so a fresh run
            // gets a fresh placement.
            tower.placed = false;
            app.phase = 'title';
            this.shownFor = '';
          }
        },
      },
    );
  }

  // --- The info/stats plate above the cards. -------------------------------

  private buildPlate(): void {
    this.plateCanvas = document.createElement('canvas');
    logicalCanvas(this.plateCanvas, PLATE_W, PLATE_H);
    this.plateTex = crispTexture(this.plateCanvas);
    this.plate = new Mesh(
      new PlaneGeometry(1.7, 0.7),
      new MeshBasicMaterial({ map: this.plateTex, transparent: true }),
    );
    this.plate.position.set(0, 1.95, -2.35);
    this.plate.visible = false;
    this.world.scene.add(this.plate);
  }

  private drawPlate(kind: 'title' | 'gameover'): void {
    const ctx = this.plateCanvas.getContext('2d')!;
    const W = PLATE_W;
    const H = PLATE_H;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(250,252,255,0.9)';
    ctx.beginPath();
    ctx.roundRect(12, 12, W - 24, H - 24, 56);
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = kind === 'title' ? '#8fdfe8' : '#f0299b';
    ctx.stroke();

    if (kind === 'title') {
      ctx.fillStyle = '#2b3a44';
      ctx.font = '900 56px system-ui, -apple-system, sans-serif';
      ctx.fillText('HOW TO PLAY', W / 2, 82);
      ctx.font = '700 40px system-ui, sans-serif';
      ctx.fillStyle = '#4d6b76';
      ctx.fillText('POINT AND PULL THE TRIGGER to answer any menu', W / 2, 165);
      ctx.fillText('SQUEEZE GRIP at your hip — draw a pistol', W / 2, 230);
      ctx.fillText('PULL TRIGGER — one ball per press, make them count', W / 2, 295);
      ctx.fillText('RELEASE GRIP — throw the gun; a fresh one respawns', W / 2, 352);
    } else {
      const win = run.endReason === 'win';
      // Losing a DUEL has its own name: you got SLIMED.
      const slimed = !win && app.mode === 'duel';
      ctx.fillStyle = win ? '#f0299b' : slimed ? '#8bd12e' : '#e0312e';
      ctx.font = '900 72px system-ui, -apple-system, sans-serif';
      ctx.fillText(
        win
          ? 'SOAKED! YOU WIN'
          : slimed
            ? 'YOU GOT SLIMED'
            : run.endReason === 'tower'
              ? 'TOWER DRAINED'
              : 'WIPED OUT',
        W / 2,
        92,
      );
      ctx.fillStyle = '#2b3a44';
      ctx.font = '800 52px system-ui, sans-serif';
      if (app.mode === 'duel') {
        ctx.fillText(`${run.score} PTS`, W / 2, 210);
      } else {
        ctx.fillText(`WAVE ${Math.max(1, run.wave)}`, W / 2 - 300, 210);
        ctx.fillText(`${run.kills} POPS`, W / 2, 210);
        ctx.fillText(`${run.score} PTS`, W / 2 + 300, 210);
      }
      ctx.fillStyle = '#7c8a94';
      ctx.font = '700 36px system-ui, sans-serif';
      ctx.fillText(
        win
          ? 'their deck drips. your crystals gleam.'
          : app.mode === 'duel'
            ? 'dripping head to toe. the rival tops up and waits…'
            : 'the reservoir refills, THE THIRST regroups…',
        W / 2,
        320,
      );
    }
    this.plateTex.needsUpdate = true;
  }
}
