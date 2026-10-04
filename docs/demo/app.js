import { CULLING_MODES, DEFAULT_CULLING_MODE, cullingMode, cullingStats, cullingPngSuffix } from './culling.mjs';
import { SSAO_FIELDS, SSAO_DEBUG_MODES, SSAO_PRESETS, ssaoSettings, ssaoWork, ssaoPngSuffix } from './ssao.mjs';
import { SHADOW_FIELDS, SHADOW_DEBUG_MODES, shadowSettings, shadowPngSuffix } from './shadows.mjs';
import { FLIGHTHELMET_ASSET, PBR_LIGHTING, PBR_DEBUG_MODES, PBR_TEXTURE_INPUTS, PBR_CAMERAS, DEFAULT_PBR_DEBUG, DEFAULT_PBR_FLAGS, pbrDebug, pbrFlags, pbrCamera, FlightHelmetLoader, readBoundedAsset } from './pbr.mjs';
import { settings, MeasurementRun, reportCsv, frameWork } from './metrics.mjs';
import { DEFAULT_EXPERIMENT, EXPERIMENTS, OVERDRAW_MODES, COURTYARD_CAMERAS, INSTANCING_MODES, DEFAULT_OBJECT_COUNT, isCourtyard, isInstancing, isPbr, isShadows, isSsao, isCulling, isMesh, overdrawMode, courtyardCamera, instancingMode, objectCount, renderingWork, sharedInstanceBufferWork, renderScale, renderGeometry, comparisonKind, createExperimentSlot, advanceTime, backingSize, clampFinite, errorText, isDirty, OperationGate, FrameRetryBudget } from './state.mjs';

const $ = (id) => document.getElementById(id);
const canvas = $('viewport');
const editor = $('shader-source');
const experimentInputs = [$('experiment-a'), $('experiment-b')];
const scaleInputs = [$('scale-a'), $('scale-b')];
const scales = [100, 100];
const modeInputs = [$('overdraw-a'), $('overdraw-b')];
const cameraInputs = [$('camera-a'), $('camera-b')];
const modes = [1, 1];
const cameras = [0, 0];
const instancingInputs = [$('instancing-a'), $('instancing-b')];
const objectCountInputs = [$('object-count-a'), $('object-count-b')];
const instancingModes = [0, 0];
const objectCounts = [DEFAULT_OBJECT_COUNT, DEFAULT_OBJECT_COUNT];
const pbrDebugInputs = [$('pbr-debug-a'), $('pbr-debug-b')];
const pbrTextureInputs = ['a', 'b'].map(side => PBR_TEXTURE_INPUTS.map(input => $(`pbr-${input.key}-${side}`)));
const pbrDebugs = [DEFAULT_PBR_DEBUG, DEFAULT_PBR_DEBUG];
const textureFlags = [DEFAULT_PBR_FLAGS, DEFAULT_PBR_FLAGS];
const cullingModes = [DEFAULT_CULLING_MODE, DEFAULT_CULLING_MODE];
const cullingInputs = [$('culling-mode-a'), $('culling-mode-b')];
const cullingFrameStats = [null, null];
const ssaoConfigs = [ssaoSettings(), ssaoSettings()];
const ssaoInputs = ['a', 'b'].map(side => Object.fromEntries(SSAO_FIELDS.map(key => [key, $(`ssao-${key}-${side}`)])));
const shadowConfigs = [shadowSettings(), shadowSettings()];
const shadowInputs = ['a', 'b'].map(side => Object.fromEntries(SHADOW_FIELDS.map(key => [key, $(`shadow-${key.replaceAll('_', '-')}-${side}`)])));
const flighthelmet = new FlightHelmetLoader(async () => {
  // A fixed same-origin URL; no external fetch, redirect, or eager initialization.
  const response = await fetch(new URL(FLIGHTHELMET_ASSET.file, import.meta.url), {mode: 'same-origin', credentials: 'same-origin', redirect: 'error'});
  if (!response.ok) throw new Error(`FlightHelmet GLB の読み込みに失敗しました (HTTP ${response.status})。`);
  const bytes = await readBoundedAsset(response);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
  if (sha256 !== FLIGHTHELMET_ASSET.sha256) throw new Error('FlightHelmet GLB の SHA-256 が固定アセットと一致しません。');
  return bytes;
});
const experiments = EXPERIMENTS;
const slots = [0, 1].map(() => createExperimentSlot());
const sources = new Map();
const gate = new OperationGate();
const renderRetries = new FrameRetryBudget(3, 100);
let retryTimer = 0;
let lab = null;
let ready = false;
let target = 1;
let time = 0;
let split = 0.5;
let playing = false;
let frame = 0;
let lastNow = null;
let resizePending = true;
let lastDpr = 0;
let resizeObserver;
let measurement = null;
let lastReport = null;

function setCompile(message, kind = '', error = '') {
  $('compile-status').className = `compile-status ${kind}`.trim();
  $('compile-message').textContent = message;
  $('compile-error').textContent = error;
  $('compile-error').hidden = !error;
}

