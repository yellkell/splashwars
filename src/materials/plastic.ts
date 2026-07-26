/**
 * The plastic toolkit — every solid surface in SPLASH WARS is toy plastic.
 * Injection-moulded shells read as: strong colour, low-ish roughness, a wet
 * clearcoat on top, zero metalness. Shared helpers so the whole game's
 * plastic agrees with itself.
 */

import { MeshPhysicalMaterial, MeshStandardMaterial, type ColorRepresentation } from 'three';

/** Glossy injection-moulded shell — pistol bodies, deck rim, enemy shells. */
export function glossyPlastic(color: ColorRepresentation, roughness = 0.28): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.18,
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
 * here" while still letting the paint level read at a glance.
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
