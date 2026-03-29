/**
 * ペイントモジュール
 * レイアウトツリーからディスプレイリスト（描画命令列）を生成する
 * 描画順序: 背景 → ボーダー → コンテンツ（テキスト）
 */

import type { LayoutBox } from './layout';
import type { StyleMap } from './style';

/** 矩形描画コマンド */
export interface DrawRect {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/** テキスト描画コマンド */
export interface DrawText {
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

/** ボーダー描画コマンド */
export interface DrawBorder {
  type: 'border';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  borderWidth: number;
}

/** ディスプレイコマンドの共用型 */
export type DisplayCommand = DrawRect | DrawText | DrawBorder;

/**
 * レイアウトツリーからディスプレイリストを生成する
 * 各ボックスの描画順序: 背景 → ボーダー → 子要素 → テキスト
 */
export function buildDisplayList(
  layoutRoot: LayoutBox,
  styleMap: StyleMap,
  offsetX: number = 0,
  offsetY: number = 0,
): DisplayCommand[] {
  const commands: DisplayCommand[] = [];

  const d = layoutRoot.dimensions;
  const absX = offsetX + d.content.x - d.padding.left - d.border.left;
  const absY = offsetY + d.content.y - d.padding.top - d.border.top;
  const fullWidth = d.content.width + d.padding.left + d.padding.right;
  const fullHeight = d.content.height + d.padding.top + d.padding.bottom;

  const styles = layoutRoot.node ? styleMap.get(layoutRoot.node) : undefined;

  // 1. 背景を描画
  const bgColor = styles?.get('background') ?? styles?.get('background-color');
  if (bgColor) {
    commands.push({
      type: 'rect',
      x: absX + d.border.left,
      y: absY + d.border.top,
      width: fullWidth,
      height: fullHeight,
      color: bgColor,
    });
  }

  // 2. ボーダーを描画
  if (d.border.top > 0 || d.border.right > 0 || d.border.bottom > 0 || d.border.left > 0) {
    const borderColor = styles?.get('border-color') ?? '#000000';
    const borderW = Math.max(d.border.top, d.border.right, d.border.bottom, d.border.left);
    commands.push({
      type: 'border',
      x: absX,
      y: absY,
      width: fullWidth + d.border.left + d.border.right,
      height: fullHeight + d.border.top + d.border.bottom,
      color: borderColor,
      borderWidth: borderW,
    });
  }

  // 3. 子要素を描画
  const childOffsetX = absX + d.border.left + d.padding.left;
  const childOffsetY = absY + d.border.top + d.padding.top;

  for (const child of layoutRoot.children) {
    const childCommands = buildDisplayList(child, styleMap, childOffsetX, childOffsetY);
    commands.push(...childCommands);
  }

  // 4. テキストコンテンツを描画（要素ノードの直接のテキスト子）
  if (layoutRoot.node) {
    for (const child of layoutRoot.node.children) {
      if (child.type === 'text') {
        const textColor = styles?.get('color') ?? '#000000';
        const fontSize = parseFloat(styles?.get('font-size') ?? '16');
        commands.push({
          type: 'text',
          x: childOffsetX,
          y: childOffsetY + (isNaN(fontSize) ? 16 : fontSize),
          text: child.text,
          color: textColor,
          fontSize: isNaN(fontSize) ? 16 : fontSize,
        });
      }
    }
  }

  return commands;
}

/**
 * ディスプレイリストをCanvas 2Dコンテキストに描画する
 */
export function paintToCanvas(commands: DisplayCommand[], ctx: CanvasRenderingContext2D): void {
  // 背景をクリア
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'rect':
        ctx.fillStyle = cmd.color;
        ctx.fillRect(cmd.x, cmd.y, cmd.width, cmd.height);
        break;
      case 'border':
        ctx.strokeStyle = cmd.color;
        ctx.lineWidth = cmd.borderWidth;
        ctx.strokeRect(
          cmd.x + cmd.borderWidth / 2,
          cmd.y + cmd.borderWidth / 2,
          cmd.width - cmd.borderWidth,
          cmd.height - cmd.borderWidth,
        );
        break;
      case 'text':
        ctx.fillStyle = cmd.color;
        ctx.font = `${cmd.fontSize}px sans-serif`;
        ctx.fillText(cmd.text, cmd.x, cmd.y);
        break;
    }
  }
}
