/** Deterministic UI contract for the procedural courtyard shadow-map experiment. */
export const DEFAULT_SHADOWS = Object.freeze({resolution: 512, depth_bias: 1, slope_bias: 1, pcf: 3, light: 0, debug: 0, enabled: 1});
export const SHADOW_FIELDS = Object.freeze(Object.keys(DEFAULT_SHADOWS));
export const SHADOW_RESOLUTIONS = Object.freeze([256, 512, 1024]);
export const SHADOW_PCF_WIDTHS = Object.freeze([1, 3, 5]);
export const SHADOW_BIAS_PRESETS = Object.freeze([
  Object.freeze({id: 0, key: 'none', name: 'なし · 0'}),
  Object.freeze({id: 1, key: 'reference', name: '基準 · reference'}),
  Object.freeze({id: 2, key: 'exaggerated', name: '過大 · exaggerated'}),
]);
export const SHADOW_LIGHTS = Object.freeze([
  Object.freeze({id: 0, key: 'high', name: '高い光 · high'}),
  Object.freeze({id: 1, key: 'low', name: '低い光 · low'}),
]);
export const SHADOW_DEBUG_MODES = Object.freeze([
  Object.freeze({id: 0, key: 'shaded', name: 'Shaded · 陰影'}),
  Object.freeze({id: 1, key: 'depth-map', name: 'Reconstructed depth · 量子化深度'}),
  Object.freeze({id: 2, key: 'visibility', name: 'Shadow visibility · 可視率'}),
]);
export const SHADOW_DEPTH_BIAS_CONSTANTS = Object.freeze([0, 2, 65536]);
export const SHADOW_SLOPE_BIAS_SCALES = Object.freeze([0, 1, 8]);
export const SHADOW_LIGHT_DIRECTIONS = Object.freeze([Object.freeze([-0.6, 1, 0.5]), Object.freeze([-1, 0.3, 0.35])]);
export const SHADOW_OBJECT_COUNT = 14;
const allowed = Object.freeze({resolution: SHADOW_RESOLUTIONS, depth_bias: [0, 1, 2], slope_bias: [0, 1, 2], pcf: SHADOW_PCF_WIDTHS, light: [0, 1], debug: [0, 1, 2], enabled: [0, 1]});
/** Validate the entire configuration before any WASM mutation. Never silently clamp. */
export function shadowSettings(input = DEFAULT_SHADOWS) {
  if (!input || typeof input !== 'object') throw new Error('Shadow 設定が必要です。');
  return Object.fromEntries(SHADOW_FIELDS.map(key => {
    const value = input[key];
    const number = Number(value);
    if ((typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) || !Number.isInteger(number) || !allowed[key].includes(number)) {
      throw new Error(`Shadow ${key}: ${allowed[key].join(' / ')} を指定してください。`);
    }
    return [key, number];
  }));
}
export function equalShadowSettings(left, right) {
  const a = shadowSettings(left), b = shadowSettings(right);
  return SHADOW_FIELDS.every(key => a[key] === b[key]);
}
/** Encoded renderer work, not GPU counters or a GPU timing estimate. */
export function shadowWork(input = DEFAULT_SHADOWS, modified = false) {
  const config = shadowSettings(input);
  const needsMap = Boolean(config.enabled || config.debug === 1);
  return {
    shadow_settings: {...config},
    shadow_enabled: Boolean(config.enabled),
    shadow_resolution: config.resolution,
    shadow_depth_bias_preset: SHADOW_BIAS_PRESETS[config.depth_bias].key,
    shadow_slope_bias_preset: SHADOW_BIAS_PRESETS[config.slope_bias].key,
    shadow_rasterizer_depth_bias_constant: SHADOW_DEPTH_BIAS_CONSTANTS[config.depth_bias],
    shadow_rasterizer_slope_scale: SHADOW_SLOPE_BIAS_SCALES[config.slope_bias],
    shadow_rasterizer_bias_clamp: 0,
    shadow_receiver_depth_offset: 0,
    shadow_depth_pipeline_variants: 9,
    shadow_bias_pipeline_scope: 'nine bounded depth pipelines compiled per shader outside measured run; selected per frame; no bias pipeline rebuild during timing',
    shadow_bias_scope: 'rasterizer DepthBiasState constant and slope_scale applied in light depth pass; constant is depth-format/implementation dependent, not a normalized-depth offset',
    shadow_pcf_width: config.pcf,
    shadow_pcf_kernel_samples: config.pcf * config.pcf,
    shadow_visibility_comparison_samples_max: config.enabled && config.debug !== 1 ? config.pcf * config.pcf : 0,
    shadow_depth_debug_comparisons_per_fragment: config.debug === 1 ? 16 : 0,
    shadow_comparison_samples_max: config.debug === 1 ? 16 : (config.enabled ? config.pcf * config.pcf : 0),
    shadow_depth_debug_reconstruction_interval_max: 1 / 65536,
    shadow_depth_debug_includes_raster_bias: true,
    shadow_comparison_method: 'nearest sampler_comparison with textureSampleCompareLevel at texel centers; explicit square PCF averages 1/9/25 discrete comparisons, not bilinear hardware PCF; outside-frustum and outside-map taps are lit',
    shadow_sample_count_scope: 'built-in visibility uses at most kernel width squared comparisons per fragment; depth debug uses 16 fixed comparisons even when Off; outside-map and disabled shaded paths sample fewer; custom WGSL may differ',
    shadow_light: SHADOW_LIGHTS[config.light].key,
    shadow_debug: SHADOW_DEBUG_MODES[config.debug].key,
    shadow_light_direction_unnormalized: [...SHADOW_LIGHT_DIRECTIONS[config.light]],
    shadow_light_projection: {kind: 'orthographic', left: -8, right: 8, bottom: -8, top: 8, near: 0.1, far: 40, eye_distance: 20, target: [0, 0, 0]},
    shadow_depth_debug_scope: 'fullscreen reconstructed/quantized normalized light-space depth including raster bias; 16 fixed binary-search comparisons, interval <= 1/65536 before framebuffer/display quantization; not an exact depth load or camera perspective distance; forces map regeneration even with shadows Off',
    shadow_map_format: 'Depth32Float',
    shadow_map_bytes_per_texel: 4,
    shadow_map_nominal_bytes: config.resolution * config.resolution * 4,
    shadow_map_byte_scope: 'one per-slot depth texture at selected resolution, retained when Off; excludes alignment, driver overhead, framebuffers and other resources',
    shadow_update_policy: needsMap ? 'regenerated-every-frame' : 'disabled-no-shadow-pass',
    shadow_map_depth_draw_calls: needsMap ? 1 : 0,
    shadow_map_render_passes: needsMap ? 1 : 0,
    shadow_metadata_scope: modified ? 'core pass/allocation configuration; custom WGSL may change sampling, bias, lighting and debug output' : 'deterministic built-in configuration; not measured CPU/GPU counters',
  };
}
/** Compact, complete settings beside the existing capture conditions in PNG names. */
export function shadowPngSuffix(slots, configs) {
  if (!slots.some(slot => slot.experiment === 6)) return '';
  return '-shadow' + slots.map((slot, index) => {
    if (slot.experiment !== 6) return 'na';
    const s = shadowSettings(configs[index]);
    return `${s.resolution}d${s.depth_bias}s${s.slope_bias}p${s.pcf}l${s.light}v${s.debug}e${s.enabled}`;
  }).join('-');
}
