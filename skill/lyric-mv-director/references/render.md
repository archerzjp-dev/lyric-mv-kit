# 出片

## 一、三档

| 档 | 设置 | 用途 |
|---|---|---|
| 草稿 | `samples: 1`，`--fps 30`，`--quality draft` | 看整片节奏、音画同步，几分钟出 |
| 正式 1080p | `samples: 8–16`，`--fps 60`（或 30） | 发布 |
| 4K | 同正式，加 `--resolution 4k` | 发 YouTube 4K、存档 |

```bash
npx hyperframes check --json
npx hyperframes snapshot --at 12,45,78,120      # 先看几帧
npx hyperframes render --fps 30 --quality draft --output out/draft.mp4
npx hyperframes render --fps 60 --output out/mv-1080p.mp4
npx hyperframes render --fps 60 --resolution 4k --video-bitrate 60M --max-bitrate 66M --output out/mv-4k.mp4
```

采样数在 `index.html` 里 `MV.Stage(..., { samples })` 改。

## 二、真 4K

`--resolution 4k` 让 HyperFrames 按 2 倍的 devicePixelRatio 截图，HTML 和 SVG 会自动按 4K 栅格化，**canvas 不会**：canvas 只有你分配给它的那么多像素。`MV.Stage` 按 `devicePixelRatio` 分配像素（4K 时画布是 3840×2160），场景照样用 1920×1080 的逻辑坐标画。自己写 WebGL 时同理：`renderer.setPixelRatio(window.devicePixelRatio)`。

验证：渲 5 秒（把 `data-duration` 临时改成 5），抽一帧放大到 1:1，看 1 像素的细线和字边是不是锐的。

## 三、码率和体积

- 体积 ≈ 码率 × 时长。4 分钟、目标 3 GB：3 × 8000 / 240 ≈ 100 Mbps，留 10% 余量。
- 颗粒、细密排线、粒子都很吃码率。同样的码率，干净的画面好看得多。
- `--video-bitrate` 是目标，短片段容易超，用 `--max-bitrate` 封顶。
- 上传 YouTube：4K60 推荐 53–68 Mbps 左右，再高也会被重新转码，体积大只是传得慢。

## 四、时间和磁盘

- 渲染时间 ≈ 帧数 × 每帧时间 × 采样数。
- 长片分段渲：`--start/--end` 在很重的 canvas 页面上可能卡在初始化。可靠的办法是做几个入口页，每个入口页的根节点只覆盖一段时长，画的时候加上这段的起点偏移，分别渲完再用 ffmpeg 无损拼接、最后统一混音轨。
- 红色细线、小字边缘发糊：试 `--chroma-subsampling 444`（色度不降采样，体积会大一些）。
- 多个渲染进程（`--workers`）时 HyperFrames 先把每帧存成图片，4 分钟 4K 要几十 GB 临时空间。磁盘紧就用 `--workers 1`。
- 渲之前 `df -h` 看一眼；临时文件在输出文件旁边，输出盘要一直接着（移动硬盘掉线会全部白渲）。
- 超过一小时的渲染，先渲一段 5–10 秒确认，再开整片。

## 五、交付前核对

```bash
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames -show_entries format=duration,size,bit_rate -of default=nw=1 out/mv-4k.mp4
npx hyperframes audio out/mv-4k.mp4 --only loudness --json
```

帧数、时长、分辨率、音轨、响度（和原歌比）都对才交。
