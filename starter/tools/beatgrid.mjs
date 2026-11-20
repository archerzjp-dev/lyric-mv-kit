#!/usr/bin/env node
// 拍点网格：把 `hyperframes audio` 量出来的起音（onsets）拟合成一条“会跟着歌走”的拍点网格。
//
// 为什么要它：`hyperframes beats` 在很多歌上会报 "no steady beat"（尤其是前奏长、鼓进得晚、
// 或者整首歌速度在漂的歌），而 MV 的剪辑点、冲击、抖动全都要落在拍子上。这里的做法是：
//   1. 用底鼓频段的起音估一个全曲速度（在 70–180 BPM 里搜，避开倍速/半速）；
//   2. 从这个速度出发，逐拍“锁相”：每一拍在预测位置 ±60 ms 内找起音，把相位和周期慢慢拉过去，
//      所以速度漂了（比如副歌比主歌快 2 BPM）网格会跟着走，不会累积成半拍的误差；
//   3. 没有鼓的地方（前奏、静场）按当前速度外推；
//   4. 小节线（downbeat）：默认按“强起音更常落在第一拍”猜，猜不准就用 --first-downbeat 指定。
//
// 用法（在 HyperFrames 工程目录里）：
//   npx hyperframes audio assets/song.wav --only onsets --band 30,150 --json > low.json
//   npx hyperframes audio assets/song.wav --only onsets,envelope --hop-ms 20 --json > full.json
//   node tools/beatgrid.mjs --low low.json --full full.json --out data/music.js
// 可选：--bpm 133（只在附近 ±4% 里搜）--meter 4 --first-downbeat 11.32 --ref ref.json（对照已知拍点，打印误差）
import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);
if (!args.low) {
  console.error('用法：node tools/beatgrid.mjs --low low.json [--full full.json] [--out data/music.js] [--bpm N] [--meter 4] [--first-downbeat 秒]');
  process.exit(1);
}

const item = (f) => JSON.parse(fs.readFileSync(f, 'utf8')).items[0];
const low = item(args.low);
const full = args.full ? item(args.full) : null;
const dur = low.duration;
const meter = +(args.meter ?? 4);

// 起音：全频段的起音为主（底鼓、军鼓、镲片、和弦进来都在拍上）；底鼓频段只取强的，权重减半
// （低频段里贝斯的每个音都会被认成起音，全收进来反而把速度拉偏）
const ev = [];
if (full) for (const e of full.onsets.events) ev.push({ t: e.t, s: e.strength });
for (const e of low.onsets.events) if (!full || e.strength >= 0.3) ev.push({ t: e.t, s: (full ? 0.5 : 1) * e.strength });
ev.sort((a, b) => a.t - b.t);
const totalS = ev.reduce((a, e) => a + e.s, 0);

// ---------- 1. 全曲速度：对每个周期 P，把起音按 t mod P 折叠，看能不能聚成一个尖峰
const SIG = 0.022;
function score(P) {
  const nb = Math.max(8, Math.round(P / 0.002));
  const h = new Float64Array(nb);
  for (const e of ev) h[Math.floor(((e.t % P) / P) * nb) % nb] += e.s;
  const w = Math.ceil((3 * SIG) / (P / nb));
  let best = -1, bestI = 0;
  for (let i = 0; i < nb; i++) {
    let acc = 0;
    for (let k = -w; k <= w; k++) {
      const d = (k * P) / nb;
      acc += h[(i + k + nb) % nb] * Math.exp(-(d * d) / (2 * SIG * SIG));
    }
    if (acc > best) { best = acc; bestI = i; }
  }
  // 除以“起音完全随机时也能落进高斯窗的比例”：不除的话，周期越短越占便宜，会把 133 认成 177、199
  const chance = (SIG * Math.sqrt(2 * Math.PI)) / P;
  return { s: best / totalS / chance, raw: best / totalS, phase: ((bestI + 0.5) / nb) * P };
}
let lo = +(args.min ?? 70), hi = +(args.max ?? 180);
if (args.bpm) { lo = +args.bpm * 0.96; hi = +args.bpm * 1.04; }
let cand = [];
for (let bpm = lo; bpm <= hi; bpm += 0.05) cand.push({ bpm, ...score(60 / bpm) });
cand.sort((a, b) => b.s - a.s);
// 倍速/半速：两个候选分数接近时，取更接近 120 的那个（大多数流行歌在 80–160）
let top = cand[0];
for (const c of cand.slice(1, 40)) {
  const r = c.bpm / top.bpm;
  const octave = Math.abs(r - 2) < 0.03 || Math.abs(r - 0.5) < 0.02 || Math.abs(r - 1.5) < 0.03 || Math.abs(r - 2 / 3) < 0.02;
  if (octave && c.s > top.s * 0.85 && Math.abs(Math.log2(c.bpm / 120)) < Math.abs(Math.log2(top.bpm / 120))) top = c;
}
let fine = top;
for (let bpm = top.bpm - 0.1; bpm <= top.bpm + 0.1; bpm += 0.002) {
  const c = { bpm, ...score(60 / bpm) };
  if (c.s > fine.s) fine = c;
}
const P0 = 60 / fine.bpm;

