/* HLS シミュレーター エンジン */

import type {
  MediaSegment, Rendition, MasterPlaylist, MediaPlaylist,
  AbrAlgorithm, AbrDecision,
  Player, DownloadedSegment,
  NetworkCondition, NetworkChange,
  SimOp, SimEvent, PlaybackResult, SimulationResult,
} from "./types.js";

// ─── プレイリスト生成 ───

/** マスタープレイリスト文字列生成 */
export function generateMasterPlaylist(master: MasterPlaylist): string {
  let m3u8 = "#EXTM3U\n";
  if (master.independentSegments) {
    m3u8 += "#EXT-X-INDEPENDENT-SEGMENTS\n";
  }
  m3u8 += "\n";

  for (const v of master.variants) {
    m3u8 += `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=${v.resolution.width}x${v.resolution.height},CODECS="${v.codecs}",FRAME-RATE=${v.frameRate.toFixed(3)}\n`;
    m3u8 += `${v.uri}\n`;
  }

  return m3u8;
}

/** メディアプレイリスト文字列生成 */
export function generateMediaPlaylist(playlist: MediaPlaylist): string {
  let m3u8 = "#EXTM3U\n";
  m3u8 += `#EXT-X-VERSION:${playlist.version}\n`;
  m3u8 += `#EXT-X-TARGETDURATION:${playlist.targetDuration}\n`;
  m3u8 += `#EXT-X-MEDIA-SEQUENCE:${playlist.mediaSequence}\n`;

  if (playlist.type === "VOD" || playlist.type === "EVENT") {
    m3u8 += `#EXT-X-PLAYLIST-TYPE:${playlist.type}\n`;
  }

  if (playlist.encryption && playlist.encryption.method !== "NONE") {
    m3u8 += `#EXT-X-KEY:METHOD=${playlist.encryption.method},URI="${playlist.encryption.uri}"`;
    if (playlist.encryption.iv) {
      m3u8 += `,IV=${playlist.encryption.iv}`;
    }
    m3u8 += "\n";
  }

  m3u8 += "\n";

  for (const seg of playlist.segments) {
    if (seg.discontinuity) {
      m3u8 += "#EXT-X-DISCONTINUITY\n";
    }
    if (seg.programDateTime !== undefined) {
      m3u8 += `#EXT-X-PROGRAM-DATE-TIME:${new Date(seg.programDateTime).toISOString()}\n`;
    }
    m3u8 += `#EXTINF:${seg.duration.toFixed(6)},\n`;
    m3u8 += `${seg.uri}\n`;
  }

  if (playlist.endList) {
    m3u8 += "#EXT-X-ENDLIST\n";
  }

  return m3u8;
}

// ─── メディア生成ヘルパー ───

/** セグメント生成 */
export function mkSegments(
  count: number,
  duration: number,
  bitrate: number,
  prefix: string,
  opts?: { encrypted?: boolean },
): MediaSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: i,
    duration,
    uri: `${prefix}_${i.toString().padStart(3, "0")}.ts`,
    sizeBytes: Math.floor((bitrate * duration) / 8),
    bitrate,
    isIdr: true,
    encrypted: opts?.encrypted ?? false,
    discontinuity: false,
  }));
}

/** レンディション生成 */
export function mkRendition(
  bandwidth: number,
  width: number,
  height: number,
  segments: MediaSegment[],
  opts?: { codec?: string; fps?: number; targetDuration?: number },
): Rendition {
  return {
    bandwidth,
    resolution: { width, height },
    codecs: opts?.codec ?? "avc1.4d401f,mp4a.40.2",
    frameRate: opts?.fps ?? 30,
    uri: `playlist_${bandwidth}.m3u8`,
    segments,
    targetDuration: opts?.targetDuration ?? (segments[0]?.duration ?? 6),
  };
}

/** マスタープレイリスト生成ヘルパー */
export function mkMaster(variants: Rendition[]): MasterPlaylist {
  return { variants, independentSegments: true };
}

/** ネットワーク条件ヘルパー */
export function mkNetwork(bandwidth = 5_000_000, latency = 50, jitter = 10, lossRate = 0): NetworkCondition {
  return { bandwidth, latency, jitter, lossRate };
}

// ─── プレイヤー ───

/** プレイヤー初期化 */
function createPlayer(abr: AbrAlgorithm): Player {
  return {
    state: "idle",
    buffer: { buffered: 0, currentTime: 0, totalDuration: 0, health: 0 },
    currentRendition: 0,
    abrAlgorithm: abr,
    abrHistory: [],
    downloadedSegments: [],
    qualitySwitches: 0,
    rebufferCount: 0,
    rebufferDuration: 0,
  };
}

