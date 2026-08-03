/**
 * THE GREAT SPLASH campaign director.
 *
 * EVERY stop — route fight or boss — is fought the same way: you stand on
 * the Blaston-sized pad with your six chosen tools racked in sockets around
 * its edge (no hip pistols, no tower), and the enemy comes to you. Route
 * stops send Splash's instanced swarm through the portal; boss stops summon
 * the real GOOPLIATH gel creature, driven by the readable attack language
 * from FIRE FIGHT: charged floor zones, re-hits, marching slams, late-lock
 * beams, crouch sweeps, volleys, alternating half-pad floods and the final
 * safe-wedge nova. Route fights are rehearsal — the same geography of
 * weapons under pressure, before the boss tests it.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  TorusGeometry,
} from 'three';
import { glossyPlastic, mattePlastic } from '../materials/plastic.js';
import { CampaignMap } from '../ui/campaignMap.js';
import {
  CAMPAIGN_NODES,
  campaignProgress,
  campaignRuntime,
  clearCampaignNode,
  nodeCleared,
  nodeIndex,
  nodeUnlocked,
  saveCampaignLoadout,
  type BossAttackKind,
  type CampaignNode,
  type GoopliathEncounter,
} from '../campaign/campaignState.js';
import {
  beamTelegraph,
  circleTelegraph,
  halfTelegraph,
  novaTelegraph,
  sweepTelegraph,
  volleyTelegraph,
  type Telegraph,
} from '../campaign/telegraphs.js';
import { bossForm, type BossVisualProfile } from '../campaign/bossForms.js';
import { GelCreature } from '../goopliath/GelCreature.js';
import { ATTACKS, type AttackName } from '../goopliath/goopConfig.js';
import { GooFx } from '../goopliath/splats.js';
import { app } from '../game/appState.js';
import { resetRunWithStacks, run, damagePlayer } from '../game/run.js';
import { tower } from '../game/tower.js';
import { resetBank } from '../game/shop.js';
import { addBallTarget, clearBallTargets, removeBallTarget, type BallTarget } from '../combat/targets.js';
import { enemyShot } from '../combat/juiceBus.js';
import { dropletBurst } from '../fx/juice.js';
import { popDamage } from '../fx/damageNumbers.js';
import { crispTexture, logicalCanvas } from '../ui/crispCanvas.js';
import { CAMPAIGN, ENEMY_SHOT, PALETTE, PISTOL } from '../config.js';
import { EnemySystem, upgradeGate } from './EnemySystem.js';
import { TurretSystem } from './TurretSystem.js';
import { WeaponSystem } from './WeaponSystem.js';
import * as sfx from '../audio/sfx.js';

type DirectorPhase = 'idle' | 'swarm' | 'intro' | 'boss' | 'victory' | 'reward';

type CircleZone = { kind: 'circle'; x: number; z: number; r: number };
type BeamZone = { kind: 'beam'; x: number; z: number; dx: number; dz: number; halfW: number; length: number };
type SweepZone = { kind: 'sweep'; bladeY: number };
type ShotZone = { kind: 'shot'; side: -1 | 1 };
type NovaZone = { kind: 'nova'; angle: number; halfAngle: number };
type HalfZone = { kind: 'half'; side: -1 | 1; axis: 0 | 1 };
type BossZone = CircleZone | BeamZone | SweepZone | ShotZone | NovaZone | HalfZone;

interface AttackBeat {
  zone: BossZone;
  start: number;
  due: number;
  telegraph: Telegraph | null;
  resolved: boolean;
}

interface ActiveAttack {
  kind: BossAttackKind;
  time: number;
  beats: AttackBeat[];
  charge: number;
  doneAt: number;
  tracks: boolean;
}

const _head = new Vector3();
const _forward = new Vector3();
const _point = new Vector3();
const _point2 = new Vector3();
const _vel = new Vector3();
const _rel = new Vector3();
const _localHead = new Vector3();

const HUD_W = 1024;
const HUD_H = 260;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function angleDelta(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
}

function hexCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function attackCue(kind: BossAttackKind): string {
  switch (kind) {
    case 'slam': return 'SLAM';
    case 'sweep': return 'DUCK';
    case 'beam': return 'TRACKING BEAM';
    case 'volley': return 'VOLLEY';
    case 'nova': return 'SAFE WEDGE';
    case 'seesaw': return 'CROSS THE LINE';
  }
}

function gestureFor(kind: BossAttackKind): AttackName {
  switch (kind) {
    case 'slam': return 'overhand';
    case 'sweep': return 'backfist';
    case 'beam': return 'cross';
    case 'volley': return 'jab';
    case 'nova': return 'uppercut';
    case 'seesaw': return 'clap';
  }
}

export class CampaignSystem extends createSystem({}) {
  private map!: CampaignMap;
  private phase: DirectorPhase = 'idle';
  private node: CampaignNode | null = null;
  private firstClear = false;
  private time = 0;

  // Boss arena basis. +forward points from the player pad to GOOPLIATH.
  private arena = new Group();
  /** Lane + boss pool + boss rim — shown only when GOOPLIATH is out. */
  private bossDressing: Mesh[] = [];
  private arenaCenter = new Vector3();
  private bossPos = new Vector3();
  private forward = new Vector3(0, 0, -1);
  private right = new Vector3(1, 0, 0);
  private arenaYaw = 0;

  private goopFx: GooFx | null = null;
  private goop: GelCreature | null = null;
  private goopRoot: Group | null = null;
  private bossVisual: BossVisualProfile | null = null;
  private arenaRimMat!: MeshBasicMaterial;
  private arenaLaneMat!: MeshBasicMaterial;
  private bossPoolMat!: MeshBasicMaterial;
  private bossRimMat!: MeshBasicMaterial;
  private bossHitPos = new Vector3();
  private bossTarget: BallTarget | null = null;
  private bossDef: GoopliathEncounter | null = null;
  private bossHealth = 0;
  private bossMaxHealth = 1;
  private introTimer = 0;
  private victoryTimer = 0;
  private cooldown = 0;
  private invulnerable = 0;
  private enraged = false;
  private activeAttack: ActiveAttack | null = null;
  private lastAttack: BossAttackKind | null = null;
  private attackSerial = 0;

  private hud!: Mesh;
  private hudCanvas = document.createElement('canvas');
  private hudTexture!: CanvasTexture;
  private hudCue = '';
  private hudTimer = 0;

  init(): void {
    this.map = new CampaignMap(
      this.world.scene,
      (id) => this.startNode(id),
      () => this.leaveCampaign(),
    );
    this.buildArena();
    this.buildHud();
  }

  update(delta: number): void {
    this.time += delta;

    if (app.mode !== 'campaign') {
      if (this.map.active) this.map.hide();
      return;
    }

    this.world.camera.getWorldPosition(_head);
    if (app.phase === 'map') {
      if (!this.map.active) this.map.show();
      this.map.update(delta, _head);
      return;
    }
    if (this.map.active) this.map.hide();

    if (this.phase === 'swarm') {
      if (app.phase === 'playing' && this.world.getSystem(EnemySystem)?.takeCampaignVictory()) {
        this.completeNode();
      }
      return;
    }

    if (!this.goop || !this.goopRoot || !this.bossDef) return;
    this.updateGoop(delta);

    if (app.phase !== 'playing') {
      this.disposeAttack();
      return;
    }

    if (this.phase === 'intro') {
      this.introTimer -= delta;
      const elapsed = CAMPAIGN.introTime - this.introTimer;
      if (elapsed > 0.45) this.goop.setFormTarget(1);
      if (this.introTimer <= 0) {
        this.phase = 'boss';
        this.cooldown = 1.1;
        this.hudCue = 'FIGHT';
        this.drawHud();
        sfx.waveHorn();
      }
      return;
    }

    if (this.phase === 'victory') {
      this.victoryTimer -= delta;
      if (this.victoryTimer <= 0) this.completeNode();
      return;
    }
    if (this.phase !== 'boss') return;

    this.invulnerable = Math.max(0, this.invulnerable - delta);
    if (this.activeAttack) this.advanceAttack(delta);
    else {
      this.cooldown -= delta;
      if (this.cooldown <= 0) this.startAttack();
    }
  }

  /** Enter or return to the saved campaign route. */
  openMap(): void {
    this.teardownBoss();
    tower.placed = false;
    campaignRuntime.activeNode = null;
    campaignRuntime.firstClear = false;
    resetRunWithStacks(campaignProgress.stacks);
    this.phase = 'idle';
    this.node = null;
    app.mode = 'campaign';
    app.phase = 'map';
    this.map.show();
  }

  /** The game-over board calls this without discarding the earned loadout. */
  retryCurrent(): void {
    if (this.node) this.startNode(this.node.id);
    else this.openMap();
  }

  /** Leave the route for the ordinary three-mode title. */
  leaveCampaign(): void {
    this.map.hide();
    this.teardownBoss();
    tower.placed = false;
    this.phase = 'idle';
    this.node = null;
    app.phase = 'title';
  }

  /** Dev hook and map click entry. */
  startNode(id: string): void {
    const index = nodeIndex(id);
    const node = CAMPAIGN_NODES[index];
    if (!node || !nodeUnlocked(index)) return;

    this.map.hide();
    this.teardownBoss();
    clearBallTargets();
    resetBank();
    this.world.getSystem(TurretSystem)?.resetField();
    resetRunWithStacks(campaignProgress.stacks);
    run.wave = index + 1;

    this.node = node;
    this.firstClear = !nodeCleared(node.id);
    campaignRuntime.activeNode = node;
    campaignRuntime.firstClear = this.firstClear;
    app.mode = 'campaign';
    app.phase = 'playing';

    if (node.swarm) this.startSwarm(node);
    else if (node.boss) this.startBoss(node, node.boss);
  }

  /** Lightweight state for smoke tests and the browser console. */
  state(): Record<string, unknown> {
    return {
      phase: this.phase,
      node: this.node?.id ?? null,
      cleared: [...campaignProgress.cleared],
      bossHealth: Math.round(this.bossHealth),
      bossMaxHealth: Math.round(this.bossMaxHealth),
      attack: this.activeAttack?.kind ?? null,
      stacks: { ...run.stacks },
    };
  }

  /** Dev hook: resolve the live boss without manufacturing projectiles. */
  damageBoss(amount = 400): number {
    if (this.phase !== 'boss') return this.bossHealth;
    this.applyBossDamage(amount, this.bossHitPos);
    return this.bossHealth;
  }

  // --- Map encounters ------------------------------------------------------

  private startSwarm(node: CampaignNode): void {
    const spec = node.swarm!;
    this.world.camera.getWorldPosition(_head);
    this.world.camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() < 1e-4) _forward.set(0, 0, -1);
    _forward.normalize();

    // No tower on a campaign route — THE THIRST comes straight for YOU.
    // tower.pos survives only as the field/portal anchor ahead of you.
    tower.pos.copy(_head).addScaledVector(_forward, 1.7).setY(0);
    tower.placed = false;

    // The pad appears underfoot for every stop, boss dressing off.
    this.forward.copy(_forward);
    this.right.set(-this.forward.z, 0, this.forward.x).normalize();
    this.arenaCenter.set(_head.x, 0, _head.z);
    this.arenaYaw = Math.atan2(-_forward.x, -_forward.z);
    this.arena.position.copy(this.arenaCenter);
    this.arena.rotation.y = this.arenaYaw;
    this.arena.visible = true;
    for (const d of this.bossDressing) d.visible = false;

    // Route fights are rehearsal for the boss, so they're fought the same
    // way: your six chosen tools stand in their sockets around the pad
    // instead of two Raptors on your hips. Reach, draw, fire, throw the
    // spent one away and grab the next — the loadout IS the ammo economy,
    // and you learn its geography before GOOPLIATH tests it.
    this.world.getSystem(WeaponSystem)?.activateBossLoadout(
      this.arenaCenter,
      this.forward,
      this.right,
      CAMPAIGN.padRadius,
    );

    this.phase = 'swarm';
    this.world.getSystem(EnemySystem)?.startCampaignEncounter(spec);
    this.world.getSystem(WeaponSystem)?.refillAll(1);
  }

  private completeNode(): void {
    if (!this.node || this.phase === 'reward') return;
    const first = clearCampaignNode(this.node.id);
    this.firstClear = first;
    campaignRuntime.firstClear = first;
    tower.placed = false;
    this.teardownBoss();

    if (!first) {
      this.openMap();
      return;
    }

    this.phase = 'reward';
    upgradeGate.afterPick = () => {
      saveCampaignLoadout(run.stacks);
      this.openMap();
    };
    upgradeGate.pending = true;
  }

  // --- Boss construction ---------------------------------------------------

  private buildArena(): void {
    // THE PAD — always under your feet on a campaign stop, FIRE FIGHT
    // style: a solid glossy octagon slab sunk to floor level with a matte
    // aqua skirt and rim tube. Solid on purpose: its top face rides above
    // the splat decals, so paint can never bury the platform you stand on.
    const slabGeo = new CylinderGeometry(CAMPAIGN.padRadius, CAMPAIGN.padRadius * 0.94, 0.09, 8);
    slabGeo.rotateY(Math.PI / 8); // line the facets up with the glow octagon
    const slab = new Mesh(slabGeo, glossyPlastic(PALETTE.deckWhite, 0.35));
    slab.position.y = -0.022; // top face at y 0.023 — above every splat
    this.arena.add(slab);
    const skirtGeo = new CylinderGeometry(CAMPAIGN.padRadius * 0.94, CAMPAIGN.padRadius * 0.84, 0.08, 8);
    skirtGeo.rotateY(Math.PI / 8);
    const skirt = new Mesh(skirtGeo, mattePlastic(PALETTE.water));
    skirt.position.y = -0.1;
    this.arena.add(skirt);
    const tube = new Mesh(
      new TorusGeometry(CAMPAIGN.padRadius * 0.985, 0.035, 14, 48),
      glossyPlastic(PALETTE.deckAqua, 0.22),
    );
    tube.rotation.x = Math.PI / 2;
    tube.position.y = 0.023;
    this.arena.add(tube);

    const floor = new Mesh(
      new CircleGeometry(CAMPAIGN.padRadius, 8, Math.PI / 8),
      new MeshBasicMaterial({ color: 0xe9fbff, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.028;
    this.arena.add(floor);

    this.arenaRimMat = new MeshBasicMaterial({ color: 0x48d9e8, transparent: true, opacity: 0.88, depthWrite: false });
    const rim = new Mesh(
      new RingGeometry(CAMPAIGN.padRadius * 0.94, CAMPAIGN.padRadius, 8, 1, Math.PI / 8),
      this.arenaRimMat,
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.03;
    this.arena.add(rim);

    this.arenaLaneMat = new MeshBasicMaterial({ color: 0x8ce8ef, transparent: true, opacity: 0.16, depthWrite: false });
    const lane = new Mesh(
      new PlaneGeometry(0.16, CAMPAIGN.bossDistance - 0.8),
      this.arenaLaneMat,
    );
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.008, -CAMPAIGN.bossDistance / 2);
    this.arena.add(lane);
    this.bossDressing.push(lane);

    this.bossPoolMat = new MeshBasicMaterial({ color: 0x3ee46b, transparent: true, opacity: 0.2, depthWrite: false });
    const bossPool = new Mesh(
      new CircleGeometry(0.88, 56),
      this.bossPoolMat,
    );
    bossPool.rotation.x = -Math.PI / 2;
    bossPool.position.set(0, 0.008, -CAMPAIGN.bossDistance);
    this.arena.add(bossPool);
    this.bossDressing.push(bossPool);

    this.bossRimMat = new MeshBasicMaterial({ color: 0x65ff87, transparent: true, opacity: 0.72, depthWrite: false });
    const bossRim = new Mesh(
      new RingGeometry(0.86, 0.94, 56),
      this.bossRimMat,
    );
    bossRim.rotation.x = -Math.PI / 2;
    bossRim.position.set(0, 0.014, -CAMPAIGN.bossDistance);
    this.arena.add(bossRim);
    this.bossDressing.push(bossRim);

    this.arena.visible = false;
    this.world.scene.add(this.arena);
  }

  private buildHud(): void {
    logicalCanvas(this.hudCanvas, HUD_W, HUD_H);
    this.hudTexture = crispTexture(this.hudCanvas);
    this.hud = new Mesh(
      new PlaneGeometry(1.9, 0.48),
      new MeshBasicMaterial({ map: this.hudTexture, transparent: true, depthTest: false }),
    );
    this.hud.renderOrder = 900;
    this.hud.visible = false;
    this.world.scene.add(this.hud);
  }

  private startBoss(node: CampaignNode, def: GoopliathEncounter): void {
    this.world.getSystem(EnemySystem)?.resetFight();
    tower.placed = false;

    this.world.camera.getWorldPosition(_head);
    this.world.camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() < 1e-4) _forward.set(0, 0, -1);
    _forward.normalize();
    this.forward.copy(_forward);
    this.right.set(-this.forward.z, 0, this.forward.x).normalize();
    this.arenaCenter.set(_head.x, 0, _head.z);
    this.bossPos.copy(this.arenaCenter).addScaledVector(this.forward, CAMPAIGN.bossDistance);
    this.arenaYaw = Math.atan2(-this.forward.x, -this.forward.z);
    this.arena.position.copy(this.arenaCenter);
    this.arena.rotation.y = this.arenaYaw;
    this.arena.visible = true;
    for (const d of this.bossDressing) d.visible = true;
    const visual = bossForm(def.form);
    this.bossVisual = visual;
    this.arenaRimMat.color.set(visual.arenaColor);
    this.arenaLaneMat.color.set(visual.arenaBright);
    this.bossPoolMat.color.set(visual.arenaColor);
    this.bossRimMat.color.set(visual.arenaBright);
    this.world.getSystem(WeaponSystem)?.activateBossLoadout(
      this.arenaCenter,
      this.forward,
      this.right,
      CAMPAIGN.padRadius,
    );

    this.goopFx = new GooFx(visual.fx);
    this.world.scene.add(this.goopFx.group);
    this.goop = new GelCreature(this.goopFx);
    this.goop.setVisualLook(visual.gel, visual.eyeScale, visual.eyeSpread);
    this.goop.setFightStyle(visual.pose);
    this.goop.qualityOverride = CAMPAIGN.goopQuality;
    this.goop.sim.impactScale = CAMPAIGN.goopImpactScale;
    this.goopRoot = new Group();
    this.goopRoot.position.copy(this.bossPos);
    this.goopRoot.scale.set(
      def.scale * visual.rootScale[0],
      def.scale * visual.rootScale[1],
      def.scale * visual.rootScale[2],
    );
    this.goopRoot.add(this.goop.group);
    this.world.scene.add(this.goopRoot);

    this.bossDef = def;
    this.bossMaxHealth = def.health;
    this.bossHealth = def.health;
    const formHeight = def.scale * visual.rootScale[1];
    const formRadius = def.scale * Math.max(...visual.rootScale);
    this.bossHitPos.copy(this.bossPos).setY(formHeight * 0.95);
    this.enraged = false;
    this.invulnerable = 0;
    this.activeAttack = null;
    this.lastAttack = null;
    this.attackSerial = 0;
    this.phase = 'intro';
    this.introTimer = CAMPAIGN.introTime;
    this.hudCue = node.subtitle;
    campaignRuntime.bossHealth = this.bossHealth;
    campaignRuntime.bossMaxHealth = this.bossMaxHealth;

    this.bossTarget = {
      pos: this.bossHitPos,
      radius: formRadius * 1.18,
      hitByHostile: false,
      alive: () => this.phase === 'boss' && this.bossHealth > 0,
      onHit: (damage, at) => this.hitGoop(damage, at),
    };
    addBallTarget(this.bossTarget);

    this.hud.position.copy(this.bossPos).setY(formHeight * 1.82 + 0.55);
    this.hud.visible = true;
    this.drawHud();
    this.world.getSystem(WeaponSystem)?.refillAll(1);
    sfx.gooRise();
  }

  private teardownBoss(): void {
    this.disposeAttack();
    this.world.getSystem(WeaponSystem)?.deactivateBossLoadout();
    if (this.bossTarget) removeBallTarget(this.bossTarget);
    this.bossTarget = null;
    this.goop?.dispose();
    this.goop = null;
    this.goopFx?.dispose();
    this.goopFx = null;
    this.goopRoot?.removeFromParent();
    this.goopRoot = null;
    this.bossDef = null;
    this.bossVisual = null;
    this.arena.visible = false;
    this.hud.visible = false;
    campaignRuntime.bossHealth = 0;
    campaignRuntime.bossMaxHealth = 0;
  }

  private updateGoop(delta: number): void {
    const goop = this.goop!;
    const root = this.goopRoot!;
    this.world.camera.getWorldPosition(_head);
    this.goopFx?.update(delta);

    // GelCreature owns its yaw inside a non-uniformly scaled parent. A real
    // matrix conversion keeps the look target honest for squat / tall forms.
    root.updateMatrixWorld();
    _localHead.copy(_head);
    root.worldToLocal(_localHead);
    goop.faceToward(_localHead);
    goop.qualityOverride = goop.isPunching ? CAMPAIGN.goopAttackQuality : CAMPAIGN.goopQuality;
    goop.enrage += ((this.enraged ? 1 : 0) - goop.enrage) * Math.min(1, delta * 2.2);
    goop.update(delta * CAMPAIGN.goopTimeScale, _head);

    this.hud.lookAt(_head.x, this.hud.position.y, _head.z);
    this.hudTimer -= delta;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08;
      this.drawHud();
    }
  }

  private hitGoop(damage: number, at: Vector3): boolean {
    const goop = this.goop;
    const root = this.goopRoot;
    if (!goop || !root || this.phase !== 'boss') return false;
    // fieldAtWorld returns native creature metres after the scaled parent is
    // inverted, so the ball skin must be converted by the same scale.
    const minScale = Math.max(0.01, Math.min(Math.abs(root.scale.x), Math.abs(root.scale.y), Math.abs(root.scale.z)));
    const skin = PISTOL.blobRadius / minScale + 0.045;
    if (goop.fieldAtWorld(at) > skin) return false;

    this.world.camera.getWorldPosition(_head);
    _vel.copy(at).sub(_head);
    if (_vel.lengthSq() < 1e-4) _vel.copy(this.forward);
    _vel.normalize();
    const reaction = goop.receivePunchWorld(at, _vel, 3.6);
    this.goopFx?.flash(at, this.bossVisual?.fx.bright ?? 0x8cff96, 0.55 + reaction.strength * 0.7);
    this.goopFx?.burst(at, _vel.multiplyScalar(-1).setY(0.7).normalize(), 4, 2.5);
    dropletBurst(at, 9, 1.15);
    sfx.hitSplat();
    this.applyBossDamage(damage, at);
    return true;
  }

  private applyBossDamage(amount: number, at: Vector3): void {
    if (this.phase !== 'boss' || this.bossHealth <= 0) return;
    const dealt = Math.max(1, Math.round(amount));
    this.bossHealth = Math.max(0, this.bossHealth - dealt);
    campaignRuntime.bossHealth = this.bossHealth;
    popDamage(_point.copy(at).addScaledVector(this.right, 0.12), dealt, dealt >= 100, 0xffffff);
    run.score += dealt;
    this.hudTimer = 0;

    const frac = this.bossHealth / this.bossMaxHealth;
    if (!this.enraged && this.bossDef && this.bossDef.enrageAt > 0 && frac <= this.bossDef.enrageAt) {
      this.enraged = true;
      this.hudCue = 'THE TIDE RISES';
      sfx.enemyPop();
    }
    if (this.bossHealth <= 0) this.beginVictory();
  }

  private beginVictory(): void {
    if (this.phase !== 'boss') return;
    this.phase = 'victory';
    this.disposeAttack();
    this.goop?.setKo(true);
    this.victoryTimer = CAMPAIGN.victoryTime;
    this.hudCue = 'TIDE BROKEN';
    this.drawHud();
    sfx.enemyPop();
  }

  // --- Boss attacks --------------------------------------------------------

  private startAttack(): void {
    const def = this.bossDef;
    const goop = this.goop;
    if (!def || !goop || def.attacks.length === 0) return;

    let kind = def.attacks[Math.floor(Math.random() * def.attacks.length)];
    if (def.attacks.length > 1 && kind === this.lastAttack) {
      kind = def.attacks[(def.attacks.indexOf(kind) + 1 + Math.floor(Math.random() * (def.attacks.length - 1))) % def.attacks.length];
    }
    this.lastAttack = kind;
    this.attackSerial += 1;
    const charge = def.charge;
    const beats: AttackBeat[] = [];

    if (kind === 'slam') this.buildSlam(beats, charge, def);
    else if (kind === 'beam') this.buildBeam(beats, charge);
    else if (kind === 'sweep') this.buildSweep(beats, charge);
    else if (kind === 'volley') this.buildVolley(beats, charge);
    else if (kind === 'nova') this.buildNova(beats, charge);
    else this.buildSeesaw(beats, charge);

    const lastDue = beats.reduce((m, b) => Math.max(m, b.due), charge);
    this.activeAttack = {
      kind,
      time: 0,
      beats,
      charge,
      doneAt: lastDue + 0.45,
      tracks: kind === 'beam' && def.trackingBeam,
    };
    this.hudCue = attackCue(kind);
    this.drawHud();

    const gesture = gestureFor(kind);
    goop.tempoScale = Math.max(0.42, (charge * CAMPAIGN.goopTimeScale) / ATTACKS[gesture].telegraph);
    this.world.camera.getWorldPosition(_head);
    goop.throwAttack(gesture, Math.random() < 0.5 ? 'left' : 'right', _head);
    sfx.enemyWindup();
  }

  private buildSlam(beats: AttackBeat[], charge: number, def: GoopliathEncounter): void {
    this.world.camera.getWorldPosition(_head);
    _point.set(_head.x, CAMPAIGN.decalY, _head.z);
    this.clampToPad(_point);
    const add = (p: Vector3, start: number, due: number): void => {
      const tg = circleTelegraph(CAMPAIGN.slamRadius, this.bossVisual?.telegraph);
      tg.group.position.set(p.x, CAMPAIGN.decalY, p.z);
      this.world.scene.add(tg.group);
      beats.push({
        zone: { kind: 'circle', x: p.x, z: p.z, r: CAMPAIGN.slamRadius },
        start, due, telegraph: tg, resolved: false,
      });
    };

    if (def.slamPattern === 'rehit') {
      add(_point, 0, charge);
      add(_point, charge + 0.08, charge + 0.86);
      return;
    }
    if (def.slamPattern === 'march') {
      const count = Math.max(2, def.slamCount);
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * 0.54;
        _point2.copy(_point).addScaledVector(this.right, offset);
        this.clampToPad(_point2);
        add(_point2, i * 0.22, charge + i * 0.52);
      }
      return;
    }
    add(_point, 0, charge);
  }

  private buildBeam(beats: AttackBeat[], charge: number): void {
    const zone: BeamZone = {
      kind: 'beam', x: this.bossPos.x, z: this.bossPos.z,
      dx: -this.forward.x, dz: -this.forward.z,
      halfW: CAMPAIGN.beamHalfWidth, length: CAMPAIGN.bossDistance + 2.2,
    };
    const tg = beamTelegraph(zone.halfW, zone.length, this.bossVisual?.telegraph);
    this.world.scene.add(tg.group);
    const beat = { zone, start: 0, due: charge, telegraph: tg, resolved: false };
    beats.push(beat);
    this.aimBeam(beat);
  }

  private buildSweep(beats: AttackBeat[], charge: number): void {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const tg = sweepTelegraph(
      CAMPAIGN.padRadius * 2.15,
      CAMPAIGN.padDepth,
      CAMPAIGN.sweepHeight,
      CAMPAIGN.sweepThickness,
      dir as -1 | 1,
      this.bossVisual?.telegraph,
    );
    tg.group.position.copy(this.arenaCenter);
    tg.group.rotation.y = this.arenaYaw;
    this.world.scene.add(tg.group);
    beats.push({
      zone: { kind: 'sweep', bladeY: CAMPAIGN.sweepHeight },
      start: 0, due: charge, telegraph: tg, resolved: false,
    });
  }

  private buildVolley(beats: AttackBeat[], charge: number): void {
    const goop = this.goop;
    const def = this.bossDef;
    if (!goop || !def) return;
    goop.headWorld(_point);
    const xScale = this.bossVisual?.rootScale[0] ?? 1;
    for (let i = 0; i < CAMPAIGN.volleyCount; i++) {
      const side = (i % 2 === 0 ? -1 : 1) as -1 | 1;
      const due = charge + i * CAMPAIGN.volleyInterval;
      const tg = volleyTelegraph(0.15 * def.scale, this.bossVisual?.telegraph);
      tg.group.position.copy(_point)
        .addScaledVector(this.right, side * 0.32 * def.scale * xScale);
      tg.group.position.y += ((i % 3) - 1) * 0.085 * def.scale;
      tg.group.visible = false;
      this.world.scene.add(tg.group);
      beats.push({
        zone: { kind: 'shot', side },
        // Each seed condenses shortly before its own release, so the player
        // can count the volley rather than seeing four overlapping timers.
        start: Math.max(0, due - charge * 0.48),
        due,
        telegraph: tg,
        resolved: false,
      });
    }
  }

  private buildNova(beats: AttackBeat[], charge: number): void {
    const local = (Math.floor(Math.random() * 6) / 6) * Math.PI * 2;
    _point.copy(this.right).multiplyScalar(Math.cos(local)).addScaledVector(this.forward, Math.sin(local));
    const angle = Math.atan2(_point.x, _point.z);
    const halfAngle = this.enraged ? CAMPAIGN.novaHalfAngle * 0.82 : CAMPAIGN.novaHalfAngle;
    const tg = novaTelegraph(CAMPAIGN.padRadius, angle, halfAngle, this.bossVisual?.telegraph);
    tg.group.position.copy(this.arenaCenter).setY(CAMPAIGN.decalY);
    this.world.scene.add(tg.group);
    beats.push({
      zone: { kind: 'nova', angle, halfAngle },
      start: 0, due: charge * 1.45, telegraph: tg, resolved: false,
    });
  }

  private buildSeesaw(beats: AttackBeat[], charge: number): void {
    const frac = this.bossHealth / this.bossMaxHealth;
    const count = 2 + Math.floor((1 - frac) * 3.8);
    const first = Math.random() < 0.5 ? -1 : 1;
    const axis: 0 | 1 = this.attackSerial % 3 === 0 ? 1 : 0;
    for (let i = 0; i < count; i++) {
      const side = (i % 2 === 0 ? first : -first) as -1 | 1;
      const due = charge + i * CAMPAIGN.seesawGap;
      const start = Math.max(0, due - charge * 0.82);
      const tg = halfTelegraph(side, CAMPAIGN.padRadius, CAMPAIGN.padDepth, this.bossVisual?.telegraph);
      tg.group.position.copy(this.arenaCenter).setY(CAMPAIGN.decalY);
      tg.group.rotation.y = this.arenaYaw + (axis === 1 ? Math.PI / 2 : 0);
      this.world.scene.add(tg.group);
      beats.push({ zone: { kind: 'half', side, axis }, start, due, telegraph: tg, resolved: false });
    }
  }

  private advanceAttack(delta: number): void {
    const attack = this.activeAttack!;
    attack.time += delta;

    if (attack.tracks && attack.time < attack.charge * CAMPAIGN.beamLockAt) {
      const beat = attack.beats.find((b) => b.zone.kind === 'beam');
      if (beat) this.aimBeam(beat);
    }

    for (const beat of attack.beats) {
      if (beat.resolved) continue;
      if (attack.time < beat.start) {
        if (beat.telegraph) beat.telegraph.group.visible = false;
        continue;
      }
      if (beat.telegraph) {
        beat.telegraph.group.visible = true;
        beat.telegraph.update(clamp((attack.time - beat.start) / Math.max(0.01, beat.due - beat.start), 0, 1), this.time);
      }
      if (attack.time < beat.due) continue;
      beat.resolved = true;
      beat.telegraph?.dispose();
      beat.telegraph = null;
      this.resolveBeat(beat.zone);
    }

    if (attack.time >= attack.doneAt) {
      this.disposeAttack();
      const def = this.bossDef!;
      const haste = this.enraged ? CAMPAIGN.enrageCooldownMult : 1;
      this.cooldown = rand(def.cooldown[0], def.cooldown[1]) * haste;
      this.hudCue = this.enraged ? 'THE TIDE RISES' : '';
      this.drawHud();
    }
  }

  private resolveBeat(zone: BossZone): void {
    if (zone.kind === 'shot') {
      this.launchVolley(zone.side);
      return;
    }

    this.world.camera.getWorldPosition(_head);
    const hit = this.zoneTouchesPlayer(zone);
    const danger = this.bossVisual?.telegraph.danger ?? 0xff3d45;
    if (zone.kind === 'circle') {
      _point.set(zone.x, 0.12, zone.z);
      dropletBurst(_point, 22, 1.8);
      this.goopFx?.flash(_point, danger, zone.r * 2.9);
      this.goopFx?.burst(_point, _vel.set(0, 1, 0), 18, 3.5);
      this.goopFx?.splat(_point, zone.r * 1.45);
      sfx.gooSlam();
    } else if (zone.kind === 'beam' || zone.kind === 'nova') {
      _point.copy(_head).setY(0.3);
      dropletBurst(_point, 18, 1.6);
      this.goopFx?.flash(_point, danger, zone.kind === 'nova' ? 1.45 : 0.9);
      this.goopFx?.burst(_point, _vel.set(0, 1, 0), zone.kind === 'nova' ? 28 : 16, 3.2);
      this.goopFx?.splat(_point, zone.kind === 'nova' ? 0.7 : 0.38);
      sfx.juiceBomb();
    } else if (zone.kind === 'half') {
      const axis = zone.axis === 0 ? this.right : this.forward;
      _point.copy(this.arenaCenter).addScaledVector(axis, zone.side * CAMPAIGN.padRadius * 0.55).setY(0.15);
      dropletBurst(_point, 26, 1.9);
      this.goopFx?.flash(_point, danger, CAMPAIGN.padRadius * 1.15);
      this.goopFx?.burst(_point, _vel.copy(axis).multiplyScalar(-zone.side).setY(0.8).normalize(), 24, 3.8);
      this.goopFx?.splat(_point, 0.62);
      sfx.gooSlam();
    } else {
      _point.copy(this.arenaCenter).setY(CAMPAIGN.sweepHeight);
      this.goopFx?.flash(_point, danger, CAMPAIGN.padRadius * 1.6);
      this.goopFx?.burst(_point, _vel.copy(this.right).setY(0.25).normalize(), 18, 4.2);
      sfx.spinWhoosh();
    }

    if (hit && this.invulnerable <= 0) {
      this.invulnerable = CAMPAIGN.invulnerable;
      if (damagePlayer(CAMPAIGN.attackDamage)) sfx.playerDown();
      else sfx.playerHurt();
    }
  }

  private zoneTouchesPlayer(zone: BossZone): boolean {
    this.world.camera.getWorldPosition(_head);
    if (zone.kind === 'circle') return Math.hypot(_head.x - zone.x, _head.z - zone.z) <= zone.r + 0.13;
    if (zone.kind === 'beam') {
      const rx = _head.x - zone.x;
      const rz = _head.z - zone.z;
      const along = rx * zone.dx + rz * zone.dz;
      const px = rx - along * zone.dx;
      const pz = rz - along * zone.dz;
      return along >= -0.3 && along <= zone.length && Math.hypot(px, pz) <= zone.halfW + 0.12;
    }
    if (zone.kind === 'sweep') {
      this.toArenaLocal(_head, _rel);
      const overPad = Math.abs(_rel.x) <= CAMPAIGN.padRadius + 0.15 && Math.abs(_rel.z) <= CAMPAIGN.padDepth * 0.6;
      return overPad && _head.y > zone.bladeY - CAMPAIGN.sweepThickness;
    }
    if (zone.kind === 'nova') {
      _rel.copy(_head).sub(this.arenaCenter);
      return angleDelta(Math.atan2(_rel.x, _rel.z), zone.angle) > zone.halfAngle;
    }
    if (zone.kind === 'half') {
      _rel.copy(_head).sub(this.arenaCenter);
      const axis = zone.axis === 0 ? this.right : this.forward;
      return _rel.dot(axis) * zone.side > -0.04;
    }
    return false;
  }

  private launchVolley(side: -1 | 1): void {
    const goop = this.goop;
    if (!goop) return;
    goop.headWorld(_point);
    const xScale = this.bossVisual?.rootScale[0] ?? 1;
    _point.addScaledVector(this.right, side * 0.24 * (this.bossDef?.scale ?? 1) * xScale);
    this.goopFx?.flash(_point, this.bossVisual?.gel.telegraphColor ?? 0xffb03a, 0.34 * (this.bossDef?.scale ?? 1));
    this.world.camera.getWorldPosition(_head);
    _vel.copy(_head).sub(_point);
    const dist = _vel.length();
    const speed = 6.2;
    _vel.normalize().multiplyScalar(speed);
    _vel.y += (ENEMY_SHOT.gravity * dist) / (2 * speed);
    this.goopFx?.burst(_point, _point2.copy(_vel).normalize(), 5, 2.2);
    enemyShot(_point, _vel, this.bossVisual?.fx.bright ?? 0);
    sfx.enemyLob();
  }

  private aimBeam(beat: AttackBeat): void {
    if (beat.zone.kind !== 'beam' || !beat.telegraph) return;
    const zone = beat.zone;
    this.world.camera.getWorldPosition(_head);
    _forward.copy(_head).sub(this.bossPos).setY(0);
    if (_forward.lengthSq() < 1e-4) _forward.copy(this.forward).multiplyScalar(-1);
    _forward.normalize(); // boss -> player
    zone.x = this.bossPos.x;
    zone.z = this.bossPos.z;
    zone.dx = _forward.x;
    zone.dz = _forward.z;

    // The strip's local -Z runs from the player's rear edge back to the boss.
    _point.copy(_head).addScaledVector(_forward, 1.2).setY(CAMPAIGN.decalY);
    beat.telegraph.group.position.copy(_point);
    _point2.copy(_forward).multiplyScalar(-1); // player -> boss
    beat.telegraph.group.rotation.y = Math.atan2(-_point2.x, -_point2.z);
  }

  private clampToPad(point: Vector3): void {
    this.toArenaLocal(point, _rel);
    const nx = _rel.x / (CAMPAIGN.padRadius * 0.82);
    const nz = _rel.z / (CAMPAIGN.padDepth * 0.42);
    const d = Math.hypot(nx, nz);
    if (d > 1) {
      _rel.x /= d;
      _rel.z /= d;
    }
    point.copy(this.arenaCenter)
      .addScaledVector(this.right, _rel.x)
      .addScaledVector(this.forward, _rel.z)
      .setY(CAMPAIGN.decalY);
  }

  private toArenaLocal(world: Vector3, out: Vector3): Vector3 {
    out.copy(world).sub(this.arenaCenter);
    const x = out.dot(this.right);
    const z = out.dot(this.forward);
    return out.set(x, world.y, z);
  }

  private disposeAttack(): void {
    if (!this.activeAttack) return;
    for (const beat of this.activeAttack.beats) beat.telegraph?.dispose();
    this.activeAttack = null;
  }

  // --- Boss HUD ------------------------------------------------------------

  private drawHud(): void {
    if (!this.bossDef) return;
    const ctx = this.hudCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, HUD_W, HUD_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(12,35,31,0.9)';
    ctx.beginPath();
    ctx.roundRect(10, 10, HUD_W - 20, HUD_H - 20, 46);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = this.enraged ? '#f0544f' : (this.bossVisual?.uiAccent ?? '#58dc76');
    ctx.stroke();

    let nameSize = 50;
    do {
      ctx.font = `900 ${nameSize}px system-ui, -apple-system, sans-serif`;
      nameSize -= 2;
    } while (nameSize > 28 && ctx.measureText(this.bossDef.name).width > HUD_W - 100);
    ctx.fillStyle = '#f3fff5';
    ctx.fillText(this.bossDef.name, HUD_W / 2, 60);

    const x = 92;
    const y = 108;
    const w = HUD_W - 184;
    const h = 42;
    ctx.fillStyle = '#173e31';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 20);
    ctx.fill();
    const frac = clamp(this.bossHealth / this.bossMaxHealth, 0, 1);
    if (frac > 0) {
      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, this.enraged ? '#ef4b44' : hexCss(this.bossVisual?.arenaColor ?? 0x3ecb67));
      grad.addColorStop(1, this.enraged ? '#ff9c55' : hexCss(this.bossVisual?.arenaBright ?? 0xa2ff79));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(h, w * frac), h, 20);
      ctx.fill();
    }

    ctx.fillStyle = this.hudCue === 'SAFE WEDGE' ? '#fff27b' : '#d8ffe1';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.fillText(this.hudCue, HUD_W / 2, 204);
    this.hudTexture.needsUpdate = true;
  }
}
