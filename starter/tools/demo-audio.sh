#!/bin/bash
# 生成一段 16 秒、120 BPM 的示范音频（底鼓每拍、军鼓在 2、4 拍、一个长和弦），只用来跑通起步工程。
# 换成你自己的歌时直接把 WAV 放到 assets/song.wav。
set -e
cd "$(dirname "$0")/.."
ffmpeg -loglevel error -y -f lavfi -i "aevalsrc='0.7*sin(2*PI*(48+90*exp(-28*mod(t,0.5)))*t)*exp(-9*mod(t,0.5))+0.3*(2*random(0)-1)*exp(-22*mod(t-0.5,1))*gte(mod(t,1),0.5)+0.05*sin(2*PI*196*t)+0.04*sin(2*PI*247*t)+0.035*sin(2*PI*294*t)|0.7*sin(2*PI*(48+90*exp(-28*mod(t,0.5)))*t)*exp(-9*mod(t,0.5))+0.3*(2*random(1)-1)*exp(-22*mod(t-0.5,1))*gte(mod(t,1),0.5)+0.05*sin(2*PI*196*t)+0.04*sin(2*PI*247*t)+0.035*sin(2*PI*294*t)':s=44100:d=16" -c:a pcm_s16le assets/song.wav
echo "写出 assets/song.wav"
