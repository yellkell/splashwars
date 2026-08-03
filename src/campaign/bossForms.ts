/**
 * The five visual incarnations of GOOPLIATH.
 *
 * Mechanics accumulate in campaignState; this file owns the other half of
 * the escalation contract: a boss must be recognisable from its silhouette
 * and colour before its name card is readable. Every form uses the same
 * liquid SDF creature, but pours those anchors into a different body plan,
 * scales that plan on three axes, and gives the shader / attack effects a
 * distinct surface language.
 */

import type { GelVisualLook } from '../goopliath/goopConfig.js';
import type { GooFxLook } from '../goopliath/splats.js';
import { A } from '../goopliath/poses.js';
import type { StylePoseDelta } from '../goopliath/styles.js';
import type { TelegraphTheme } from './telegraphs.js';

export type BossFormId = 'puddle' | 'current' | 'pressure' | 'flood' | 'goopliath';

export interface BossVisualProfile {
  id: BossFormId;
  /** Non-uniform parent scale, multiplied by the encounter's size scalar. */
  rootScale: readonly [number, number, number];
  /** Per-anchor re-pour of the standard boxer pose. */
  pose: ReadonlyArray<StylePoseDelta>;
  gel: GelVisualLook;
  fx: GooFxLook;
  telegraph: TelegraphTheme;
  eyeScale: readonly [number, number, number];
  eyeSpread: number;
  /** Arena furniture and UI colours. */
  arenaColor: number;
  arenaBright: number;
  uiAccent: string;
}

const COMMON_DANGER = 0xff3d45;
const COMMON_SAFE = 0x63f4dd;

