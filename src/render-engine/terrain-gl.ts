// Terrain on the graphics card (Stage 8, D95). For every pixel of a picture, a WebGL2 shader finds the
// place of the planet it shows (undoing the projection: d3-geo's inverses, written out as in
// terrain/look.ts), reads the elevation grid there (a half-float texture with its own smaller copies,
// so a zoomed-out view reads the mean of what each pixel covers) and colours it: by height, shaded by
// the slope towards the light, or as a see-through layer of relief alone (shadows dark, lit slopes
// light) to lay over land or territory.
//
// Pictures are made for the renderer's sheets (see plane.ts): the shader takes the sheet's plane and
// the transform from the sheet to the picture, so a picture with room around the view, a turned
// view or a picture for an export are all made the same way. One WebGL context serves every renderer;
// each renderer keeps its last pictures (TerrainPictures).
import type { ElevationGrid } from '../terrain/grid.ts';
import { PALETTES, rampUniform, LIGHT, type TerrainLook } from '../terrain/look.ts';
import type { ProjectionName } from './camera.ts';

/** What a picture is of: a sheet's plane, and where it lies on the picture (picture pixels). */
export interface TerrainFrame {
  kind: ProjectionName;
  /** Sheet pixels per plane unit, the plane point at the sheet's origin, the sheet's middle meridian (degrees). */
  S: number; ox: number; oy: number; lonRef: number;
  /** Sheet pixels to picture pixels. */
  m: { a: number; b: number; c: number; d: number; e: number; f: number };
  width: number; height: number;
}

/**
 * sea: the sea colours everywhere (lakes and the sea beyond the coastline take it);
 * land: the land colours everywhere (laid on inside the coastline);
 * both: each where the terrain has land or sea (with the sea level of the moment, D96);
 * relief: shadows and light alone, see-through;
 * landmask: the land alone, opaque (for ending territory at the coast of the moment).
 */
export type TerrainImageKind = 'sea' | 'land' | 'both' | 'relief' | 'landmask';
const MODES: Record<TerrainImageKind, number> = { sea: 0, land: 1, both: 2, relief: 3, landmask: 4 };

/**
 * The sea of a moment (D96): its level (metres above today's) and, where Natural Earth's coastline is
 * drawn, that coastline's land as a picture the size of the terrain's picture (land opaque), so that at
 * today's level land is exactly what the coastline encloses (see heightAboveSea).
 */
export interface TerrainSea { level: number; mask: TexImageSource | null; maskKey: string }
const TODAY: TerrainSea = { level: 0, mask: null, maskKey: '' };
const PROJ: Partial<Record<ProjectionName, number>> = { equirectangular: 0, mercator: 1, equalEarth: 2, naturalEarth: 3 };

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_elev;
uniform vec2 u_tex;
uniform vec2 u_size;
uniform vec2 u_offset;
uniform mat3 u_inv;
uniform float u_S;
uniform vec2 u_origin;
uniform float u_lonRef;
uniform int u_proj;
uniform int u_mode;
uniform float u_shadeTint;
uniform float u_exag;
uniform float u_seaRelief;
uniform vec3 u_light;
uniform vec4 u_sea[8];
uniform int u_seaN;
uniform vec4 u_land[8];
uniform int u_landN;
uniform float u_seaLevel;
uniform sampler2D u_mask;
uniform int u_useMask;
out vec4 outColor;
const float PI = 3.141592653589793;

bool invertPlane(vec2 p, out vec2 ll) {
  float lam = p.x, phi = p.y;
  bool ok = true;
  if (u_proj == 1) {
    phi = 2.0 * atan(exp(p.y)) - PI / 2.0;
  } else if (u_proj == 2) {
    const float A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
    float M = sqrt(3.0) / 2.0;
    float l = p.y, l2 = l * l, l6 = l2 * l2 * l2;
    for (int i = 0; i < 12; i++) {
      float fy = l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)) - p.y;
      float fpy = A1 + 3.0 * A2 * l2 + l6 * (7.0 * A3 + 9.0 * A4 * l2);
      l -= fy / fpy; l2 = l * l; l6 = l2 * l2 * l2;
    }
    float s = sin(l) / M;
    ok = abs(s) <= 1.0;
    lam = M * p.x * (A1 + 3.0 * A2 * l2 + l6 * (7.0 * A3 + 9.0 * A4 * l2)) / cos(l);
    phi = asin(clamp(s, -1.0, 1.0));
  } else if (u_proj == 3) {
    phi = p.y;
    for (int i = 0; i < 25; i++) {
      float p2 = phi * phi, p4 = p2 * p2;
      phi -= (phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))) - p.y)
        / (1.007226 + p2 * (0.015085 * 3.0 + p4 * (-0.044475 * 7.0 + 0.028874 * 9.0 * p2 - 0.005916 * 11.0 * p4)));
    }
    float q2 = phi * phi;
    lam = p.x / (0.8707 + q2 * (-0.131979 + q2 * (-0.013791 + q2 * q2 * q2 * (0.003971 - 0.001529 * q2))));
  }
  ll = vec2(lam, phi);
  if (abs(phi) > PI / 2.0 + 1e-6) ok = false;
  if (u_proj >= 2 && abs(lam) > PI + 1e-4) ok = false;
  return ok;
}

