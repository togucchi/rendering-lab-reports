/** Bounded, deterministic browser contract for the standalone SSAO study. */
export const DEFAULT_SSAO = Object.freeze({samples: 32, resolution: 100, blur: 0, debug: 0, enabled: 1});
export const SSAO_FIELDS = Object.freeze(Object.keys(DEFAULT_SSAO));
export const SSAO_SAMPLES = Object.freeze([8, 16, 32]);
export const SSAO_RESOLUTIONS = Object.freeze([100, 50]);
export const SSAO_BLURS = Object.freeze([
  Object.freeze({id: 0, key: 'off', name: 'Off · raw AO', radius: 0}),
  Object.freeze({id: 1, key: 'bilateral-radius-1', name: 'Bilateral · radius 1', radius: 1}),
  Object.freeze({id: 2, key: 'bilateral-radius-2', name: 'Bilateral · radius 2', radius: 2}),
]);
export const SSAO_DEBUG_MODES = Object.freeze([
  Object.freeze({id: 0, key: 'final', name: 'Final · 合成結果'}),
  Object.freeze({id: 1, key: 'ao-only', name: 'AO-only · 遮蔽のみ'}),
]);
export const SSAO_FIXED = Object.freeze({radius: 0.7, strength: 1.3, bias: 0.03, seed: 17, time_seconds: 0});
export const SSAO_OBJECT_COUNT = 14;
export const SSAO_PRESETS = Object.freeze({
  reference: DEFAULT_SSAO,
  half: Object.freeze({...DEFAULT_SSAO, resolution: 50}),
});
const allowed = Object.freeze({samples: SSAO_SAMPLES, resolution: SSAO_RESOLUTIONS, blur: [0, 1, 2], debug: [0, 1], enabled: [0, 1]});
/** Validate the entire configuration before one atomic core mutation. */
export function ssaoSettings(input = DEFAULT_SSAO) {
  if (!input || typeof input !== 'object') throw new Error('SSAO 設定が必要です。');
  return Object.fromEntries(SSAO_FIELDS.map(key => {
    const value = input[key], number = Number(value);
    if ((typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) || !Number.isInteger(number) || !allowed[key].includes(number)) {
      throw new Error(`SSAO ${key}: ${allowed[key].join(' / ')} を指定してください。`);
    }
    return [key, number];
  }));
}
export function equalSsaoSettings(left, right) {
  const a = ssaoSettings(left), b = ssaoSettings(right);
  return SSAO_FIELDS.every(key => a[key] === b[key]);
}
/** Dimensions refer to a slot's internal scene target, not the whole canvas. */
export function ssaoAllocation(internal, resolution = DEFAULT_SSAO.resolution) {
  if (!SSAO_RESOLUTIONS.includes(resolution)) throw new Error('SSAO resolution: 100 / 50 を指定してください。');
  if (!internal || !Number.isInteger(internal.width) || !Number.isInteger(internal.height) || internal.width < 1 || internal.height < 1) throw new Error('SSAO internal dimensions must be positive integers.');
  const ao = {width: Math.max(1, Math.floor(internal.width * resolution / 100)), height: Math.max(1, Math.floor(internal.height * resolution / 100))};
  const gbuffer = 16 * internal.width * internal.height;
  const targets = 8 * ao.width * ao.height;
  return {ssao_gbuffer_pixels: {...internal}, ssao_ao_pixels: ao, ssao_gbuffer_nominal_bytes: gbuffer, ssao_ao_targets_nominal_bytes: targets, ssao_extra_nominal_bytes: gbuffer + targets};
}
/** Encoded pass/draw counts and nominal allocations, never measured GPU counters. */
export function ssaoWork(input = DEFAULT_SSAO, internal = null, modified = false) {
  const config = ssaoSettings(input), enabled = Boolean(config.enabled), blur = SSAO_BLURS[config.blur];
  return {
    ssao_settings: {...config}, ssao_enabled: enabled,
    ssao_samples: config.samples, ssao_resolution_percent: config.resolution,
    ssao_resolution_scope: 'AO target dimensions only; normal and world-position buffers remain at full internal scene resolution',
    ssao_blur: blur.key, ssao_blur_id: config.blur, ssao_blur_radius: blur.radius,
    ssao_debug: SSAO_DEBUG_MODES[config.debug].key, ssao_debug_id: config.debug,
    ssao_radius_world_units: SSAO_FIXED.radius, ssao_strength: SSAO_FIXED.strength, ssao_bias_world_units: SSAO_FIXED.bias,
    ssao_seed: SSAO_FIXED.seed, ssao_effective_time_seconds: SSAO_FIXED.time_seconds, ssao_ignores_global_time: true,
    ssao_sample_count_scope: 'configured hemisphere sample budget per AO fragment; background and out-of-screen samples may do less work; custom WGSL may differ',
    ssao_active_samples_max: enabled ? config.samples : 0,
    ssao_gbuffer_formats: ['Rgba16Float', 'Rgba16Float'], ssao_gbuffer_bytes_per_pixel: 16,
    ssao_ao_target_formats: ['Rgba8Unorm', 'Rgba8Unorm'], ssao_ao_targets_bytes_per_pixel: 8,
    ssao_allocation_scope: 'per-slot normal + world-position buffers and raw + blurred AO textures; both AO targets allocated even with blur Off and all retained with SSAO Off; excludes existing depth/color targets, alignment and driver overhead',
    ssao_allocation_formula: '16 * internal_width * internal_height + 8 * ao_width * ao_height; ao_axis = max(1, floor(internal_axis * resolution_percent / 100))',
    ...(internal ? ssaoAllocation(internal, config.resolution) : {ssao_gbuffer_pixels: null, ssao_ao_pixels: null, ssao_gbuffer_nominal_bytes: null, ssao_ao_targets_nominal_bytes: null, ssao_extra_nominal_bytes: null}),
    ssao_gbuffer_draw_calls: enabled ? 1 : 0,
    ssao_ao_draw_calls: enabled ? 1 : 0,
    ssao_blur_draw_calls: enabled && config.blur !== 0 ? 1 : 0,
    ssao_extra_render_passes: enabled ? 2 + (config.blur !== 0 ? 1 : 0) : 0,
    ssao_final_geometry_draw_calls: config.debug === 0 ? 1 : 0,
    ssao_final_fullscreen_draw_calls: config.debug === 1 ? 1 : 0,
    ssao_update_policy: enabled ? 'gbuffer-and-ao-regenerated-every-frame' : 'disabled-no-gbuffer-ao-or-blur-passes',
    ssao_off_debug_scope: 'AO-only with SSAO Off is neutral white; no gbuffer, AO or blur work',
    ssao_lighting_scope: 'AO multiplies ambient 0.22 only; direct Lambert 0.78 unchanged; no shadow/PBR composition',
    ssao_upsampling: 'bilinear AO reconstruction via explicit textureLoad; not edge-aware upsampling; half-resolution silhouette bleed can remain after bilateral blur',
    ssao_scene_scope: 'standalone procedural courtyard; no shadow mapping or FlightHelmet PBR composition',
    ssao_metadata_scope: modified ? 'core pass/allocation configuration; custom WGSL may change sampling, lighting and debug output' : 'deterministic built-in configuration; not measured CPU/GPU counters',
  };
}
/** Complete variable and fixed conditions beside existing PNG capture metadata. */
export function ssaoPngSuffix(slots, configs) {
  if (!slots.some(slot => slot.experiment === 7)) return '';
  return '-ssao' + slots.map((slot, index) => {
    if (slot.experiment !== 7) return 'na';
    const s = ssaoSettings(configs[index]);
    return `s${s.samples}r${s.resolution}b${s.blur}v${s.debug}e${s.enabled}`;
  }).join('-') + '-radius0p7-strength1p3-bias0p03-seed17-ssaot0';
}