// ─── ABR アルゴリズム ───

/** 帯域幅ベースABR */
function abrBandwidth(
  variants: Rendition[],
  estimatedBw: number,
  _bufferLevel: number,
): AbrDecision {
  // 推定帯域幅の70%以下のバリアントを選択
  const safeMargin = 0.7;
  let selected = 0;
  for (let i = variants.length - 1; i >= 0; i--) {
    if (variants[i].bandwidth <= estimatedBw * safeMargin) {
      selected = i;
      break;
    }
  }

  return {
    selectedIdx: selected,
    estimatedBandwidth: estimatedBw,
    bufferLevel: _bufferLevel,
    reason: `帯域幅 ${(estimatedBw / 1_000_000).toFixed(1)}Mbps → ${variants[selected].resolution.width}x${variants[selected].resolution.height}`,
  };
}

/** バッファベースABR (BBA) */
function abrBuffer(
  variants: Rendition[],
  estimatedBw: number,
  bufferLevel: number,
): AbrDecision {
  // バッファレベルに基づいて品質選択
  const reservoir = 5;   // 最低品質を維持するバッファ量(秒)
  const cushion = 20;    // 最高品質に到達するバッファ量(秒)

  let selected: number;
  if (bufferLevel <= reservoir) {
    selected = 0; // 最低品質
  } else if (bufferLevel >= cushion) {
    selected = variants.length - 1; // 最高品質
  } else {
    // 線形補間
    const ratio = (bufferLevel - reservoir) / (cushion - reservoir);
    selected = Math.min(Math.floor(ratio * variants.length), variants.length - 1);
  }

  return {
    selectedIdx: selected,
    estimatedBandwidth: estimatedBw,
    bufferLevel,
    reason: `バッファ ${bufferLevel.toFixed(1)}s → ${variants[selected].resolution.width}x${variants[selected].resolution.height}`,
  };
}

/** ハイブリッドABR */
function abrHybrid(
  variants: Rendition[],
  estimatedBw: number,
  bufferLevel: number,
): AbrDecision {
  const bwDecision = abrBandwidth(variants, estimatedBw, bufferLevel);
  const bufDecision = abrBuffer(variants, estimatedBw, bufferLevel);

  // 両方の最小値を取る（保守的）
  const selected = Math.min(bwDecision.selectedIdx, bufDecision.selectedIdx);

  // バッファが十分ならBW基準、不足ならバッファ基準
  let reason: string;
  if (bufferLevel < 8) {
    reason = `ハイブリッド(バッファ優先): buf=${bufferLevel.toFixed(1)}s`;
  } else {
    reason = `ハイブリッド(帯域幅優先): bw=${(estimatedBw / 1_000_000).toFixed(1)}Mbps`;
  }

  return {
    selectedIdx: selected,
    estimatedBandwidth: estimatedBw,
    bufferLevel,
    reason: `${reason} → ${variants[selected].resolution.width}x${variants[selected].resolution.height}`,
  };
}

/** ABR判定実行 */
function runAbr(
  algorithm: AbrAlgorithm,
  variants: Rendition[],
  estimatedBw: number,
  bufferLevel: number,
): AbrDecision {
  switch (algorithm) {
    case "bandwidth": return abrBandwidth(variants, estimatedBw, bufferLevel);
    case "buffer": return abrBuffer(variants, estimatedBw, bufferLevel);
    case "hybrid": return abrHybrid(variants, estimatedBw, bufferLevel);
  }
}

// ─── ネットワークシミュレーション ───

/** セグメントダウンロード時間計算 */
function calcDownloadTime(segment: MediaSegment, net: NetworkCondition): {
  downloadTime: number;
  throughput: number;
  lost: boolean;
} {
  if (Math.random() < net.lossRate) {
    return { downloadTime: net.latency * 3, throughput: 0, lost: true };
  }

  const jitter = (Math.random() - 0.5) * 2 * net.jitter;
  const latency = Math.max(0, net.latency + jitter);
  // ダウンロード時間 = レイテンシ + サイズ / 帯域幅
  const transferTime = (segment.sizeBytes * 8 * 1000) / net.bandwidth;
  const downloadTime = latency + transferTime;
  const throughput = (segment.sizeBytes * 8 * 1000) / downloadTime;

  return { downloadTime, throughput, lost: false };
}

/** ネットワーク条件を時刻で更新 */
function getCurrentNetwork(
  baseNet: NetworkCondition,
  changes: NetworkChange[],
  currentTime: number,
): NetworkCondition {
  let net = baseNet;
  for (const change of changes) {
    if (currentTime >= change.atTime) {
      net = change.condition;
    }
  }
  return net;
}

