/**
 * InputManager — 入力エミュレーション
 *
 * Ebitenの入力API (IsKeyPressed, CursorPosition等) をエミュレートする。
 * ブラウザのキーボード/マウスイベントの受信と、
 * プログラム的な入力シミュレーション（テスト/プリセット用）の両方をサポート。
 */

import type { InputState, Key, MouseButton } from "./types.js";

/** ブラウザのキーコードからEbitenのKey型への変換マップ */
const KEY_MAP: Record<string, Key> = {
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  " ": "Space",
  Space: "Space",
  Enter: "Enter",
  Escape: "Escape",
  KeyA: "KeyA",
  KeyD: "KeyD",
  KeyS: "KeyS",
  KeyW: "KeyW",
  KeyZ: "KeyZ",
  KeyX: "KeyX",
  a: "KeyA",
  d: "KeyD",
  s: "KeyS",
  w: "KeyW",
  z: "KeyZ",
  x: "KeyX",
};

export class InputManager {
  private pressedKeys = new Set<Key>();
  private cursorX = 0;
  private cursorY = 0;
  private pressedMouseButtons = new Set<MouseButton>();
  private clicks: Array<{ x: number; y: number; button: MouseButton }> = [];

  /** ブラウザのキー押下イベント処理 */
  handleKeyDown(key: string): void {
    const mapped = KEY_MAP[key];
    if (mapped) this.pressedKeys.add(mapped);
  }

  /** ブラウザのキー解放イベント処理 */
  handleKeyUp(key: string): void {
    const mapped = KEY_MAP[key];
    if (mapped) this.pressedKeys.delete(mapped);
  }

  /** マウス移動イベント処理 */
  handleMouseMove(x: number, y: number): void {
    this.cursorX = x;
    this.cursorY = y;
  }

  /** マウスボタン押下イベント処理 */
  handleMouseDown(button: number, x: number, y: number): void {
    const mb = buttonToMouseButton(button);
    this.pressedMouseButtons.add(mb);
    this.clicks.push({ x, y, button: mb });
  }

  /** マウスボタン解放イベント処理 */
  handleMouseUp(button: number): void {
    this.pressedMouseButtons.delete(buttonToMouseButton(button));
  }

  /** Ebitenの IsKeyPressed に対応 */
  isKeyPressed(key: Key): boolean {
    return this.pressedKeys.has(key);
  }

  /** Ebitenの CursorPosition に対応 */
  cursorPosition(): { x: number; y: number } {
    return { x: this.cursorX, y: this.cursorY };
  }

  /** Ebitenの IsMouseButtonPressed に対応 */
  isMouseButtonPressed(button: MouseButton): boolean {
    return this.pressedMouseButtons.has(button);
  }

  /** ティック終了時にクリックリストをクリア */
  endTick(): void {
    this.clicks = [];
  }

  /** 現在の状態スナップショット取得 */
  getState(): InputState {
    return {
      pressedKeys: new Set(this.pressedKeys),
      cursorX: this.cursorX,
      cursorY: this.cursorY,
      pressedMouseButtons: new Set(this.pressedMouseButtons),
      clicks: [...this.clicks],
    };
  }

  /** 全入力状態をリセット */
  reset(): void {
    this.pressedKeys.clear();
    this.pressedMouseButtons.clear();
    this.clicks = [];
    this.cursorX = 0;
    this.cursorY = 0;
  }

  // ─── テスト/プリセット用のシミュレーション ───

  /** キー押下をシミュレート */
  simulateKeyPress(key: Key): void {
    this.pressedKeys.add(key);
  }

  /** キー解放をシミュレート */
  simulateKeyRelease(key: Key): void {
    this.pressedKeys.delete(key);
  }

  /** クリックをシミュレート */
  simulateClick(x: number, y: number, button: MouseButton = "Left"): void {
    this.cursorX = x;
    this.cursorY = y;
    this.clicks.push({ x, y, button });
  }
}

/** ブラウザのbutton番号をMouseButtonに変換 */
function buttonToMouseButton(button: number): MouseButton {
  switch (button) {
    case 0: return "Left";
    case 1: return "Middle";
    case 2: return "Right";
    default: return "Left";
  }
}
