/**
 * You: health, the visor read, the orbiting globes, and death.
 *
 * There is no health bar. Taking a hit throws PAINT ACROSS YOUR VISOR — a
 * camera-locked splat plane that thickens as you get hurt and washes off as
 * you recover. Your health is legible the same way the pistol's ammo is
 * legible: by looking at the paint, not at a number.
 *
 * This system also runs ORBITERS — the vampire-survivors passive. Each stack
 * adds a globe of your own paint circling you; anything they sweep through
 * takes damage on a per-enemy cooldown, so a wall of Scurriers melts as it
 * closes rather than instantly evaporating.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  AdditiveBlending,
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Group,
} from 'three';
import { EnemySystem } from './EnemySystem.js';
import { glossyPlastic } from '../materials/plastic.js';
import { resetRun, run, UpgradeId } from '../game/run.js';
import { dropletBurst } from '../fx/paint.js';
import * as sfx from '../audio/sfx.js';
import { ORBITALS, PALETTE, PLAYER } from '../config.js';

const _pos = new Vector3();
const _globePos = new Vector3();
const _near: number[] = [];

/** A camera-locked splat texture — paint thrown across your view. */
function visorTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  // Splats clustered around the edges so the centre of your view stays
  // playable even at low health — readable, not blinding.
  for (let i = 0; i < 26; i++) {
    const edge = Math.random() < 0.5;
    const x = edge ? (Math.random() < 0.5 ? Math.random() * 0.22 : 0.78 + Math.random() * 0.22) : Math.random();
    const y = edge ? Math.random() : (Math.random() < 0.5 ? Math.random() * 0.24 : 0.76 + Math.random() * 0.24);
    const r = size * (0.02 + Math.random() * 0.075);
    ctx.beginPath();
    ctx.arc(x * size, y * size, r, 0, Math.PI * 2);
    ctx.fill();
    for (let n = 0; n < 4; n++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * (1.2 + Math.random() * 0.9);
      ctx.beginPath();
      ctx.arc(x * size + Math.cos(a) * d, y * size + Math.sin(a) * d, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  return tex;
}

export class PlayerSystem extends createSystem({}) {
  private visor!: Mesh;
  private visorMat!: MeshBasicMaterial;
  private orbitGroup = new Group();
  private globes: Mesh[] = [];
  /** Per-enemy damage cooldowns for the orbiters, keyed by swarm slot. */
  private orbitCooldown = new Float32Array(4096);
  private angle = 0;

  init(): void {
    // The visor plane rides the camera, just in front of the near plane.
    this.visorMat = new MeshBasicMaterial({
      map: visorTexture(),
      color: PALETTE.paint,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.visor = new Mesh(new PlaneGeometry(0.42, 0.42), this.visorMat);
    this.visor.position.set(0, 0, -0.22);
    this.visor.renderOrder = 1000;
    this.visor.frustumCulled = false;
    this.world.camera.add(this.visor);

    this.world.scene.add(this.orbitGroup);
  }

  update(delta: number): void {
    // --- Health: regen after a quiet spell, and the visor read. ---
    run.sinceHit += delta;
    if (run.iframes > 0) run.iframes -= delta;
    if (!run.dead && run.sinceHit >= PLAYER.regenDelay && run.health < run.maxHealth) {
      run.health = Math.min(run.maxHealth, run.health + PLAYER.regenPerSec * delta);
    }
    // The visor tracks how hurt you are, plus a spike from the last hit.
    const wounded = 1 - run.health / run.maxHealth;
    run.hurt = Math.max(0, run.hurt - delta / PLAYER.hurtFlash);
    const target = Math.min(1, wounded * 0.85 + run.hurt * 0.5);
    this.visorMat.opacity += (target - this.visorMat.opacity) * Math.min(1, delta * 6);

    // --- Death: a beat on the floor, then a fresh run. ---
    if (run.dead) {
      run.deathTimer -= delta;
      if (run.deathTimer <= 0) {
        resetRun();
        // Clear the swarm too, or the crowd that killed you is still
        // standing on your deck the instant you come back.
        this.world.getSystem(EnemySystem)?.resetFight();
        sfx.waveHorn();
      }
      return;
    }

    this.updateOrbiters(delta);
  }

  // --- Orbiters. -----------------------------------------------------------

  private updateOrbiters(delta: number): void {
    const stacks = run.stacks[UpgradeId.Orbital];
    const wanted = stacks === 0 ? 0 : 1 + stacks; // 2 globes at the first pick
    while (this.globes.length < wanted) {
      const globe = new Mesh(
        new SphereGeometry(ORBITALS.globeRadius, 14, 12),
        glossyPlastic(PALETTE.paint, 0.1),
      );
      this.globes.push(globe);
      this.orbitGroup.add(globe);
    }
    while (this.globes.length > wanted) {
      const globe = this.globes.pop()!;
      this.orbitGroup.remove(globe);
      globe.geometry.dispose();
    }
    if (wanted === 0) return;

    // Orbit around YOUR head's floor position, so they follow you around
    // the deck rather than around the world origin.
    this.world.camera.getWorldPosition(_pos);
    this.orbitGroup.position.set(_pos.x, 0, _pos.z);

    // More stacks spin faster as well as adding globes.
    this.angle += ORBITALS.speed * (1 + stacks * 0.12) * delta;

    const enemies = this.world.getSystem(EnemySystem);
    const swarm = enemies?.swarm;

    for (let i = 0; i < this.globes.length; i++) {
      const a = this.angle + (i / this.globes.length) * Math.PI * 2;
      const globe = this.globes[i];
      globe.position.set(
        Math.cos(a) * ORBITALS.radius,
        ORBITALS.height + Math.sin(this.angle * 2 + i) * 0.05,
        Math.sin(a) * ORBITALS.radius,
      );

      if (!swarm || !enemies) continue;
      globe.getWorldPosition(_globePos);
      swarm.near(_globePos.x, _globePos.z, ORBITALS.globeRadius + 0.4, _near);
      for (let n = 0; n < _near.length; n++) {
        const j = _near[n];
        if (!swarm.alive[j]) continue;
        if (this.orbitCooldown[j] > 0) continue;
        const dx = swarm.px[j] - _globePos.x;
        const dy = swarm.py[j] - _globePos.y;
        const dz = swarm.pz[j] - _globePos.z;
        const r = swarm.radius[j] + ORBITALS.globeRadius;
        if (dx * dx + dy * dy + dz * dz <= r * r) {
          this.orbitCooldown[j] = ORBITALS.tickInterval;
          enemies.hit(j, ORBITALS.damage);
          dropletBurst(_globePos, 4, 0.6);
        }
      }
    }

    // Tick down the per-enemy orbiter cooldowns.
    for (let j = 0; j < this.orbitCooldown.length; j++) {
      if (this.orbitCooldown[j] > 0) this.orbitCooldown[j] -= delta;
    }
    void AdditiveBlending;
  }
}