// ---------- 2. 分段局部拟合：每 4 拍取一个中心，前后各 8 拍的窗口里重新搜周期（±3%）和相位，
// 用整窗几十个起音一起投票，比逐拍锁相稳（逐拍锁相会被切分音、拖后的合成器拉偏）。
// 相位也用全部起音来定。只用底鼓频段不行：贝斯常在反拍上，低频段的强起音会把网格整段拖到半拍上。
const phaseEv = ev;
function localFit(c, P, evs, pNow = P) {
  const a = c - 8 * P, b = c + 8 * P;
  const inW = evs.filter((e) => e.t >= a && e.t <= b);
  if (inW.reduce((s, e) => s + e.s, 0) < 3) return null;
  const at = (o, p) => inW.reduce((sc, e) => { const x = e.t - (o + Math.round((e.t - o) / p) * p); return sc + e.s * Math.exp(-(x * x) / (2 * 0.015 * 0.015)); }, 0);
  const keep = at(c, pNow);
  let best = { sc: -1 };
  for (let r = 0.97; r <= 1.03; r += 0.001) {
    const p = P * r;
    // 相位只许在预测位置 ±70 ms 里找：再宽就会锁到反拍（踩镲、贝斯的“嗒”在半拍上）
    for (let d = -0.07; d <= 0.07; d += 0.002) {
      const o = c + d;
      let sc = 0;
      for (const e of inW) {
        const k = Math.round((e.t - o) / p);
        const x = e.t - (o + k * p);
        sc += e.s * Math.exp(-(x * x) / (2 * 0.015 * 0.015));
      }
      if (sc > best.sc) best = { sc, p, o };
    }
  }
  // 挪相位要有理由：新位置的得分没比“照原速度走下去”高出 15%，就不挪（鼓稀的段落最容易被一两个杂音带偏）
  if (Math.abs(best.o - c) > 0.02 && best.sc < keep * 1.15) return { sc: keep, p: pNow, o: c };
  return best;
}
// 顺着歌往前走：每次在当前位置拟合一窗，取窗中间 4 拍，再用这窗的周期预测下一窗的中心。
// 这样副歌快 2 BPM 时网格会跟上，不会因为和全曲网格差出一整拍而跳拍。
const beats = [];
{
  let x = fine.phase, p = P0;
  while (x > P0) x -= P0;
  while (x < dur + P0) {
    // 周期永远围着全曲速度 ±3% 搜（不围着上一窗搜，否则误差会一窗一窗累积，越走越快）
    const f = localFit(x, P0, phaseEv, p);
    if (f) {
      p = 0.5 * p + 0.5 * f.p;               // 周期慢慢跟，防止某一窗抽风
      const k = Math.round((x - f.o) / f.p);
      x = f.o + k * f.p;
    }
    for (let j = 0; j < 4; j++) beats.push(x + j * p);
    x += 4 * p;
  }
}
// 相邻两窗接缝处的小跳动：对每拍相对“均匀拍”的偏差取 5 拍中位数
{
  const dev = beats.map((b, i) => (i > 0 && i < beats.length - 1 ? b - (beats[i - 1] + beats[i + 1]) / 2 : 0));
  for (let i = 2; i < beats.length - 2; i++) {
    const w = dev.slice(i - 2, i + 3).sort((a, b) => a - b)[2];
    if (Math.abs(dev[i] - w) > 0.012) beats[i] -= (dev[i] - w) / 2;
  }
}
// 往前补到 0 以前一拍，往后补到结尾以后一拍
while (beats[0] > 0) beats.unshift(beats[0] - P0);
while (beats[beats.length - 1] < dur) beats.push(beats[beats.length - 1] + P0);