function syncControls() {
  for (const element of document.querySelectorAll('[data-lock]')) element.disabled = !ready || gate.busy;
  $('play-button').setAttribute('aria-pressed', String(playing));
  $('play-button').setAttribute('aria-label', playing ? 'アニメーションを停止' : 'アニメーションを再生');
  $('play-icon').textContent = playing ? 'Ⅱ' : '▶';
  $('reload-button').innerHTML = `<span aria-hidden="true">↻</span> ${gate.busy ? '処理中…' : `${target === 0 ? 'A' : 'B'} に適用`}`;
  $('target-a').classList.toggle('active', target === 0);
  $('target-b').classList.toggle('active', target === 1);
  $('target-a').setAttribute('aria-pressed', String(target === 0));
  $('target-b').setAttribute('aria-pressed', String(target === 1));
  $('measure-cancel').disabled = !measurement;
  $('measure-csv').disabled = !lastReport || gate.busy;
  $('measure-json').disabled = !lastReport || gate.busy;
  scaleInputs.forEach((input, index) => { input.value = String(scales[index]); });
  slots.forEach((slot, index) => {
    experimentInputs[index].value = String(slot.experiment);
    const courtyard = isCourtyard(slot.experiment);
    const repeated = isInstancing(slot.experiment);
    modeInputs[index].value = String(modes[index]);
    const cameraChoices = isPbr(slot.experiment) ? PBR_CAMERAS : COURTYARD_CAMERAS;
    cameraInputs[index].innerHTML = cameraChoices.map(choice => `<option value="${choice.id}">${choice.name}</option>`).join('');
    cameraInputs[index].value = String(cameras[index]);
    instancingInputs[index].value = String(instancingModes[index]);
    objectCountInputs[index].value = String(objectCounts[index]);
    modeInputs[index].disabled = !ready || gate.busy || !courtyard;
    cameraInputs[index].disabled = !ready || gate.busy || !isMesh(slot.experiment) || isCulling(slot.experiment);
    cullingInputs[index].value = String(cullingModes[index]);
    cullingInputs[index].disabled = !ready || gate.busy || !isCulling(slot.experiment);
    $(`culling-controls-${index === 0 ? 'a' : 'b'}`).disabled = !ready || gate.busy || !isCulling(slot.experiment);
    instancingInputs[index].disabled = objectCountInputs[index].disabled = !ready || gate.busy || !repeated;
    pbrDebugInputs[index].value = String(pbrDebugs[index]);
    pbrDebugInputs[index].disabled = !ready || gate.busy || !isPbr(slot.experiment);
    pbrTextureInputs[index].forEach((input, texture) => {
      input.checked = Boolean(textureFlags[index] & PBR_TEXTURE_INPUTS[texture].bit);
      input.disabled = !ready || gate.busy || !isPbr(slot.experiment);
    });
    for (const key of SHADOW_FIELDS) {
      shadowInputs[index][key].value = String(shadowConfigs[index][key]);
      shadowInputs[index][key].disabled = !ready || gate.busy || !isShadows(slot.experiment);
    }
    for (const key of SSAO_FIELDS) {
      ssaoInputs[index][key].value = String(ssaoConfigs[index][key]);
      ssaoInputs[index][key].disabled = !ready || gate.busy || !isSsao(slot.experiment);
    }
    $(`ssao-controls-${index === 0 ? 'a' : 'b'}`).disabled = !ready || gate.busy || !isSsao(slot.experiment);
    for (const preset of Object.keys(SSAO_PRESETS)) $(`ssao-preset-${preset}-${index === 0 ? 'a' : 'b'}`).disabled = !ready || gate.busy || !isSsao(slot.experiment);
    $(index === 0 ? 'shadow-controls-a' : 'shadow-controls-b').disabled = !ready || gate.busy || !isShadows(slot.experiment);
    const work = renderingWork(slot, modes[index], cameras[index], instancingModes[index], objectCounts[index], pbrDebugs[index], textureFlags[index], shadowConfigs[index], ssaoConfigs[index], null, cullingModes[index], cullingFrameStats[index]);
    $(index === 0 ? 'shadow-work-a' : 'shadow-work-b').textContent = isShadows(slot.experiment)
      ? `${work.shadow_resolution}² · ${(work.shadow_map_nominal_bytes / 1024).toFixed(0)} KiB depth · PCF ${work.shadow_pcf_kernel_samples} taps · active ≤${work.shadow_comparison_samples_max} comparisons · shadow pass ${work.shadow_map_depth_draw_calls} draws`
      : '実験 07 のみ有効';
    $(index === 0 ? 'draw-count-a' : 'draw-count-b').textContent = isCulling(slot.experiment)
      ? cullingSummary(index) : isMesh(slot.experiment)
      ? `${work.fragment_workload}${repeated ? ` · ${work.instancing_mode}` : ''} · ${work.scene_object_count} ${isPbr(slot.experiment) ? 'primitives' : 'objects'} · scene ${work.scene_draw_calls} + upsample 1 draws`
      : 'fullscreen 1 + upsample 1 draws';
  });
  syncCullingOutputs();
  $('culling-panel').hidden = !slots.some(slot => isCulling(slot.experiment));
  syncSsaoDimensions();
  $('ssao-panel').hidden = !slots.some(slot => isSsao(slot.experiment));
  $('shadow-panel').hidden = !slots.some(slot => isShadows(slot.experiment));
  $('pbr-panel').hidden = !slots.some(slot => isPbr(slot.experiment));
  $('pbr-asset-status').textContent = flighthelmet.loaded ? 'FlightHelmet512.glb · GPU resources ready · A/B で共有' : '最初の選択時に同一 origin から GLB を取得します。';
  syncDirty();
}

