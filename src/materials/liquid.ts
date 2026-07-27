/**
 * The liquid — SPLASH WARS' centrepiece trick, Half-Life: Alyx style.
 *
 * The juice inside a pistol tank is one mesh (a slightly-shrunk copy of the
 * tank interior) whose fragment shader CLIPS everything above a liquid
 * surface plane defined in WORLD space. Because the plane lives in world
 * space, the surface stays level however you tilt, swing or roll the gun —
 * exactly the Alyx bottle illusion. Where the clip cuts the mesh open you see
 * its back faces, which we juice as a flat bright "surface of the liquid"
 * colour — the classic cheap fake for the liquid's top.
 *
 * On top of that:
 *  - a spring–damper SloshSim tilts the plane's normal in response to how the
 *    hand accelerates, so whipping the gun sends the juice surging;
 *  - a travelling ripple wobbles the plane, scaled by slosh energy;
 *  - a foam/meniscus band brightens the cut line where juice meets air;
 *  - the FILL LEVEL is a uniform driven straight from the weapon's ammo —
 *    the tank visibly drains as you fire. One unified system.
 */

import {
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type ColorRepresentation,
} from 'three';
import { PISTOL } from '../config.js';

// ---------------------------------------------------------------------------
// The slosh simulation — a damped 2D pendulum for the surface tilt.
// ---------------------------------------------------------------------------

/**
 * Tracks the liquid surface's tilt (rise/run in world X and Z) and a scalar
 * "energy" that drives the shader ripple. Feed it the tank's world-space
 * acceleration every frame.
 */
export class SloshSim {
  tiltX = 0;
  tiltZ = 0;
  energy = 0;
  private velX = 0;
  private velZ = 0;

  update(dt: number, accel: Vector3): void {
    const s = PISTOL.slosh;
    // Surface tips away from the direction of acceleration (juice lags the
    // tank), pulled level by the spring, calmed by damping.
    const driveX = -accel.x * s.accelGain;
    const driveZ = -accel.z * s.accelGain;
    this.velX += (driveX - s.spring * 0.01 * this.tiltX - s.damping * 0.1 * this.velX) * dt * 60;
    this.velZ += (driveZ - s.spring * 0.01 * this.tiltZ - s.damping * 0.1 * this.velZ) * dt * 60;
    this.tiltX += this.velX * dt;
    this.tiltZ += this.velZ * dt;
    const clamp = s.maxTilt;
    this.tiltX = Math.max(-clamp, Math.min(clamp, this.tiltX));
    this.tiltZ = Math.max(-clamp, Math.min(clamp, this.tiltZ));

    // Ripple energy: spikes with jolts (vertical ones count too), then dies.
    const jolt = Math.min(1.2, accel.length() * 0.02);
    this.energy = Math.max(this.energy * Math.exp(-s.energyDecay * dt), jolt);
  }

  reset(): void {
    this.tiltX = this.tiltZ = this.velX = this.velZ = this.energy = 0;
  }
}

// ---------------------------------------------------------------------------
// The clipped-liquid shader.
// ---------------------------------------------------------------------------

