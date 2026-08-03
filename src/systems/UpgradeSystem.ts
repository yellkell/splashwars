/**
 * The between-wave upgrade choice — three cards on the shared pointer-driven
 * CardBoard (ui/cardBoard.ts). EnemySystem raises `upgradeGate.pending`
 * when a wave clears; this system shows the offer, applies the pick, and
 * hands control back to the wave director.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { CardBoard } from '../ui/cardBoard.js';
import { EnemySystem, upgradeGate } from './EnemySystem.js';
import { applyUpgrade, offerUpgrades, run, type UpgradeIdT } from '../game/run.js';
import { app } from '../game/appState.js';

const _cam = new Vector3();

export class UpgradeSystem extends createSystem({}) {
  private board!: CardBoard;

  init(): void {
    this.board = new CardBoard(this.world.scene);
  }

  update(delta: number): void {
    if (!this.board.active && upgradeGate.pending && app.phase === 'playing') {
      upgradeGate.pending = false;
      this.show();
    }
    // Death while the board is up: drop it, the game-over flow takes over.
    if (this.board.active && app.phase !== 'playing') this.board.hide();

    this.world.camera.getWorldPosition(_cam);
    this.board.update(delta, _cam);
  }

  private show(): void {
    const offers = offerUpgrades();
    if (offers.length === 0) {
      // Everything maxed — nothing to choose, carry straight on.
      this.world.getSystem(EnemySystem)?.resumeAfterUpgrade();
      return;
    }
    this.board.show(
      offers.map((def) => ({
        id: def.id,
        title: def.title,
        blurb: def.blurb,
        effectLine: def.effect(run.stacks[def.id]),
        footnote: run.stacks[def.id] > 0 ? `owned ×${run.stacks[def.id]}` : undefined,
        color: def.color,
      })),
      {
        onPick: (id) => {
          applyUpgrade(id as UpgradeIdT);
          this.world.getSystem(EnemySystem)?.resumeAfterUpgrade();
        },
      },
    );
  }
}
