/**
 * isdb.ts — ISDB-T 地上デジタル放送シミュレーション
 *
 * UHF チャンネル選局 → OFDM 復調 → TS パケット分離 →
 * 映像/音声/データの取り出しまでをシミュレートする。
 */

// ── 変調方式 ──
export type Modulation = "DQPSK" | "QPSK" | "16QAM" | "64QAM";

// ── FFT モード ──
export type FftMode = "2K" | "4K" | "8K";

// ── ガードインターバル ──
export type GuardInterval = "1/4" | "1/8" | "1/16" | "1/32";

// ── ISDB-T レイヤー (A: ワンセグ, B: フルセグ映像, C: フルセグ追加) ──
export interface IsdbLayer {
  id: "A" | "B" | "C";
  segments: number;
  modulation: Modulation;
  codeRate: string;
  /** セグメント内のキャリア数 */
  carriers: number;
  /** ビットレート (Mbps) */
  bitrate: number;
  description: string;
}

// ── チャンネル定義 ──
export interface Channel {
  /** 物理チャンネル番号 */
  physCh: number;
  /** リモコンキー ID */
  remoteId: number;
  /** 放送局名 */
  name: string;
  /** 中心周波数 (MHz) */
  frequency: number;
  /** 帯域幅 (MHz) */
  bandwidth: number;
  /** レイヤー構成 */
  layers: IsdbLayer[];
  /** FFT モード */
  fftMode: FftMode;
  /** ガードインターバル */
  guardInterval: GuardInterval;
  /** C/N 比 (dB) — 受信品質 */
  cnRatio: number;
  /** BER (ビット誤り率) */
  ber: number;
  /** 番組情報 */
  programs: ProgramInfo[];
}

// ── 番組情報 (EPG) ──
export interface ProgramInfo {
  serviceId: number;
  name: string;
  genre: string;
  startTime: string;
  duration: string;
  description: string;
}

// ── TS パケット ──
export interface TsPacket {
  syncByte: number;
  pid: number;
  pidName: string;
  payload: string;
  scrambled: boolean;
  continuityCounter: number;
}

// ── OFDM セグメント ──
export interface OfdmSegment {
  index: number;
  layer: "A" | "B" | "C";
  modulation: Modulation;
  carriers: number;
  power: number;
}

// ── 受信トレース ──
export interface ReceptionStep {
  phase: "tune" | "agc" | "fft" | "demod" | "fec" | "ts_sync" | "demux" | "decode" | "output";
  detail: string;
  data?: string;
}

// ── 受信結果 ──
export interface ReceptionResult {
  channel: Channel;
  segments: OfdmSegment[];
  tsPackets: TsPacket[];
  steps: ReceptionStep[];
  signalLevel: number;
  locked: boolean;
}

/** UHF チャンネル番号 → 中心周波数 (MHz) */
export function uhfFrequency(ch: number): number {
  return 473 + (ch - 13) * 6 + 3;
}

