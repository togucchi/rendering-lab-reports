// CPU observations and rAF cadence are not GPU execution time.
export const METRICS = ['frame_interval_ms', 'cpu_acquire_ms', 'cpu_encode_ms', 'cpu_submit_ms', 'cpu_present_ms', 'cpu_render_call_ms'];
export function settings(input, maxDimension = 8192) {
  const integer = (key, min, max) => {
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key}: ${min}〜${max} の整数を指定してください。`);
    return value;
  };
  return { width: integer('width', 2, maxDimension), height: integer('height', 1, maxDimension),
    warmup: integer('warmup', 1, 10000), samples: integer('samples', 2, 10000), repeats: integer('repeats', 1, 20) };
}
export function summarize(values) {
  if (!values.length || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('有効な計測値が必要です。');
  const sorted = [...values].sort((a,b) => a-b);
  const percentile = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { count: values.length, mean: values.reduce((a,b) => a+b,0)/values.length,
    min: sorted[0], median: percentile(.5), p95: percentile(.95), max: sorted.at(-1) };
}
export class MeasurementRun {
  constructor(config, context) { this.config = settings(config); this.context = structuredClone(context); this.rows = []; this.previous = null; this.frame = 0; this.repeat = 1; this.status = 'running'; this.reason = null; }
  get progress() { return `${this.repeat}/${this.config.repeats} · ${Math.min(this.frame, this.config.warmup)} warmup · ${Math.max(0,this.frame-this.config.warmup)}/${this.config.samples} samples`; }
  add(now, timings, callMs) {
    if (this.status !== 'running') throw new Error('計測は終了しています。');
    if (!Number.isFinite(now) || (this.previous !== null && now < this.previous) || timings.length !== 5 || timings[0] !== 1 || timings.slice(1).some(v => !Number.isFinite(v) || v < 0) || !Number.isFinite(callMs) || callMs < 0) throw new Error('フレーム未描画または無効な計測値。');
    const interval = this.previous === null ? null : now - this.previous;
    this.previous = now;
    this.frame++;
    if (this.frame > this.config.warmup) this.rows.push({repeat: this.repeat, sample: this.frame-this.config.warmup,
      frame_interval_ms: interval, cpu_acquire_ms: timings[1], cpu_encode_ms: timings[2], cpu_submit_ms: timings[3], cpu_present_ms: timings[4], cpu_render_call_ms: callMs, gpu_ms: null});
    if (this.frame === this.config.warmup + this.config.samples) {
      if (this.repeat === this.config.repeats) this.status = 'complete';
      else { this.repeat++; this.frame = 0; this.previous = null; }
    }
  }
  abort(reason) { if (this.status === 'running') { this.status = 'aborted'; this.reason = String(reason); } }
  report() {
    const summaries = [];
    for (let repeat = 1; repeat <= this.config.repeats; repeat++) {
      const rows = this.rows.filter(row => row.repeat === repeat);
      if (rows.length) summaries.push({repeat, ...Object.fromEntries(METRICS.map(key => [key, summarize(rows.map(row => row[key]))]))});
    }
    return {schema_version: 1, measurement_kind: 'browser_cpu_and_raf', status: this.status, reason: this.reason,
      config: {...this.config}, context: structuredClone(this.context), gpu_time_status: 'unavailable: timestamp query not enabled', summaries, rows: this.rows.map(row => ({...row}))};
  }
}
// Quote every field and neutralize spreadsheet formula execution in textual cells.
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[=+@\-\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
export function reportCsv(report) {
  const columns = ['schema_version','measurement_kind','status','reason','config_json','context_json','gpu_time_status','row_type','repeat','sample',...METRICS,'gpu_ms','metric','count','mean','median','p95','min','max'];
  // Full shaders are stored once to avoid O(samples × shader size) export memory.
  const metadata = [report.schema_version,report.measurement_kind,report.status,report.reason,JSON.stringify(report.config),null,report.gpu_time_status];
  const contextRow = [...metadata];
  contextRow[5] = JSON.stringify(report.context);
  const rows = [[...contextRow,'metadata',...Array(columns.length-metadata.length-1).fill(null)], ...report.rows.map(row => [...metadata,'sample',row.repeat,row.sample,...METRICS.map(key => row[key]),row.gpu_ms,...Array(7).fill(null)])];
  for (const summary of report.summaries) for (const metric of METRICS) {
    const s = summary[metric];
    rows.push([...metadata,'summary',summary.repeat,null,...Array(METRICS.length+1).fill(null),metric,s.count,s.mean,s.median,s.p95,s.min,s.max]);
  }
  return [columns,...rows].map(row => row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