// ─── EWMA帯域幅推定 ───

/** EWMA帯域幅推定 */
function estimateBandwidth(history: DownloadedSegment[]): number {
  if (history.length === 0) return 5_000_000; // デフォルト5Mbps

  const alpha = 0.3; // 重み（新しいサンプルの影響度）
  let estimate = history[0].throughput;

  for (let i = 1; i < history.length; i++) {
    estimate = alpha * history[i].throughput + (1 - alpha) * estimate;
  }

  return estimate;
}

// ─── 再生シミュレーション ───

/** VOD再生シミュレーション */
function simulatePlayback(
  master: MasterPlaylist,
  abr: AbrAlgorithm,
  network: NetworkCondition,
  networkChanges: NetworkChange[],
  isLive: boolean,
  liveWindowSize: number,
): PlaybackResult {
  const events: SimEvent[] = [];
  const player = createPlayer(abr);

  // バリアントをビットレート順にソート
  const variants = [...master.variants].sort((a, b) => a.bandwidth - b.bandwidth);

  // マスタープレイリスト取得
  const masterStr = generateMasterPlaylist(master);
  events.push({ time: 0, type: "playlist_load", message: "マスタープレイリスト取得", detail: `${variants.length}バリアント` });

  player.state = "loading";
  events.push({ time: 0, type: "state_change", message: "状態: loading" });

  // 初期レンディション（最低品質）
  player.currentRendition = 0;
  const firstRendition = variants[0];
  const segments = firstRendition.segments;

  // 総再生時間
  const totalDuration = segments.reduce((s, seg) => s + seg.duration, 0);
  player.buffer.totalDuration = totalDuration;

  // メディアプレイリスト
  const mediaPlaylist: MediaPlaylist = {
    targetDuration: firstRendition.targetDuration,
    mediaSequence: 0,
    segments: firstRendition.segments,
    type: isLive ? "LIVE" : "VOD",
    endList: !isLive,
    version: 3,
    encryption: segments.some(s => s.encrypted) ? {
      method: "AES-128",
      uri: "https://key.example.com/key",
    } : undefined,
  };
  const mediaStr = generateMediaPlaylist(mediaPlaylist);

  events.push({
    time: 0,
    type: "playlist_load",
    message: `メディアプレイリスト取得 (${isLive ? "LIVE" : "VOD"})`,
    detail: `${segments.length}セグメント, ${totalDuration.toFixed(1)}秒`,
  });

  if (mediaPlaylist.encryption) {
    events.push({ time: 0, type: "encryption", message: `暗号化: ${mediaPlaylist.encryption.method}` });
  }

  // セグメントダウンロード・再生ループ
  let time = 0;
  let segIdx = 0;
  const maxSegments = isLive ? Math.min(segments.length, liveWindowSize * 2) : segments.length;
  // 帯域幅推定の安全マージン
  let playStarted = false;
  const bufferGoal = 10; // バッファ目標(秒)

  while (segIdx < maxSegments) {
    const net = getCurrentNetwork(network, networkChanges, time);

    // ネットワーク変化検出
    for (const change of networkChanges) {
      if (Math.abs(change.atTime - time) < 100) {
        events.push({
          time,
          type: "network_change",
          message: `ネットワーク変化: ${(change.condition.bandwidth / 1_000_000).toFixed(1)}Mbps`,
          detail: `latency=${change.condition.latency}ms, loss=${(change.condition.lossRate * 100).toFixed(0)}%`,
        });
      }
    }

    // ABR判定
    const estimatedBw = estimateBandwidth(player.downloadedSegments);
    const abrDecision = runAbr(abr, variants, estimatedBw, player.buffer.health);
    player.abrHistory.push(abrDecision);

    // 品質切替検出
    if (abrDecision.selectedIdx !== player.currentRendition) {
      const prevIdx = player.currentRendition;
      const prevRes = variants[prevIdx].resolution;
      const newRes = variants[abrDecision.selectedIdx].resolution;
      const direction = abrDecision.selectedIdx > prevIdx ? "quality_up" : "quality_down";

      events.push({
        time,
        type: direction,
        message: `品質変更: ${prevRes.width}x${prevRes.height} → ${newRes.width}x${newRes.height}`,
        detail: abrDecision.reason,
      });
      events.push({
        time,
        type: "abr_switch",
        message: `ABR(${abr}): ${abrDecision.reason}`,
      });

      player.currentRendition = abrDecision.selectedIdx;
      player.qualitySwitches++;
    }

    // 選択レンディションのセグメント取得
    const rendition = variants[player.currentRendition];
    const seg = rendition.segments[segIdx % rendition.segments.length];
    if (!seg) break;

    // ダウンロード
    const dl = calcDownloadTime(seg, net);

    if (dl.lost) {
      events.push({ time, type: "error", message: `セグメント${segIdx}ダウンロード失敗 (パケットロス)` });
      // リトライ
      const retry = calcDownloadTime(seg, net);
      if (retry.lost) {
        events.push({ time, type: "error", message: `リトライ失敗 - スキップ` });
        segIdx++;
        continue;
      }
      time += retry.downloadTime;
      player.downloadedSegments.push({
        segment: seg,
        renditionIdx: player.currentRendition,
        downloadTime: retry.downloadTime,
        throughput: retry.throughput,
        startTime: time - retry.downloadTime,
      });
    } else {
      time += dl.downloadTime;
      player.downloadedSegments.push({
        segment: seg,
        renditionIdx: player.currentRendition,
        downloadTime: dl.downloadTime,
        throughput: dl.throughput,
        startTime: time - dl.downloadTime,
      });
    }

    events.push({
      time,
      type: "segment_download",
      message: `セグメント${segIdx} DL完了`,
      detail: `${(seg.sizeBytes / 1024).toFixed(0)}KB, ${dl.downloadTime.toFixed(0)}ms, ${(dl.throughput / 1_000_000).toFixed(1)}Mbps`,
    });

    if (seg.encrypted) {
      events.push({ time, type: "encryption", message: `セグメント${segIdx} 復号` });
    }

    // バッファ追加
    player.buffer.buffered += seg.duration;
    player.buffer.health = player.buffer.buffered - player.buffer.currentTime;

    events.push({
      time,
      type: "segment_append",
      message: `セグメント${segIdx} バッファ追加`,
      detail: `buffer=${player.buffer.health.toFixed(1)}s`,
    });

    events.push({
      time,
      type: "buffer_update",
      message: `バッファ: ${player.buffer.health.toFixed(1)}s`,
      detail: `buffered=${player.buffer.buffered.toFixed(1)}s, pos=${player.buffer.currentTime.toFixed(1)}s`,
    });

    // 再生開始判定
    if (!playStarted && player.buffer.health >= Math.min(bufferGoal, seg.duration * 2)) {
      playStarted = true;
      player.state = "playing";
      events.push({ time, type: "state_change", message: "状態: playing" });
    }

    // 再生進行シミュレーション（ダウンロード時間分再生が進む）
    if (playStarted) {
      const playProgress = dl.downloadTime / 1000; // ms → 秒
      player.buffer.currentTime += playProgress;
      player.buffer.health = player.buffer.buffered - player.buffer.currentTime;

      // リバッファ検出
      if (player.buffer.health <= 0) {
        player.state = "buffering";
        player.rebufferCount++;
        const rebufferTime = Math.abs(player.buffer.health) * 1000;
        player.rebufferDuration += rebufferTime;

        events.push({
          time,
          type: "rebuffer",
          message: `リバッファリング発生 (#${player.rebufferCount})`,
          detail: `${rebufferTime.toFixed(0)}ms待機`,
        });
        events.push({ time, type: "state_change", message: "状態: buffering → playing" });

        player.buffer.health = 0;
        player.buffer.currentTime = player.buffer.buffered;
        player.state = "playing";
      }
    }

    segIdx++;
  }

  // 再生完了
  if (!isLive) {
    player.state = "ended";
    events.push({ time, type: "state_change", message: "状態: ended" });
  }

  events.push({
    time,
    type: "info",
    message: `再生完了: ${player.qualitySwitches}回品質切替, ${player.rebufferCount}回リバッファ`,
    detail: `リバッファ合計: ${player.rebufferDuration.toFixed(0)}ms`,
  });

  return { player, masterPlaylistStr: masterStr, mediaPlaylistStr: mediaStr, events };
}

// ─── メインシミュレーション ───

/** シミュレーション実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const allEvents: SimEvent[] = [];
  const results: PlaybackResult[] = [];

  for (const op of ops) {
    switch (op.type) {
      case "vod": {
        const r = simulatePlayback(op.master, op.abr, op.network, op.networkChanges ?? [], false, 0);
        results.push(r);
        allEvents.push(...r.events);
        break;
      }
      case "live": {
        const r = simulatePlayback(op.master, op.abr, op.network, op.networkChanges ?? [], true, op.windowSize);
        results.push(r);
        allEvents.push(...r.events);
        break;
      }
      case "abr_compare": {
        for (const algo of op.algorithms) {
          const r = simulatePlayback(op.master, algo, op.network, op.networkChanges ?? [], false, 0);
          results.push(r);
          allEvents.push(...r.events);
        }
        break;
      }
    }
  }

  return { results, events: allEvents };
}
