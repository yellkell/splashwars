/**
 * DUEL — the 1v1 mode. StarCraft in miniature, played with water pistols.
 *
 * Two floating decks face each other across a gap. Yours has three MINERAL
 * CRYSTALS (blue, glassy, StarCraft through and through), a DEPOT bin, four
 * SHIELD SLOTS across the front edge (two top, two bottom — Fortnite-style
 * panel building) and room for three turrets. The rival machine's deck
 * mirrors yours, and IT plays the same game you do.
 *
 * The economy: shoot a crystal and minerals chip straight off it (the
 * bootstrap); buy cantaloupe-plastic MINER drones and they ferry loads
 * crystal→depot forever. Minerals buy JUICE — the second resource, which
 * fills your pistols and stocks the reserve your respawning guns draw on —
 * plus TURRETS and SHIELDS. Run the rival out of shell before it soaks you.
 *
 * The rival AI runs an abstract copy of the same books (income per miner,
 * same price list) and its purchases appear physically on its deck: shield
 * panels you must crack, turrets you can pop, miners bobbing between its
 * crystals. Everything you can hit is a BallTarget (combat/targets.ts);
 * everything it throws is a hostile ball in the same sim yours fly in.
 */

import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  type Object3D,
} from 'three';
import { CardBoard } from '../ui/cardBoard.js';
import { EnemySystem } from './EnemySystem.js';
import { WeaponSystem } from './WeaponSystem.js';
import { sharedTurretAssets } from './TurretSystem.js';
import { addBallTarget, clearBallTargets, type BallTarget } from '../combat/targets.js';
import { enemyShot, squirtBlob } from '../combat/juiceBus.js';
import { dropletBurst } from '../fx/juice.js';
import { popDamage } from '../fx/damageNumbers.js';
import { app } from '../game/appState.js';
import { run } from '../game/run.js';
import { duel } from '../game/duel.js';
import { addDrops, bank, build, spendDrops } from '../game/shop.js';
import { handAimRay } from '../input/aim.js';
import { placementSpot } from '../input/pointRay.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';
import { DUEL, PALETTE, SHOP } from '../config.js';

const HANDS = ['left', 'right'] as const;

const _pos = new Vector3();
const _vel = new Vector3();
const _head = new Vector3();
const _spot = new Vector3();
const _rayO = new Vector3();
const _rayD = new Vector3();

// --- Shared materials (module-cached, never per-instance). -----------------

let matCrystal: MeshStandardMaterial;
let matCrystalCore: MeshBasicMaterial;
let matCrystalDead: MeshStandardMaterial;
let matCantaloupe: MeshStandardMaterial;
let matRind: MeshStandardMaterial;
let matViolet: MeshStandardMaterial;
let matLens: MeshBasicMaterial;
let matDark: MeshStandardMaterial;
let matPane: MeshStandardMaterial;
let matSlotGhost: MeshBasicMaterial;