function cullingSummary(index) {
  const stats = cullingFrameStats[index];
  return stats ? `${CULLING_MODES[cullingModes[index]].key} · tested ${stats.tested_objects} · submitted ${stats.visible_objects} objects · ${stats.draw_calls} draws · ${stats.submitted_triangles} triangles · LOD 0/1/2: ${stats.lod_object_counts.join(' / ')}` : '次の描画で実際の submitted draw list を表示';
}
function syncCullingOutputs() {
  slots.forEach((slot, index) => {
    $(`culling-work-${index === 0 ? 'a' : 'b'}`).textContent = isCulling(slot.experiment) ? cullingSummary(index) : '実験 09 のみ有効';
    if (isCulling(slot.experiment)) $(`draw-count-${index === 0 ? 'a' : 'b'}`).textContent = cullingSummary(index);
  });
}
/** Call only after a synchronous successful render; never while reload owns &mut core. */
function readCullingStats() {
  return slots.map((slot, index) => isCulling(slot.experiment) ? cullingStats(Array.from(lab.culling_stats(index))) : null);
}
function recordCullingFrame(stats = readCullingStats()) {
  stats.forEach((value, index) => { cullingFrameStats[index] = value; });
  syncCullingOutputs();
}

function syncDirty() {
  const dirty = isDirty(slots[target]);
  $('dirty-state').textContent = dirty ? '未適用の変更' : '適用済み';
  $('dirty-state').classList.toggle('dirty', dirty);
  slots.forEach((slot, index) => {
    const modified = slot.applied !== slot.original;
    const badge = $(index === 0 ? 'revision-a' : 'revision-b');
    badge.textContent = modified ? 'MODIFIED' : 'ORIGINAL';
    badge.classList.toggle('modified', modified);
  });
}

function syncLines() {
  const lineCount = editor.value.split('\n').length;
  $('line-numbers').textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  $('line-numbers').scrollTop = editor.scrollTop;
}

function showEditor() {
  editor.value = slots[target].draft;
  $('editor-file').textContent = experiments[slots[target].experiment].file;
  syncLines();
  syncControls();
}

function syncTime() {
  $('time').value = String(time);
  $('time-value').textContent = `${time.toFixed(2)} s`;
  $('frame-time').textContent = `t = ${time.toFixed(2)} s`;
}

function stopFrames() {
  if (frame) cancelAnimationFrame(frame);
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = 0;
  frame = 0;
  lastNow = null;
}

function scheduleFrame() {
  if (ready && !gate.busy && playing && !document.hidden && !frame && !retryTimer) frame = requestAnimationFrame(tick);
}

function syncRenderDimensions(width = canvas.width, height = canvas.height) {
  renderGeometry(width, height, split, scales).forEach((geometry, index) => {
    const display = geometry.display_viewport_pixels;
    const internal = geometry.internal_render_pixels;
    $(index === 0 ? 'scale-size-a' : 'scale-size-b').textContent = `${internal.width} × ${internal.height} → ${display.width} × ${display.height} px`;
  });
  syncSsaoDimensions(width, height);
}

function syncSsaoDimensions(width = canvas.width, height = canvas.height) {
  const geometries = renderGeometry(width, height, split, scales);
  slots.forEach((slot, index) => {
    const output = $(`ssao-work-${index === 0 ? 'a' : 'b'}`);
    if (!isSsao(slot.experiment)) { output.textContent = '実験 08 のみ有効'; return; }
    const work = ssaoWork(ssaoConfigs[index], geometries[index].internal_render_pixels);
    const ao = work.ssao_ao_pixels;
    output.textContent = `AO ${ao.width} × ${ao.height} px · ${work.ssao_samples} samples · ${(work.ssao_extra_nominal_bytes / 1024).toFixed(1)} KiB extra · ${work.ssao_extra_render_passes + 1} scene passes / draws`;
  });
}

async function changeScale(slotIndex, value) {
  if (!ready || gate.busy) { scaleInputs[slotIndex].value = String(scales[slotIndex]); return; }
  await runLocked(async () => {
    try {
      const percent = renderScale(value);
      lab.set_render_scale(slotIndex, percent);
      scales[slotIndex] = percent;
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} 内部描画 ${percent}% · 表示サイズは固定`);
    } catch (error) { setCompile('描画倍率の変更に失敗 · 直前の設定を保持', 'error', errorText(error)); }
  });
}

async function changeMode(slotIndex, value) {
  if (!ready || gate.busy || !isCourtyard(slots[slotIndex].experiment)) { modeInputs[slotIndex].value = String(modes[slotIndex]); return; }
  await runLocked(async () => {
    try {
      const mode = overdrawMode(value);
      lab.set_overdraw(slotIndex, mode);
      modes[slotIndex] = mode;
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} · ${OVERDRAW_MODES[mode].name} · ソースを保持`);
    } catch (error) { setCompile('描画方式の変更に失敗 · 直前の設定を保持', 'error', errorText(error)); }
  });
}

