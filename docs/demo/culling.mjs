/** Browser contract for the standalone CPU frustum-culling and distance-LOD study. */
export const DEFAULT_CULLING_MODE = 0;
export const CULLING_OBJECT_COUNT = 51;
export const CULLING_FIXED = Object.freeze({
  lod_thresholds_world_units: Object.freeze([12, 24]),
  sphere_triangles_by_lod: Object.freeze([1840, 440, 100]),
  plane_epsilon_world_units: 0.0001,
  path_duration_seconds: 20,
  scene_seed: 0,
});
export const CULLING_CAMERA_KEYS = Object.freeze([
  [0, [8.2, 6.8, 10.5]], [2, [0, 2.2, 3]], [4, [-9, 3.8, 4]],
  [6, [0, 1.55, 10.3]], [10, [0, 1.55, 26.3]], [14, [0, 1.55, 10.3]],
  [16, [0, 1.55, 12.26]], [16.5, [0, 1.55, 12.34]], [17, [0, 1.55, 12.26]],
  [17.5, [0, 1.55, 12.34]], [18, [0, 1.55, 12.26]], [18.5, [0, 1.55, 12.34]],
  [19, [0, 1.55, 12.26]], [19.5, [0, 1.55, 12.34]], [20, [0, 1.55, 12.26]],
].map(([time, eye]) => Object.freeze({time_seconds: time, eye: Object.freeze(eye)})));
export const CULLING_MODES = Object.freeze([
  Object.freeze({id: 0, key: 'baseline', name: 'Baseline · 全 objects / high LOD', cull: false, lod: false}),
  Object.freeze({id: 1, key: 'cull-only', name: 'Cull only · frustum / high LOD', cull: true, lod: false}),
  Object.freeze({id: 2, key: 'lod-only', name: 'LOD only · 全 objects / distance LOD', cull: false, lod: true}),
  Object.freeze({id: 3, key: 'cull-and-lod', name: 'Cull + LOD · frustum / distance LOD', cull: true, lod: true}),
]);
export function cullingMode(value) {
  const mode = Number(value);
  if ((typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) || !Number.isInteger(mode) || !CULLING_MODES[mode]) {
    throw new Error('Culling mode: baseline / cull only / LOD only / cull + LOD を指定してください。');
  }
  return mode;
}
/** Values come from the actual last submitted core draw list, never a JS estimate. */
export function cullingStats(input) {
  if (!Array.isArray(input) && !(input instanceof Uint32Array)) throw new Error('Culling counters are unavailable.');
  const values = Array.from(input);
  if (values.length !== 7 || values.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) throw new Error('Invalid culling counters.');
  const [tested, visible, draw_calls, triangles, lod0, lod1, lod2] = values;
  if (visible > CULLING_OBJECT_COUNT || ![0, CULLING_OBJECT_COUNT].includes(tested) || draw_calls !== visible || lod0 + lod1 + lod2 !== visible || (tested !== 0 && visible > tested)) throw new Error('Inconsistent culling counters.');
  return {tested_objects: tested, visible_objects: visible, draw_calls, submitted_triangles: triangles, lod_object_counts: [lod0, lod1, lod2]};
}
export function cullingWork(mode = DEFAULT_CULLING_MODE, stats = null, modified = false) {
  const config = CULLING_MODES[cullingMode(mode)];
  return {
    culling_mode: config.key, culling_mode_id: config.id,
    frustum_culling_enabled: config.cull, distance_lod_enabled: config.lod,
    culling_method: 'CPU conservative world-AABB against six normalized WebGPU frustum planes; no occlusion culling',
    culling_bounds_policy: 'world AABB encloses all eight transformed local-bound corners and every LOD; supports nonuniform scale and rotation; intersects retained',
    culling_clip_depth_range: '0 <= z <= w; near plane = clip-matrix row2',
    culling_plane_epsilon_world_units: CULLING_FIXED.plane_epsilon_world_units,
    lod_distance_metric: 'world-space Euclidean distance from eye to object AABB center',
    lod_thresholds_world_units: [...CULLING_FIXED.lod_thresholds_world_units],
    lod_boundary_policy: 'distance < 12: LOD0; 12 <= distance < 24: LOD1; distance >= 24: LOD2; equality selects lower detail',
    lod_hysteresis: false,
    lod_sphere_triangles: [...CULLING_FIXED.sphere_triangles_by_lod],
    lod_geometry_scope: '41 spheres/ellipsoids use three indexed meshes; 10 box/floor objects retain original geometry and count in LOD0',
    culling_scene_seed: CULLING_FIXED.scene_seed,
    culling_scene_scope: '10-object courtyard plus outer ground and 40 transformed ornamental ellipsoids; immutable shared world-space geometry',
    culling_lighting: {direction_before_normalization: [0.75, 1.25, 0.7], shader_time_seconds: 0, scope: 'same fixed Lambert lighting in all modes; global time changes only the camera'},
    culling_projection: {fov_y_degrees: 45, near: 0.1, far: 100, aspect_policy: 'display viewport aspect is preserved across render scales; vertical FOV widens when display viewport aspect < 1'},
    culling_camera_target: [0, 1.55, 0.3],
    culling_camera_keyframes: CULLING_CAMERA_KEYS.map(key => ({time_seconds: key.time_seconds, eye: [...key.eye]})),
    culling_stats: stats ? {...stats, lod_object_counts: [...stats.lod_object_counts]} : null,
    culling_stats_source: 'actual last submitted core draw list; tested=0 when culling is disabled; visible means submitted objects, not unoccluded pixels',
    culling_draw_policy: 'one indexed draw per submitted object; no instancing or batching reduction',
    culling_camera_path: 'piecewise-linear 0..20s path clamped by core; browser playback wraps at 20s; pause/scrub replays the same pose; 16..20s repeatedly crosses center-sphere LOD12 threshold by +/-0.04 world units',
    culling_update_scope: 'CPU visibility tests, distance-LOD selection and draw-list encoding run inside every rendered frame',
    culling_metadata_scope: modified ? 'core geometry and draw-list counts; custom vertex displacement may invalidate conservative bounds' : 'built-in conservative bounds and actual submitted geometry; not GPU execution-time counters',
  };
}
export function cullingPngSuffix(slots, modes) {
  if (!slots.some(slot => slot.experiment === 8)) return '';
  return '-culling' + slots.map((slot, index) => slot.experiment === 8 ? cullingMode(modes[index]) : 'na').join('-') + '-lod12-24-path20s-seed0';
}