/** 関東地方の放送局チャンネル定義 */
export function createTokyoChannels(): Channel[] {
  const layerA = (mod: Modulation = "QPSK"): IsdbLayer => ({
    id: "A", segments: 1, modulation: mod, codeRate: "2/3",
    carriers: 108, bitrate: 0.416, description: "ワンセグ (携帯向け 320x240)",
  });
  const layerB = (seg: number, mod: Modulation = "64QAM"): IsdbLayer => ({
    id: "B", segments: seg, modulation: mod, codeRate: "3/4",
    carriers: 108 * seg, bitrate: seg * 1.79, description: `フルセグ映像 (1440x1080 / ${seg}セグメント)`,
  });

  const mkCh = (
    physCh: number, remoteId: number, name: string,
    progs: ProgramInfo[], cn = 28, ber = 1e-8,
  ): Channel => ({
    physCh, remoteId, name,
    frequency: uhfFrequency(physCh),
    bandwidth: 6,
    layers: [layerA(), layerB(12)],
    fftMode: "8K",
    guardInterval: "1/8",
    cnRatio: cn,
    ber,
    programs: progs,
  });

  return [
    mkCh(27, 1, "NHK総合", [
      { serviceId: 0x0400, name: "NHKニュース7", genre: "ニュース", startTime: "19:00", duration: "30分", description: "全国のニュースをお届けします" },
      { serviceId: 0x0400, name: "大河ドラマ", genre: "ドラマ", startTime: "20:00", duration: "45分", description: "歴史ドラマ" },
    ]),
    mkCh(26, 2, "NHK Eテレ", [
      { serviceId: 0x0408, name: "サイエンスZERO", genre: "教養", startTime: "23:30", duration: "30分", description: "科学の最前線" },
    ]),
    mkCh(25, 4, "日本テレビ", [
      { serviceId: 0x0410, name: "世界まる見え!", genre: "バラエティ", startTime: "20:00", duration: "54分", description: "世界の驚き映像" },
    ]),
    mkCh(24, 5, "テレビ朝日", [
      { serviceId: 0x0418, name: "報道ステーション", genre: "ニュース", startTime: "21:54", duration: "76分", description: "夜のニュース" },
    ]),
    mkCh(22, 6, "TBSテレビ", [
      { serviceId: 0x0420, name: "日曜劇場", genre: "ドラマ", startTime: "21:00", duration: "54分", description: "日曜夜のドラマ" },
    ]),
    mkCh(23, 7, "テレビ東京", [
      { serviceId: 0x0428, name: "WBS", genre: "ニュース", startTime: "23:00", duration: "58分", description: "ワールドビジネスサテライト" },
    ]),
    mkCh(21, 8, "フジテレビ", [
      { serviceId: 0x0430, name: "めざましテレビ", genre: "情報", startTime: "05:25", duration: "155分", description: "朝の情報番組" },
    ]),
  ];
}

/** 受信をシミュレートする */
export function simulateReception(channel: Channel, noiseLevel: number): ReceptionResult {
  const steps: ReceptionStep[] = [];

  // 1. チューニング
  steps.push({
    phase: "tune",
    detail: `UHF ${channel.physCh}ch (${channel.frequency} MHz) にチューニング`,
    data: `帯域幅: ${channel.bandwidth} MHz, 中心周波数: ${channel.frequency} MHz`,
  });

  // 2. AGC (自動利得制御)
  const signalLevel = Math.max(0, channel.cnRatio - noiseLevel + Math.random() * 3);
  const locked = signalLevel > 15;
  steps.push({
    phase: "agc",
    detail: `AGC 調整: 信号レベル ${signalLevel.toFixed(1)} dB`,
    data: `C/N比: ${(channel.cnRatio - noiseLevel).toFixed(1)} dB${locked ? " (ロック)" : " (ロスト)"}`,
  });

  if (!locked) {
    steps.push({
      phase: "agc",
      detail: "受信失敗: 信号レベルが低すぎます",
    });
    return { channel, segments: [], tsPackets: [], steps, signalLevel, locked };
  }

  // 3. FFT (高速フーリエ変換)
  const fftSize = channel.fftMode === "2K" ? 2048 : channel.fftMode === "4K" ? 4096 : 8192;
  steps.push({
    phase: "fft",
    detail: `${channel.fftMode} FFT 実行 (${fftSize} ポイント)`,
    data: `ガードインターバル: ${channel.guardInterval}, 有効シンボル: ${fftSize} サンプル`,
  });

  // 4. OFDM セグメント分離
  const segments: OfdmSegment[] = [];
  for (const layer of channel.layers) {
    for (let i = 0; i < layer.segments; i++) {
      segments.push({
        index: segments.length,
        layer: layer.id,
        modulation: layer.modulation,
        carriers: layer.carriers / layer.segments,
        power: signalLevel - Math.random() * 2,
      });
    }
  }

  steps.push({
    phase: "demod",
    detail: `OFDM 復調: 13 セグメント (${channel.layers.map((l) => `${l.id}:${l.segments}seg/${l.modulation}`).join(", ")})`,
    data: `総キャリア数: ${segments.reduce((s, seg) => s + seg.carriers, 0)}`,
  });

  // 5. FEC (誤り訂正)
  const effectiveBer = channel.ber * (1 + noiseLevel * 0.1);
  steps.push({
    phase: "fec",
    detail: `ビタビ復号 + リードソロモン符号で誤り訂正`,
    data: `BER: ${effectiveBer.toExponential(1)}, 符号化率: ${channel.layers[0]?.codeRate ?? "3/4"}`,
  });

  // 6. TS 同期
  steps.push({
    phase: "ts_sync",
    detail: "TS パケット同期バイト (0x47) を検出",
    data: "パケットサイズ: 188 バイト (204 バイト RS 符号付き)",
  });

  // 7. TS パケット分離 (DEMUX)
  const tsPackets = generateTsPackets(channel);
  steps.push({
    phase: "demux",
    detail: `TS デマルチプレクサ: ${tsPackets.length} パケット解析`,
    data: `PID 一覧: ${[...new Set(tsPackets.map((p) => `0x${p.pid.toString(16).padStart(4, "0")} (${p.pidName})`))].join(", ")}`,
  });

  // 8. デコード
  steps.push({
    phase: "decode",
    detail: "映像: H.264/MPEG-4 AVC デコード, 音声: AAC-LC デコード",
    data: `映像: 1440×1080i (16:9), 音声: ステレオ 48kHz`,
  });

  // 9. 出力
  steps.push({
    phase: "output",
    detail: `${channel.name} (リモコン ${channel.remoteId}) を表示`,
    data: channel.programs.length > 0 ? `番組: ${channel.programs[0]!.name}` : "",
  });

  return { channel, segments, tsPackets, steps, signalLevel, locked };
}