async function changeCamera(slotIndex, value) {
  if (!ready || gate.busy || (!isMesh(slots[slotIndex].experiment) || isCulling(slots[slotIndex].experiment))) { cameraInputs[slotIndex].value = String(cameras[slotIndex]); return; }
  await runLocked(async () => {
    try {
      const pbr = isPbr(slots[slotIndex].experiment);
      const camera = pbr ? pbrCamera(value) : courtyardCamera(value);
      lab.set_camera(slotIndex, camera);
      cameras[slotIndex] = camera;
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} · ${(pbr ? PBR_CAMERAS : COURTYARD_CAMERAS)[camera].name} · ソースを保持`);
    } catch (error) { setCompile('カメラの変更に失敗 · 直前の設定を保持', 'error', errorText(error)); }
  });
}

async function changeInstancing(slotIndex, modeValue, countValue) {
  if (!ready || gate.busy || !isInstancing(slots[slotIndex].experiment)) {
    instancingInputs[slotIndex].value = String(instancingModes[slotIndex]);
    objectCountInputs[slotIndex].value = String(objectCounts[slotIndex]);
    return;
  }
  await runLocked(async () => {
    try {
      const mode = instancingMode(modeValue);
      const count = objectCount(countValue);
      // Apply mode and count atomically; publish only after the core accepts both.
      lab.set_instancing(slotIndex, mode, count);
      instancingModes[slotIndex] = mode;
      objectCounts[slotIndex] = count;
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} · ${INSTANCING_MODES[mode].name} · ${count} objects · ソースを保持`);
    } catch (error) { setCompile('Instancing の変更に失敗 · 直前の設定を保持', 'error', errorText(error)); }
  });
}

async function changeCulling(slotIndex, value) {
  if (!ready || gate.busy || !isCulling(slots[slotIndex].experiment)) {
    cullingInputs[slotIndex].value = String(cullingModes[slotIndex]); return;
  }
  await runLocked(async () => {
    try {
      const mode = cullingMode(value);
      lab.set_culling(slotIndex, mode);
      cullingModes[slotIndex] = mode;
      cullingFrameStats[slotIndex] = null;
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} · ${CULLING_MODES[mode].name} · ソースと時間を保持`);
    } catch (error) { setCompile('Culling / LOD の変更に失敗 · 直前の設定を保持', 'error', errorText(error)); }
  });
}

async function changePbr(slotIndex, debugValue, flagsValue) {
  if (!ready || gate.busy || !isPbr(slots[slotIndex].experiment)) { syncControls(); return; }
  await runLocked(async () => {
    try {
      const debug = pbrDebug(debugValue);
      const flags = pbrFlags(flagsValue);
      lab.set_pbr(slotIndex, debug, flags);
      pbrDebugs[slotIndex] = debug;
      textureFlags[slotIndex] = flags;
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} · ${PBR_DEBUG_MODES[debug].name} · texture flags ${flags} · ソースを保持`);
    } catch (error) { setCompile('PBR 設定の変更に失敗 · 直前の設定を保持', 'error', errorText(error)); }
  });
}

async function changeShadows(slotIndex, input) {
  if (!ready || gate.busy || !isShadows(slots[slotIndex].experiment)) { syncControls(); return; }
  await runLocked(async () => {
    try {
      const config = shadowSettings(input);
      // All fields are validated and sent together. Retain last-good JS state on failure.
      lab.set_shadows(slotIndex, config.resolution, config.depth_bias, config.slope_bias, config.pcf, config.light, config.debug, config.enabled);
      shadowConfigs[slotIndex] = config;
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} · shadows ${config.enabled ? 'on' : 'off'} · ${config.resolution}² · PCF ${config.pcf}×${config.pcf} · ${SHADOW_DEBUG_MODES[config.debug].name} · ソースを保持`);
    } catch (error) { setCompile('Shadow 設定の変更に失敗 · 直前の設定を保持', 'error', errorText(error)); }
  });
}

async function changeSsao(slotIndex, input) {
  if (!ready || gate.busy || !isSsao(slots[slotIndex].experiment)) { syncControls(); return; }
  await runLocked(async () => {
    try {
      const config = ssaoSettings(input);
      // Validate all fields and publish only after the core accepts one transaction.
      lab.set_ssao(slotIndex, config.samples, config.resolution, config.blur, config.debug, config.enabled);
      ssaoConfigs[slotIndex] = config;
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} · SSAO ${config.enabled ? 'on' : 'off'} · ${config.samples} samples · AO ${config.resolution}% · ${SSAO_DEBUG_MODES[config.debug].name} · ソースを保持`);
    } catch (error) { setCompile('SSAO 設定の変更に失敗 · 直前の設定を保持', 'error', errorText(error)); }
  });
}

async function ssaoPreset(slotIndex, preset) {
  if (!Object.hasOwn(SSAO_PRESETS, preset)) return;
  await changeSsao(slotIndex, SSAO_PRESETS[preset]);
}

async function scalePreset(percent) {
  if (!ready || gate.busy) return;
  // Never overwrite either applied WGSL or an editor draft to make a preset.
  if (!slots.every(slot => isCourtyard(slot.experiment)) || comparisonKind(slots, [100, 100], modes, cameras) !== 'A/A') {
    setCompile('プリセットには A/B 同じ中庭条件が必要です', 'error', 'ソースは変更していません。A/B の実験・適用済み WGSL・描画方式・カメラを同じにして再試行してください。');
    return;
  }
  await runLocked(async () => {
    try {
      lab.set_render_scale(0, 100); scales[0] = 100;
      lab.set_render_scale(1, renderScale(percent)); scales[1] = percent;
      playing = false; time = 0; split = .5;
      $('split').value = '50'; $('split-line').style.left = '50%'; $('split-value').textContent = '50 / 50';
      syncTime();
      setCompile(`中庭 A100 / B${percent} · t = 0 · 50:50 · ソースと編集中の変更を保持`);
    } catch (error) { setCompile('プリセットの設定に失敗', 'error', errorText(error)); }
  });
}

