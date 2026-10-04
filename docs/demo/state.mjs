/** Pure UI helpers; renderer state lives exclusively in the Rust core. */
export const DEFAULT_EXPERIMENT = 2;
export const EXPERIMENTS = Object.freeze([
  Object.freeze({ id: 0, name: '色と座標', file: 'color.wgsl' }),
  Object.freeze({ id: 1, name: '球体と光', file: 'sphere.wgsl' }),
  Object.freeze({ id: 2, name: 'メッシュの中庭', file: 'courtyard.wgsl' }),
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

export function comparisonKind(slots, scales) {
  return slots[0].experiment === slots[1].experiment && slots[0].applied === slots[1].applied && scales[0] === scales[1] ? 'A/A' : 'A/B';
}
