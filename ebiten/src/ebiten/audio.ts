/**
 * AudioContext / AudioPlayer — オーディオ合成
 *
 * Ebitenの audio.Context, audio.Player をエミュレートする。
 * 実際の音声再生は行わず、PCMバッファを計算し波形を可視化する。
 * サイン波、矩形波、三角波、鋸歯状波、ノイズの5種類を生成。
 */

import type { AudioPlayerState, AudioState, WaveType } from "./types.js";

/** PCM波形生成: サイン波 */
export function generateSineWave(freq: number, sampleRate: number, numSamples: number): number[] {
  const buf: number[] = [];
  for (let i = 0; i < numSamples; i++) {
    buf.push(Math.sin(2 * Math.PI * freq * i / sampleRate));
  }
  return buf;
}

/** PCM波形生成: 矩形波 */
export function generateSquareWave(freq: number, sampleRate: number, numSamples: number): number[] {
  const buf: number[] = [];
  const period = sampleRate / freq;
  for (let i = 0; i < numSamples; i++) {
    buf.push((i % period) < period / 2 ? 1 : -1);
  }
  return buf;
}

/** PCM波形生成: 三角波 */
export function generateTriangleWave(freq: number, sampleRate: number, numSamples: number): number[] {
  const buf: number[] = [];
  const period = sampleRate / freq;
  for (let i = 0; i < numSamples; i++) {
    const t = (i % period) / period;
    buf.push(t < 0.5 ? 4 * t - 1 : 3 - 4 * t);
  }
  return buf;
}

/** PCM波形生成: 鋸歯状波 */
export function generateSawtoothWave(freq: number, sampleRate: number, numSamples: number): number[] {
  const buf: number[] = [];
  const period = sampleRate / freq;
  for (let i = 0; i < numSamples; i++) {
    const t = (i % period) / period;
    buf.push(2 * t - 1);
  }
  return buf;
}

/** PCM波形生成: ホワイトノイズ */
export function generateNoise(numSamples: number, seed: number = 42): number[] {
  const buf: number[] = [];
  // 簡易PRNG（再現性のためシード付き）
  let s = seed;
  for (let i = 0; i < numSamples; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    buf.push((s / 0x7fffffff) * 2 - 1);
  }
  return buf;
}

/** 波形タイプに応じたPCM生成 */
export function generateWave(type: WaveType, freq: number, sampleRate: number, numSamples: number, position: number = 0): number[] {
  switch (type) {
    case "sine": return generateSineWave(freq, sampleRate, numSamples);
    case "square": return generateSquareWave(freq, sampleRate, numSamples);
    case "triangle": return generateTriangleWave(freq, sampleRate, numSamples);
    case "sawtooth": return generateSawtoothWave(freq, sampleRate, numSamples);
    case "noise": return generateNoise(numSamples, position);
  }
}

/** オーディオプレイヤー */
export class EbitenAudioPlayer {
  readonly id: string;
  waveType: WaveType;
  frequency: number;
  volume: number;
  isPlaying: boolean;
  position: number;

  constructor(id: string, waveType: WaveType, frequency: number) {
    this.id = id;
    this.waveType = waveType;
    this.frequency = frequency;
    this.volume = 1.0;
    this.isPlaying = false;
    this.position = 0;
  }

  play(): void { this.isPlaying = true; }
  pause(): void { this.isPlaying = false; }
  setVolume(v: number): void { this.volume = Math.max(0, Math.min(1, v)); }

  /** 状態スナップショット */
  getState(): AudioPlayerState {
    return {
      id: this.id,
      waveType: this.waveType,
      frequency: this.frequency,
      volume: this.volume,
      isPlaying: this.isPlaying,
      position: this.position,
    };
  }
}

/** オーディオコンテキスト（Ebitenの audio.Context 相当） */
export class EbitenAudioContext {
  readonly sampleRate: number;
  private players = new Map<string, EbitenAudioPlayer>();
  /** 直近のPCMフレーム（可視化用） */
  private lastPcmBuffer: number[] = [];

  constructor(sampleRate: number = 44100) {
    this.sampleRate = sampleRate;
  }

  /** プレイヤーを作成 */
  createPlayer(id: string, waveType: WaveType, frequency: number): EbitenAudioPlayer {
    const player = new EbitenAudioPlayer(id, waveType, frequency);
    this.players.set(id, player);
    return player;
  }

  /** プレイヤーを取得 */
  getPlayer(id: string): EbitenAudioPlayer | undefined {
    return this.players.get(id);
  }

  /** 1フレーム分のPCMバッファを生成（可視化用）。再生中のプレイヤーをミックスする */
  generateFrame(samplesPerFrame: number): number[] {
    const mixed: number[] = new Array(samplesPerFrame).fill(0);
    let activeCount = 0;

    for (const player of this.players.values()) {
      if (!player.isPlaying) continue;
      activeCount++;
      const wave = generateWave(player.waveType, player.frequency, this.sampleRate, samplesPerFrame, player.position);
      for (let i = 0; i < samplesPerFrame; i++) {
        mixed[i]! += (wave[i] ?? 0) * player.volume;
      }
      player.position += samplesPerFrame;
    }

    // クリッピング防止の正規化
    if (activeCount > 1) {
      for (let i = 0; i < samplesPerFrame; i++) {
        mixed[i]! /= activeCount;
      }
    }

    this.lastPcmBuffer = mixed;
    return mixed;
  }

  /** 状態スナップショット */
  getState(): AudioState {
    return {
      sampleRate: this.sampleRate,
      pcmBuffer: [...this.lastPcmBuffer],
      players: [...this.players.values()].map(p => p.getState()),
    };
  }
}
