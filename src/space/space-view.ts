// Seeing a space map (Stage 11, D110): a camera circling a point in space. The camera's longitude is
// the direction it looks from (around the galactic pole), its latitude how high above the galactic
// plane (90: straight down from the north), its zoom how close, its rotation a turn of the picture;
// `target` is the point it circles (light-years; the Sun when absent). Gentle perspective: the nearest
// stars of the sphere shown are drawn half as large again as those at its far side.
import type { Camera } from '../render-engine/camera.ts';

export type Vec3 = [number, number, number];

export interface SpaceView {
  camera: Camera; width: number; height: number;
  /** Pixels per design pixel (1 at 1920 wide). */
  unit: number;
  /** Pixels per light-year at the target. */
  scale: number;
  /** A point (light-years) on the picture: x, y and how much nearer than the target it is (the perspective factor), or null behind the camera. */
  project(p: Vec3): [number, number, number] | null;
  /** The camera's axes: right, up (on the picture) and forward (into it). */
  right: Vec3; up: Vec3; forward: Vec3;
  target: Vec3;
}

/** How far the camera stands from what it circles, in radii of the space shown. */
export const CAMERA_DISTANCE = 3;

/** A camera for a new star map: from above the galactic plane, at an angle, the whole sphere in view. */
export const spaceCamera = (): Camera => ({ lon: -60, lat: 28, zoom: 0, rotation: 0, projection: 'equirectangular' });

export function makeSpaceView(cam: Camera, width: number, height: number, radiusLy = 50): SpaceView {
  const yaw = (cam.lon * Math.PI) / 180, pitch = (Math.max(-90, Math.min(90, cam.lat)) * Math.PI) / 180;
  const toCam: Vec3 = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
  const forward: Vec3 = [-toCam[0], -toCam[1], -toCam[2]];
  // Right is level with the galactic plane (also when looking straight down); up completes the axes.
  const right: Vec3 = [-Math.sin(yaw), Math.cos(yaw), 0];
  const up: Vec3 = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const target: Vec3 = cam.target ?? [0, 0, 0];
  const D = CAMERA_DISTANCE * radiusLy;
  const eye: Vec3 = [target[0] + toCam[0] * D, target[1] + toCam[1] * D, target[2] + toCam[2] * D];
  const scale = ((Math.min(width, height) * 0.46) / radiusLy) * Math.pow(2, cam.zoom);
  const cx = width / 2, cy = height / 2;
  const rot = (cam.rotation * Math.PI) / 180, cr = Math.cos(rot), sr = Math.sin(rot);
  const project = (p: Vec3): [number, number, number] | null => {
    const vx = p[0] - eye[0], vy = p[1] - eye[1], vz = p[2] - eye[2];
    const depth = vx * forward[0] + vy * forward[1] + vz * forward[2];
    if (depth <= D * 0.05) return null;
    const k = D / depth;
    const x = (vx * right[0] + vy * right[1] + vz * right[2]) * scale * k;
    const y = -(vx * up[0] + vy * up[1] + vz * up[2]) * scale * k;
    return [cx + x * cr - y * sr, cy + x * sr + y * cr, k];
  };
  return { camera: cam, width, height, unit: width / 1920, scale, project, right, up, forward, target };
}

/** The camera turned by a drag of (dx, dy) pixels: around the pole sideways, up and down over the plane. */
export function orbitCamera(cam: Camera, dx: number, dy: number): Camera {
  const lon = ((((cam.lon - dx * 0.35) % 360) + 540) % 360) - 180;
  return { ...cam, lon, lat: Math.max(-89.9, Math.min(89.9, cam.lat + dy * 0.35)) };
}

/** The camera's target moved by a drag of (dx, dy) pixels across the picture (the picture follows the pointer). */
export function panSpaceCamera(cam: Camera, view: SpaceView, dx: number, dy: number): Camera {
  const t = view.target, k = 1 / view.scale;
  const rot = (cam.rotation * Math.PI) / 180, ux = dx * Math.cos(rot) + dy * Math.sin(rot), uy = -dx * Math.sin(rot) + dy * Math.cos(rot);
  return { ...cam, target: [t[0] - (view.right[0] * ux - view.up[0] * uy) * k, t[1] - (view.right[1] * ux - view.up[1] * uy) * k, t[2] - (view.right[2] * ux - view.up[2] * uy) * k] };
}
