// Fields on the graphics card (Stage 9, D102). A field layer's picture is made in two steps. First
// every source in force is drawn as a rectangle around its reach (thousands in one call), and for
// each pixel there the shader finds the place it shows (undoing the projection, as for terrain), its
// distance and bearing from the source on the sphere, and the source's value there (domain/fields.ts
// is the reference); the values are added up in a picture of numbers. Then that picture is coloured
// by the field's ramp, see-through where there is little or nothing. The result is laid over the map
// like the terrain's pictures (TerrainFrame: the sheet's plane and where it lies on the picture).
import { INVERT_PLANE, PROJ, type TerrainFrame } from './terrain-gl.ts';
import { FIELD_TYPES, type FieldType } from '../domain/fields.ts';
import type { SpreadRaster } from '../domain/spread.ts';

/** One source as drawn: its rectangle on the picture and what the shader needs of it (see FieldGL). */
export interface FieldInstance {
  /** Picture pixels: left, top, right, bottom. */
  rect: [number, number, number, number];
  /** Longitude and latitude (radians, the longitude relative to nothing: the shader takes the sheet's meridian into account). */
  lon: number; lat: number;
  /** Radius (km, as grown), value at the middle (intensity × strength), how uneven its edge (0-1). */
  radius: number; value: number; noise: number;
  /** A plume: the direction the wind carries it (radians from north) and how far it has gone (km); null for a circle. */
  plume: { dir: number; length: number } | null;
  /** The phases of its uneven edge (radians). */
  phases: [number, number, number];
}

const FLOATS = 16;

/**
 * A source spreading over the terrain (D103) as drawn: its grid, its rectangle on the picture, and
 * its moment: its age and life (days), its value at the peak, and a flood's water level then (metres
 * above the ground at the source).
 */
export interface FieldRaster {
  raster: SpreadRaster; rect: [number, number, number, number];
  age: number; rise: number; hold: number; decay: number; value: number; level: number;
}

const RASTER_VERTEX = `#version 300 es
in vec2 a_corner;
uniform vec4 u_rect;
uniform vec2 u_size;
uniform vec2 u_offset;
void main() {
  vec2 px = mix(u_rect.xy, u_rect.zw, a_corner) - u_offset;
  vec2 clip = px / u_size * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const RASTER = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_size;
uniform vec2 u_offset;
uniform mat3 u_inv;
uniform float u_S;
uniform vec2 u_origin;
uniform float u_lonRef;
uniform int u_proj;
uniform float u_scale;
uniform highp sampler2D u_r;
uniform ivec2 u_rsize;
uniform vec4 u_box;
uniform int u_flood;
uniform vec4 u_life;
uniform float u_value;
uniform float u_level;
out vec4 outV;
const float PI = 3.141592653589793;
${INVERT_PLANE}
// A source's strength at an age (domain/fields.ts strengthAt): rising, lasting, halving, gone once faded.
float strengthAt(float age) {
  if (age < 0.0) return 0.0;
  if (age < u_life.x) { float x = age / u_life.x; return x * x * (3.0 - 2.0 * x); }
  if (age <= u_life.x + u_life.y) return 1.0;
  if (u_life.z <= 0.0) return 0.0;
  float v = exp2(-(age - u_life.x - u_life.y) / u_life.z);
  return v < 0.004 ? 0.0 : v;
}
vec2 cell(ivec2 p) { return texelFetch(u_r, clamp(p, ivec2(0), u_rsize - 1), 0).rg; }
void main() {
  vec2 dev = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) + u_offset;
  vec2 sheet = (u_inv * vec3(dev, 1.0)).xy;
  vec2 plane = sheet / u_S + u_origin;
  vec2 ll;
  if (!invertPlane(vec2(plane.x, -plane.y), ll)) discard;
  float dc = ll.x + u_lonRef - (u_box.x + 0.5 * u_box.z);
  dc -= 2.0 * PI * floor((dc + PI) / (2.0 * PI));
  vec2 uv = vec2(dc / u_box.z + 0.5, (u_box.y - ll.y) / u_box.w);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  // Between the four nearest cells' middles, of those it reaches; its edge fades out between cells.
  vec2 p = uv * vec2(u_rsize) - 0.5, f = p - floor(p);
  ivec2 i0 = ivec2(floor(p));
  vec2 c00 = cell(i0), c10 = cell(i0 + ivec2(1, 0)), c01 = cell(i0 + ivec2(0, 1)), c11 = cell(i0 + ivec2(1, 1));
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  w *= vec4(step(c00.x, 5.0e8), step(c10.x, 5.0e8), step(c01.x, 5.0e8), step(c11.x, 5.0e8));
  float reach = w.x + w.y + w.z + w.w;
  if (reach <= 0.0) discard;
  vec2 v = (c00 * w.x + c10 * w.y + c01 * w.z + c11 * w.w) / reach;
  float val = 0.0;
  {
    // A flood: as deep as the water stands above the ground, where it has spilled to; a fire or lava:
    // the source's life counted from when it arrived.
    if (u_flood == 1) val = v.x <= u_level ? max(0.0, u_level - v.y) : 0.0;
    else val = u_value * strengthAt(u_life.w - v.x);
  }
  outV = vec4(val * smoothstep(0.2, 0.8, reach) * u_scale, 0.0, 0.0, 1.0);
}`;

