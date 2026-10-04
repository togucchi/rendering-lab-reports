import { settings, MeasurementRun, reportCsv } from './metrics.mjs';
import { DEFAULT_EXPERIMENT, EXPERIMENTS, createExperimentSlot, advanceTime, backingSize, clampFinite, errorText, isDirty, OperationGate, FrameRetryBudget } from './state.mjs';

const $ = (id) => document.getElementById(id);
const canvas = $('viewport');
const editor = $('shader-source');
const experimentInputs = [$('experiment-a'), $('experiment-b')];
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
  syncDirty();
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
    if (lab.render(time, split) !== true) {
      // A transient unavailable surface is not a successfully presented frame.
      // Suspend animation and retry at a bounded cadence even when paused.
      stopFrames();
      scheduleRenderRetry();
      return false;
    }
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
      // The mesh experiment has a vertex layout and depth state of its own.
      // Configure its kind and compile the exact fetched source atomically.
      await lab.set_source(slotIndex, next, source);
      slots[slotIndex] = createExperimentSlot(next, source);
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
      link.download = `rendering-lab-t${time.toFixed(2)}-ab${Math.round(split * 100)}.png`;
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
  const context = {started_at: new Date().toISOString(), time_seconds: time, split,
    comparison: slots[0].experiment === slots[1].experiment && slots[0].applied === slots[1].applied ? 'A/A' : 'A/B',
    display_css_pixels: {width: canvas.clientWidth, height: canvas.clientHeight},
    viewport_order: 'A left, B right; same command buffer; order not randomized',
    vsync: 'browser presentation policy; not controlled', thermal_state: 'unavailable: not measured',
    environment_notes: $('measure-notes').value.trim() || 'unavailable: no operator notes',
    camera: 'fixed courtyard camera v1', scene_seed: 'deterministic procedural geometry; no RNG',
    slots: slots.map(slot => ({experiment: slot.experiment, source: slot.applied})),
    browser: navigator.userAgent, platform: navigator.platform || 'unavailable',
    device_pixel_ratio: window.devicePixelRatio || 1, hardware: 'unavailable: not inferred from browser',
    adapter: lab.adapter_description(), timestamp_supported: lab.timestamp_supported(), timestamp_enabled: false,
    clock: 'performance.now; precision depends on browser privacy policy',
    pacing: 'requestAnimationFrame; foreground only; no GPU completion wait',
    scope: 'combined A/B pass; not independent A-versus-B GPU benchmark',
    build_revision: $('measure-commit').value.trim() || 'unavailable: operator must record tested commit',
    build_revision_source: 'operator supplied; not automatically verified'};
  const run = new MeasurementRun(config, context);
  playing = false;
  await runLocked(async () => {
    let raf = 0;
    try {
      canvas.width = config.width; canvas.height = config.height;
      lab.resize(config.width,config.height);
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