function resizeIfNeeded() {
  if (!ready || gate.busy) return;
  const dpr = window.devicePixelRatio || 1;
  if (!resizePending && lastDpr === dpr) return;
  const { width, height } = backingSize(canvas.clientWidth, canvas.clientHeight, dpr);
  if (canvas.width !== width || canvas.height !== height) {
    // JS sets the backing store; Rust reconfigures the WebGPU surface to match.
    canvas.width = width;
    canvas.height = height;
    lab.resize(width, height);
  }
  $('resolution').textContent = `${width} × ${height} px`;
  lastDpr = dpr;
  resizePending = false;
}

function scheduleRenderRetry() {
  if (!ready || gate.busy || document.hidden || retryTimer) return;
  const delay = renderRetries.nextDelay();
  $('engine-status').className = 'status error';
  $('engine-status').innerHTML = delay === null
    ? '<i aria-hidden="true"></i> 描画待機 · 操作で再試行'
    : '<i aria-hidden="true"></i> 描画を再試行中';
  if (delay === null) return;
  retryTimer = setTimeout(() => {
    retryTimer = 0;
    // The gate can have changed since scheduling. Its unlock redraws safely.
    if (!ready || gate.busy || document.hidden) return;
    draw(false);
  }, delay);
}

function draw(resetRetries = true) {
  if (!ready || gate.busy) return false;
  if (resetRetries) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = 0;
    renderRetries.reset();
  }
  try {
    resizeIfNeeded();
    syncRenderDimensions();
    if (lab.render(time, split) !== true) {
      // A transient unavailable surface is not a successfully presented frame.
      // Suspend animation and retry at a bounded cadence even when paused.
      stopFrames();
      scheduleRenderRetry();
      return false;
    }
    recordCullingFrame();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = 0;
    renderRetries.reset();
    $('engine-status').className = 'status ready';
    $('engine-status').innerHTML = '<i aria-hidden="true"></i> WEBGPU / READY';
    scheduleFrame();
    return true;
  } catch (error) {
    fail('描画を続けられませんでした', `${errorText(error)}\nGPU の接続やブラウザーの状態を確認し、ページを再読み込みしてください。`);
    return false;
  }
}

function tick(now) {
  frame = 0;
  if (!ready || gate.busy || !playing || document.hidden) return;
  if (lastNow !== null) time = advanceTime(time, (now - lastNow) / 1000);
  lastNow = now;
  syncTime();
  draw(false);
}

async function sourceFor(id) {
  if (sources.has(id)) return sources.get(id);
  const file = experiments[id]?.file;
  if (!file) throw new Error('実験が見つかりません。');
  const response = await fetch(new URL(`./shaders/${file}`, import.meta.url));
  if (!response.ok) throw new Error(`${file} の読み込みに失敗しました (HTTP ${response.status})。web/shaders/ を確認してください。`);
  const source = await response.text();
  if (!source.trim()) throw new Error(`${file} が空です。`);
  sources.set(id, source);
  return source;
}

async function runLocked(operation) {
  if (!ready || gate.busy) return false;
  return gate.run(operation, () => {
    // A wasm-bindgen &mut self borrow can outlive an await. No render, resize,
    // or other WASM call may run until this operation has fully settled.
    stopFrames();
    syncControls();
  }, () => {
    syncControls();
    draw(); // This also flushes any resize deferred by ResizeObserver.
  });
}

