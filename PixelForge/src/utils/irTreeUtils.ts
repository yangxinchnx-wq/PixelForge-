/**
 * IR 树工具函数（从 App.vue 提取）。
 */

import type { RenderIR } from '@/compiler/ir/renderIR';
import type { IRTreeNode } from '@/types';
import { Opcode } from '@/shared/types';

/** Opcode → 中文名称映射 */
const OPCODE_LABELS: Record<number, string> = {
  [Opcode.SOLID_COLOR]: '纯色填充',
  [Opcode.LINEAR_GRADIENT]: '线性渐变',
  [Opcode.NOISE]: '噪声',
  [Opcode.BLEND]: '混合',
  [Opcode.CIRCLE_SHAPE]: '圆形',
  [Opcode.IMAGE_TEXTURE]: '图片纹理',
};

/** 将 RenderIR 转换为 IRTreeNode[]（供 IRPreviewPanel 展示） */
export function renderIRToTreeNodes(ir: RenderIR): IRTreeNode[] {
  const layerNodes: IRTreeNode[] = ir.layers.map((layer, i) => ({
    id: layer.id,
    name: `${OPCODE_LABELS[layer.opcode] ?? '图层'} ${i + 1}`,
    type: 'layer',
    visible: layer.visible,
    opcode: layer.opcode,
    blendMode: layer.blendMode,
    params: layer.params,
  }));

  const effectNodes: IRTreeNode[] = ir.effects.map((effect, i) => ({
    id: effect.id,
    name: `效果 ${i + 1} (${effect.type})`,
    type: 'effect',
    targetLayer: effect.targetLayer,
    params: effect.params,
  }));

  const nodes: IRTreeNode[] = [];
  if (layerNodes.length > 0) {
    nodes.push({
      id: 'layers-group',
      name: `图层 (${layerNodes.length})`,
      type: 'group',
      children: layerNodes,
    });
  }
  if (effectNodes.length > 0) {
    nodes.push({
      id: 'effects-group',
      name: `效果 (${effectNodes.length})`,
      type: 'group',
      children: effectNodes,
    });
  }
  if (nodes.length === 0) {
    nodes.push({
      id: 'empty',
      name: '空 IR（无图层）',
      type: 'empty',
    });
  }
  return nodes;
}
