// mv.js —— 在 HyperFrames 里做“代码生成 MV”的一组小工具。没有依赖，普通 <script> 引入即可。
//
// 核心约定：画面是时间 t 的纯函数。同一个 t 永远画出同一帧，所以预览、逐帧导出、4K 重渲完全一致。
// 不许用 Date.now()、Math.random()、requestAnimationFrame 当时钟，不许依赖“上一帧”的状态。
(function () {
  const MV = {};

  // ---------------------------------------------------------------- 缓动
  // 用强缓动：动作要“猛—停—猛”，不要屏保式的匀速飘。
  MV.ease = {
    linear: (x) => x,
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
    outBack: (x, s = 1.7) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
    // 弹簧：过冲后回弹，k 越大越硬，z 越大越快停
    spring: (x, k = 14, z = 5) => (x <= 0 ? 0 : 1 - Math.exp(-z * x) * Math.cos(k * x)),
  };
  MV.clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  MV.lerp = (a, b, k) => a + (b - a) * k;
  /** t 在 [a, b] 里走到哪了（0–1），超出夹住。 */
  MV.prog = (t, a, b) => MV.clamp((t - a) / (b - a));

  // ---------------------------------------------------------------- 确定的随机
  MV.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** 2D 值噪声，-1..1，同样的输入永远同样的输出。 */
  MV.noise = function (x, y = 0, seed = 7) {
    const h = (i, j) => {
      let n = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  };

  // ---------------------------------------------------------------- 音乐
  /**
   * 读 tools/beatgrid.mjs 生成的 window.MUSIC。
   * beatAt(t) 返回“连续拍号”（3.5 = 第 4 拍的一半），barAt 同理。
   * 网格不是“第一拍 + k × 周期”推出来的，是逐拍量的数组：歌会变速，推出来的网格会漂。
   */
  MV.Music = function (m) {
    const beats = m.beats, downs = m.downbeats;
    const idx = (arr, t) => {
      let lo = 0, hi = arr.length - 1;
      if (t <= arr[0]) return (t - arr[0]) / (arr[1] - arr[0]);
      if (t >= arr[hi]) return hi + (t - arr[hi]) / (arr[hi] - arr[hi - 1]);
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid] <= t) lo = mid; else hi = mid; }
      return lo + (t - arr[lo]) / (arr[lo + 1] - arr[lo]);
    };
    const since = (arr, t) => {
      let lo = 0, hi = arr.length - 1, best = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
      return best < 0 ? Infinity : t - arr[best];
    };
    return {
      raw: m,
      bpm: m.bpm,
      beatAt: (t) => idx(beats, t),
      barAt: (t) => idx(downs, t),
      timeOfBeat: (k) => { const i = Math.floor(k), f = k - i; const a = beats[MV.clamp(i, 0, beats.length - 1)], b = beats[MV.clamp(i + 1, 0, beats.length - 1)]; return a + (b - a) * f; },
      timeOfBar: (k) => downs[MV.clamp(Math.round(k), 0, downs.length - 1)],
      /** 最近一次拍点/小节线/底鼓之后的衰减脉冲，1 → 0。decay 是秒。 */
      pulse: (t, which = 'beats', decay = 0.18) => Math.exp(-since(m[which] || beats, t) / decay),
      /** 0–1 的整体响度（来自 hyperframes audio 的包络）。 */
      energy: (t) => {
        if (!m.env) return 0.5;
        const v = m.env.values, x = t / m.env.hop, i = Math.floor(x);
        const a = v[MV.clamp(i, 0, v.length - 1)], b = v[MV.clamp(i + 1, 0, v.length - 1)];
        return a + (b - a) * (x - i);
      },
    };
  };

  // ---------------------------------------------------------------- 歌词
  /**
   * 读 window.LYRICS（tools/tap.html 或强制对齐导出）：{ lines: [{ text, start, end, chars: [{ c, start, end }] }] }
   * 场景里按内容查，不写死秒数：get('越过它', 0)。对齐数据重做以后，画面自动跟上。
   */
  MV.Lyrics = function (data) {
    const lines = data.lines;
    return {
      lines,
      get(q, nth = 0) {
        const hits = lines.filter((l) => l.text.replace(/\s/g, '').includes(q.replace(/\s/g, '')));
        if (!hits[nth]) throw new Error(`歌词里找不到第 ${nth + 1} 次出现的“${q}”`);
        return hits[nth];
      },
      lineAt(t) { return lines.find((l) => t >= l.start && t < l.end) || null; },
    };
  };

  // ---------------------------------------------------------------- 逐字卡拉 OK
  /**
   * 每个字的状态。规矩：
   * - 字不能在它被唱出来之前点亮；整句可以提前 lead 秒（默认 0.4）以暗色预告。
   * - sung：这个字唱了多少（0–1），hit：刚唱到的那一下（1 → 0，用来做冲击），shown：要不要画。
   */
  MV.kara = {
    state(ch, line, t, lead = 0.4) {
      const shown = t >= line.start - lead;
      const sung = MV.prog(t, ch.start, Math.max(ch.end, ch.start + 0.08));
      const hit = t >= ch.start ? Math.exp(-(t - ch.start) / 0.12) : 0;
      return { shown, sung, hit, on: t >= ch.start };
    },
    /**
     * 横排一行：返回每个字的 { ch, x, y, w }。tracking 是字距（字号的倍数），空格按半个字宽。
     * 中文不要用“居中一行字幕”的排法，默认左对齐到网格。
     */
    layout(ctx, line, { x = 0, y = 0, size = 96, font = 'MVDisplay', weight = 900, tracking = 0.04, align = 'left' } = {}) {
      ctx.font = `${weight} ${size}px ${font}, "Songti SC", "Noto Serif SC", serif`;
      const out = [];
      let cx = 0;
      for (const ch of line.chars) {
        if (ch.c === ' ' || ch.c === '　') { cx += size * 0.5; continue; }
        const w = ctx.measureText(ch.c).width;
        out.push({ ch, x: cx, y, w });
        cx += w + size * tracking;
      }
      const total = cx - size * tracking;
      const dx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
      for (const g of out) g.x += dx;
      return out;
    },
  };

  // ---------------------------------------------------------------- 舞台
  /**
   * 一块全屏 canvas，按 devicePixelRatio 分配像素：HyperFrames 用 --resolution 4k 渲染时 DPR = 2，
   * 画布就真按 3840×2160 画，不是 1080p 放大。场景只管用 1920×1080 的逻辑坐标画。
   *
   * 运动模糊：canvas 里的东西 HyperFrames 的 data-motion-blur 管不到，要自己做——
   * 在快门时间里按几个子时间点各画一遍，取平均。samples=1 是草稿，正式片 8–16。
   */
  MV.Stage = function (canvas, { width = 1920, height = 1080, fps = 30, samples = 1, shutter = 0.5 } = {}) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const out = canvas.getContext('2d');
    const work = document.createElement('canvas');
    work.width = canvas.width; work.height = canvas.height;
    const ctx = work.getContext('2d');
    const self = { width, height, dpr, fps, samples, shutter, scenes: [] };

    /** 场景表：[{ id, start, end, scene: { init?(), draw(ctx, f) } }]，按时间排好。 */
    self.setScenes = (list) => { self.scenes = list; for (const s of list) s.scene.init && s.scene.init(self); };
    self.sceneAt = (t) => self.scenes.find((s) => t >= s.start && t < s.end) || self.scenes[self.scenes.length - 1];

    function drawOnce(target, t) {
      const s = self.sceneAt(t);
      target.setTransform(dpr, 0, 0, dpr, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      s.scene.draw(target, { t, lt: t - s.start, dur: s.end - s.start, p: MV.prog(t, s.start, s.end), id: s.id, W: width, H: height });
    }

    self.render = (t) => {
      const n = Math.max(1, self.samples | 0);
      if (n === 1) { drawOnce(out, t); return; }
      // 快门以帧为中心打开；子帧按 1/(i+1) 叠加，就是逐步平均
      const span = self.shutter / self.fps;
      for (let i = 0; i < n; i++) {
        const ts = t + ((i + 0.5) / n - 0.5) * span;
        drawOnce(ctx, ts);
        out.setTransform(1, 0, 0, 1, 0, 0);
        out.globalCompositeOperation = 'source-over';
        out.globalAlpha = 1 / (i + 1);
        out.drawImage(work, 0, 0);
      }
      out.globalAlpha = 1;
    };
    return self;
  };

  // ---------------------------------------------------------------- 接上 HyperFrames
  /**
   * HyperFrames 每跳到一个时间点发一次 hf-seek，这里按那个时间画一帧。
   * ready 是“字体、预计算都好了”的 promise：登记到 window.__hf.buildReady，HyperFrames 会等它再截帧。
   */
  MV.connect = function (stage, ready, key = 'mv') {
    const hf = (window.__hf = window.__hf || {});
    (hf.buildReady = hf.buildReady || {})[key] = ready;
    ready.then(() => stage.render(0));
    window.addEventListener('hf-seek', (e) => {
      const p = ready.then(() => stage.render(e.detail.time));
      if (e.detail && typeof e.detail.waitUntil === 'function') e.detail.waitUntil(p);
    });
  };

  window.MV = MV;
})();
