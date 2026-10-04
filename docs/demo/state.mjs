/** Pure UI helpers; renderer state lives exclusively in the Rust core. */
export const DEFAULT_EXPERIMENT = 2;
export const EXPERIMENTS = Object.freeze([
  Object.freeze({ id: 0, name: '色と座標', file: 'color.wgsl' }),
  Object.freeze({ id: 1, name: '球体と光', file: 'sphere.wgsl' }),
  Object.freeze({ id: 2, name: 'メッシュの中庭', file: 'courtyard.wgsl' }),
  Object.freeze({ id: 3, name: '中庭 · heavy fragment', file: 'courtyard-heavy.wgsl' }),
  Object.freeze({ id: 4, name: '反復オブジェクト · instancing', file: 'instancing.wgsl' }),
]);

export function createExperimentSlot(experiment = DEFAULT_EXPERIMENT, source = '') {
  if (!Number.isInteger(experiment) || !EXPERIMENTS[experiment]) throw new Error('実験が見つかりません。');
  return { experiment, draft: source, applied: source, original: source };
}

export function clampFinite(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function backingSize(cssWidth, cssHeight, devicePixelRatio = 1, maxSide = 8192) {
  const dpr = clampFinite(devicePixelRatio, 0.5, 8, 1);
  const width = Math.max(2, Math.round(clampFinite(cssWidth, 1, 100000) * dpr));
  const height = Math.max(2, Math.round(clampFinite(cssHeight, 1, 100000) * dpr));
  const scale = Math.min(1, maxSide / width, maxSide / height);
  return { width: Math.max(2, Math.floor(width * scale)), height: Math.max(2, Math.floor(height * scale)) };
}

export function advanceTime(time, elapsedSeconds, duration = 20) {
  const start = clampFinite(time, 0, duration);
  const delta = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  return (start + delta) % duration;
}

export function isDirty(slot) {
  return slot.draft !== slot.applied;
}

export function errorText(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error) || '不明なエラー'; } catch { return String(error); }
}

/** Mark the lock BEFORE yielding. Rendering/resizing must inspect gate.busy. */
export class OperationGate {
  busy = false;
  async run(operation, onLock = () => {}, onUnlock = () => {}) {
    if (this.busy) return false;
    this.busy = true;
    try {
      onLock();
      await operation();
      return true;
    } finally {
      this.busy = false;
      onUnlock();
    }
  }
}

/** At most limit timer-driven retries per explicit draw/resize attempt. */
export class FrameRetryBudget {
  constructor(limit = 3, delayMs = 100) {
    this.limit = limit;
    this.delayMs = delayMs;
    this.attempts = 0;
  }
  reset() { this.attempts = 0; }
  nextDelay() {
    if (this.attempts >= this.limit) return null;
    this.attempts += 1;
    return this.delayMs;
  }
}

export const RENDER_SCALES = Object.freeze([100, 75, 50]);
export function renderScale(value) {
  const percent = Number(value);
  if (!RENDER_SCALES.includes(percent)) throw new Error('内部描画倍率は 100 / 75 / 50% を指定してください。');
  return percent;
}

/** Mirror core viewport_widths (including the f32 split) and integer target sizing. */
export function renderGeometry(width, height, split, scales) {
  const fraction = Math.fround(clampFinite(split, .05, .95, .5));
  const left = Math.min(width - 1, Math.max(1, Math.round(Math.fround(width * fraction))));
  return [left, width - left].map((w, index) => {
    const percent = renderScale(scales[index]);
    return {render_scale_percent: percent,
      display_viewport_pixels: {x: index === 0 ? 0 : left, y: 0, width: w, height},
      internal_render_pixels: {width: Math.max(1, Math.round(w * percent / 100)), height: Math.max(1, Math.round(height * percent / 100))}};
  });
}

export const OVERDRAW_MODES = Object.freeze([
  Object.freeze({id: 0, key: 'front-to-back', name: '手前 → 奥'}),
  Object.freeze({id: 1, key: 'back-to-front', name: '奥 → 手前（基準）'}),
  Object.freeze({id: 2, key: 'depth-prepass', name: 'Depth prepass'}),
]);
export const COURTYARD_CAMERAS = Object.freeze([
  Object.freeze({id: 0, key: 'oblique', name: '斜め · 重なり多'}),
  Object.freeze({id: 1, key: 'overhead', name: '俯瞰 · 重なり少'}),
]);
export const isCourtyard = experiment => experiment === 2 || experiment === 3;
export const isInstancing = experiment => experiment === 4;
export const isMesh = experiment => isCourtyard(experiment) || isInstancing(experiment);
export const DEFAULT_OBJECT_COUNT = 256;
export const MAX_OBJECT_COUNT = 4096;
export const INSTANCE_DATA_STRIDE_BYTES = 48;
export const INSTANCING_MODES = Object.freeze([
  Object.freeze({id: 0, key: 'individual', name: '個別 draw（基準）'}),
  Object.freeze({id: 1, key: 'instanced', name: 'Instanced draw'}),
]);
export function instancingMode(value) {
  const id = Number(value);
  if ((typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) || !Number.isInteger(id) || !INSTANCING_MODES[id]) throw new Error('Instancing は個別 draw / instanced draw を指定してください。');
  return id;
}
export function objectCount(value) {
  const count = Number(value);
  if ((typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) || !Number.isInteger(count) || count < 1 || count > MAX_OBJECT_COUNT) throw new Error(`オブジェクト数は 1〜${MAX_OBJECT_COUNT} の整数を指定してください。`);
  return count;
}
export function overdrawMode(value) {
  const id = Number(value);
  if ((typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) || !Number.isInteger(id) || !OVERDRAW_MODES[id]) throw new Error('描画方式は手前→奥 / 奥→手前 / depth prepass を指定してください。');
  return id;
}
export function courtyardCamera(value) {
  const id = Number(value);
  if ((typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) || !Number.isInteger(id) || !COURTYARD_CAMERAS[id]) throw new Error('カメラは斜め / 俯瞰を指定してください。');
  return id;
}

