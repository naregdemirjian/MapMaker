// The globe (D127). The part of the planet in view is first drawn flat by the renderer, as for any other
// view: an equirectangular picture around the middle of what is in view, `perRad` pixels to a radian.
// The graphics card then lays it onto a sphere seen from afar (the orthographic view): for each pixel of
// the frame the shader finds the place on the sphere it shows and reads the picture there, with mipmaps
// and anisotropic filtering so the land sloping away towards the edge stays clean. The sphere is lit from
// the upper left, and in pictures with a background it has a rim and a glow of air around its edge.

/** The flat picture of the part in view, and where it lies on the planet. */
export interface GlobePicture {
  image: OffscreenCanvas;
  width: number; height: number;
  /** Its middle (radians), its pixels to a radian, and whether it goes all the way round (a pole in view). */
  lonMid: number; latMid: number; perRad: number; round: boolean;
}

/** How the globe is seen in the frame (device pixels; angles in radians). */
export interface GlobeLook {
  width: number; height: number;
  /** The globe's middle and radius on the frame. */
  cx: number; cy: number; R: number;
  /** The place at the middle, and the frame's turn. */
  lon0: number; lat0: number; roll: number;
  /** How strongly it is lit and shaded (0: flat colours). */
  shade: number;
  /** The air's colour (0-1) and how far its glow reaches beyond the edge; null: none. */
  air: { rgb: [number, number, number]; width: number } | null;
  /** The colour around the globe (0-1, straight alpha); null: clear. */
  space: [number, number, number, number] | null;
}

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_texSize;
uniform vec3 u_mid;
uniform float u_round;
uniform vec2 u_size;
uniform vec3 u_globe;
uniform vec3 u_cam;
uniform float u_shade;
uniform vec4 u_air;
uniform vec4 u_space;
out vec4 o;
const float PI = 3.141592653589793;
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  vec2 d = (p - u_globe.xy) / u_globe.z;
  // Undo the frame's turn.
  float cr = cos(u_cam.z), sr = sin(u_cam.z);
  d = vec2(cr * d.x + sr * d.y, -sr * d.x + cr * d.y);
  float u = d.x, v = -d.y;
  float r2 = u * u + v * v, r = sqrt(r2);
  vec4 outside = u_space;
  if (u_air.w > 0.0 && r > 1.0) {
    float k = clamp(1.0 - (r - 1.0) * u_globe.z / u_air.w, 0.0, 1.0);
    float g = k * k * 0.5;
    outside = vec4(u_air.rgb * g, g) + outside * (1.0 - g);
  }
  // (Anti-aliased edge: the share of the pixel on the sphere.)
  float edge = clamp((1.0 - r) * u_globe.z + 0.5, 0.0, 1.0);
  if (edge <= 0.0) { o = outside; return; }
  float z = sqrt(max(0.0, 1.0 - min(r2, 1.0)));
  // From the viewer's frame to the planet's: tilted back from the middle's latitude, then turned to its longitude.
  float c0 = cos(u_cam.y), s0 = sin(u_cam.y);
  vec3 q = vec3(u, v * c0 + z * s0, -v * s0 + z * c0);
  float lon = atan(q.x, q.z) + u_cam.x;
  float lat = asin(clamp(q.y, -1.0, 1.0));
  float dl = lon - u_mid.x;
  dl -= 2.0 * PI * floor((dl + PI) / (2.0 * PI));
  vec2 t = vec2(u_texSize.x * 0.5 + dl * u_mid.z, u_texSize.y * 0.5 - (lat - u_mid.y) * u_mid.z);
  vec2 gx = dFdx(t), gy = dFdy(t);
  // (Where a picture going all the way round meets itself, the step across is not a gradient.)
  if (u_round > 0.5) { gx.x -= u_texSize.x * round(gx.x / u_texSize.x); gy.x -= u_texSize.x * round(gy.x / u_texSize.x); }
  vec4 c = textureGrad(u_tex, t / u_texSize, gx / u_texSize, gy / u_texSize);
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  float lit = 0.4 + 0.6 * max(dot(vec3(u, v, z), L), 0.0);
  c.rgb *= mix(1.0, lit, u_shade);
  if (u_air.w > 0.0) c.rgb += u_air.rgb * (pow(1.0 - z, 3.0) * 0.35 * c.a);
  vec4 inside = c * edge;
  o = inside + outside * (1.0 - inside.a);
}`;

class GlobeGL {
  canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private aniso: { ext: { TEXTURE_MAX_ANISOTROPY_EXT: number }; max: number } | null = null;
  readonly maxTexture: number;
  /** The picture the graphics card holds (shared by every renderer: one asking not to send its picture again gets it sent when another's is there). */
  private holding: OffscreenCanvas | null = null;

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`globe shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`globe program: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    for (const n of ['u_tex', 'u_texSize', 'u_mid', 'u_round', 'u_size', 'u_globe', 'u_cam', 'u_shade', 'u_air', 'u_space']) this.loc[n] = gl.getUniformLocation(prog, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const a = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
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
   * The globe for a frame, on this module's canvas (the frame's size), until the next call. `upload`
   * false: the picture is the one given last time (it is not sent to the graphics card again).
   */
  draw(pic: GlobePicture, look: GlobeLook, upload = true): OffscreenCanvas {
    const gl = this.gl;
    const W = Math.max(1, Math.round(look.width)), H = Math.max(1, Math.round(look.height));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // (Colours times their opacity, as the frame is: edges blend correctly.)
    if (upload || this.holding !== pic.image) {
      this.holding = pic.image;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic.image);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, this.aniso.max));
    const L = this.loc;
    gl.uniform1i(L.u_tex, 0);
    gl.uniform2f(L.u_texSize, pic.width, pic.height);
    gl.uniform3f(L.u_mid, pic.lonMid, pic.latMid, pic.perRad);
    gl.uniform1f(L.u_round, pic.round ? 1 : 0);
    gl.uniform2f(L.u_size, W, H);
    gl.uniform3f(L.u_globe, look.cx, look.cy, look.R);
    gl.uniform3f(L.u_cam, look.lon0, look.lat0, look.roll);
    gl.uniform1f(L.u_shade, look.shade);
    gl.uniform4f(L.u_air, look.air?.rgb[0] ?? 0, look.air?.rgb[1] ?? 0, look.air?.rgb[2] ?? 0, look.air?.width ?? 0);
    const sp = look.space;
    gl.uniform4f(L.u_space, sp ? sp[0] * sp[3] : 0, sp ? sp[1] * sp[3] : 0, sp ? sp[2] * sp[3] : 0, sp ? sp[3] : 0);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

let shared: GlobeGL | null | undefined;

/** The globe's drawing on the graphics card (null where WebGL2 is not there). */
export function globeGL(): GlobeGL | null {
  if (shared === undefined) {
    try { shared = new GlobeGL(); } catch { shared = null; }
  }
  return shared;
}

/**
 * The longitudes and latitudes a globe shows in a frame (radians; the longitudes relative to the
 * middle's, so the range may pass ±π), found from points across the frame and round the globe's edge,
 * and whether a pole is in view (then every longitude is).
 */
export function globeInView(width: number, height: number, cx: number, cy: number, R: number, lon0: number, lat0: number, roll: number): { west: number; east: number; south: number; north: number; round: boolean } | null {
  const c0 = Math.cos(lat0), s0 = Math.sin(lat0), cr = Math.cos(roll), sr = Math.sin(roll);
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  const at = (x: number, y: number) => {
    let dx = (x - cx) / R, dy = (y - cy) / R;
    [dx, dy] = [cr * dx + sr * dy, -sr * dx + cr * dy];
    const u = dx, v = -dy, r2 = u * u + v * v;
    if (r2 > 1) return;
    const z = Math.sqrt(1 - r2);
    const qx = u, qy = v * c0 + z * s0, qz = -v * s0 + z * c0;
    const dl = Math.atan2(qx, qz), lat = Math.asin(Math.max(-1, Math.min(1, qy)));
    if (dl < west) west = dl; if (dl > east) east = dl; if (lat < south) south = lat; if (lat > north) north = lat;
  };
  const N = 40;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) at((i / N) * width, (j / N) * height);
  // Round the edge (just inside it), where it is in the frame.
  for (let k = 0; k < 720; k++) {
    const a = (k / 720) * 2 * Math.PI, x = cx + Math.cos(a) * R * 0.9999, y = cy + Math.sin(a) * R * 0.9999;
    if (x >= 0 && y >= 0 && x <= width && y <= height) at(x, y);
  }
  if (west > east) return null;
  // A pole on the near side and in the frame: all the way round.
  let round = false;
  for (const pole of [1, -1]) {
    const qy = pole, qz = 0; // the pole's direction in the planet's frame, as seen: undo the tilt
    const v = qy * c0 - qz * s0, z = qy * s0 + qz * c0;
    if (z < 0) continue;
    let dx = 0, dy = -v;
    [dx, dy] = [cr * dx - sr * dy, sr * dx + cr * dy];
    const x = cx + dx * R, y = cy + dy * R;
    if (x >= -R * 0.02 && y >= -R * 0.02 && x <= width + R * 0.02 && y <= height + R * 0.02) {
      round = true;
      if (pole > 0) north = Math.PI / 2; else south = -Math.PI / 2;
    }
  }
  // (The sampling misses up to a step between samples: a margin of that, and a little more.)
  const step = Math.max(east - west, north - south) / N + 0.02;
  return {
    west: round ? -Math.PI : west - step, east: round ? Math.PI : east + step,
    south: Math.max(-Math.PI / 2, south - step), north: Math.min(Math.PI / 2, north + step), round,
  };
}
