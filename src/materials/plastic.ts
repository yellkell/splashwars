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
 * The clear tank shell: see-through blow-moulded plastic. No physical
 * transmission (too heavy in stereo WebXR) — a low-opacity glossy shell over
 * the liquid mesh inside sells it fine.
 */
export function clearPlastic(tint: ColorRepresentation = 0xdff6ff): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: tint,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
}
