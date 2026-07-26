/**
 * Waves — vampire-survivors pacing on a pool deck. Each wave a bigger,
 * faster squad of toy enemies fades in on a ring out in your room and bobs
 * in toward the deck, holding at a standoff ring around you (they don't
 * damage you yet — this build is the paint sandbox). Coverage is their
 * health: PaintSystem paints them, this system pops the fully-painted, and
 * when the squad is cleared the next wave rolls in after a breather.
 * Wave 10 is the boss: one huge toy that soaks a whole tank of paint.
 *
 * A floating wave sign (canvas plate, same family as the title banner)
 * announces WAVE N / CLEARED / boss.
 */

import { createSystem, type Entity } from '@iwsdk/core';
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { Enemy } from '../components/Enemy.js';
import { createToyEnemy, type ToyVisual } from '../enemies/toy.js';
import { dropletBurst, initPaintPools } from '../fx/paint.js';
import * as sfx from '../audio/sfx.js';
import { ENEMY, WAVES } from '../config.js';

const _pos = new Vector3();

type Phase = 'intermission' | 'wave';

export class EnemySystem extends createSystem({
  enemies: { required: [Enemy] },
}) {
  private visuals = new Map<Entity, ToyVisual>();
  private phase: Phase = 'intermission';
  private wave = 0; // the wave currently running (1-based once started)
  private timer = WAVES.interWaveDelay; // counts down in intermission
  private toSpawn = 0;
  private spawnTimer = 0;
  private time = 0;

  // The floating wave sign.
  private sign!: Mesh;
  private signCanvas!: HTMLCanvasElement;
  private signTex!: CanvasTexture;

  init(): void {
    initPaintPools(this.world.scene); // shared with PaintSystem, first-in wins
    this.buildSign();
    this.setSign(`WAVE 1 INCOMING…`, '#1fc4c9');
  }

  update(delta: number): void {
    this.time += delta;

    if (this.phase === 'intermission') {
      this.timer -= delta;
      if (this.timer <= 0) this.startWave(this.wave + 1);
    } else {
      // Staggered squad entrances.
      if (this.toSpawn > 0) {
        this.spawnTimer -= delta;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = WAVES.spawnStagger;
          this.toSpawn -= 1;
          this.spawnEnemy(this.wave, this.wave === WAVES.count && this.toSpawn === 0);
        }
      }
    }

    // Drive every live toy: bob, drift in, slow orbit, face the player.
    const enemies = [...this.queries.enemies.entities];
    for (const e of enemies) {
      const obj = e.object3D;
      if (!obj) continue;

      const coverage = e.getValue(Enemy, 'coverage') ?? 0;
      this.visuals.get(e)?.setCoverage(coverage);
      if (coverage >= 1) {
        this.popEnemy(e);
        continue;
      }

      const speed = e.getValue(Enemy, 'speed') ?? 0.3;
      const phase = e.getValue(Enemy, 'phase') ?? 0;
      obj.getWorldPosition(_pos);
      const dist = Math.hypot(_pos.x, _pos.z);

      if (dist > WAVES.standoffRadius) {
        // Bob in toward the deck.
        obj.position.x -= (_pos.x / dist) * speed * delta;
        obj.position.z -= (_pos.z / dist) * speed * delta;
      } else {
        // Hold the ring, circling slowly — a crowd treading water.
        const orbit = speed * 0.35 * delta;
        const a = Math.atan2(_pos.z, _pos.x) + orbit / dist;
        obj.position.x = Math.cos(a) * dist;
        obj.position.z = Math.sin(a) * dist;
      }

      // Idle bob + heavier wallow as the paint weighs it down.
      obj.position.y =
        ENEMY.hoverHeight +
        Math.sin(this.time * ENEMY.bobRate + phase) * ENEMY.bobAmplitude * (1 - coverage * 0.6) -
        coverage * 0.12;
      obj.lookAt(0, ENEMY.hoverHeight, 0);
    }

    // Wave cleared?
    if (this.phase === 'wave' && this.toSpawn === 0 && enemies.length === 0) {
      this.phase = 'intermission';
      this.timer = WAVES.interWaveDelay;
      if (this.wave >= WAVES.count) {
        this.setSign('ALL WAVES CLEARED — AGAIN, BIGGER', '#f0299b');
        this.wave = 0; // loop, for now — meta-progression comes later
      } else {
        this.setSign(`WAVE ${this.wave} CLEARED`, '#f0299b');
      }
    }

    // The sign gently faces the player.
    this.sign.lookAt(this.world.camera.getWorldPosition(_pos));
  }

  private startWave(n: number): void {
    this.phase = 'wave';
    this.wave = n;
    this.toSpawn = n === WAVES.count ? 1 : WAVES.baseEnemies + (n - 1) * WAVES.enemiesPerWave;
    this.spawnTimer = 0.5;
    sfx.waveHorn();
    this.setSign(n === WAVES.count ? 'FINAL WAVE — THE BIG ONE' : `WAVE ${n}`, '#1fc4c9');
  }

  private spawnEnemy(wave: number, boss: boolean): void {
    const scale = boss ? WAVES.bossScale : 0.92 + Math.random() * 0.25;
    const visual = createToyEnemy(scale);
    const e = this.world.createTransformEntity(visual.group, { persistent: true });
    const speed = (WAVES.baseSpeed + (wave - 1) * WAVES.speedPerWave) * (boss ? 0.55 : 1);
    e.addComponent(Enemy, {
      radius: ENEMY.bodyRadius * scale * 1.12,
      speed,
      soak: boss ? WAVES.bossCoverageSoak : 1,
      phase: Math.random() * Math.PI * 2,
      boss: boss ? 1 : 0,
    });

    // Appear on the spawn ring, biased toward the front half of the room.
    const [rMin, rMax] = WAVES.spawnRadius;
    const r = rMin + Math.random() * (rMax - rMin);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
    e.object3D!.position.set(Math.cos(a) * r, ENEMY.hoverHeight, Math.sin(a) * r);
    this.visuals.set(e, visual);
  }

  private popEnemy(e: Entity): void {
    const obj = e.object3D;
    if (obj) {
      obj.getWorldPosition(_pos);
      const boss = (e.getValue(Enemy, 'boss') ?? 0) === 1;
      dropletBurst(_pos, boss ? ENEMY.popDroplets * 4 : ENEMY.popDroplets, boss ? 2.2 : 1.3);
      sfx.enemyPop();
    }
    this.visuals.get(e)?.dispose();
    this.visuals.delete(e);
    e.destroy();
  }

  // --- The wave sign. ------------------------------------------------------

  private buildSign(): void {
    this.signCanvas = document.createElement('canvas');
    this.signCanvas.width = 1024;
    this.signCanvas.height = 200;
    this.signTex = new CanvasTexture(this.signCanvas);
    this.signTex.minFilter = LinearFilter;
    this.sign = new Mesh(
      new PlaneGeometry(1.7, 0.33),
      new MeshBasicMaterial({ map: this.signTex, transparent: true }),
    );
    this.sign.position.set(0, 1.95, -3.2);
    this.world.scene.add(this.sign);
  }

  private setSign(text: string, color: string): void {
    const ctx = this.signCanvas.getContext('2d')!;
    const { width: w, height: h } = this.signCanvas;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Frosted plastic pill behind the text.
    ctx.fillStyle = 'rgba(250,252,255,0.82)';
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 90);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.font = '900 92px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2 + 4);
    this.signTex.needsUpdate = true;
  }
}
