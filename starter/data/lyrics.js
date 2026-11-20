// 示范歌词（不是任何真实的歌）。格式和 tools/tap.html 导出的一样：每个字有自己的 start / end（秒）。
// 这份是按 120 BPM 每拍一个字手写的；换歌后用 tap.html 重做，或用强制对齐的结果覆盖。
(function () {
  const beat = 0.5;
  const mk = (text, start, perChar = beat) => {
    const chars = [];
    let t = start;
    for (const c of text) {
      if (c === ' ') { chars.push({ c, start: t, end: t }); continue; }
      chars.push({ c, start: +t.toFixed(3), end: +(t + perChar * 0.9).toFixed(3) });
      t += perChar;
    }
    return { text, start, end: +(t).toFixed(3), chars };
  };
  window.LYRICS = {
    lines: [
      mk('一条线在黑里醒来', 2.0),
      mk('它记得每一次心跳', 6.0),
      mk('越过它 就是明天', 10.0),
    ],
  };
})();
