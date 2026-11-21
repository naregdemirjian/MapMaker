// A galaxy's picture laid on its plane by the graphics card (D193). The picture is sent once (with
// mipmaps and anisotropic filtering, so it stays clean seen small or at a slant); for a view the plane is
// a grid of points, each placed where the camera sees it and carrying how near it is, so the card draws
// the picture in true perspective in one go. Where WebGL2 is missing the renderer draws the picture in
// pieces on a canvas instead.
import type { SpaceView } from './space-view.ts';
import type { GalaxyImage } from './galaxy-pictures.ts';

const VERTEX = `#version 300 es
in vec3 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() { v_uv = a_uv; gl_Position = vec4(a_pos.xy, 0.0, a_pos.z); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_alpha;
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  // (With u_alpha the light is the opacity: as bright over black, clear where there is none.)
  o = vec4(c, mix(1.0, max(c.r, max(c.g, c.b)), u_alpha));
}`;

/** Points along each side of the plane's grid. */
const GRID = 24;

class GalaxyGL {
  canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private points: WebGLBuffer;
  private order: WebGLBuffer;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private aniso: { ext: { TEXTURE_MAX_ANISOTROPY_EXT: number }; max: number } | null = null;
  private maxTexture: number;
  /** The picture the graphics card holds. */
  private holding = -1;
  private lost = false;

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas.addEventListener?.('webglcontextlost', () => { this.lost = true; });
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`galaxy shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`galaxy program: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    for (const n of ['u_tex', 'u_alpha']) this.loc[n] = gl.getUniformLocation(prog, n);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.points = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.points);
    const aPos = gl.getAttribLocation(prog, 'a_pos'), aUv = gl.getAttribLocation(prog, 'a_uv');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 20, 12);
    this.order = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.order);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic') as { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number } | null;
    if (ext) this.aniso = { ext, max: gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number };
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  }

  /**
   * The picture seen in a view, on this module's canvas (W by H device pixels, `k` of them to one of the
   * view's), until the next call; clear where the plane is not. `alpha`: its light as its opacity. Null if
   * the graphics card cannot draw it (the caller draws it its own way).
   */
  draw(pic: GalaxyImage, view: SpaceView, W: number, H: number, k: number, alpha: boolean): OffscreenCanvas | null {
    const gl = this.gl;
    if (this.lost || gl.isContextLost()) return null;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.holding !== pic.version) {
      // (The largest copy of the picture the card takes.)
      const level = pic.levels.find((l) => l.size <= this.maxTexture);
      if (!level) return null;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, level.image as TexImageSource);
      gl.generateMipmap(gl.TEXTURE_2D);
      if (gl.getError() !== gl.NO_ERROR) { this.holding = -1; return null; }
      this.holding = pic.version;
    }
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, this.aniso.max));
    // The grid: each point where the camera sees it, with how far it is (so the card works in true perspective).
    const E = pic.extent, n = GRID + 1;
    const pts = new Float32Array(n * n * 5), seen = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = i / GRID, v = j / GRID, q = j * n + i;
      const p = view.project([-E + u * 2 * E, E - v * 2 * E, 0]);
      if (!p) continue;
      seen[q] = 1;
      const w = 1 / p[2];
      pts.set([((p[0] * k * 2) / W - 1) * w, (1 - (p[1] * k * 2) / H) * w, w, u, v], q * 5);
    }
    const order = new Uint16Array(GRID * GRID * 6);
    let count = 0;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      if (!seen[a] || !seen[b] || !seen[c] || !seen[d]) continue;
      order.set([a, b, c, b, d, c], count);
      count += 6;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.points);
    gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.order);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, order, gl.DYNAMIC_DRAW);
    gl.uniform1i(this.loc.u_tex, 0);
    gl.uniform1f(this.loc.u_alpha, alpha ? 1 : 0);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count) gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    return this.canvas;
  }
}

let shared: GalaxyGL | null | undefined;
let off = false;

/** The galaxy's drawing on the graphics card (null where WebGL2 is not there, or switched off for a test). */
export function galaxyGL(): GalaxyGL | null {
  if (off || typeof OffscreenCanvas === 'undefined') return null;
  if (shared === undefined) {
    try { shared = new GalaxyGL(); } catch { shared = null; }
  }
  return shared;
}
/** Draw galaxies without the graphics card (for tests of that way). */
export function setGalaxyGL(on: boolean): void { off = !on; }
