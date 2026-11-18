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
import type { TerrainCover } from '../terrain/cover.ts';
import type { DetailGrid } from '../terrain/detail.ts';
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
 * landmask: the land alone, opaque (for ending territory at the coast of the moment);
 * override: where sculpting has changed the terrain, opaque (D98: where Natural Earth's coastline gives way).
 */
export type TerrainImageKind = 'sea' | 'land' | 'both' | 'relief' | 'landmask' | 'override';
const MODES: Record<TerrainImageKind, number> = { sea: 0, land: 1, both: 2, relief: 3, landmask: 4, override: 5 };

/** Where sculpting has changed the terrain (D98): a mark for each cell of the grid, and a name for the marks. */
export interface TerrainOverride { data: Uint8Array; key: string }

/**
 * The sea of a moment (D96): its level (metres above today's) and, where Natural Earth's coastline is
 * drawn, that coastline's land as a picture the size of the terrain's picture (land opaque), so that at
 * today's level land is exactly what the coastline encloses (see heightAboveSea).
 */
export interface TerrainSea { level: number; mask: TexImageSource | null; maskKey: string }
const TODAY: TerrainSea = { level: 0, mask: null, maskKey: '' };
export const PROJ: Partial<Record<ProjectionName, number>> = { equirectangular: 0, mercator: 1, equalEarth: 2, naturalEarth: 3 };

/**
 * Undoing the projection on the graphics card: a plane point (x, and y up) to [longitude, latitude]
 * relative to the sheet's meridian (radians), as d3-geo's inverses (see terrain/look.ts invertPlane);
 * false where the point is off the planet. Needs `u_proj` (PROJ's codes) and `PI` declared before it.
 */
export const INVERT_PLANE = `bool invertPlane(vec2 p, out vec2 ll) {
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
`;

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
uniform sampler2D u_override;
uniform int u_useOverride;
uniform sampler2D u_cover;
uniform int u_useCover;
uniform sampler2D u_detail;
uniform int u_useDetail;
uniform vec4 u_detailBox;
uniform vec2 u_detailTex;
out vec4 outColor;
const float PI = 3.141592653589793;

${INVERT_PLANE}
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
  // Close in on the Earth (D101): inside the region of the finer grid, its heights. Its place on that
  // grid (longitudes taken round to the region's side of the planet), and how far from its edges.
  float dc = ll.x + u_lonRef - (u_detailBox.x + 0.5 * u_detailBox.z);
  dc -= 2.0 * PI * floor((dc + PI) / (2.0 * PI));
  vec2 uvD = vec2(dc / u_detailBox.z + 0.5, (u_detailBox.y - lat) / u_detailBox.w);
  vec2 gxD = dFdx(uvD), gyD = dFdy(uvD);
  vec2 edge = 2.0 / max(u_detailTex, vec2(1.0));
  bool inD = u_useDetail == 1 && all(greaterThan(uvD, edge)) && all(lessThan(uvD, vec2(1.0) - edge));
  vec2 su = inD ? uvD : uv, sgx = inD ? gxD : gx, sgy = inD ? gyD : gy;
  // What one pixel covers of the grid (at least a cell): slopes are measured across that much. (A
  // grid's width and height are angles: the whole planet's, or the region's.)
  vec2 span = inD ? u_detailBox.zw : vec2(2.0 * PI, PI);
  vec2 foot = max(abs(sgx) + abs(sgy), 1.0 / (inD ? u_detailTex : u_tex));
  float e, eW, eE, eN, eS;
  if (inD) {
    e = textureGrad(u_detail, su, sgx, sgy).r;
    eW = textureGrad(u_detail, su - vec2(foot.x, 0.0), sgx, sgy).r;
    eE = textureGrad(u_detail, su + vec2(foot.x, 0.0), sgx, sgy).r;
    eN = textureGrad(u_detail, su - vec2(0.0, foot.y), sgx, sgy).r;
    eS = textureGrad(u_detail, su + vec2(0.0, foot.y), sgx, sgy).r;
  } else {
    e = textureGrad(u_elev, su, sgx, sgy).r;
    eW = textureGrad(u_elev, su - vec2(foot.x, 0.0), sgx, sgy).r;
    eE = textureGrad(u_elev, su + vec2(foot.x, 0.0), sgx, sgy).r;
    eN = textureGrad(u_elev, su - vec2(0.0, foot.y), sgx, sgy).r;
    eS = textureGrad(u_elev, su + vec2(0.0, foot.y), sgx, sgy).r;
  }
  // Height above the sea of the moment: where a coastline is drawn, never below 0.5 m on its land
  // and never above -0.5 m off it (see heightAboveSea in terrain/sea-level.ts).
  // Where sculpting changed the terrain (D98), the terrain's own coast, whatever the coastline says.
  float over = u_useOverride == 1 ? texture(u_override, uv).r : 0.0;
  float h = e;
  if (u_useMask == 1) h = mix(texelFetch(u_mask, ivec2(dev), 0).a > 0.5 ? max(e, 0.5) : min(e, -0.5), e, over);
  float rel = h - u_seaLevel;
  // How much of the pixel is land: the coast is smoothed over about a pixel. (How fast the height
  // changes from pixel to pixel is worked out from the slope of the terrain, not from neighbouring
  // pixels: that would depend on where the picture starts, and a kept picture with room around the
  // view must be the picture drawn afresh.)
  float dEdu = (eE - eW) / (2.0 * foot.x), dEdv = (eS - eN) / (2.0 * foot.y);
  float perPixel = abs(dEdu * sgx.x + dEdv * sgx.y) + abs(dEdu * sgy.x + dEdv * sgy.y);
  float landA = clamp(rel / max(perPixel, 1e-3) + 0.5, 0.0, 1.0);
  if (!ok) { outColor = vec4(0.0); return; }
  if (u_mode == 4) { outColor = vec4(landA); return; }
  if (u_mode == 5) { outColor = vec4(over); return; }
  const float R = 6371008.8;
  float dxm = 2.0 * foot.x * span.x * R * max(cos(lat), 0.05);
  float dym = 2.0 * foot.y * span.y * R;
  // Seen from farther away, slopes are measured over longer distances and come out gentler: the
  // relief is exaggerated more, so it reads the same at every zoom. Close in on finer heights (D101)
  // the slopes are nearer their true steepness and are exaggerated less.
  float exag = u_exag * max(0.25, sqrt(dym / 20000.0));
  vec3 n = normalize(vec3(-(eE - eW) / dxm * exag, -(eN - eS) / dym * exag, 1.0));
  float shade = dot(n, u_light) - u_light.z;
  if (rel < 0.0) shade *= u_seaRelief;
  if (u_mode == 3) {
    float d = shade * 1.5;
    if (d < 0.0) { float a = min(0.7, -d); outColor = vec4(0.0, 0.0, 0.0, a); }
    else { float a = min(0.3, d * 0.5); outColor = vec4(a, a, a, a); }
    return;
  }
  // The land's colour: from its land cover in the satellite look (D100), else by its height.
  vec3 land = u_useCover == 1 && u_mode != 0 ? textureGrad(u_cover, uv, gx, gy).rgb : rampLand(max(rel, 0.0));
  vec3 col = u_mode == 1 ? land : u_mode == 0 ? rampSea(min(rel, 0.0)) : mix(rampSea(min(rel, 0.0)), land, landA);
  if (u_shadeTint > 0.0) {
    float s = shade * u_shadeTint;
    col = s < 0.0 ? col * (1.0 + max(s, -0.85)) : col + (vec3(1.0) - col) * min(s * 0.6, 0.6);
  }
  outColor = vec4(col, 1.0);
}`;

const UNIFORMS = ['u_elev', 'u_tex', 'u_size', 'u_offset', 'u_inv', 'u_S', 'u_origin', 'u_lonRef', 'u_proj', 'u_mode', 'u_shadeTint', 'u_exag', 'u_seaRelief', 'u_light', 'u_sea', 'u_seaN', 'u_land', 'u_landN', 'u_seaLevel', 'u_mask', 'u_useMask', 'u_override', 'u_useOverride', 'u_cover', 'u_useCover', 'u_detail', 'u_useDetail', 'u_detailBox', 'u_detailTex'] as const;
type UniformName = (typeof UNIFORMS)[number];

/** The relief's exaggeration at strength 1 (slopes ten kilometres across are gentle). */
const EXAGGERATION = 6;

class TerrainGL {
  private textures = new WeakMap<ElevationGrid, WebGLTexture>();
  private maskTexture: WebGLTexture | null = null;
  private overrides = new WeakMap<Uint8Array, WebGLTexture>();
  private covers = new WeakMap<object, WebGLTexture>();
  /** The finer grids' textures (D101), the last few: let go explicitly as the view moves on. */
  private details: Array<{ grid: DetailGrid; tex: WebGLTexture }> = [];
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

  /** A finer grid's texture (D101), made once; older ones are deleted. */
  private detailTexture(grid: DetailGrid): WebGLTexture {
    const have = this.details.find((d) => d.grid === grid);
    if (have) return have.tex;
    const tex = this.texture(grid, false);
    this.details.push({ grid, tex });
    while (this.details.length > 3) this.gl.deleteTexture(this.details.shift()!.tex);
    return tex;
  }

  /** The grid as a texture: heights in metres (half floats), with copies halved again and again for zoomed-out views. */
  private texture(grid: ElevationGrid, keep = true): WebGLTexture {
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, keep ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (keep) this.textures.set(grid, t);
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

  /** Where sculpting changed the terrain, as a texture laid like the grid's (one byte a cell). */
  private override(grid: ElevationGrid, marks: Uint8Array): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    let t = this.overrides.get(marks);
    if (!t) {
      t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      let w = grid.width, h = grid.height, data = new Uint8Array(marks.length);
      for (let k = 0; k < data.length; k++) data[k] = marks[k] ? 255 : 0;
      // (Halved like the heights when the grid is larger than the graphics card takes.)
      while (w > this.max || h > this.max) {
        const nw = w >> 1, nh = h >> 1, next = new Uint8Array(nw * nh);
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) next[y * nw + x] = Math.max(data[2 * y * w + 2 * x], data[2 * y * w + 2 * x + 1], data[(2 * y + 1) * w + 2 * x], data[(2 * y + 1) * w + 2 * x + 1]);
        data = next; w = nw; h = nh;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.overrides.set(marks, t);
    } else gl.bindTexture(gl.TEXTURE_2D, t);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** The land cover (D100) as a texture laid like the grid's, with copies halved for zoomed-out views. */
  private cover(c: TerrainCover): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3);
    let t = this.covers.get(c.pixels);
    if (!t) {
      t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      let w = c.width, h = c.height;
      if (c.pixels instanceof Uint8Array) {
        let data = c.pixels;
        // (Halved when larger than the graphics card takes.)
        while (w > this.max || h > this.max) {
          const nw = w >> 1, nh = h >> 1, next = new Uint8Array(nw * nh * 4);
          for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let q = 0; q < 4; q++) {
            next[(y * nw + x) * 4 + q] = (data[(2 * y * w + 2 * x) * 4 + q] + data[(2 * y * w + 2 * x + 1) * 4 + q] + data[((2 * y + 1) * w + 2 * x) * 4 + q] + data[((2 * y + 1) * w + 2 * x + 1) * 4 + q] + 2) >> 2;
          }
          data = next; w = nw; h = nh;
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c.pixels);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.covers.set(c.pixels, t);
    } else gl.bindTexture(gl.TEXTURE_2D, t);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Draws a picture of the terrain (or the part of it at `offset`, `w` × `h` pixels) on the context's canvas. */
  draw(grid: ElevationGrid, look: TerrainLook, kind: TerrainImageKind, f: TerrainFrame, offset: [number, number], w: number, h: number, sea: TerrainSea = TODAY, over: TerrainOverride | null = null, cover: TerrainCover | null = null, detail: DetailGrid | null = null): void {
    const gl = this.gl, u = this.u;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    if (sea.mask) this.mask(sea.mask);
    if (over) this.override(grid, over.data);
    if (cover) this.cover(cover);
    if (detail) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.detailTexture(detail));
      gl.activeTexture(gl.TEXTURE0);
    }
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
    gl.uniform1i(u.u_override, 2);
    gl.uniform1i(u.u_useOverride, over ? 1 : 0);
    gl.uniform1i(u.u_cover, 3);
    gl.uniform1i(u.u_useCover, cover ? 1 : 0);
    const rad = Math.PI / 180;
    gl.uniform1i(u.u_detail, 4);
    gl.uniform1i(u.u_useDetail, detail ? 1 : 0);
    gl.uniform4f(u.u_detailBox, detail ? detail.west * rad : 0, detail ? detail.north * rad : 0, detail ? detail.width * detail.dLon * rad : 1, detail ? detail.height * detail.dLat * rad : 1);
    gl.uniform2f(u.u_detailTex, detail ? Math.min(detail.width, this.max) : 1, detail ? Math.min(detail.height, this.max) : 1);
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
  image(grid: ElevationGrid, gridKey: string, look: TerrainLook, kind: TerrainImageKind, f: TerrainFrame, part?: [number, number, number, number], sea: TerrainSea = TODAY, over: TerrainOverride | null = null, cover: TerrainCover | null = null, detail: DetailGrid | null = null): TerrainImage | null {
    const W = Math.max(1, Math.round(f.width)), H = Math.max(1, Math.round(f.height));
    const x0 = Math.max(0, Math.floor(part?.[0] ?? 0)), y0 = Math.max(0, Math.floor(part?.[1] ?? 0));
    const x1 = Math.min(W, Math.ceil(part ? part[0] + part[2] : W)), y1 = Math.min(H, Math.ceil(part ? part[1] + part[3] : H));
    if (x1 <= x0 || y1 <= y0) return null;
    const w = x1 - x0, h = y1 - y0;
    const { a, b, c, d, e } = f.m;
    const key = `${gridKey}|${JSON.stringify(look)}|${f.kind}|${f.S}|${f.ox}|${f.oy}|${f.lonRef}|${a},${b},${c},${d},${e},${f.m.f}|${W}x${H}|${x0},${y0},${w}x${h}|${sea.level}|${sea.maskKey}|${over?.key ?? ''}|${cover?.key ?? ''}|${detail?.key ?? ''}`;
    const k = this.kept.get(kind);
    if (k && k.key === key) return k.out;
    const gl = terrainGL();
    if (!gl) return null;
    let image: ImageBitmap | OffscreenCanvas;
    if (w <= gl.max && h <= gl.max) {
      gl.draw(grid, look, kind, f, [x0, y0], w, h, sea, over, cover, detail);
      image = gl.canvas.transferToImageBitmap();
    } else {
      // Larger than the graphics card draws at once: in tiles.
      const out = new OffscreenCanvas(w, h), ctx = out.getContext('2d')!;
      for (let y = 0; y < h; y += gl.max) for (let x = 0; x < w; x += gl.max) {
        const tw = Math.min(gl.max, w - x), th = Math.min(gl.max, h - y);
        gl.draw(grid, look, kind, f, [x0 + x, y0 + y], tw, th, sea, over, cover, detail);
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