const LIQUID_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const LIQUID_FRAG = /* glsl */ `
  uniform vec3 uPlanePoint;   // a world-space point on the liquid surface
  uniform vec3 uPlaneNormal;  // world up, tilted by the slosh sim
  uniform float uTime;
  uniform float uSlosh;       // ripple energy 0..~1
  uniform vec3 uColor;        // lit juice body
  uniform vec3 uDeepColor;    // shadowed depths
  uniform vec3 uFoamColor;    // meniscus / surface sheen
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main(){
    // Signed distance above the (tilted) surface plane, wobbled by two
    // crossing travelling ripples so churned juice visibly rolls.
    float ripple =
      sin(dot(vWorldPos.xz, vec2(38.0, 26.0)) - uTime * 13.0) * 0.5 +
      sin(dot(vWorldPos.xz, vec2(-22.0, 31.0)) + uTime * 9.0) * 0.5;
    float d = dot(vWorldPos - uPlanePoint, normalize(uPlaneNormal))
            + ripple * 0.006 * uSlosh * ${PISTOL.slosh.rippleGain.toFixed(2)};
    if (d > 0.0) discard;

    if (!gl_FrontFacing) {
      // The open cut — the liquid's top surface. Flat and bright, with the
      // ripple shimmering across it.
      float shimmer = 0.92 + 0.08 * ripple * uSlosh * 4.0;
      gl_FragColor = vec4(uFoamColor * shimmer, 1.0);
      return;
    }

    // The body of the juice: simple fixed-key shading so it reads THICK —
    // deep colour below, lit colour up top.
    float up = clamp(vWorldNormal.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uDeepColor, uColor, up * 0.75 + 0.25);
    // Meniscus: a foam band hugging the underside of the surface plane.
    col = mix(col, uFoamColor, smoothstep(-0.010, -0.002, d) * 0.85);
    // Wet gloss: a real Blinn-Phong glint off a fixed key light, tracking
    // the camera, so the juice gleams as the tank turns in your hand.
    vec3 n = normalize(vWorldNormal);
    vec3 lightDir = normalize(vec3(0.35, 0.85, 0.4));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float spec = pow(max(dot(n, normalize(lightDir + viewDir)), 0.0), 80.0);
    col += spec * 0.85;
    // FULLY OPAQUE: thick juice is not see-through. Anything less and you
    // catch the tank's far wall (and the room) straight through the liquid.
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** A live liquid volume: parent `mesh` inside the tank, then call update(). */
export interface LiquidVisual {
  mesh: Mesh;
  material: ShaderMaterial;
  slosh: SloshSim;
  /**
   * Drive the illusion. `fill` is 0..1 (this IS the ammo gauge), `tankCenter`
   * the tank's world-space centre, `tankHeight` its interior world height.
   */
  update(time: number, dt: number, fill: number, tankCenter: Vector3, tankHeight: number, accel: Vector3): void;
  dispose(): void;
}

const _up = new Vector3();
const _point = new Vector3();

export function createLiquid(
  interiorGeo: BufferGeometry,
  juice: ColorRepresentation,
  deep: ColorRepresentation,
  foam: ColorRepresentation,
): LiquidVisual {
  const material = new ShaderMaterial({
    uniforms: {
      uPlanePoint: { value: new Vector3() },
      uPlaneNormal: { value: new Vector3(0, 1, 0) },
      uTime: { value: 0 },
      uSlosh: { value: 0 },
      uColor: { value: new Color(juice) },
      uDeepColor: { value: new Color(deep) },
      uFoamColor: { value: new Color(foam) },
    },
    vertexShader: LIQUID_VERT,
    fragmentShader: LIQUID_FRAG,
    // Opaque: it renders in the opaque pass, writes depth, and the frosted
    // shell then blends over the top of it in the transparent pass — which
    // is exactly the sort order the illusion needs.
    transparent: false,
    side: DoubleSide,
  });

  const mesh = new Mesh(interiorGeo, material);
  mesh.renderOrder = 1; // before the frosted tank shell blends over it
  const slosh = new SloshSim();

  return {
    mesh,
    material,
    slosh,
    update(time, dt, fill, tankCenter, tankHeight, accel) {
      slosh.update(dt, accel);
      // Surface plane: a world-up normal tipped by the slosh pendulum…
      _up.set(slosh.tiltX, 1, slosh.tiltZ).normalize();
      // …passing through the tank centre offset by the fill level. Measuring
      // the offset along world up (not the tank's axis) keeps the volume
      // believable however the gun is tilted.
      _point.copy(tankCenter).addScaledVector(
        _up,
        (Math.min(1, Math.max(0, fill)) - 0.5) * tankHeight,
      );
      material.uniforms.uPlanePoint.value.copy(_point);
      material.uniforms.uPlaneNormal.value.copy(_up);
      material.uniforms.uTime.value = time;
      material.uniforms.uSlosh.value = slosh.energy;
      // Fully drained: hide the mesh so no backface slivers linger.
      mesh.visible = fill > 0.005;
    },
    dispose() {
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