// ---------- 3. 小节线
function nearby(x, W = 0.06) {
  let w = 0;
  for (const e of ev) {
    if (e.t < x - W) continue;
    if (e.t > x + W) break;
    const d = e.t - x;
    w += e.s * Math.exp(-(d * d) / (2 * 0.025 * 0.025));
  }
  return w > 0.25 ? { w } : null;
}
let offset;
if (args['first-downbeat'] !== undefined) {
  const t0 = +args['first-downbeat'];
  let k = 0;
  for (let i = 0; i < beats.length; i++) if (Math.abs(beats[i] - t0) < Math.abs(beats[k] - t0)) k = i;
  offset = k % meter;
} else {
  const sc = new Array(meter).fill(0);
  for (let i = 0; i < beats.length; i++) {
    const m = nearby(beats[i]);
    if (m) sc[i % meter] += m.w * m.w;
  }
  offset = sc.indexOf(Math.max(...sc));
}
const downbeats = beats.filter((_, i) => i % meter === offset);

// ---------- 4. 输出
const r3 = (x) => Math.round(x * 1000) / 1000;
const kicks = low.onsets.events.filter((e) => e.strength >= 0.35).map((e) => r3(e.t));
const hits = full ? full.onsets.events.filter((e) => e.strength >= 0.5).map((e) => r3(e.t)) : [];
let env = null;
if (full?.envelope?.values) {
  const v = full.envelope.values;
  const mn = Math.min(...v.filter(Number.isFinite)), mx = Math.max(...v.filter(Number.isFinite));
  env = { hop: full.envelope.hopMs / 1000, values: v.map((x) => Math.round(((Number.isFinite(x) ? x : mn) - mn) / (mx - mn || 1) * 1000) / 1000) };
}
const out = { duration: r3(dur), bpm: Math.round(fine.bpm * 1000) / 1000, meter, beats: beats.map(r3), downbeats: downbeats.map(r3), kicks, hits, env };

// 局部速度：每 8 小节一段，让人一眼看出歌有没有变速
const seg = [];
for (let i = 0; i + meter * 8 < beats.length; i += meter * 8) {
  const a = beats[i], b = beats[i + meter * 8];
  if (b > dur) break;
  seg.push(`${a.toFixed(1)}s ${(60 / ((b - a) / (meter * 8))).toFixed(2)}`);
}
console.error(`全曲速度 ${out.bpm} BPM（聚拢度 ${fine.s.toFixed(2)}，1 是随机，2 以上可信），${out.beats.length} 拍，${out.downbeats.length} 个小节线，第一个小节线 ${out.downbeats.find((d) => d >= -0.05)?.toFixed(3)} s`);
console.error(`每 8 小节的速度：${seg.join(' | ')}`);
if (fine.s < 1.6) console.error('聚拢度低：这首歌可能节奏不稳或鼓很少。剪辑点改用段落和能量变化，别逐拍硬卡。');

// 哪些地方要用耳朵核对：连续 2 小节里，落在拍上 ±25 ms 有起音的拍不到一半
{
  const weak = [];
  for (let i = 0; i + meter * 2 <= beats.length; i += meter * 2) {
    const blk = beats.slice(i, i + meter * 2).filter((b) => b > 0 && b < dur);
    if (!blk.length) continue;
    const ok = blk.filter((b) => nearby(b, 0.025)).length / blk.length;
    if (ok < 0.5) weak.push(blk[0].toFixed(1));
  }
  if (weak.length) console.error(`这些位置起音和网格对不上（鼓稀、切分、变速或静场），开工前戴耳机核对：${weak.join('s, ')}s`);
}

if (args.ref) {
  const ref = JSON.parse(fs.readFileSync(args.ref, 'utf8'));
  const rb = ref.beats ?? ref;
  const errs = rb.filter((t) => t > 1 && t < dur - 1).map((t) => {
    let n = beats[0];
    for (const b of beats) if (Math.abs(b - t) < Math.abs(n - t)) n = b;
    return Math.abs(n - t) * 1000;
  }).sort((a, b) => a - b);
  const q = (p) => errs[Math.min(errs.length - 1, Math.floor(p * errs.length))].toFixed(1);
  console.error(`对照拍点 ${errs.length} 个：误差中位数 ${q(0.5)} ms，90% ${q(0.9)} ms，最大 ${q(1)} ms`);
  if (ref.downbeats) {
    const hit = ref.downbeats.filter((t) => t > 1 && t < dur - 1 && downbeats.some((d) => Math.abs(d - t) < 0.06)).length;
    console.error(`小节线对上 ${hit}/${ref.downbeats.filter((t) => t > 1 && t < dur - 1).length}`);
  }
}

const js = `// 由 tools/beatgrid.mjs 生成。beats/downbeats 是秒；kicks 是底鼓起音；env 是 0–1 的响度包络。\nwindow.MUSIC = ${JSON.stringify(out)};\n`;
if (args.out) { fs.writeFileSync(args.out, js); console.error(`写出 ${args.out}`); }
else process.stdout.write(js);