async function applyShader() {
  if (!ready || gate.busy) return;
  const slotIndex = target;
  const source = slots[slotIndex].draft;
  await runLocked(async () => {
    setCompile(`${slotIndex === 0 ? 'A' : 'B'} をコンパイルしています…`, 'busy');
    try {
      await lab.reload(slotIndex, source);
      slots[slotIndex].applied = source;
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} に適用しました · 描画パイプライン更新`);
    } catch (error) {
      setCompile('コンパイルに失敗 · 最後に成功した描画を保持', 'error', errorText(error));
    }
  });
}

async function changeExperiment(slotIndex, next) {
  if (!ready || gate.busy) {
    experimentInputs[slotIndex].value = String(slots[slotIndex].experiment);
    return;
  }
  const previous = slots[slotIndex].experiment;
  await runLocked(async () => {
    setCompile('実験を読み込んでいます…', 'busy');
    try {
      const source = await sourceFor(next);
      if (isPbr(next)) {
        setCompile('FlightHelmet · GLB 取得 / decode / GPU upload…', 'busy');
        await flighthelmet.ensureLoaded(lab);
      }
      // The mesh experiment has a vertex layout and depth state of its own.
      // Configure its kind and compile the exact fetched source atomically.
      await lab.set_source(slotIndex, next, source);
      slots[slotIndex] = createExperimentSlot(next, source);
      cullingFrameStats[slotIndex] = null;
      if (slotIndex === target) showEditor();
      setCompile(`${slotIndex === 0 ? 'A' : 'B'} · ${experiments[next].name} に切り替えました`);
    } catch (error) {
      experimentInputs[slotIndex].value = String(previous);
      setCompile('実験の切り替えに失敗 · 直前の状態を保持', 'error', errorText(error));
    }
  });
}

async function exportPng() {
  if (!ready || gate.busy) return;
  // Resize before acquiring the gate; render exactly once immediately before
  // capture. A skipped presentation must never become a stale or empty PNG.
  try { resizeIfNeeded(); } catch (error) {
    fail('描画サイズの更新に失敗しました', errorText(error));
    return;
  }
  await runLocked(async () => {
    try {
      if (lab.render(time, split) !== true) {
        setCompile('PNG を保存できません · 描画を待って再試行してください', 'error', 'GPU がこのフレームを表示できませんでした。描画が戻ったら「PNG を保存」をもう一度押してください。');
        return;
      }
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG を作成できませんでした。')), 'image/png');
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rendering-lab-t${time.toFixed(2)}-ab${Math.round(split * 100)}-exp${slots[0].experiment}-${slots[1].experiment}-mode${modes[0]}-${modes[1]}-cam${cameras[0]}-${cameras[1]}-inst${instancingModes[0]}-${instancingModes[1]}-objects${objectCounts[0]}-${objectCounts[1]}${slots.some(slot => isPbr(slot.experiment)) ? `-pbr${pbrDebugs[0]}-${pbrDebugs[1]}-textures${textureFlags[0]}-${textureFlags[1]}` : ''}${shadowPngSuffix(slots, shadowConfigs)}${ssaoPngSuffix(slots, ssaoConfigs)}${cullingPngSuffix(slots, cullingModes)}-scale${scales[0]}-${scales[1]}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setCompile(`PNG を作成しました · t = ${time.toFixed(2)} s`);
    } catch (error) {
      setCompile('PNG の保存に失敗しました', 'error', errorText(error));
    }
  });
}

function fail(title, detail) {
  ready = false;
  playing = false;
  stopFrames();
  $('fatal-title').textContent = title;
  $('fatal-detail').textContent = detail;
  $('fatal-error').hidden = false;
  $('canvas-loading').hidden = true;
  $('engine-status').className = 'status error';
  $('engine-status').innerHTML = '<i aria-hidden="true"></i> GPU 未接続';
  setCompile('初期化または描画に失敗しました', 'error');
  syncControls();
}

function download(text, type, name) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function measure() {
  if (!ready || gate.busy || document.hidden) return;
  let config;
  try {
    config = settings(Object.fromEntries(['width','height','warmup','samples','repeats'].map(key => [key,$(`measure-${key}`).value])), Math.min(8192,lab.max_texture_dimension()));
  } catch (error) { $('measure-status').textContent = errorText(error); return; }
  // Snapshot only applied shaders, never unapplied editor drafts.
  const measurementSlots = slots.map((slot, index) => ({experiment: slot.experiment, source: slot.applied,
    ...renderingWork(slot, modes[index], cameras[index], instancingModes[index], objectCounts[index], pbrDebugs[index], textureFlags[index], shadowConfigs[index], ssaoConfigs[index], renderGeometry(config.width, config.height, split, scales)[index].internal_render_pixels, cullingModes[index], null), ...renderGeometry(config.width, config.height, split, scales)[index]}));
  const context = {started_at: new Date().toISOString(), time_seconds: time, split,
    comparison: comparisonKind(slots, scales, modes, cameras, instancingModes, objectCounts, pbrDebugs, textureFlags, shadowConfigs, ssaoConfigs, cullingModes, renderGeometry(config.width, config.height, split, scales).map(geometry => geometry.display_viewport_pixels)),
    culling_time_policy: slots.some(slot => isCulling(slot.experiment)) ? 'same deterministic camera path at frozen global time; frustum uses each slot display viewport aspect (view preserved across render scales); counts verified after measured-size render' : null,
    ssao_time_policy: slots.some(slot => isSsao(slot.experiment)) ? 'SSAO geometry and sampling fixed at t=0, seed=17; global time applies only to other experiments' : null,
    pbr_lighting: slots.some(slot => isPbr(slot.experiment)) ? {...PBR_LIGHTING} : null,
    display_canvas_physical_pixels: {width: config.width, height: config.height},
    render_scale_percent: [...scales],
    upsampling: 'linear filtering; offscreen targets composited into fixed display viewports',
    display_css_pixels: {width: canvas.clientWidth, height: canvas.clientHeight},
    viewport_order: 'A left, B right; same command buffer; order not randomized',
    vsync: 'browser presentation policy; not controlled', thermal_state: 'unavailable: not measured',
    environment_notes: $('measure-notes').value.trim() || 'unavailable: no operator notes',
    camera: 'per-slot fixed camera or deterministic path at frozen time; see slots[].camera and camera_id', scene_seed: 'deterministic procedural geometry or pinned FlightHelmet GLB; no RNG',
    draw_call_counts_source: 'deterministic encoded draw calls; culling counts read from actual submitted core draw list at measured dimensions; not measured fragment invocations or GPU work',
    ...frameWork(measurementSlots),
    shared_instance_buffer: sharedInstanceBufferWork(measurementSlots),
    slots: measurementSlots,
    browser: navigator.userAgent, platform: navigator.platform || 'unavailable',
    device_pixel_ratio: window.devicePixelRatio || 1, hardware: 'unavailable: not inferred from browser',
    adapter: lab.adapter_description(), timestamp_supported: lab.timestamp_supported(), timestamp_enabled: false,
    clock: 'performance.now; precision depends on browser privacy policy',
    pacing: 'requestAnimationFrame; foreground only; no GPU completion wait',
    scope: 'combined A/B offscreen and composite passes; no per-slot timings; not independent A-versus-B GPU benchmark; renderer initialization and static instance upload excluded; FlightHelmet fetch/decode/GPU upload also excluded; required shadow maps regenerated inside every measured frame, including depth debug with shadows Off; shadow texture reallocation on setting changes excluded; SSAO gbuffer, AO and optional bilateral passes regenerated inside every enabled measured frame; SSAO Off skips those passes; SSAO setting/size allocation occurs before samples or in excluded warmup; shader compilation excluded; culling tests and LOD selection included in CPU encode; CPU culling-counter retrieval is outside CPU render-call timing (rAF cadence still includes reporting overhead)',
    build_revision: $('measure-commit').value.trim() || 'unavailable: operator must record tested commit',
    build_revision_source: 'operator supplied; not automatically verified'};
  const run = new MeasurementRun(config, context);
  playing = false;
  await runLocked(async () => {
    let raf = 0;
    let verifiedCullingStats = null;
    try {
      canvas.width = config.width; canvas.height = config.height;
      lab.resize(config.width,config.height);
      syncRenderDimensions(config.width, config.height);
      $('resolution').textContent = `${config.width} × ${config.height} px · 計測固定`;
      await new Promise(resolve => {
        const finish = reason => {
          if (reason) run.abort(reason);
          if (raf) cancelAnimationFrame(raf);
          raf = 0; measurement = null; resolve();
        };
        measurement = {abort: finish};
        syncControls();
        const sample = now => {
          raf = 0;
          if (document.hidden) { finish('タブが非表示になりました'); return; }
          if (canvas.clientWidth !== context.display_css_pixels.width || canvas.clientHeight !== context.display_css_pixels.height || (window.devicePixelRatio || 1) !== context.device_pixel_ratio) { finish('表示サイズまたは DPR が変わりました'); return; }
          try {
            const start = performance.now();
            const timings = Array.from(lab.render_measured(context.time_seconds,context.split));
            const callMs = performance.now() - start;
            if (timings[0] === 1 && slots.some(slot => isCulling(slot.experiment))) {
              const actual = readCullingStats();
              // Frozen time, shaders and dimensions must produce the same submitted list.
              if (verifiedCullingStats !== null && JSON.stringify(actual) !== verifiedCullingStats) throw new Error('Culling counters changed during the fixed-condition run.');
              if (verifiedCullingStats === null) {
                verifiedCullingStats = JSON.stringify(actual);
                run.context.slots.forEach((slot, index) => {
                  if (!isCulling(slot.experiment)) return;
                  const stats = actual[index];
                  Object.assign(slot, {culling_stats: stats, color_draw_calls: stats.draw_calls, scene_draw_calls: stats.draw_calls, total_draw_calls: stats.draw_calls + 1});
                });
                Object.assign(run.context, frameWork(run.context.slots));
                run.context.culling_stats_verified_at = {time_seconds: context.time_seconds, canvas_pixels: {width: config.width, height: config.height}, scope: 'first successful measured-size frame; checked unchanged on every subsequent successful frame'};
              }
              recordCullingFrame(actual);
            }
            // Never silently discard unavailable or failed frames: abort the run.
            run.add(now,timings,callMs);
            $('measure-status').textContent = `計測中 ${run.progress}`;
            if (run.status === 'complete') finish();
            else raf = requestAnimationFrame(sample);
          } catch (error) { finish(errorText(error)); }
        };
        raf = requestAnimationFrame(sample);
      });
    } catch (error) { run.abort(errorText(error)); }
    finally {
      measurement = null;
      lastReport = run.report();
      resizePending = true;
      const summary = lastReport.summaries.map(s => `run ${s.repeat}: CPU encode ${s.cpu_encode_ms.mean.toFixed(3)} ms / submit ${s.cpu_submit_ms.mean.toFixed(3)} ms / rAF p95 ${s.frame_interval_ms.p95.toFixed(2)} ms`).join('\n');
      $('measure-status').textContent = `${run.status === 'complete' ? '完了' : `中止: ${run.reason}`} · ${run.rows.length} samples\n${summary}\nGPU 時間: 未計測（timestamp query 未有効化）`;
    }
  });
}
cullingInputs.forEach((select, index) => select.addEventListener('change', () => changeCulling(index, select.value)));
scaleInputs.forEach((select, index) => select.addEventListener('change', () => changeScale(index, select.value)));
modeInputs.forEach((select, index) => select.addEventListener('change', () => changeMode(index, select.value)));
cameraInputs.forEach((select, index) => select.addEventListener('change', () => changeCamera(index, select.value)));
instancingInputs.forEach((select, index) => select.addEventListener('change', () => changeInstancing(index, select.value, objectCounts[index])));
objectCountInputs.forEach((input, index) => input.addEventListener('change', () => changeInstancing(index, instancingModes[index], input.value)));
pbrDebugInputs.forEach((select, index) => select.addEventListener('change', () => changePbr(index, select.value, textureFlags[index])));
pbrTextureInputs.forEach((inputs, index) => inputs.forEach(input => input.addEventListener('change', () => {
  const flags = inputs.reduce((value, checkbox, texture) => value | (checkbox.checked ? PBR_TEXTURE_INPUTS[texture].bit : 0), 0);
  return changePbr(index, pbrDebugs[index], flags);
})));
shadowInputs.forEach((inputs, index) => Object.values(inputs).forEach(input => input.addEventListener('change', () =>
  changeShadows(index, Object.fromEntries(SHADOW_FIELDS.map(key => [key, inputs[key].value])))
)));
ssaoInputs.forEach((inputs, index) => Object.values(inputs).forEach(input => input.addEventListener('change', () =>
  changeSsao(index, Object.fromEntries(SSAO_FIELDS.map(key => [key, inputs[key].value])))
)));
for (const [index, side] of ['a', 'b'].entries()) for (const preset of Object.keys(SSAO_PRESETS)) $(`ssao-preset-${preset}-${side}`).addEventListener('click', () => ssaoPreset(index, preset));
for (const percent of [100, 75, 50]) $(`scale-preset-${percent}`).addEventListener('click', () => scalePreset(percent));
$('measure-start').addEventListener('click', measure);
$('measure-cancel').addEventListener('click', () => measurement?.abort('ユーザーが中止しました'));
$('measure-csv').addEventListener('click', () => { if (lastReport && !gate.busy) download(reportCsv(lastReport),'text/csv;charset=utf-8','rendering-lab-measurements.csv'); });
$('measure-json').addEventListener('click', () => { if (lastReport && !gate.busy) download(JSON.stringify(lastReport,null,2),'application/json','rendering-lab-measurements.json'); });

$('retry-button').addEventListener('click', () => window.location.reload());
$('target-a').addEventListener('click', () => { if (!gate.busy) { target = 0; showEditor(); } });
$('target-b').addEventListener('click', () => { if (!gate.busy) { target = 1; showEditor(); } });
$('reload-button').addEventListener('click', applyShader);
$('export-button').addEventListener('click', exportPng);
experimentInputs.forEach((select, slotIndex) => select.addEventListener('change', () => changeExperiment(slotIndex, Number(select.value))));
editor.addEventListener('input', () => { slots[target].draft = editor.value; syncLines(); syncDirty(); });
editor.addEventListener('scroll', () => { $('line-numbers').scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    applyShader();
  } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
});
$('split').addEventListener('input', (event) => {
  if (gate.busy) return;
  split = clampFinite(event.target.value, 10, 90, 50) / 100;
  $('split-line').style.left = `${split * 100}%`;
  $('split-value').textContent = `${Math.round(split * 100)} / ${Math.round((1 - split) * 100)}`;
  draw();
});
$('time').addEventListener('input', (event) => {
  if (gate.busy) return;
  playing = false;
  stopFrames();
  time = clampFinite(event.target.value, 0, 20);
  syncControls();
  syncTime();
  draw();
});
$('play-button').addEventListener('click', () => {
  if (!ready || gate.busy) return;
  playing = !playing;
  stopFrames();
  syncControls();
  draw();
});
$('reset-time').addEventListener('click', () => {
  if (gate.busy) return;
  playing = false;
  time = 0;
  stopFrames();
  syncControls();
  syncTime();
  draw();
});
function onResize() {
  resizePending = true;
  if (!gate.busy) draw();
}
window.addEventListener('resize', onResize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) measurement?.abort('タブが非表示になりました');
  stopFrames();
  if (!document.hidden) onResize();
});
window.addEventListener('pagehide', () => { measurement?.abort('ページを離れました'); stopFrames(); resizeObserver?.disconnect(); });
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { resizeObserver?.observe($('canvas-wrap')); onResize(); }
});

async function initialize() {
  if (!window.isSecureContext) {
    fail('安全な接続が必要です', 'WebGPU は HTTPS または localhost で利用してください。file:// で直接開かず、ローカル HTTP サーバーを起動してください。');
    return;
  }
  if (!navigator.gpu) {
    fail('この環境では WebGPU を利用できません', 'WebGPU 対応ブラウザーを使い、ハードウェアアクセラレーションが利用できることを確認してください。');
    return;
  }
  let module;
  try {
    module = await import('./pkg/rendering_web.js');
    await module.default();
  } catch (error) {
    fail('WebAssembly の読み込みに失敗しました', `web/pkg/ に bash scripts/build-web.sh のビルド出力が必要です。\n${errorText(error)}`);
    return;
  }
  try {
    const source = await sourceFor(DEFAULT_EXPERIMENT);
    const { width, height } = backingSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
    canvas.width = width;
    canvas.height = height;
    lab = await module.create_renderer(canvas);
    // Compile the exact source shown in the editor, including changes made
    // since the WASM build. ready stays false across both mutable async calls.
    await lab.set_source(0, DEFAULT_EXPERIMENT, source);
    await lab.set_source(1, DEFAULT_EXPERIMENT, source);
    slots.forEach((_, index) => {
      slots[index] = createExperimentSlot(DEFAULT_EXPERIMENT, source);
      experimentInputs[index].value = String(DEFAULT_EXPERIMENT);
    });
    ready = true;
    showEditor();
    syncTime();
    $('canvas-loading').hidden = true;
    $('split-line').style.visibility = 'visible';
    $('engine-status').className = 'status ready';
    $('engine-status').innerHTML = '<i aria-hidden="true"></i> WEBGPU / READY';
    setCompile('準備完了 · A / B ともにメッシュの中庭で開始');
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe($('canvas-wrap'));
    draw();
  } catch (error) {
    fail('GPU または実験の初期化に失敗しました', errorText(error));
  }
}

initialize();