function buildDuelMaterials(): void {
  if (matCrystal) return;
  // StarCraft minerals: deep glassy blue with a lit core.
  matCrystal = new MeshStandardMaterial({
    color: 0x63c4ff,
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
    emissive: 0x1c5f9a,
    emissiveIntensity: 0.55,
  });
  matCrystalCore = new MeshBasicMaterial({ color: 0xcdeeff });
  matCrystalDead = new MeshStandardMaterial({ color: 0x9fb0ba, roughness: 0.8 });
  // The miner: cantaloupe plastic — orange flesh, pale netted rind accents.
  matCantaloupe = new MeshStandardMaterial({ color: 0xf5a94e, roughness: 0.35 });
  matRind = new MeshStandardMaterial({ color: 0xd8e3c8, roughness: 0.5 });
  matViolet = new MeshStandardMaterial({ color: 0x7b5cff, roughness: 0.3 });
  matLens = new MeshBasicMaterial({ color: 0xcdbcff });
  matDark = new MeshStandardMaterial({ color: 0x22303a, roughness: 0.6 });
  matPane = new MeshStandardMaterial({
    color: 0xbfe8ff,
    roughness: 0.35,
    transparent: true,
    opacity: 0.42,
  });
  matSlotGhost = new MeshBasicMaterial({
    color: PALETTE.water,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
}

// --- Small structs. --------------------------------------------------------

interface Crystal {
  group: Group;
  left: number;
  target: BallTarget;
}

interface Miner {
  group: Group;
  carry: Mesh;
  phase: 'toCrystal' | 'dig' | 'toDepot';
  timer: number;
  crystal: number;
  from: Vector3;
  to: Vector3;
}

interface ShieldPanel {
  group: Group;
  pane: Mesh;
  hp: number;
  target: BallTarget;
}

interface DuelTurret {
  group: Group;
  head: Object3D;
  cooldown: number;
  hp: number; // enemy turrets are poppable; yours use Infinity
  target?: BallTarget;
}

// Slot layout: front edge, 2 columns × 2 rows (bottom row 0-1, top 2-3).
const SLOT_X = [-0.72, 0.72];
const SLOT_Y = [0.57, 1.62];
const PANEL_W = 1.4;
const PANEL_H = 1.05;

function slotCentre(slot: number, z: number, out: Vector3): Vector3 {
  return out.set(SLOT_X[slot % 2], SLOT_Y[slot >> 1], z);
}

export class DuelSystem extends createSystem({}) {
  private board!: CardBoard;
  private root = new Group();
  private built = false;
  private time = 0;

  // Your side.
  private crystals: Crystal[] = [];
  private depotPos = new Vector3(0.55, 0, 0.4);
  private miners: Miner[] = [];
  private myShields: (ShieldPanel | null)[] = [null, null, null, null];
  private myTurrets: DuelTurret[] = [];
  private slotGhosts: Mesh[] = [];
  private hoverSlot = -1;

  // The rival.
  private avatar!: Group;
  private avatarLens!: Mesh;
  private avatarHp = DUEL.avatarHp;
  private avatarShotTimer = 2;
  private enemyShields: (ShieldPanel | null)[] = [null, null, null, null];
  private enemyShieldBrokenAt = [-99, -99, -99, -99];
  private enemyTurrets: DuelTurret[] = [];
  private enemyMinerBots: Miner[] = [];
  private enemyMinerals = 30;
  private enemyShots = 20;
  private aiAcc = 0;
  private over = false;

  private toggleWas = false;
  private triggerWas: [boolean, boolean] = [false, false];

  init(): void {
    this.board = new CardBoard(this.world.scene);
    this.root.visible = false;
    this.world.scene.add(this.root);
  }

  // --- Match lifecycle. ----------------------------------------------------

  /** MenuSystem calls this when a duel run starts (fresh or AGAIN). */
  startMatch(): void {
    buildDuelMaterials();
    if (!this.built) this.buildArena();
    this.built = true;

    // Sweep the previous match.
    clearBallTargets();
    for (const m of this.miners) m.group.removeFromParent();
    this.miners.length = 0;
    for (const m of this.enemyMinerBots) m.group.removeFromParent();
    this.enemyMinerBots.length = 0;
    for (const t of [...this.myTurrets, ...this.enemyTurrets]) t.group.removeFromParent();
    this.myTurrets.length = 0;
    this.enemyTurrets.length = 0;
    for (const s of [...this.myShields, ...this.enemyShields]) s?.group.removeFromParent();
    this.myShields.fill(null);
    this.enemyShields.fill(null);
    this.enemyShieldBrokenAt.fill(-99);

    duel.active = true;
    duel.tanks = DUEL.startTanks;
    addDrops(DUEL.startMinerals);
    this.avatarHp = DUEL.avatarHp;
    this.avatarShotTimer = 3.5;
    this.enemyMinerals = 30;
    this.enemyShots = 20;
    this.over = false;

    for (const c of this.crystals) {
      c.left = DUEL.crystalCapacity;
      c.group.scale.setScalar(1);
      c.group.traverse((o) => {
        if (o instanceof Mesh && o.material === matCrystalDead) o.material = matCrystal;
      });
    }
    this.registerTargets();
    this.addMiner(); // one free worker — the StarCraft opening
    this.addEnemyMinerBot();
    this.world.getSystem(WeaponSystem)?.refillAll(1);
    this.world.getSystem(EnemySystem)?.setSign('MINE THE CRYSTALS — Y OPENS THE SHOP', '#63c4ff');
  }

  update(delta: number): void {
    if (app.mode !== 'duel') {
      if (this.root.visible) this.root.visible = false;
      if (this.board.active) this.board.hide();
      if (duel.active) duel.active = false;
      return;
    }
    this.time += delta;
    this.root.visible = app.phase === 'playing' || app.phase === 'gameover';
    this.world.camera.getWorldPosition(_head);
    this.board.update(delta, _head);

    if (app.phase !== 'playing') {
      duel.active = false;
      this.hideSlotGhosts();
      return;
    }
    duel.active = true;

    // --- Y toggles the duel shop (or cancels a placement). ---
    const gp = this.input.xr.gamepads[HANDS[SHOP.toggleHand]];
    const toggle =
      (gp?.getButtonPressed(InputComponent.Y_Button) ?? false) ||
      (gp?.getButtonPressed(InputComponent.X_Button) ?? false);
    if (toggle && !this.toggleWas) {
      if (build.placing) {
        build.placing = null;
        this.hideSlotGhosts();
        sfx.shopToggle(false);
      } else if (this.board.active) {
        this.board.hide();
        sfx.shopToggle(false);
      } else {
        this.showShop();
        sfx.shopToggle(true);
      }
    }
    this.toggleWas = toggle;

    if (build.placing === 'shield') this.updateShieldPlacing();
    else if (build.placing === 'duelTurret') this.updateTurretPlacing();
    else this.hideSlotGhosts();

    this.updateMiners(delta, this.miners, true);
    this.updateMiners(delta, this.enemyMinerBots, false);
    this.updateCrystals();
    this.updateAvatar(delta);
    this.updateTurrets(delta);
    this.updateAI(delta);
  }

  // --- The arena (built once). --------------------------------------------

  private deck(trim: MeshStandardMaterial): Group {
    const g = new Group();
    const slab = new Mesh(
      new BoxGeometry(DUEL.platformW, 0.06, DUEL.platformD),
      sharedTurretAssets().matWhite,
    );
    slab.position.y = 0.03;
    g.add(slab);
    for (const side of [-1, 1]) {
      const rail = new Mesh(new BoxGeometry(DUEL.platformW, 0.03, 0.07), trim);
      rail.position.set(0, 0.075, side * (DUEL.platformD / 2 - 0.035));
      g.add(rail);
      const railX = new Mesh(new BoxGeometry(0.07, 0.03, DUEL.platformD), trim);
      railX.position.set(side * (DUEL.platformW / 2 - 0.035), 0.075, 0);
      g.add(railX);
    }
    return g;
  }

  private crystalCluster(): Group {
    const g = new Group();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.random();
      const h = 0.22 + Math.random() * 0.24;
      const spike = new Mesh(new OctahedronGeometry(0.09), matCrystal);
      spike.scale.set(0.55, h / 0.09, 0.55);
      spike.position.set(Math.cos(a) * 0.11, h * 0.5, Math.sin(a) * 0.11);
      spike.rotation.set(Math.cos(a) * 0.45, a, Math.sin(a) * 0.45);
      g.add(spike);
      // A lit core inside every other spike — the mineral GLOWS.
      if (i % 2 === 0) {
        const core = new Mesh(new OctahedronGeometry(0.035), matCrystalCore);
        core.position.copy(spike.position).multiplyScalar(0.9);
        core.position.y += 0.02;
        g.add(core);
      }
    }
    return g;
  }

  private minerDrone(): { group: Group; carry: Mesh } {
    const g = new Group();
    const body = new Mesh(new CapsuleGeometry(0.07, 0.06, 6, 12), matCantaloupe);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.16;
    g.add(body);
    // Rind netting: two pale hoops around the flesh.
    for (const z of [-0.03, 0.035]) {
      const hoop = new Mesh(new TorusGeometry(0.071, 0.008, 8, 16), matRind);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(z, 0.16, 0);
      g.add(hoop);
    }
    const scoop = new Mesh(new ConeGeometry(0.045, 0.09, 10), matDark);
    scoop.rotation.x = Math.PI / 2;
    scoop.position.set(0, 0.12, -0.1);
    g.add(scoop);
    const eye = new Mesh(new SphereGeometry(0.022, 10, 8), matLens);
    eye.position.set(0, 0.19, -0.08);
    g.add(eye);
    // The chunk it hauls home — visible only on the return leg.
    const carry = new Mesh(new OctahedronGeometry(0.05), matCrystal);
    carry.position.set(0, 0.08, -0.09);
    carry.visible = false;
    g.add(carry);
    return { group: g, carry };
  }

  private avatarBot(): Group {
    const g = new Group();
    const body = new Mesh(new CapsuleGeometry(0.24, 0.3, 8, 16), sharedTurretAssets().matWhite);
    g.add(body);
    const ring = new Mesh(new TorusGeometry(0.26, 0.035, 10, 24), matViolet);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.12;
    g.add(ring);
    const socket = new Mesh(new TorusGeometry(0.1, 0.028, 10, 20), matDark);
    socket.position.set(0, 0.12, 0.21);
    g.add(socket);
    this.avatarLens = new Mesh(new SphereGeometry(0.085, 14, 12), matLens);
    this.avatarLens.position.set(0, 0.12, 0.22);
    g.add(this.avatarLens);
    for (const side of [-1, 1]) {
      const arm = new Mesh(new CylinderGeometry(0.035, 0.045, 0.3, 10), matViolet);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(side * 0.3, -0.05, 0.12);
      g.add(arm);
    }
    const skirt = new Mesh(new ConeGeometry(0.2, 0.18, 14), matDark);
    skirt.position.y = -0.36;
    g.add(skirt);
    return g;
  }

  private buildArena(): void {
    // Your deck sits under you; the rival's faces it across the gap.
    const mine = this.deck(sharedTurretAssets().matRed);
    mine.position.set(0, 0, -0.1);
    this.root.add(mine);
    const theirs = this.deck(matViolet);
    theirs.position.set(0, 0, DUEL.enemyZ);
    this.root.add(theirs);

    // Your crystals — around you, in reach of a lazy over-shoulder shot.
    for (const [x, z] of [[-1.15, 0.75], [1.15, 0.75], [0, 1.0]] as const) {
      const group = this.crystalCluster();
      group.position.set(x, 0.06, z);
      this.root.add(group);
      this.crystals.push({ group, left: DUEL.crystalCapacity, target: null! });
    }
    // Rival crystals (set dressing — its books are abstract).
    for (const [x, z] of [[-1.15, DUEL.enemyZ - 0.75], [1.15, DUEL.enemyZ - 0.75]] as const) {
      const group = this.crystalCluster();
      group.position.set(x, 0.06, z);
      this.root.add(group);
    }

    // The depot: a little red-lidded bin the miners pour into.
    const depot = new Group();
    const bin = new Mesh(new CylinderGeometry(0.13, 0.16, 0.2, 12), sharedTurretAssets().matWhite);
    bin.position.y = 0.1;
    depot.add(bin);
    const lid = new Mesh(new TorusGeometry(0.13, 0.025, 10, 18), sharedTurretAssets().matRed);
    lid.rotation.x = Math.PI / 2;
    lid.position.y = 0.21;
    depot.add(lid);
    depot.position.copy(this.depotPos);
    this.root.add(depot);

    // The rival itself.
    this.avatar = this.avatarBot();
    this.avatar.position.set(0, 1.35, DUEL.enemyZ + 0.35);
    this.root.add(this.avatar);

    // Ghost frames for your four shield slots (shown while placing).
    for (let s = 0; s < 4; s++) {
      const ghost = new Mesh(new BoxGeometry(PANEL_W, PANEL_H, 0.03), matSlotGhost);
      slotCentre(s, this.myShieldZ(), _spot);
      ghost.position.copy(_spot);
      ghost.visible = false;
      this.root.add(ghost);
      this.slotGhosts.push(ghost);
    }
  }

  private myShieldZ(): number {
    return -0.1 - DUEL.platformD / 2; // your deck's front edge
  }

  private enemyShieldZ(): number {
    return DUEL.enemyZ + DUEL.platformD / 2; // their front edge, facing you
  }

  // --- Targets (what juice can hit). ---------------------------------------

  private registerTargets(): void {
    // Crystals: chip minerals off with every landed ball.
    for (const c of this.crystals) {
      const pos = c.group.position.clone().setY(0.32);
      c.target = {
        pos,
        radius: 0.38,
        hitByHostile: false,
        alive: () => c.left > 0,
        onHit: (_d, at) => {
          const gain = Math.min(DUEL.mineralsPerShot, c.left);
          c.left -= gain;
          addDrops(gain);
          popDamage(_pos.copy(at).setY(at.y + 0.15), gain, false, 0x7ad4ff);
          sfx.coin(0);
          if (c.left <= 0) this.exhaustCrystal(c);
          return true;
        },
      };
      addBallTarget(c.target);
    }
    // The rival's shell.
    addBallTarget({
      pos: this.avatar.position,
      radius: 0.5,
      hitByHostile: false,
      alive: () => this.avatarHp > 0,
      onHit: (damage, at) => {
        this.avatarHp -= damage;
        popDamage(_pos.copy(at).setY(at.y + 0.3), damage, false, 0xffffff);
        sfx.hitSplat();
        if (this.avatarHp <= 0) this.win();
        return true;
      },
    });
  }

  private exhaustCrystal(c: Crystal): void {
    c.group.traverse((o) => {
      if (o instanceof Mesh && (o.material === matCrystal || o.material === matCrystalCore)) {
        o.material = matCrystalDead;
      }
    });
  }

  private updateCrystals(): void {
    for (const c of this.crystals) {
      const k = 0.35 + 0.65 * (c.left / DUEL.crystalCapacity);
      c.group.scale.setScalar(k);
    }
  }

  // --- Miners. -------------------------------------------------------------

  private addMiner(): void {
    const { group, carry } = this.minerDrone();
    group.position.copy(this.depotPos);
    this.root.add(group);
    this.miners.push({
      group,
      carry,
      phase: 'toCrystal',
      timer: 0,
      crystal: this.pickCrystal(),
      from: this.depotPos.clone(),
      to: new Vector3(),
    });
  }

  private addEnemyMinerBot(): void {
    const { group, carry } = this.minerDrone();
    const depot = _spot.set(-0.5, 0, DUEL.enemyZ - 0.3);
    group.position.copy(depot);
    this.root.add(group);
    this.enemyMinerBots.push({
      group,
      carry,
      phase: 'toCrystal',
      timer: 0,
      crystal: Math.random() < 0.5 ? 0 : 1,
      from: depot.clone(),
      to: new Vector3(),
    });
  }

  private pickCrystal(): number {
    const open = this.crystals.map((c, i) => (c.left > 0 ? i : -1)).filter((i) => i >= 0);
    if (open.length === 0) return -1;
    return open[Math.floor(Math.random() * open.length)];
  }

  /** Drive one fleet of miner drones (yours pays out; the rival's is set
   * dressing — its books accrue in updateAI). */
  private updateMiners(delta: number, fleet: Miner[], mine: boolean): void {
    for (const m of fleet) {
      m.timer += delta;
      const crystalPos = mine
        ? m.crystal >= 0
          ? this.crystals[m.crystal].group.position
          : this.depotPos
        : _spot.set(m.crystal === 0 ? -1.15 : 1.15, 0, DUEL.enemyZ - 0.75);
      const depotPos = mine ? this.depotPos : _pos.set(-0.5, 0, DUEL.enemyZ - 0.3);

      switch (m.phase) {
        case 'toCrystal': {
          const t = Math.min(1, m.timer / DUEL.minerLeg);
          m.group.position.lerpVectors(m.from, m.to.copy(crystalPos), t);
          m.group.position.y = 0.06 + Math.sin(t * Math.PI) * 0.12 + Math.sin(this.time * 6) * 0.015;
          m.group.lookAt(crystalPos.x, m.group.position.y, crystalPos.z);
          if (t >= 1) {
            m.phase = 'dig';
            m.timer = 0;
          }
          break;
        }
        case 'dig': {
          // Nose down in the mineral, wiggling.
          m.group.position.y = 0.06 + Math.abs(Math.sin(m.timer * 9)) * 0.05;
          m.group.rotation.z = Math.sin(m.timer * 9) * 0.12;
          if (m.timer >= DUEL.minerDig) {
            m.phase = 'toDepot';
            m.timer = 0;
            m.from.copy(m.group.position);
            m.carry.visible = true;
            m.group.rotation.z = 0;
          }
          break;
        }
        case 'toDepot': {
          const t = Math.min(1, m.timer / DUEL.minerLeg);
          m.group.position.lerpVectors(m.from, m.to.copy(depotPos), t);
          m.group.position.y = 0.06 + Math.sin(t * Math.PI) * 0.12 + Math.sin(this.time * 6) * 0.015;
          m.group.lookAt(depotPos.x, m.group.position.y, depotPos.z);
          if (t >= 1) {
            m.carry.visible = false;
            m.phase = 'toCrystal';
            m.timer = 0;
            m.from.copy(m.group.position);
            if (mine) {
              // The delivery: minerals in the bank, straight off the rock.
              const c = m.crystal >= 0 ? this.crystals[m.crystal] : undefined;
              const gain = c ? Math.min(DUEL.minerYield, c.left) : 0;
              if (c && gain > 0) {
                c.left -= gain;
                addDrops(gain);
                popDamage(_pos.copy(depotPos).setY(0.45), gain, false, 0x7ad4ff);
                sfx.coin(1);
                if (c.left <= 0) this.exhaustCrystal(c);
              }
              m.crystal = this.pickCrystal();
            }
          }
          break;
        }
      }
    }
  }

  // --- Shields (Fortnite slots). -------------------------------------------

  private buildPanel(slot: number, z: number, mineSide: boolean): ShieldPanel {
    const group = new Group();
    const pane = new Mesh(new BoxGeometry(PANEL_W - 0.08, PANEL_H - 0.08, 0.03), matPane.clone());
    group.add(pane);
    const frameMat = mineSide ? sharedTurretAssets().matRed : matViolet;
    for (const dy of [-1, 1]) {
      const bar = new Mesh(new BoxGeometry(PANEL_W, 0.05, 0.05), frameMat);
      bar.position.y = dy * (PANEL_H / 2 - 0.025);
      group.add(bar);
    }
    for (const dx of [-1, 1]) {
      const bar = new Mesh(new BoxGeometry(0.05, PANEL_H, 0.05), frameMat);
      bar.position.x = dx * (PANEL_W / 2 - 0.025);
      group.add(bar);
    }
    slotCentre(slot, z, _spot);
    group.position.copy(_spot);
    this.root.add(group);

    const panel: ShieldPanel = { group, pane, hp: DUEL.shieldHp, target: null! };
    panel.target = {
      pos: group.position,
      radius: 1.05,
      hitByHostile: mineSide,
      alive: () => panel.hp > 0,
      onHit: (damage, at) => {
        // The sphere gate is generous; do the real panel-rect test here.
        if (Math.abs(at.x - group.position.x) > PANEL_W / 2 + 0.05) return false;
        if (Math.abs(at.y - group.position.y) > PANEL_H / 2 + 0.05) return false;
        if (Math.abs(at.z - group.position.z) > 0.4) return false;
        panel.hp -= mineSide ? DUEL.shieldHitDamage : damage;
        const mat = panel.pane.material as MeshStandardMaterial;
        mat.opacity = 0.42 * (0.35 + 0.65 * Math.max(0, panel.hp) / DUEL.shieldHp);
        sfx.towerHit();
        if (panel.hp <= 0) this.shatterPanel(panel, mineSide);
        return true;
      },
    };
    addBallTarget(panel.target);
    return panel;
  }

  private shatterPanel(panel: ShieldPanel, mineSide: boolean): void {
    dropletBurst(_pos.copy(panel.group.position), 26, 1.6);
    sfx.gunBurst();
    panel.group.removeFromParent();
    const list = mineSide ? this.myShields : this.enemyShields;
    const idx = list.indexOf(panel);
    if (idx >= 0) {
      list[idx] = null;
      if (!mineSide) this.enemyShieldBrokenAt[idx] = this.time;
    }
    this.world
      .getSystem(EnemySystem)
      ?.setSign(mineSide ? 'YOUR PANEL SHATTERED' : 'THEIR PANEL SHATTERED', mineSide ? '#e0312e' : '#f0299b');
  }

  private updateShieldPlacing(): void {
    // Show ghost frames on the EMPTY slots; pick with the hand ray.
    this.hoverSlot = -1;
    const z = this.myShieldZ();
    if (handAimRay(this.world, 1, _rayO, _rayD) || handAimRay(this.world, 0, _rayO, _rayD)) {
      if (Math.abs(_rayD.z) > 1e-4) {
        const t = (z - _rayO.z) / _rayD.z;
        if (t > 0) {
          const x = _rayO.x + _rayD.x * t;
          const y = _rayO.y + _rayD.y * t;
          if (Math.abs(x) < PANEL_W + 0.2 && y > 0 && y < SLOT_Y[1] + PANEL_H) {
            this.hoverSlot = (x < 0 ? 0 : 1) + (y > (SLOT_Y[0] + SLOT_Y[1]) / 2 ? 2 : 0);
          }
        }
      }
    }
    for (let s = 0; s < 4; s++) {
      const ghost = this.slotGhosts[s];
      ghost.visible = !this.myShields[s];
      (ghost.material as MeshBasicMaterial).opacity = s === this.hoverSlot ? 0.5 : 0.18;
    }

    for (const hand of [0, 1] as const) {
      const gp = this.input.xr.gamepads[HANDS[hand]];
      const pressed = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      const down = pressed && !this.triggerWas[hand];
      this.triggerWas[hand] = pressed;
      if (!down) continue;
      if (this.hoverSlot < 0 || this.myShields[this.hoverSlot]) {
        sfx.denied();
        return;
      }
      if (!spendDrops(DUEL.shieldCost)) {
        sfx.denied();
        build.placing = null;
        this.hideSlotGhosts();
        return;
      }
      this.myShields[this.hoverSlot] = this.buildPanel(this.hoverSlot, z, true);
      sfx.placeTower();
      pulseHand(this.world.session, HANDS[hand], 0.5, 60);
      // Chain while there's an empty slot and the minerals for it.
      const empty = this.myShields.some((p) => !p);
      if (!empty || bank.drops < DUEL.shieldCost) {
        build.placing = null;
        this.hideSlotGhosts();
      }
      return;
    }
  }

  private hideSlotGhosts(): void {
    for (const g of this.slotGhosts) g.visible = false;
  }

  // --- Turrets. ------------------------------------------------------------

  private ghost?: Group;

  private buildTurret(mineSide: boolean): DuelTurret {
    const { assets, matWhite, matRed } = sharedTurretAssets();
    const a = assets.sprinkler;
    const g = new Group();
    g.add(new Mesh(a.shell, matWhite));
    g.add(new Mesh(a.accent, mineSide ? matRed : matViolet));
    const head = new Group();
    head.position.y = a.headY;
    if (a.headShell) head.add(new Mesh(a.headShell, matWhite));
    if (a.headAccent) head.add(new Mesh(a.headAccent, mineSide ? matRed : matViolet));
    g.add(head);
    this.root.add(g);
    return { group: g, head, cooldown: 1, hp: mineSide ? Infinity : 150 };
  }

  private updateTurretPlacing(): void {
    if (!this.ghost) {
      const { assets, matGhost } = sharedTurretAssets();
      const a = assets.sprinkler;
      this.ghost = new Group();
      this.ghost.add(new Mesh(a.shell, matGhost), new Mesh(a.accent, matGhost));
      if (a.headShell) this.ghost.add(new Mesh(a.headShell, matGhost).translateY(a.headY));
      this.root.add(this.ghost);
    }
    placementSpot(this.world, _spot);
    // Your turrets live on YOUR deck.
    _spot.x = Math.max(-DUEL.platformW / 2 + 0.2, Math.min(DUEL.platformW / 2 - 0.2, _spot.x));
    _spot.z = Math.max(this.myShieldZ() + 0.35, Math.min(DUEL.platformD / 2 - 0.3, _spot.z));
    this.ghost.position.copy(_spot).setY(0.06);

    for (const hand of [0, 1] as const) {
      const gp = this.input.xr.gamepads[HANDS[hand]];
      const pressed = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      const down = pressed && !this.triggerWas[hand];
      this.triggerWas[hand] = pressed;
      if (!down) continue;
      if (this.myTurrets.length >= DUEL.turretMax || !spendDrops(DUEL.turretCost)) {
        sfx.denied();
        build.placing = null;
        this.hideTurretGhost();
        return;
      }
      const turret = this.buildTurret(true);
      turret.group.position.copy(_spot).setY(0.06);
      this.myTurrets.push(turret);
      sfx.placeTower();
      dropletBurst(_pos.copy(_spot).setY(0.3), 8, 0.8);
      if (this.myTurrets.length >= DUEL.turretMax || bank.drops < DUEL.turretCost) {
        build.placing = null;
        this.hideTurretGhost();
      }
      return;
    }
  }

  private hideTurretGhost(): void {
    this.ghost?.removeFromParent();
    this.ghost = undefined;
  }

  private updateTurrets(delta: number): void {
    if (build.placing !== 'duelTurret') this.hideTurretGhost();

    // Yours: lob at the rival on a cadence, arcing like the Sprinkler.
    for (const t of this.myTurrets) {
      t.cooldown -= delta;
      const dx = this.avatar.position.x - t.group.position.x;
      const dz = this.avatar.position.z - t.group.position.z;
      t.head.rotation.y += (Math.atan2(-dx, -dz) - t.head.rotation.y) * Math.min(1, delta * 6);
      if (t.cooldown > 0 || this.avatarHp <= 0) continue;
      t.cooldown = 1 / DUEL.turretRate;
      t.head.getWorldPosition(_pos);
      _vel.copy(this.avatar.position).sub(_pos);
      const dist = _vel.length();
      _vel.normalize().multiplyScalar(DUEL.turretMuzzleSpeed);
      _vel.y += (2.0 * dist) / (2 * DUEL.turretMuzzleSpeed);
      squirtBlob(_pos, _vel);
      sfx.turretShot();
    }

    // The rival's: hostile lobs at YOU, dodgeable, poppable.
    for (const t of this.enemyTurrets) {
      if (t.hp <= 0) continue;
      t.cooldown -= delta;
      const dx = _head.x - t.group.position.x;
      const dz = _head.z - t.group.position.z;
      t.head.rotation.y += (Math.atan2(-dx, -dz) - t.head.rotation.y) * Math.min(1, delta * 5);
      if (t.cooldown > 0 || run.dead) continue;
      t.cooldown = DUEL.enemyTurretInterval * (0.85 + Math.random() * 0.3);
      t.head.getWorldPosition(_pos);
      _vel.copy(_head).sub(_pos);
      const dist = _vel.length();
      _vel.normalize().multiplyScalar(4.2);
      _vel.y += (2.6 * dist) / (2 * 4.2);
      _vel.x += (Math.random() - 0.5) * 0.5;
      enemyShot(_pos, _vel);
      sfx.enemyLob();
    }
  }

  // --- The rival. ----------------------------------------------------------

  private updateAvatar(delta: number): void {
    if (this.avatarHp <= 0) return;
    // Strafe + bob on its own deck; the lens tracks you.
    this.avatar.position.x = Math.sin(this.time * 0.55) * 1.0;
    this.avatar.position.y = 1.35 + Math.sin(this.time * 1.7) * 0.08;
    this.avatar.lookAt(_head.x, this.avatar.position.y, _head.z);
    // Lens mood: bright while stocked with juice, dim when dry, red when hurt.
    const hurt = 1 - this.avatarHp / DUEL.avatarHp;
    (this.avatarLens.material as MeshBasicMaterial).color.setRGB(
      0.8 + hurt * 0.2,
      0.74 * (1 - hurt),
      1 - hurt * 0.7,
    );

    this.avatarShotTimer -= delta;
    if (this.avatarShotTimer <= 0 && this.enemyShots > 0 && !run.dead) {
      this.avatarShotTimer = DUEL.avatarShotInterval * (0.8 + Math.random() * 0.4);
      this.enemyShots -= 1;
      _pos.copy(this.avatar.position);
      _pos.y -= 0.05;
      _vel.copy(_head).sub(_pos);
      const dist = _vel.length();
      _vel.normalize().multiplyScalar(4.4);
      _vel.y += (2.6 * dist) / (2 * 4.4);
      _vel.x += (Math.random() - 0.5) * 0.7;
      enemyShot(_pos, _vel);
      sfx.enemyLob();
    }
  }

  /** The rival's books: same price list, purchases appear on its deck. */
  private updateAI(delta: number): void {
    if (this.avatarHp <= 0) return;
    this.enemyMinerals +=
      (DUEL.aiIncomeBase + DUEL.aiIncomePerMiner * this.enemyMinerBots.length) * delta;
    this.aiAcc += delta;
    if (this.aiAcc < 0.6) return;
    this.aiAcc = 0;

    // Priorities: ammo, cover, guns, economy — a build order, basically.
    if (this.enemyShots <= 3 && this.enemyMinerals >= DUEL.juiceCost) {
      this.enemyMinerals -= DUEL.juiceCost;
      this.enemyShots += DUEL.aiShotsPerJuice;
      return;
    }
    const slot = this.enemyShields.findIndex(
      (p, i) => !p && this.time - this.enemyShieldBrokenAt[i] > 6,
    );
    if (slot >= 0 && this.enemyMinerals >= DUEL.shieldCost) {
      this.enemyMinerals -= DUEL.shieldCost;
      this.enemyShields[slot] = this.buildPanel(slot, this.enemyShieldZ(), false);
      return;
    }
    if (this.enemyTurrets.length < DUEL.turretMax && this.enemyMinerals >= DUEL.turretCost) {
      this.enemyMinerals -= DUEL.turretCost;
      const spots = [[-0.95, DUEL.enemyZ + 0.5], [0.95, DUEL.enemyZ + 0.5], [0, DUEL.enemyZ - 0.1]];
      const [x, z] = spots[this.enemyTurrets.length];
      const turret = this.buildTurret(false);
      turret.group.position.set(x, 0.06, z);
      const t = turret;
      t.target = {
        pos: turret.group.position,
        radius: 0.42,
        hitByHostile: false,
        alive: () => t.hp > 0,
        onHit: (damage, at) => {
          t.hp -= damage;
          popDamage(_pos.copy(at).setY(at.y + 0.2), damage, false, 0xffffff);
          if (t.hp <= 0) {
            dropletBurst(_pos.copy(t.group.position).setY(0.4), 18, 1.4);
            sfx.enemyPop();
            t.group.removeFromParent();
          }
          return true;
        },
      };
      addBallTarget(t.target);
      this.enemyTurrets.push(turret);
      return;
    }
    if (this.enemyMinerBots.length < DUEL.minerMax && this.enemyMinerals >= DUEL.minerCost) {
      this.enemyMinerals -= DUEL.minerCost;
      this.addEnemyMinerBot();
    }
  }

  private win(): void {
    if (this.over) return;
    this.over = true;
    dropletBurst(_pos.copy(this.avatar.position), 70, 2.6);
    sfx.towerDown();
    sfx.upgradePick();
    run.endReason = 'win';
    run.score += 1000;
    app.phase = 'gameover';
    this.world.getSystem(EnemySystem)?.setSign("THEY'RE SOAKED", '#f0299b');
  }

  // --- The duel shop. ------------------------------------------------------

  private showShop(): void {
    const shields = this.myShields.filter(Boolean).length;
    this.board.show(
      [
        {
          id: 'juice',
          title: 'JUICE',
          blurb: 'Both pistols full, plus one reserve tank',
          effectLine: `${DUEL.juiceCost} MINERALS`,
          footnote: `RESERVE ${duel.tanks}`,
          color: '#f0299b',
          scale: 0.85,
        },
        {
          id: 'miner',
          title: 'MINER',
          blurb: 'A drone that mines so you can keep shooting',
          effectLine: `${DUEL.minerCost} MINERALS`,
          footnote: `${this.miners.length}/${DUEL.minerMax}`,
          color: '#f5a94e',
          scale: 0.85,
        },
        {
          id: 'turret',
          title: 'TURRET',
          blurb: 'Auto-fire on your deck, aimed at THEM',
          effectLine: `${DUEL.turretCost} MINERALS EACH`,
          footnote: `${this.myTurrets.length}/${DUEL.turretMax}`,
          color: '#e0312e',
          scale: 0.85,
        },
        {
          id: 'shield',
          title: 'SHIELD',
          blurb: 'A front panel — four slots, two up two down',
          effectLine: `${DUEL.shieldCost} MINERALS EACH`,
          footnote: `${shields}/4`,
          color: '#63c4ff',
          scale: 0.85,
        },
      ],
      {
        y: SHOP.boardHeight,
        distance: SHOP.boardDistance,
        perRow: 4,
        canPick: (id) => {
          if (id === 'juice') return bank.drops >= DUEL.juiceCost;
          if (id === 'miner')
            return bank.drops >= DUEL.minerCost && this.miners.length < DUEL.minerMax;
          if (id === 'turret')
            return bank.drops >= DUEL.turretCost && this.myTurrets.length < DUEL.turretMax;
          return bank.drops >= DUEL.shieldCost && this.myShields.some((p) => !p);
        },
        onPick: (id) => this.purchase(id),
      },
    );
  }

  /** Buy by id — cards land here; public for the dev hooks. */
  purchase(id: string): void {
    if (id === 'juice') {
      if (!spendDrops(DUEL.juiceCost)) return;
      duel.tanks += 1;
      this.world.getSystem(WeaponSystem)?.refillAll(1);
      sfx.refund();
      return;
    }
    if (id === 'miner') {
      if (this.miners.length >= DUEL.minerMax || !spendDrops(DUEL.minerCost)) return;
      sfx.buy();
      this.addMiner();
      return;
    }
    if (id === 'turret') {
      if (this.myTurrets.length >= DUEL.turretMax || bank.drops < DUEL.turretCost) return;
      sfx.buy();
      build.placing = 'duelTurret';
      // The trigger that shot the card may still be held — force a fresh
      // press before anything plants.
      this.triggerWas = [true, true];
      return;
    }
    if (id === 'shield') {
      if (!this.myShields.some((p) => !p) || bank.drops < DUEL.shieldCost) return;
      sfx.buy();
      build.placing = 'shield';
      this.triggerWas = [true, true];
    }
  }

  /** Dev hooks. */
  state(): Record<string, unknown> {
    return {
      minerals: bank.drops,
      tanks: duel.tanks,
      miners: this.miners.length,
      turrets: this.myTurrets.length,
      shields: this.myShields.map((p) => (p ? Math.round(p.hp) : 0)),
      avatarHp: Math.round(this.avatarHp),
      enemy: {
        minerals: Math.round(this.enemyMinerals),
        shots: this.enemyShots,
        miners: this.enemyMinerBots.length,
        turrets: this.enemyTurrets.filter((t) => t.hp > 0).length,
        shields: this.enemyShields.map((p) => (p ? Math.round(p.hp) : 0)),
      },
    };
  }
}
