#!/bin/bash
# 把创作技能装进 Claude Code（~/.claude/skills/lyric-mv-director/），连同起步工程一起装：
# 以后在任何文件夹里对 Claude 说“给这首歌做个 MV”，它都能找到起步工程和工具。
# 再跑一次就是更新。只动这一个技能文件夹，不碰别的。
set -e
here="$(cd "$(dirname "$0")" && pwd)"
dest="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/lyric-mv-director"

mkdir -p "$dest"
rm -rf "$dest/references" "$dest/templates" "$dest/assets/starter"
cp -R "$here/skill/lyric-mv-director/." "$dest/"
mkdir -p "$dest/assets"
# 起步工程：不带示范音频、字体和渲染产物
rsync -a --exclude 'assets/song.wav' --exclude 'assets/fonts/*.ttf' --exclude 'assets/fonts/*.otf' \
  --exclude 'out' --exclude 'renders' --exclude '.hyperframes' --exclude '.DS_Store' \
  "$here/starter/" "$dest/assets/starter/"

echo "装好了：$dest"
echo "在 Claude Code 里说“给这首歌做个 MV”，把歌（WAV）和歌词给它就行。"