vec3 rampSea(float e) {
  vec3 c = u_sea[0].yzw;
  if (e <= u_sea[0].x) return c;
  for (int i = 1; i < 8; i++) {
    if (i >= u_seaN) break;
    vec4 a = u_sea[i - 1], b = u_sea[i];
    if (e <= b.x) return mix(a.yzw, b.yzw, (e - a.x) / (b.x - a.x));
    c = b.yzw;
  }
  return c;
}

vec3 rampLand(float e) {
  vec3 c = u_land[0].yzw;
  if (e <= u_land[0].x) return c;
  for (int i = 1; i < 8; i++) {
    if (i >= u_landN) break;
    vec4 a = u_land[i - 1], b = u_land[i];
    if (e <= b.x) return mix(a.yzw, b.yzw, (e - a.x) / (b.x - a.x));
    c = b.yzw;
  }
  return c;
}

void main() {
  vec2 dev = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) + u_offset;
  vec2 sheet = (u_inv * vec3(dev, 1.0)).xy;
  vec2 plane = sheet / u_S + u_origin;
  vec2 ll;
  bool ok = invertPlane(vec2(plane.x, -plane.y), ll);
  float lat = clamp(ll.y, -PI / 2.0, PI / 2.0);
  vec2 uv = vec2((ll.x + u_lonRef + PI) / (2.0 * PI), (PI / 2.0 - lat) / PI);
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  // What one pixel covers of the grid (at least a cell): slopes are measured across that much.
  vec2 foot = max(abs(gx) + abs(gy), 1.0 / u_tex);
  float e = textureGrad(u_elev, uv, gx, gy).r;
  float eW = textureGrad(u_elev, uv - vec2(foot.x, 0.0), gx, gy).r;
  float eE = textureGrad(u_elev, uv + vec2(foot.x, 0.0), gx, gy).r;
  float eN = textureGrad(u_elev, uv - vec2(0.0, foot.y), gx, gy).r;
  float eS = textureGrad(u_elev, uv + vec2(0.0, foot.y), gx, gy).r;
  // Height above the sea of the moment: where a coastline is drawn, never below 0.5 m on its land
  // and never above -0.5 m off it (see heightAboveSea in terrain/sea-level.ts).
  float h = e;
  if (u_useMask == 1) h = texelFetch(u_mask, ivec2(dev), 0).a > 0.5 ? max(e, 0.5) : min(e, -0.5);
  float rel = h - u_seaLevel;
  // How much of the pixel is land: the coast is smoothed over about a pixel. (How fast the height
  // changes from pixel to pixel is worked out from the slope of the terrain, not from neighbouring
  // pixels: that would depend on where the picture starts, and a kept picture with room around the
  // view must be the picture drawn afresh.)
  float dEdu = (eE - eW) / (2.0 * foot.x), dEdv = (eS - eN) / (2.0 * foot.y);
  float perPixel = abs(dEdu * gx.x + dEdv * gx.y) + abs(dEdu * gy.x + dEdv * gy.y);
  float landA = clamp(rel / max(perPixel, 1e-3) + 0.5, 0.0, 1.0);
  if (!ok) { outColor = vec4(0.0); return; }
  if (u_mode == 4) { outColor = vec4(landA); return; }
  const float R = 6371008.8;
  float dxm = 2.0 * foot.x * 2.0 * PI * R * max(cos(lat), 0.05);
  float dym = 2.0 * foot.y * PI * R;
  // Seen from farther away, slopes are measured over longer distances and come out gentler: the
  // relief is exaggerated more, so it reads the same at every zoom.
  float exag = u_exag * sqrt(max(1.0, dym / 20000.0));
  vec3 n = normalize(vec3(-(eE - eW) / dxm * exag, -(eN - eS) / dym * exag, 1.0));
  float shade = dot(n, u_light) - u_light.z;
  if (rel < 0.0) shade *= u_seaRelief;
  if (u_mode == 3) {
    float d = shade * 1.5;
    if (d < 0.0) { float a = min(0.7, -d); outColor = vec4(0.0, 0.0, 0.0, a); }
    else { float a = min(0.3, d * 0.5); outColor = vec4(a, a, a, a); }
    return;
  }
  vec3 col = u_mode == 1 ? rampLand(max(rel, 0.0)) : u_mode == 0 ? rampSea(min(rel, 0.0)) : mix(rampSea(min(rel, 0.0)), rampLand(max(rel, 0.0)), landA);
  if (u_shadeTint > 0.0) {
    float s = shade * u_shadeTint;
    col = s < 0.0 ? col * (1.0 + max(s, -0.85)) : col + (vec3(1.0) - col) * min(s * 0.6, 0.6);
  }
  outColor = vec4(col, 1.0);
}`;

const UNIFORMS = ['u_elev', 'u_tex', 'u_size', 'u_offset', 'u_inv', 'u_S', 'u_origin', 'u_lonRef', 'u_proj', 'u_mode', 'u_shadeTint', 'u_exag', 'u_seaRelief', 'u_light', 'u_sea', 'u_seaN', 'u_land', 'u_landN', 'u_seaLevel', 'u_mask', 'u_useMask'] as const;
type UniformName = (typeof UNIFORMS)[number];

/** The relief's exaggeration at strength 1 (slopes ten kilometres across are gentle). */
const EXAGGERATION = 6;

class TerrainGL {
  private textures = new WeakMap<ElevationGrid, WebGLTexture>();
  private maskTexture: WebGLTexture | null = null;
  private u: Record<UniformName, WebGLUniformLocation | null>;
  readonly canvas: OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  readonly max: number;

  private constructor(canvas: OffscreenCanvas, gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.canvas = canvas;
    this.gl = gl;
    this.u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)])) as Record<UniformName, WebGLUniformLocation | null>;
    this.max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, (gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array)[0], (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number));
  }

  static create(): TerrainGL | null {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Terrain shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Terrain shader: ${gl.getProgramInfoLog(program)}`);
    gl.useProgram(program);
    // One triangle that covers the whole picture.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return new TerrainGL(canvas, gl, program);
  }

  get lost(): boolean { return this.gl.isContextLost(); }

  /** The grid as a texture: heights in metres (half floats), with copies halved again and again for zoomed-out views. */
  private texture(grid: ElevationGrid): WebGLTexture {
    let t = this.textures.get(grid);
    if (t) return t;
    const gl = this.gl;
    t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    let w = grid.width, h = grid.height, level = new Float32Array(w * h);
    for (let k = 0; k < level.length; k++) level[k] = grid.data[k] * grid.step;
    const halve = () => {
      const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), next = new Float32Array(nw * nh);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const x0 = Math.min(w - 1, 2 * x), x1 = Math.min(w - 1, 2 * x + 1), y0 = Math.min(h - 1, 2 * y), y1 = Math.min(h - 1, 2 * y + 1);
        next[y * nw + x] = (level[y0 * w + x0] + level[y0 * w + x1] + level[y1 * w + x0] + level[y1 * w + x1]) / 4;
      }
      level = next; w = nw; h = nh;
    };
    while (w > this.max || h > this.max) halve();
    let lv = 0;
    for (;;) {
      gl.texImage2D(gl.TEXTURE_2D, lv, gl.R16F, w, h, 0, gl.RED, gl.FLOAT, level);
      if (w === 1 && h === 1) break;
      halve();
      lv++;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, lv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(grid, t);
    return t;
  }

  /** The coastline's land, for the sea of a moment (uploaded for each picture that needs it). */
  private mask(source: TexImageSource): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    if (!this.maskTexture) {
      this.maskTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Draws a picture of the terrain (or the part of it at `offset`, `w` × `h` pixels) on the context's canvas. */
  draw(grid: ElevationGrid, look: TerrainLook, kind: TerrainImageKind, f: TerrainFrame, offset: [number, number], w: number, h: number, sea: TerrainSea = TODAY): void {
    const gl = this.gl, u = this.u;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    if (sea.mask) this.mask(sea.mask);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(grid));
    const { a, b, c, d, e, f: ty } = f.m, det = a * d - b * c;
    const ia = d / det, ib = -b / det, ic = -c / det, id = a / det, ie = (c * ty - d * e) / det, iff = (b * e - a * ty) / det;
    const pal = PALETTES[look.palette];
    gl.uniform1i(u.u_elev, 0);
    gl.uniform2f(u.u_tex, Math.min(grid.width, this.max), Math.min(grid.height, this.max));
    gl.uniform2f(u.u_size, w, h);
    gl.uniform2f(u.u_offset, offset[0], offset[1]);
    gl.uniformMatrix3fv(u.u_inv, false, [ia, ib, 0, ic, id, 0, ie, iff, 1]);
    gl.uniform1f(u.u_S, f.S);
    gl.uniform2f(u.u_origin, f.ox, f.oy);
    gl.uniform1f(u.u_lonRef, (f.lonRef * Math.PI) / 180);
    gl.uniform1i(u.u_proj, PROJ[f.kind] ?? 0);
    gl.uniform1i(u.u_mode, MODES[kind]);
    gl.uniform1f(u.u_shadeTint, look.relief ? 1.4 : 0);
    gl.uniform1f(u.u_exag, EXAGGERATION * look.strength);
    gl.uniform1f(u.u_seaRelief, look.seaFloor ? 0.7 : 0);
    gl.uniform3f(u.u_light, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform4fv(u.u_sea, rampUniform(pal.sea));
    gl.uniform1i(u.u_seaN, Math.min(8, pal.sea.length));
    gl.uniform4fv(u.u_land, rampUniform(pal.land));
    gl.uniform1i(u.u_landN, Math.min(8, pal.land.length));
    gl.uniform1f(u.u_seaLevel, sea.level);
    gl.uniform1i(u.u_mask, 1);
    gl.uniform1i(u.u_useMask, sea.mask ? 1 : 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

let shared: TerrainGL | null | undefined;
let failed = false;

/** The shared WebGL renderer (made on first use, again after the context is lost); null without WebGL2. */
function terrainGL(): TerrainGL | null {
  if (failed) return null;
  if (shared === undefined || (shared && shared.lost)) {
    try { shared = TerrainGL.create(); } catch (e) { console.error(e); shared = null; }
    if (!shared) failed = true;
  }
  return shared;
}

/** Can terrain be drawn here (WebGL2)? */
export function terrainDrawable(): boolean { return !!terrainGL(); }

/** A picture of terrain, and where its top left corner goes on the picture it was made for. */
export interface TerrainImage { image: ImageBitmap | OffscreenCanvas; x: number; y: number }

/** A renderer's last pictures of terrain, one of each kind, kept until what they show changes. */
export class TerrainPictures {
  private kept = new Map<TerrainImageKind, { key: string; out: TerrainImage }>();

  /**
   * A picture of the terrain for a frame (null when WebGL2 is not there): all of it, or the part
   * `part` ([x, y, width, height] in picture pixels). `gridKey` names the grid's content.
   */
  image(grid: ElevationGrid, gridKey: string, look: TerrainLook, kind: TerrainImageKind, f: TerrainFrame, part?: [number, number, number, number], sea: TerrainSea = TODAY): TerrainImage | null {
    const W = Math.max(1, Math.round(f.width)), H = Math.max(1, Math.round(f.height));
    const x0 = Math.max(0, Math.floor(part?.[0] ?? 0)), y0 = Math.max(0, Math.floor(part?.[1] ?? 0));
    const x1 = Math.min(W, Math.ceil(part ? part[0] + part[2] : W)), y1 = Math.min(H, Math.ceil(part ? part[1] + part[3] : H));
    if (x1 <= x0 || y1 <= y0) return null;
    const w = x1 - x0, h = y1 - y0;
    const { a, b, c, d, e } = f.m;
    const key = `${gridKey}|${JSON.stringify(look)}|${f.kind}|${f.S}|${f.ox}|${f.oy}|${f.lonRef}|${a},${b},${c},${d},${e},${f.m.f}|${W}x${H}|${x0},${y0},${w}x${h}|${sea.level}|${sea.maskKey}`;
    const k = this.kept.get(kind);
    if (k && k.key === key) return k.out;
    const gl = terrainGL();
    if (!gl) return null;
    let image: ImageBitmap | OffscreenCanvas;
    if (w <= gl.max && h <= gl.max) {
      gl.draw(grid, look, kind, f, [x0, y0], w, h, sea);
      image = gl.canvas.transferToImageBitmap();
    } else {
      // Larger than the graphics card draws at once: in tiles.
      const out = new OffscreenCanvas(w, h), ctx = out.getContext('2d')!;
      for (let y = 0; y < h; y += gl.max) for (let x = 0; x < w; x += gl.max) {
        const tw = Math.min(gl.max, w - x), th = Math.min(gl.max, h - y);
        gl.draw(grid, look, kind, f, [x0 + x, y0 + y], tw, th, sea);
        ctx.drawImage(gl.canvas, x, y);
      }
      image = out;
    }
    if (k && 'close' in k.out.image) k.out.image.close();
    const out = { image, x: x0, y: y0 };
    this.kept.set(kind, { key, out });
    return out;
  }

  /** Lets the pictures go (their memory is the graphics card's). */
  clear(): void {
    for (const k of this.kept.values()) if ('close' in k.out.image) k.out.image.close();
    this.kept.clear();
  }
}
