/**
 * THE POINTER — how menus are answered.
 *
 * Whenever a CardBoard is up, a slim beam leaves each hand along the SAME
 * aim axis the pistol barrel uses (input/aim.ts), a cursor disc lands on
 * whatever card it crosses, and the trigger clicks it. Nothing else in the
 * game uses a pointer: it exists only while a menu is open, so the fight
 * itself stays pure shooting.
 *
 * This replaced hosing menus with juice. Shooting a card looked cute and
 * played badly — you had to draw a gun to answer a menu, spend a third of a
 * tank per choice, and wait out a coverage threshold to learn whether the
 * game had heard you. A cursor answers instantly and costs nothing.
 *
 * One press does one thing: clicking a card starts a short lockout
 * (`menuClick.cooldown`) that WeaponSystem and the placement systems both
 * respect, so the trigger pull that picks TURRET can't also squirt juice or
 * slam the ghost down the instant the board closes.
 */

import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import {
  AdditiveBlending,
  CircleGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Group,
} from 'three';
import { activeBoards, menuClick, type CardBoard } from '../ui/cardBoard.js';
import { handAimRay } from '../input/aim.js';
import { pulseHand } from '../input/haptics.js';
import { PALETTE, UPGRADES } from '../config.js';

const HANDS = ['left', 'right'] as const;

const _origin = new Vector3();
const _dir = new Vector3();
const _point = new Vector3();
const _bestPoint = new Vector3();
const _q = new Quaternion();
const FORWARD = new Vector3(0, 0, -1);

/** Beam colours: aqua when it's on something, red when that thing is barred. */
const COLOR_IDLE = PALETTE.water;
const COLOR_DENY = 0xe0312e;

interface HandPointer {
  group: Group;
  beam: Mesh;
  cursor: Mesh;
  ring: Mesh;
  triggerWas: boolean;
}

export class PointerSystem extends createSystem({}) {
  private pointers: HandPointer[] = [];
  /** Which board+card each hand is over, for hover bookkeeping. */
  private hoverBoard: CardBoard | null = null;

  init(): void {
    for (let hand = 0; hand < 2; hand++) {
      const group = new Group();
      // A unit beam running along -Z from the origin; scale.z is the reach.
      const beamGeo = new CylinderGeometry(0.0035, 0.0035, 1, 8);
      beamGeo.rotateX(Math.PI / 2);
      beamGeo.translate(0, 0, -0.5);
      const beam = new Mesh(
        beamGeo,
        new MeshBasicMaterial({
          color: COLOR_IDLE,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      group.add(beam);
      this.world.scene.add(group);

      // The cursor: a filled dot inside a ring, parked on the card face.
      const cursor = new Mesh(
        new CircleGeometry(0.008, 20),
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }),
      );
      cursor.renderOrder = 950;
      const ring = new Mesh(
        new RingGeometry(0.016, 0.021, 24),
        new MeshBasicMaterial({ color: COLOR_IDLE, transparent: true, opacity: 0.9, depthTest: false }),
      );
      ring.renderOrder = 950;
      this.world.scene.add(cursor, ring);

      group.visible = false;
      cursor.visible = false;
      ring.visible = false;
      this.pointers.push({ group, beam, cursor, ring, triggerWas: false });
    }
  }

  update(delta: number): void {
    menuClick.cooldown = Math.max(0, menuClick.cooldown - delta);

    if (activeBoards.size === 0) {
      for (const p of this.pointers) {
        p.group.visible = false;
        p.cursor.visible = false;
        p.ring.visible = false;
        // Keep the edge tracker current so a held trigger can't "click"
        // the instant a board appears.
        const gp = this.input.xr.gamepads[HANDS[this.pointers.indexOf(p)]];
        p.triggerWas = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      }
      if (this.hoverBoard) {
        this.hoverBoard.setHover(-1);
        this.hoverBoard = null;
      }
      return;
    }

    // Find the best hit across both hands and every open board.
    let bestBoard: CardBoard | null = null;
    let bestIndex = -1;
    let bestDist = Infinity;
    let bestHand = -1;

    for (let hand = 0; hand < 2; hand++) {
      const p = this.pointers[hand];
      if (!handAimRay(this.world, hand as 0 | 1, _origin, _dir)) {
        p.group.visible = false;
        p.cursor.visible = false;
        p.ring.visible = false;
        continue;
      }
      // Park the beam along this hand's aim; length is set below.
      p.group.position.copy(_origin);
      p.group.quaternion.copy(_q.setFromUnitVectors(FORWARD, _dir));
      p.group.visible = true;
      p.beam.scale.z = 2.2;
      p.cursor.visible = false;
      p.ring.visible = false;

      for (const board of activeBoards) {
        const hit = board.hitTest(_origin, _dir, _point);
        if (!hit || hit.distance >= bestDist) continue;
        bestDist = hit.distance;
        bestBoard = board;
        bestIndex = hit.index;
        bestHand = hand;
        _bestPoint.copy(_point);
      }
    }

    // Hover bookkeeping — only one card is ever lit.
    if (this.hoverBoard && this.hoverBoard !== bestBoard) this.hoverBoard.setHover(-1);
    this.hoverBoard = bestBoard;
    if (bestBoard) {
      const changed = bestBoard.setHover(bestIndex);
      if (changed && bestHand >= 0) {
        // A tick as the cursor crosses onto a new card — the click's
        // whole job is to feel like it landed on something.
        pulseHand(this.world.session, HANDS[bestHand], 0.25, 14);
      }
    }

    // Dress the winning hand's beam: stop it at the card, show the cursor,
    // and go red on anything you can't actually take.
    if (bestHand >= 0 && bestBoard) {
      const p = this.pointers[bestHand];
      const ok = bestBoard.affordableAt(bestIndex);
      const tint = ok ? COLOR_IDLE : COLOR_DENY;
      (p.beam.material as MeshBasicMaterial).color.set(tint);
      (p.ring.material as MeshBasicMaterial).color.set(tint);
      p.beam.scale.z = bestDist;
      p.cursor.visible = true;
      p.ring.visible = true;
      // Float the cursor a hair off the face so it never z-fights the card.
      p.cursor.position.copy(_bestPoint).addScaledVector(_dir, -0.004);
      p.ring.position.copy(p.cursor.position);
      p.cursor.quaternion.copy(p.group.quaternion);
      p.ring.quaternion.copy(p.group.quaternion);
    }

    // The click.
    for (let hand = 0; hand < 2; hand++) {
      const p = this.pointers[hand];
      const gp = this.input.xr.gamepads[HANDS[hand]];
      const pressed = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      const down = pressed && !p.triggerWas;
      p.triggerWas = pressed;
      if (!down || hand !== bestHand || !bestBoard) continue;
      const picked = bestBoard.activateHover();
      menuClick.cooldown = UPGRADES.clickGuard;
      pulseHand(this.world.session, HANDS[hand], picked ? 0.8 : 0.3, picked ? 40 : 18);
      if (picked) this.hoverBoard = null;
    }
  }
}