export const BOSS_FORMS: Record<BossFormId, BossVisualProfile> = {
  puddle: {
    id: 'puddle',
    rootScale: [1.16, 0.82, 1.1],
    // Low, broad and soft: an overgrown puddle only just learning to stand.
    pose: [
      [A.HEAD, 0, -0.2, 0.04, 1.22],
      [A.NECK, 0, -0.15, 0.03, 1.18],
      [A.CHEST_L, -0.06, -0.12, 0.03, 1.2],
      [A.CHEST_R, 0.06, -0.12, 0.03, 1.2],
      [A.BELLY, 0, -0.12, 0.04, 1.34],
      [A.PELVIS, 0, -0.08, 0.02, 1.25],
      [A.SHOULDER_L, -0.08, -0.14, 0.02, 1.12],
      [A.SHOULDER_R, 0.08, -0.14, 0.02, 1.12],
      [A.ELBOW_L, -0.08, -0.15, 0.02, 1.14],
      [A.ELBOW_R, 0.08, -0.15, 0.02, 1.14],
      [A.FIST_L, -0.14, -0.17, 0.04, 1.28],
      [A.FIST_R, 0.14, -0.17, 0.04, 1.28],
      [A.HIP_L, -0.08, -0.06, 0, 1.18],
      [A.HIP_R, 0.08, -0.06, 0, 1.18],
      [A.KNEE_L, -0.1, -0.03, 0, 1.2],
      [A.KNEE_R, 0.1, -0.03, 0, 1.2],
      [A.BASE_L, -0.16, 0, 0.02, 1.28],
      [A.BASE_R, 0.16, 0, -0.02, 1.28],
      [A.BASE_F, 0, 0, 0.12, 1.2],
      [A.BASE_B, 0, 0, -0.12, 1.2],
    ],
    gel: {
      shallowColor: 0xa2ffd5,
      deepColor: 0x105747,
      nucleusColor: 0x31e69a,
      accentColor: 0xe0ff78,
      telegraphColor: 0xffc84d,
      surfaceMode: 0,
      patternScale: 5.2,
      patternSpeed: 0.55,
      patternStrength: 0.2,
      wobble: 0.017,
      wobbleAgitated: 0.052,
      wobbleFrequency: 0.78,
    },
    fx: { color: 0x43d89a, bright: 0xa2ffd5 },
    telegraph: { warning: 0xffc247, danger: COMMON_DANGER, accent: 0x55e6a8, safe: COMMON_SAFE },
    eyeScale: [1.35, 1.22, 1.2],
    eyeSpread: 0.39,
    arenaColor: 0x42d99a,
    arenaBright: 0x9dffd2,
    uiAccent: '#5ce5ad',
  },

  current: {
    id: 'current',
    rootScale: [0.86, 1.12, 0.96],
    // A tall, streamed body: thin waist, long limbs and a trailing rear foot.
    pose: [
      [A.HEAD, 0.02, 0.12, -0.03, 0.96],
      [A.NECK, 0.01, 0.1, -0.02, 0.9],
      [A.CHEST_L, 0.02, 0.07, -0.01, 0.93],
      [A.CHEST_R, -0.02, 0.07, -0.01, 0.93],
      [A.BELLY, 0, 0.05, -0.03, 0.82],
      [A.PELVIS, 0.02, 0.04, -0.03, 0.88],
      [A.SHOULDER_L, -0.02, 0.08, 0.01, 0.9],
      [A.SHOULDER_R, 0.03, 0.08, -0.02, 0.9],
      [A.ELBOW_L, -0.04, 0.03, 0.09, 0.86],
      [A.ELBOW_R, 0.04, 0.02, -0.06, 0.86],
      [A.FIST_L, -0.08, 0.02, 0.14, 0.9],
      [A.FIST_R, 0.08, -0.02, -0.08, 0.9],
      [A.HIP_L, -0.01, 0.03, 0.04, 0.88],
      [A.HIP_R, 0.02, 0.03, -0.04, 0.88],
      [A.KNEE_L, -0.02, 0.05, 0.08, 0.84],
      [A.KNEE_R, 0.02, 0.05, -0.1, 0.84],
      [A.BASE_L, -0.03, 0, 0.16, 0.92],
      [A.BASE_R, 0.03, 0, -0.2, 0.92],
      [A.BASE_F, -0.04, 0, 0.18, 0.88],
      [A.BASE_B, 0.06, 0, -0.26, 0.88],
    ],
    gel: {
      shallowColor: 0x86f4ff,
      deepColor: 0x113b72,
      nucleusColor: 0x2b9cff,
      accentColor: 0xd1fbff,
      telegraphColor: 0xffb84a,
      surfaceMode: 1,
      patternScale: 7.8,
      patternSpeed: 2.15,
      patternStrength: 0.26,
      wobble: 0.011,
      wobbleAgitated: 0.045,
      wobbleFrequency: 1.05,
    },
    fx: { color: 0x36b8ee, bright: 0x91efff },
    telegraph: { warning: 0xffb340, danger: COMMON_DANGER, accent: 0x42c8ff, safe: COMMON_SAFE },
    eyeScale: [0.78, 1.38, 0.86],
    eyeSpread: 0.24,
    arenaColor: 0x279eea,
    arenaBright: 0x77eaff,
    uiAccent: '#52c9ff',
  },

  pressure: {
    id: 'pressure',
    rootScale: [1.01, 1.03, 0.9],
    // Dense and top-heavy: swollen shoulders/fists over a cinched base.
    pose: [
      [A.HEAD, 0, 0.02, 0.02, 1.05],
      [A.NECK, 0, 0.02, 0.02, 1.18],
      [A.CHEST_L, -0.06, 0.04, 0.04, 1.28],
      [A.CHEST_R, 0.06, 0.04, 0.04, 1.28],
      [A.BELLY, 0, 0.01, 0.03, 1.08],
      [A.PELVIS, 0, -0.01, 0, 0.94],
      [A.SHOULDER_L, -0.12, 0.07, 0.04, 1.38],
      [A.SHOULDER_R, 0.12, 0.07, 0.04, 1.38],
      [A.ELBOW_L, -0.09, 0.08, -0.02, 1.26],
      [A.ELBOW_R, 0.09, 0.08, -0.02, 1.26],
      [A.FIST_L, -0.08, 0.11, -0.06, 1.42],
      [A.FIST_R, 0.08, 0.11, -0.06, 1.42],
      [A.HIP_L, 0.02, -0.02, 0, 0.9],
      [A.HIP_R, -0.02, -0.02, 0, 0.9],
      [A.KNEE_L, 0.03, -0.02, 0, 0.82],
      [A.KNEE_R, -0.03, -0.02, 0, 0.82],
      [A.BASE_L, 0.04, 0, 0, 0.82],
      [A.BASE_R, -0.04, 0, 0, 0.82],
      [A.BASE_F, 0, 0, 0.02, 0.78],
      [A.BASE_B, 0, 0, -0.02, 0.78],
    ],
    gel: {
      shallowColor: 0xe3a1ff,
      deepColor: 0x44105f,
      nucleusColor: 0xff4fc5,
      accentColor: 0xffa1e7,
      telegraphColor: 0xffad4c,
      surfaceMode: 2,
      patternScale: 12.5,
      patternSpeed: 3.1,
      patternStrength: 0.28,
      wobble: 0.008,
      wobbleAgitated: 0.038,
      wobbleFrequency: 1.38,
    },
    fx: { color: 0xc04eea, bright: 0xf0a0ff },
    telegraph: { warning: 0xffaa3d, danger: COMMON_DANGER, accent: 0xca61ff, safe: COMMON_SAFE },
    eyeScale: [1.28, 0.54, 0.92],
    eyeSpread: 0.28,
    arenaColor: 0x9e3cdb,
    arenaBright: 0xe18bff,
    uiAccent: '#c56bff',
  },

  flood: {
    id: 'flood',
    rootScale: [1.18, 0.94, 1.16],
    // A rolling wall: wide, forward-heavy and deliberately asymmetric.
    pose: [
      [A.HEAD, -0.06, -0.03, 0.09, 1.12],
      [A.NECK, -0.04, -0.03, 0.08, 1.15],
      [A.CHEST_L, -0.1, -0.02, 0.12, 1.3],
      [A.CHEST_R, 0.08, -0.04, 0.02, 1.24],
      [A.BELLY, -0.02, -0.04, 0.08, 1.34],
      [A.PELVIS, 0.02, -0.03, 0.04, 1.22],
      [A.SHOULDER_L, -0.16, 0.04, 0.14, 1.34],
      [A.SHOULDER_R, 0.13, -0.05, -0.02, 1.25],
      [A.ELBOW_L, -0.18, 0.02, 0.15, 1.3],
      [A.ELBOW_R, 0.16, -0.08, 0.02, 1.2],
      [A.FIST_L, -0.22, 0.06, 0.17, 1.4],
      [A.FIST_R, 0.2, -0.1, 0.04, 1.3],
      [A.HIP_L, -0.09, -0.02, 0.06, 1.2],
      [A.HIP_R, 0.1, -0.04, 0, 1.16],
      [A.KNEE_L, -0.12, -0.02, 0.09, 1.22],
      [A.KNEE_R, 0.12, -0.03, -0.05, 1.18],
      [A.BASE_L, -0.18, 0, 0.14, 1.3],
      [A.BASE_R, 0.18, 0, -0.12, 1.26],
      [A.BASE_F, -0.1, 0, 0.2, 1.32],
      [A.BASE_B, 0.12, 0, -0.2, 1.28],
    ],
    gel: {
      shallowColor: 0xffa6cb,
      deepColor: 0x64153f,
      nucleusColor: 0xff4c7c,
      accentColor: 0x72dcff,
      telegraphColor: 0xffa148,
      surfaceMode: 3,
      patternScale: 5.6,
      patternSpeed: 1.65,
      patternStrength: 0.32,
      wobble: 0.022,
      wobbleAgitated: 0.064,
      wobbleFrequency: 0.68,
    },
    fx: { color: 0xf34f91, bright: 0xffb0d2 },
    telegraph: { warning: 0xff9b3e, danger: COMMON_DANGER, accent: 0xff5c9d, safe: 0x70eaff },
    eyeScale: [1.28, 0.78, 1.05],
    eyeSpread: 0.46,
    arenaColor: 0xe83f82,
    arenaBright: 0xff98c3,
    uiAccent: '#ff6aa3',
  },

  goopliath: {
    id: 'goopliath',
    rootScale: [1.08, 1.14, 1.03],
    // The crown form: a tall central mass with raised, pointed outer lobes.
    pose: [
      [A.HEAD, 0, 0.15, 0.03, 1.24],
      [A.NECK, 0, 0.1, 0.02, 1.2],
      [A.CHEST_L, -0.05, 0.08, 0.04, 1.25],
      [A.CHEST_R, 0.05, 0.08, 0.04, 1.25],
      [A.BELLY, 0, 0.03, 0.05, 1.22],
      [A.PELVIS, 0, 0, 0.02, 1.16],
      [A.SHOULDER_L, -0.13, 0.18, 0.01, 1.2],
      [A.SHOULDER_R, 0.13, 0.18, 0.01, 1.2],
      [A.ELBOW_L, -0.16, 0.2, -0.02, 1.05],
      [A.ELBOW_R, 0.16, 0.2, -0.02, 1.05],
      [A.FIST_L, -0.18, 0.24, -0.04, 0.94],
      [A.FIST_R, 0.18, 0.24, -0.04, 0.94],
      [A.HIP_L, -0.06, 0, 0, 1.18],
      [A.HIP_R, 0.06, 0, 0, 1.18],
      [A.KNEE_L, -0.08, 0.01, 0.04, 1.14],
      [A.KNEE_R, 0.08, 0.01, -0.04, 1.14],
      [A.BASE_L, -0.12, 0, 0.08, 1.22],
      [A.BASE_R, 0.12, 0, -0.08, 1.22],
      [A.BASE_F, 0, 0, 0.14, 1.2],
      [A.BASE_B, 0, 0, -0.14, 1.2],
    ],
    gel: {
      shallowColor: 0xe1ff62,
      deepColor: 0x33460b,
      nucleusColor: 0xff8d20,
      accentColor: 0xffc339,
      telegraphColor: 0xffdf57,
      surfaceMode: 4,
      patternScale: 9.4,
      patternSpeed: 2.75,
      patternStrength: 0.38,
      wobble: 0.016,
      wobbleAgitated: 0.07,
      wobbleFrequency: 1.18,
    },
    fx: { color: 0xb8df35, bright: 0xf0ff70 },
    telegraph: { warning: 0xffcc35, danger: 0xff3038, accent: 0xd7f342, safe: 0x63f4dd },
    eyeScale: [0.94, 1.2, 1.0],
    eyeSpread: 0.34,
    arenaColor: 0x99c528,
    arenaBright: 0xe3ff58,
    uiAccent: '#d7ef43',
  },
};

export function bossForm(id: BossFormId): BossVisualProfile {
  return BOSS_FORMS[id];
}