/** TS パケットを生成する（シミュレーション） */
function generateTsPackets(channel: Channel): TsPacket[] {
  const packets: TsPacket[] = [];
  let cc = 0;

  const add = (pid: number, name: string, payload: string, scrambled = false) => {
    packets.push({ syncByte: 0x47, pid, pidName: name, payload, scrambled, continuityCounter: cc++ % 16 });
  };

  // PAT (Program Association Table)
  add(0x0000, "PAT", `program_number=${channel.programs[0]?.serviceId ?? 0}, PMT_PID=0x0100`);

  // PMT (Program Map Table)
  add(0x0100, "PMT", "stream_type=0x02(H.264) PID=0x0110, stream_type=0x0F(AAC) PID=0x0111");

  // NIT (Network Information Table)
  add(0x0010, "NIT", `network_id=0x7FE0, ts_id=0x${channel.physCh.toString(16)}`);

  // SDT (Service Description Table)
  add(0x0011, "SDT", `service_name="${channel.name}", service_type=digital_tv`);

  // EIT (Event Information Table — EPG)
  for (const prog of channel.programs) {
    add(0x0012, "EIT", `event="${prog.name}" ${prog.startTime} ${prog.duration} [${prog.genre}]`);
  }

  // TOT (Time Offset Table)
  add(0x0014, "TOT", `JST=${new Date().toISOString().slice(11, 19)}`);

  // 映像 PES パケット (複数)
  for (let i = 0; i < 5; i++) {
    add(0x0110, "Video", `H.264 NAL unit (slice ${i + 1}/5), 1440x1080i`, true);
  }

  // 音声 PES パケット
  for (let i = 0; i < 2; i++) {
    add(0x0111, "Audio", `AAC-LC frame (${i + 1}/2), 48kHz stereo`, true);
  }

  // 字幕 PES パケット
  add(0x0130, "Caption", "ARIB 字幕 (8単位符号)");

  // データ放送
  add(0x0140, "Data", "BML データカルーセル (データ放送)");

  // ECM (暗号化管理)
  add(0x0160, "ECM", "B-CAS カード認証 → スクランブル鍵取得");

  // NULL パケット (帯域調整)
  add(0x1FFF, "NULL", "帯域調整用 NULL パケット");

  return packets;
}

/** セグメント配置を視覚化するための情報 */
export function describeSegmentLayout(channel: Channel): string[] {
  const lines: string[] = [];
  lines.push("┌─────────────────────────────────────┐");
  lines.push("│         6 MHz 帯域 (13セグメント)        │");
  lines.push("├──┬──────────────────────────────────┤");
  const layerA = channel.layers.find((l) => l.id === "A");
  const layerB = channel.layers.find((l) => l.id === "B");
  lines.push(
    `│${layerA ? "1S" : "  "}│` +
    `${"B".repeat(layerB?.segments ?? 12).padEnd(12, " ")}` +
    "                      │",
  );
  lines.push("├──┼──────────────────────────────────┤");
  lines.push(`│ A│              B (${layerB?.segments ?? 12} seg)              │`);
  lines.push("└──┴──────────────────────────────────┘");
  return lines;
}
