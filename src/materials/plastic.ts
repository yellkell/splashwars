/**
 * The plastic toolkit — every solid surface in SPLASH WARS is toy plastic.
 * Injection-moulded shells read as: strong colour, low-ish roughness, a wet
 * clearcoat on top, zero metalness. Shared helpers so the whole game's
 * plastic agrees with itself.
 */

import { MeshPhysicalMaterial, MeshStandardMaterial, type ColorRepresentation } from 'three';

/**
 * WET JUICE — the glossiest thing in the game. Juice balls, orbiter globes,
 * anything that reads as fresh liquid juice: near-zero roughness under a
 * tight clearcoat, so every light in the scene leaves a hot little glint.
 */
export function wetJuice(color: ColorRepresentation): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    // As glossy as the renderer goes: a mirror-smooth base under a
    // mirror-smooth clearcoat, with the environment cranked so the
    // poolside IBL rolls across every ball as it flies.
    roughness: 0.012,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.008,
    envMapIntensity: 1.8,
    specularIntensity: 1,
    // A faint bright sheen at grazing angles — the wet skin on a droplet.
    sheen: 0.5,
    sheenRoughness: 0.25,
    sheenColor: 0xffffff,
  });
}

/** Glossy injection-moulded shell — pistol bodies, deck rim, enemy shells. */
export function glossyPlastic(color: ColorRepresentation, roughness = 0.22): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.4,
  });
}

/** Matte moulded plastic — undersides, structural bits that shouldn't shine. */
export function mattePlastic(color: ColorRepresentation): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 });
}

/**
 * The tank shell: FROSTED blow-moulded plastic, the Valve trick. A dead-clear
 * shell shows every seam of the liquid mesh and reads as an empty glass box;
 * frosting it — rough base under a glossy clearcoat, milky white, a bit more
 * opacity — scatters the surface just enough to sell "there is real liquid in
 * here" while still letting the juice level read at a glance.
 *
 * No physical transmission (far too heavy in stereo WebXR) — the frost plus
 * the opaque liquid inside does the whole job.
 */
export function clearPlastic(tint: ColorRepresentation = 0xeaf7ff): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: tint,
    // Rough base = the frost. The clearcoat on top keeps the wet, moulded
    // sheen so it still reads as plastic rather than chalk.
    roughness: 0.55,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.22,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
}