/** Applied renderer work per slot; a modified shader cannot be called light/heavy. */
export function renderingWork(slot, mode = 1, camera = 0, instancing = 0, count = DEFAULT_OBJECT_COUNT) {
  const courtyard = isCourtyard(slot.experiment);
  const repeated = isInstancing(slot.experiment);
  const effectiveMode = courtyard ? OVERDRAW_MODES[overdrawMode(mode)] : null;
  const effectiveCamera = isMesh(slot.experiment) ? COURTYARD_CAMERAS[courtyardCamera(camera)] : null;
  const effectiveInstancing = repeated ? INSTANCING_MODES[instancingMode(instancing)] : null;
  const objects = repeated ? objectCount(count) : (courtyard ? 10 : 0);
  const colorDraws = repeated ? (effectiveInstancing.id === 0 ? objects : 1) : (courtyard ? 10 : 1);
  const depthDraws = courtyard && effectiveMode.id === 2 ? 10 : 0;
  const baseline = isMesh(slot.experiment) ? (slot.experiment === 3 ? 'heavy' : 'light') : 'not-applicable';
  const modified = slot.applied !== slot.original;
  return {
    geometry: repeated ? 'procedural-repeated-opaque-objects' : (courtyard ? 'procedural-courtyard-10-objects' : 'fullscreen-triangle'),
    shader_modified: modified,
    fragment_workload: modified ? 'custom' : baseline,
    fragment_workload_baseline: baseline,
    overdraw_mode: effectiveMode?.key ?? 'not-applicable',
    overdraw_mode_id: effectiveMode?.id ?? null,
    camera: effectiveCamera?.key ?? 'not-applicable',
    camera_id: effectiveCamera?.id ?? null,
    instancing_mode: effectiveInstancing?.key ?? 'not-applicable',
    instancing_mode_id: effectiveInstancing?.id ?? null,
    scene_object_count: objects,
    active_instance_data_bytes: repeated ? objects * INSTANCE_DATA_STRIDE_BYTES : 0,
    instance_data_scope: repeated ? 'active prefix of shared buffer; not a per-slot allocation or upload' : 'not-applicable',
    color_draw_calls: colorDraws,
    depth_prepass_draw_calls: depthDraws,
    scene_draw_calls: colorDraws + depthDraws,
    scene_render_passes: depthDraws ? 2 : 1,
    shared_composite_pass: true,
    composite_draw_calls: 1,
    total_draw_calls: colorDraws + depthDraws + 1,
  };
}

/** Core allocates and uploads the entire immutable buffer once at renderer init. */
export function sharedInstanceBufferWork(slots) {
  const activeCount = Math.max(0, ...slots.filter(slot => slot.instancing_mode_id !== null).map(slot => slot.scene_object_count));
  return {
    stride_bytes: INSTANCE_DATA_STRIDE_BYTES,
    capacity_objects: MAX_OBJECT_COUNT,
    allocated_bytes: MAX_OBJECT_COUNT * INSTANCE_DATA_STRIDE_BYTES,
    active_shared_prefix_bytes: activeCount * INSTANCE_DATA_STRIDE_BYTES,
    initial_upload_bytes: MAX_OBJECT_COUNT * INSTANCE_DATA_STRIDE_BYTES,
    initial_upload_scope: 'once at renderer initialization; shared by A/B; excluded from measured run',
    instance_upload_bytes_per_frame: 0,
    instance_upload_bytes_on_count_change: 0,
    update_policy: 'static-no-update',
    data_source: 'deterministic core layout and update policy; not measured CPU/GPU counters',
  };
}

export function comparisonKind(slots, scales, modes = [1, 1], cameras = [0, 0], instancingModes = [0, 0], objectCounts = [DEFAULT_OBJECT_COUNT, DEFAULT_OBJECT_COUNT]) {
  return slots[0].experiment === slots[1].experiment && slots[0].applied === slots[1].applied && scales[0] === scales[1]
    && (!isMesh(slots[0].experiment) || cameras[0] === cameras[1])
    && (!isCourtyard(slots[0].experiment) || modes[0] === modes[1])
    && (!isInstancing(slots[0].experiment) || (instancingModes[0] === instancingModes[1] && objectCounts[0] === objectCounts[1])) ? 'A/A' : 'A/B';
}
