/** Shared UI metadata for the fixed, locally served FlightHelmet PBR baseline. */
export const FLIGHTHELMET_ASSET = Object.freeze({
  name: 'FlightHelmet',
  file: './assets/flighthelmet/FlightHelmet512.glb',
  source_revision: '4995a638c96dbc94376d3d6164e70fee3ac7f7a2',
  sha256: 'e45247aaa51e168e80d65d1fc1d71538500f963ea30e868a5f7cef902e0ecbaf',
  derivative_name: 'FlightHelmet512px',
  transfer_bytes: 7428104,
  unique_asset_images: 15,
  asset_texture_bytes_including_mips: 20971500,
  texture_byte_scope: 'unique asset RGBA8 pixels including mips; excludes fallback textures, geometry, framebuffers, depth and driver overhead',
  primitive_count: 6,
  material_count: 6,
  texture_max_dimension: 512,
  vertex_count: 55392,
  triangle_count: 94722,
  identity_source: 'pinned local derivative; build manifest SHA256',
});
export const PBR_LIGHTING = Object.freeze({
  model: 'glTF metallic-roughness; GGX direct lighting',
  exposure: 1,
  direct_light_direction_unnormalized: Object.freeze([-0.5, 0.8, 1]),
  direct_light_direction_policy: 'normalized in shader',
  direct_light_radiance: Object.freeze([3, 3, 3]),
  shadows: false,
  scope: 'built-in baseline; custom WGSL may alter lighting',
  tone_mapping: 'Reinhard',
  image_based_lighting: false,
  ambient_occlusion_on_direct_light: false,
  transmission: 'unsupported; opaque lens fallback',
});
export const DEFAULT_PBR_DEBUG = 0;
export const DEFAULT_PBR_FLAGS = 7;
export const PBR_DEBUG_MODES = Object.freeze([
  Object.freeze({id: 0, key: 'lit', name: 'Lit · PBR'}),
  Object.freeze({id: 1, key: 'base-color', name: 'Base color'}),
  Object.freeze({id: 2, key: 'normal', name: 'Normal'}),
  Object.freeze({id: 3, key: 'metallic', name: 'Metallic'}),
  Object.freeze({id: 4, key: 'roughness', name: 'Roughness'}),
]);
export const PBR_TEXTURE_INPUTS = Object.freeze([
  Object.freeze({bit: 1, key: 'base-color', name: 'Base color texture'}),
  Object.freeze({bit: 2, key: 'normal', name: 'Normal texture'}),
  Object.freeze({bit: 4, key: 'orm', name: 'ORM texture'}),
]);
export const PBR_CAMERAS = Object.freeze([
  Object.freeze({id: 0, key: 'front-three-quarter', name: '正面 · 3/4', eye: Object.freeze([0.7, 0.5, 1.1])}),
  Object.freeze({id: 1, key: 'rear', name: '背面', eye: Object.freeze([-0.8, 0.55, -1.1])}),
]);
function validInteger(value, maximum, label) {
  const number = Number(value);
  if ((typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) || !Number.isInteger(number) || number < 0 || number > maximum) throw new Error(`${label} の値が無効です。`);
  return number;
}
export const pbrDebug = value => validInteger(value, PBR_DEBUG_MODES.length - 1, 'PBR debug');
export const pbrFlags = value => validInteger(value, DEFAULT_PBR_FLAGS, 'PBR texture flags');
export const pbrCamera = value => validInteger(value, PBR_CAMERAS.length - 1, 'FlightHelmet camera');

/** Construction performs no I/O. Failed requests are retryable, successful bytes
 * remain cached even if decode/upload fails. All calls share one upload promise.
 * The caller must hold OperationGate while ensureLoaded borrows the WASM core. */
export class FlightHelmetLoader {
  constructor(fetchBytes) {
    this.fetchBytes = fetchBytes;
    this.bytesPromise = null;
    this.loadPromise = null;
    this.loaded = false;
  }
  bytes() {
    if (!this.bytesPromise) {
      this.bytesPromise = Promise.resolve().then(this.fetchBytes).then(bytes => {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('FlightHelmet GLB が空、または無効です。');
        return bytes;
      }).catch(error => {
        this.bytesPromise = null;
        throw error;
      });
    }
    return this.bytesPromise;
  }
  ensureLoaded(lab) {
    if (this.loaded) return Promise.resolve();
    if (!this.loadPromise) {
      this.loadPromise = this.bytes().then(bytes => lab.load_flighthelmet(bytes)).then(() => {
        this.loaded = true;
        this.bytesPromise = null; // Release GLB staging after shared GPU upload succeeds.
      }).finally(() => { this.loadPromise = null; });
    }
    return this.loadPromise;
  }
}

/** Bound network staging as well as the core decoder. The URL is fixed same-origin. */
export async function readBoundedAsset(response, maxBytes = 8 * 1024 * 1024) {
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    if (response.body) await response.body.cancel();
    throw new Error('FlightHelmet GLB exceeds the 8 MiB transfer budget.');
  }
  if (!response.body) throw new Error('FlightHelmet response has no readable body.');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error('FlightHelmet GLB exceeds the 8 MiB transfer budget.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
