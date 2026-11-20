// scenes.js —— 示范的三个场景和场景表。每个场景是 { init?(stage), draw(ctx, f) }。
// draw 必须把整幅画面画满（先铺底色），并且只依赖 f.t：同一个 t 永远同一帧。
//
// 三个场景各示范一种“歌词做进画面”的办法：
//   thread：字坐在一根会随底鼓震动的弦上；巨字在小节线上砸下来
//   press ：重板一拍一块压下来，唱到的字被压扁
//   grid  ：灰格子一圈圈逼近唯一的红格，唱一个字逼近一圈
(function () {
  const { ease, prog, clamp, lerp, noise } = MV;
  const music = MV.Music(window.MUSIC);
  const lyrics = MV.Lyrics(window.LYRICS);

  // 色板（换成你这支片自己的）：一个底、一个字色、一个灰、只许一个强调色
  const C = { ground: '#101114', paper: '#E6E4DE', ink: '#151618', grey: '#5F6166', red: '#D3261C' };
  const FONT = 'MVDisplay';
  const M = 96; // 安全边距：字和主体不进四边 96 像素

  // 画一个字，可以缩放、压扁；(x, y) 是字的左下（基线）
  function glyph(ctx, c, x, y, size, color, { sx = 1, sy = 1, alpha = 1 } = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = `900 ${size}px ${FONT}, "Songti SC", "Noto Serif SC", serif`;
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    ctx.fillText(c, 0, 0);
    ctx.restore();
  }

  // ---------------------------------------------------------------- thread
  const thread = {
    draw(ctx, f) {
      const { t, W, H } = f;
      ctx.fillStyle = C.ground;
      ctx.fillRect(0, 0, W, H);

      // 线一拍一段地画出来（每拍 outExpo：猛地一下，停住）
      const y0 = 660, x0 = M, x1 = W - M;
      const b = music.beatAt(t);
      const steps = 4; // 第 1 到第 4 拍画完
      const k = clamp(b - 1, 0, steps);
      const reach = (Math.floor(k) + ease.outExpo(k - Math.floor(k))) / steps;
      const xEnd = lerp(x0, x1, clamp(reach));

      // 弦：每个底鼓起一次驻波，响度越大振幅越大
      const amp = 22 * music.pulse(t, 'kicks', 0.22) * (0.5 + music.energy(t));
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let x = x0; x <= xEnd; x += 6) {
        const u = (x - x0) / (x1 - x0);
        const y = y0 + amp * Math.sin(Math.PI * u * 3) * Math.sin(Math.PI * u);
        x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      // 笔头：一个亮点
      ctx.fillStyle = C.paper;
      ctx.beginPath();
      ctx.arc(xEnd, y0, 6 + 4 * music.pulse(t, 'beats', 0.12), 0, Math.PI * 2);
      ctx.fill();

      // 巨字：歌词里的原字，在小节线上砸下来（落点用 0 ms 的硬切，不缓动）
      const line = lyrics.get('一条线');
      const slamAt = music.timeOfBar(Math.round(music.barAt(line.chars[2].start)));
      if (t >= slamAt) {
        const s = ease.outExpo(prog(t, slamAt, slamAt + 0.35));
        glyph(ctx, '线', 1080, 960, lerp(760, 620, s), C.grey, { alpha: 0.32 });
      }

      // 歌词坐在弦上：没唱到的 30% 亮，唱到的全亮，正在唱的那个字有一下冲击
      const gl = MV.kara.layout(ctx, line, { x: M, y: y0 - 40, size: 112 });
      for (const g of gl) {
        const st = MV.kara.state(g.ch, line, t);
        if (!st.shown) continue;
        const u = (g.x - x0) / (x1 - x0);
        const ride = amp * Math.sin(Math.PI * u * 3) * Math.sin(Math.PI * u);
        const pop = 1 + 0.18 * st.hit;
        glyph(ctx, g.ch.c, g.x, g.y + ride - 26 * st.hit, 112 * pop, st.on ? C.paper : C.paper, { alpha: st.on ? 1 : 0.3 });
      }
    },
  };

  // ---------------------------------------------------------------- press
  const press = {
    draw(ctx, f) {
      const { t, W, H } = f;
      // 小节线上硬切到纸白底：反差本身就是一次冲击
      const shake = 5 * music.pulse(t, 'kicks', 0.12);
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(noise(t * 40, 1) * shake, noise(t * 40, 2) * shake);

      const line = lyrics.get('心跳');
      const gl = MV.kara.layout(ctx, line, { x: M, y: 700, size: 168, tracking: 0.02 });
      for (const g of gl) {
        const st = MV.kara.state(g.ch, line, t);
        if (!st.shown) continue;
        // 被压扁：纵向弹簧到 35%，横向摊开到 125%
        const k = st.on ? ease.spring(clamp((t - g.ch.start) / 0.5), 16, 7) : 0;
        const sy = lerp(1, 0.35, k), sx = lerp(1, 1.25, k);
        glyph(ctx, g.ch.c, g.x - (g.w * (sx - 1)) / 2, g.y, 168, C.ink, { sx, sy, alpha: st.on ? 1 : 0.28 });
      }

      // 重板：每拍从上面砸下来一块，落地用 inExpo（越落越快），落地那一刻停住
      const b = music.beatAt(t);
      const i = Math.floor(b), fr = b - i;
      const slabH = 360;
      const land = 700 - 168 * 0.35 - 8; // 正好压在扁字的顶上
      const yb = lerp(-slabH, land, ease.inExpo(clamp(fr / 0.45)));
      ctx.fillStyle = C.ink;
      ctx.fillRect(M, yb - slabH, W - 2 * M, slabH);
      ctx.restore();

      // 唯一的红：正在被压的那个字下面一道短线
      const cur = gl.find((g) => t >= g.ch.start && t < g.ch.end);
      if (cur) {
        ctx.fillStyle = C.red;
        ctx.fillRect(cur.x, 730, cur.w, 8);
      }
    },
  };

  // ---------------------------------------------------------------- grid
  const grid = {
    init() {
      this.cols = 16; this.rows = 6;
      this.cell = Math.floor((1920 - 2 * M) / this.cols);
      this.red = { c: 11, r: 2 };
    },
    draw(ctx, f) {
      const { t, W, H } = f;
      ctx.fillStyle = C.ground;
      ctx.fillRect(0, 0, W, H);
      const line = lyrics.get('越过它');
      const sungCount = line.chars.filter((c) => c.c.trim() && t >= c.start).length;
      const total = line.chars.filter((c) => c.c.trim()).length;
      // 灰从外圈往里逼：唱一个字逼近一圈，用弹簧落到位
      const maxR = 11;
      const last = line.chars.filter((c) => c.c.trim() && t >= c.start).pop();
      const k = last ? ease.spring(clamp((t - last.start) / 0.4), 14, 6) : 1;
      const R = maxR - (sungCount - 1 + k) * ((maxR - 1) / total);
      const gap = 6, s = this.cell;
      const gh = this.rows * s, top = M;
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) {
          const d = Math.max(Math.abs(c - this.red.c), Math.abs(r - this.red.r));
          const x = M + c * s, y = top + r * s;
          if (c === this.red.c && r === this.red.r) {
            ctx.fillStyle = C.red;
          } else if (d >= R) {
            ctx.fillStyle = C.grey;
          } else continue;
          ctx.fillRect(x + gap / 2, y + gap / 2, s - gap, s - gap);
        }

      // 歌词压在格子下面，左对齐，基线留在下边距以内
      const gl = MV.kara.layout(ctx, line, { x: M, y: top + gh + 190, size: 150 });
      for (const g of gl) {
        const st = MV.kara.state(g.ch, line, t);
        if (!st.shown) continue;
        glyph(ctx, g.ch.c, g.x, g.y - 30 * st.hit, 150, C.paper, { alpha: st.on ? 1 : 0.3 });
      }
      // 结尾半秒压暗：全片收在黑上
      const fade = prog(t, 15.4, 15.95);
      if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, W, H); }
    },
  };

  // ---------------------------------------------------------------- 场景表
  // 切点不写死秒数：用歌词和小节线算。改了对齐数据，切点自动跟着走。
  const cutBefore = (q) => music.timeOfBar(Math.floor(music.barAt(lyrics.get(q).start + 0.02)));
  const T1 = cutBefore('心跳'), T2 = cutBefore('越过它');
  window.SCENES = [
    { id: 'thread', start: 0, end: T1, scene: thread },
    { id: 'press', start: T1, end: T2, scene: press },
    { id: 'grid', start: T2, end: window.MUSIC.duration, scene: grid },
  ];
})();