const VERTEX = `#version 300 es
in vec2 a_corner;
in vec4 a_rect;
in vec4 a_c;
in vec4 a_s;
in vec4 a_p;
uniform vec2 u_size;
uniform vec2 u_offset;
out vec4 v_c;
out vec4 v_s;
out vec4 v_p;
void main() {
  vec2 px = mix(a_rect.xy, a_rect.zw, a_corner) - u_offset;
  vec2 clip = px / u_size * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_c = a_c; v_s = a_s; v_p = a_p;
}`;

const ACCUMULATE = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_size;
uniform vec2 u_offset;
uniform mat3 u_inv;
uniform float u_S;
uniform vec2 u_origin;
uniform float u_lonRef;
uniform int u_proj;
uniform float u_R;
uniform float u_scale;
in vec4 v_c;
in vec4 v_s;
in vec4 v_p;
out vec4 outV;
const float PI = 3.141592653589793;
${INVERT_PLANE}
void main() {
  vec2 dev = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) + u_offset;
  vec2 sheet = (u_inv * vec3(dev, 1.0)).xy;
  vec2 plane = sheet / u_S + u_origin;
  vec2 ll;
  if (!invertPlane(vec2(plane.x, -plane.y), ll)) discard;
  float lam = ll.x + u_lonRef, phi = ll.y, l0 = v_c.x, p0 = v_c.y;
  float dl = lam - l0;
  float sp = sin((phi - p0) * 0.5), sl = sin(dl * 0.5);
  float h = sp * sp + cos(p0) * cos(phi) * sl * sl;
  float d = 2.0 * u_R * asin(min(1.0, sqrt(h)));
  float b = atan(sin(dl) * cos(phi), cos(p0) * sin(phi) - sin(p0) * cos(phi) * cos(dl));
  float r = v_c.z, f = 0.0;
  if (v_s.y > 0.5) {
    // A plume (domain/fields.ts sourceValue): along the wind and across it.
    float a = d * cos(b - v_s.z), c = d * sin(b - v_s.z), L = v_s.w;
    float along = clamp(a, 0.0, L), width = r + 0.375 * along;
    float front = r + 0.3 * L;
    float ends = a < 0.0 ? exp(-2.0 * (a / r) * (a / r)) : a > L ? exp(-2.0 * ((a - L) / front) * ((a - L) / front)) : 1.0;
    f = exp(-2.0 * (c / width) * (c / width)) * ends * (r / width);
  } else {
    float edge = v_s.x > 0.0 ? max(0.2, 1.0 + 0.45 * v_s.x * (0.5 * sin(3.0 * b + v_p.x) + 0.3 * sin(5.0 * b + v_p.y) + 0.2 * sin(11.0 * b + v_p.z))) : 1.0;
    float u = d / (r * edge);
    f = u >= 1.0 ? 0.0 : (1.0 - u * u) * (1.0 - u * u);
  }
  outV = vec4(v_c.w * f * u_scale, 0.0, 0.0, 1.0);
}`;

const COLOUR_VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const COLOUR = `#version 300 es
precision highp float;
uniform sampler2D u_acc;
uniform float u_full;
uniform float u_opacity;
uniform vec4 u_stopC[8];
uniform float u_stopT[8];
uniform int u_stops;
out vec4 outColor;
void main() {
  float v = texelFetch(u_acc, ivec2(gl_FragCoord.xy), 0).r / u_full;
  vec4 c = u_stopC[0];
  if (v > u_stopT[0]) {
    c = u_stopC[u_stops - 1];
    for (int i = 1; i < 8; i++) {
      if (i >= u_stops) break;
      if (v <= u_stopT[i]) { c = mix(u_stopC[i - 1], u_stopC[i], (v - u_stopT[i - 1]) / (u_stopT[i] - u_stopT[i - 1])); break; }
    }
  }
  float a = c.a * u_opacity;
  outColor = vec4(c.rgb * a, a);
}`;

class FieldGL {
  readonly canvas: OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  readonly max: number;
  /** Whether sums are kept as floats (else as bytes, the value as a share of the field's full value). */
  readonly floats: boolean;
  private acc: WebGLProgram; private colour: WebGLProgram; private raster: WebGLProgram;
  private vaoRaster: WebGLVertexArrayObject;
  private ur: Record<string, WebGLUniformLocation | null> = {};
  private rasterTextures = new WeakMap<SpreadRaster, WebGLTexture>();
  private quad: WebGLBuffer; private inst: WebGLBuffer; private tri: WebGLBuffer;
  private vaoAcc: WebGLVertexArrayObject; private vaoColour: WebGLVertexArrayObject;
  private fbo: WebGLFramebuffer; private tex: WebGLTexture; private size = [0, 0];
  private ua: Record<string, WebGLUniformLocation | null> = {};
  private uc: Record<string, WebGLUniformLocation | null> = {};

  private constructor(canvas: OffscreenCanvas, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.floats = !!gl.getExtension('EXT_color_buffer_float');
    this.max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, (gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array)[0], gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
    const program = (vs: string, fs: string) => {
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Field shader: ${gl.getShaderInfoLog(s)}`);
        return s;
      };
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Field shader: ${gl.getProgramInfoLog(p)}`);
      return p;
    };
    this.acc = program(VERTEX, ACCUMULATE);
    this.colour = program(COLOUR_VERTEX, COLOUR);
    this.raster = program(RASTER_VERTEX, RASTER);
    for (const n of ['u_rect', 'u_size', 'u_offset', 'u_inv', 'u_S', 'u_origin', 'u_lonRef', 'u_proj', 'u_scale', 'u_r', 'u_rsize', 'u_box', 'u_flood', 'u_life', 'u_value', 'u_level']) this.ur[n] = gl.getUniformLocation(this.raster, n);
    for (const n of ['u_size', 'u_offset', 'u_inv', 'u_S', 'u_origin', 'u_lonRef', 'u_proj', 'u_R', 'u_scale']) this.ua[n] = gl.getUniformLocation(this.acc, n);
    for (const n of ['u_acc', 'u_full', 'u_opacity', 'u_stopC', 'u_stopT', 'u_stops']) this.uc[n] = gl.getUniformLocation(this.colour, n);
    // The sources: a unit square, drawn once for each (its rectangle and settings per instance).
    this.vaoAcc = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoAcc);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(this.acc, 'a_corner');
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    ['a_rect', 'a_c', 'a_s', 'a_p'].forEach((n, i) => {
      const loc = gl.getAttribLocation(this.acc, n);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(loc, 1);
    });
    // The spreads: the same unit square, its rectangle given for each.
    this.vaoRaster = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoRaster);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const rc = gl.getAttribLocation(this.raster, 'a_corner');
    gl.enableVertexAttribArray(rc);
    gl.vertexAttribPointer(rc, 2, gl.FLOAT, false, 0, 0);
    // The colouring: one triangle over the whole picture.
    this.vaoColour = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoColour);
    this.tri = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(this.colour, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.fbo = gl.createFramebuffer()!;
    this.tex = gl.createTexture()!;
  }

  static create(): FieldGL | null {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    return new FieldGL(canvas, gl);
  }

  get lost(): boolean { return this.gl.isContextLost(); }

  /** The picture of numbers the sums go into, as large as the part drawn. */
  private target(w: number, h: number): void {
    const gl = this.gl;
    if (this.size[0] === w && this.size[1] === h) return;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.floats) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.size = [w, h];
  }

  /** Draws a field layer's picture (or the part at `offset`, `w` × `h` pixels) on the context's canvas. */
  /** A spread's grid as a texture (two floats a cell, read cell by cell). */
  private rasterTexture(r: SpreadRaster): WebGLTexture {
    let t = this.rasterTextures.get(r);
    if (t) return t;
    const gl = this.gl;
    t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, r.width, r.height, 0, gl.RG, gl.FLOAT, r.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.rasterTextures.set(r, t);
    return t;
  }

  draw(type: FieldType, opacity: number, sources: FieldInstance[], f: TerrainFrame, offset: [number, number], w: number, h: number, radiusKm: number, rasters: FieldRaster[] = []): void {
    const gl = this.gl, def = FIELD_TYPES[type];
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.target(w, h);
    // The sums.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.acc);
    const { a, b, c, d, e, f: ty } = f.m, det = a * d - b * c;
    const ia = d / det, ib = -b / det, ic = -c / det, id = a / det, ie = (c * ty - d * e) / det, iff = (b * e - a * ty) / det;
    gl.uniform2f(this.ua.u_size, w, h);
    gl.uniform2f(this.ua.u_offset, offset[0], offset[1]);
    gl.uniformMatrix3fv(this.ua.u_inv, false, [ia, ib, 0, ic, id, 0, ie, iff, 1]);
    gl.uniform1f(this.ua.u_S, f.S);
    gl.uniform2f(this.ua.u_origin, f.ox, f.oy);
    gl.uniform1f(this.ua.u_lonRef, (f.lonRef * Math.PI) / 180);
    gl.uniform1i(this.ua.u_proj, PROJ[f.kind] ?? 0);
    gl.uniform1f(this.ua.u_R, radiusKm);
    gl.uniform1f(this.ua.u_scale, this.floats ? 1 : 1 / def.full);
    const data = new Float32Array(sources.length * FLOATS);
    sources.forEach((s, i) => {
      data.set([...s.rect, s.lon, s.lat, s.radius, s.value, s.noise, s.plume ? 1 : 0, s.plume?.dir ?? 0, s.plume?.length ?? 0, ...s.phases, 0], i * FLOATS);
    });
    gl.bindVertexArray(this.vaoAcc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    if (sources.length) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, sources.length);
    // The spreads (D103), one at a time, each with its grid.
    if (rasters.length) {
      gl.useProgram(this.raster);
      const u = this.ur, rad = Math.PI / 180;
      gl.uniform2f(u.u_size, w, h);
      gl.uniform2f(u.u_offset, offset[0], offset[1]);
      gl.uniformMatrix3fv(u.u_inv, false, [ia, ib, 0, ic, id, 0, ie, iff, 1]);
      gl.uniform1f(u.u_S, f.S);
      gl.uniform2f(u.u_origin, f.ox, f.oy);
      gl.uniform1f(u.u_lonRef, f.lonRef * rad);
      gl.uniform1i(u.u_proj, PROJ[f.kind] ?? 0);
      gl.uniform1f(u.u_scale, this.floats ? 1 : 1 / def.full);
      gl.uniform1i(u.u_r, 1);
      gl.bindVertexArray(this.vaoRaster);
      gl.activeTexture(gl.TEXTURE1);
      for (const r of rasters) {
        const g = r.raster;
        gl.bindTexture(gl.TEXTURE_2D, this.rasterTexture(g));
        gl.uniform4f(u.u_rect, ...r.rect);
        gl.uniform2i(u.u_rsize, g.width, g.height);
        gl.uniform4f(u.u_box, g.west * rad, g.north * rad, g.width * g.dLon * rad, g.height * g.dLat * rad);
        gl.uniform1i(u.u_flood, g.kind === 'flood' ? 1 : 0);
        gl.uniform4f(u.u_life, r.rise, r.hold, r.decay, r.age);
        gl.uniform1f(u.u_value, r.value);
        gl.uniform1f(u.u_level, r.level);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.disable(gl.BLEND);
    // Coloured by the ramp.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.colour);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.uc.u_acc, 0);
    gl.uniform1f(this.uc.u_full, this.floats ? def.full : 1);
    gl.uniform1f(this.uc.u_opacity, opacity);
    const stops = def.ramp.slice(0, 8);
    gl.uniform4fv(this.uc.u_stopC, Float32Array.from(Array.from({ length: 8 }, (_, i) => { const s = stops[Math.min(i, stops.length - 1)]; return [s[1] / 255, s[2] / 255, s[3] / 255, s[4]]; }).flat()));
    gl.uniform1fv(this.uc.u_stopT, Float32Array.from(Array.from({ length: 8 }, (_, i) => stops[Math.min(i, stops.length - 1)][0])));
    gl.uniform1i(this.uc.u_stops, stops.length);
    gl.bindVertexArray(this.vaoColour);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

let shared: FieldGL | null | undefined;
let failed = false;
function fieldGL(): FieldGL | null {
  if (failed) return null;
  if (shared === undefined || (shared && shared.lost)) {
    try { shared = FieldGL.create(); } catch (e) { console.error(e); shared = null; }
    if (!shared) failed = true;
  }
  return shared;
}

/** Can fields be drawn here (WebGL2)? */
export function fieldsDrawable(): boolean { return !!fieldGL(); }

/** The phases of a source's uneven edge, from its seed (as domain/fields.ts edgeAt). */
export function edgePhases(seed: number): [number, number, number] {
  const p = (k: number) => (((seed * 9301 + k * 49297) % 233280) / 233280) * 2 * Math.PI;
  return [p(1), p(2), p(3)];
}

/** A renderer's last picture of each field layer, kept until what it shows changes. */
export class FieldPictures {
  private kept = new Map<string, { key: string; image: ImageBitmap | OffscreenCanvas }>();

  /** The picture of a field layer for a frame (all of it), or null without WebGL2. `key`: what the picture shows. */
  image(layerId: string, key: string, type: FieldType, opacity: number, sources: FieldInstance[], f: TerrainFrame, radiusKm: number, rasters: FieldRaster[] = []): ImageBitmap | OffscreenCanvas | null {
    const W = Math.max(1, Math.round(f.width)), H = Math.max(1, Math.round(f.height));
    const k = this.kept.get(layerId);
    const full = `${key}|${W}x${H}`;
    if (k && k.key === full) return k.image;
    const gl = fieldGL();
    if (!gl) return null;
    let image: ImageBitmap | OffscreenCanvas;
    if (W <= gl.max && H <= gl.max) {
      gl.draw(type, opacity, sources, f, [0, 0], W, H, radiusKm, rasters);
      image = gl.canvas.transferToImageBitmap();
    } else {
      const out = new OffscreenCanvas(W, H), ctx = out.getContext('2d')!;
      for (let y = 0; y < H; y += gl.max) for (let x = 0; x < W; x += gl.max) {
        const tw = Math.min(gl.max, W - x), th = Math.min(gl.max, H - y);
        gl.draw(type, opacity, sources, f, [x, y], tw, th, radiusKm, rasters);
        ctx.drawImage(gl.canvas, x, y);
      }
      image = out;
    }
    if (k && 'close' in k.image) k.image.close();
    this.kept.set(layerId, { key: full, image });
    return image;
  }

  /** Lets the pictures go. */
  clear(): void {
    for (const k of this.kept.values()) if ('close' in k.image) k.image.close();
    this.kept.clear();
  }
}
