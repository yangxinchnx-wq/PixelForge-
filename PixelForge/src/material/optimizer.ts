/**
 * Shader Optimizer(Step 28.14)— Kernel Fusion 优化器。
 *
 * 职责:
 * - 检测可合并的连续 FILTER 节点链
 * - 把多个 FILTER 合并为单个 fused 节点(减少 GPU pass)
 * - 输出优化后的 MaterialGraph(供 compiler 使用)
 *
 * Fusion 规则(spec §14):
 *   连续的 FILTER 节点(输入 vec4 → 输出 vec4)可以合并:
 *     Noise → Blur → ColorCorrect
 *   变为:
 *     FusedFilter(Noise + Blur + ColorCorrect)
 *
 * 限制:
 *   - 只合并线性链(无分叉)
 *   - 只合并 vec4 → vec4 的 FILTER
 *   - 合并后节点的参数为各子节点参数的拼接
 *
 * 简化版(Step 28):
 *   - 不真正合并节点(改图结构复杂)
 *   - 而是标记可合并的节点链,由 compiler 在生成 WGSL 时内联(inline)
 *   - 即:多个 FILTER 节点的 WGSL 代码合并到同一个 fn 中,避免中间 texture 读写
 *
 * 与 compiler.ts 的协作:
 *   compiler 在生成 WGSL 时:
 *   - 未优化的链:每个 FILTER 节点 → 独立 let 语句(默认行为)
 *   - 已优化的链:多个 FILTER 节点 → 嵌套函数调用(如 noise(blur(colorCorrect(x))))
 *
 * 优化效果:
 *   未优化:5 个 FILTER → 5 次 texture 读写
 *   优化后:5 个 FILTER → 1 次 texture 读写(只在 OUTPUT 节点写)
 */

import type { MaterialGraph, MaterialNode } from './types'

/**
 * 可融合的节点链(线性 FILTER 序列)。
 *
 * - nodes:  链中的节点(按执行顺序)
 * - outputVar: 链最终输出的变量名(由 compiler 分配)
 */
export interface FusionChain {
  nodes: MaterialNode[]
}

/**
 * 检测图中所有可融合的 FILTER 链。
 *
 * 算法:
 *   1. 找到所有 FILTER 节点(vec4 → vec4)
 *   2. 从每个 FILTER 节点开始,向后追踪:
 *      - 下游也是 FILTER(vec4 → vec4)且只有一个下游 → 加入链
 *      - 否则停止
 *   3. 链长度 >= 2 才值得融合
 *
 * @returns FusionChain[](每条链至少 2 个节点)
 */
export function detectFusionChains(graph: MaterialGraph): FusionChain[] {
  const chains: FusionChain[] = []
  const visited = new Set<string>()

  // 找到所有 vec4 → vec4 的 FILTER 节点
  const filterNodes = graph.nodes.filter(
    (n) =>
      n.type === 'FILTER' &&
      n.inputs.length === 1 &&
      n.inputs[0].type === 'vec4' &&
      n.outputs.length === 1 &&
      n.outputs[0].type === 'vec4',
  )

  // 正向邻接:from → [to]
  const forwardAdj = new Map<string, string[]>()
  for (const node of graph.nodes) forwardAdj.set(node.id, [])
  for (const edge of graph.edges) {
    const list = forwardAdj.get(edge.from)
    if (list) list.push(edge.to)
  }

  // 反向邻接:to → [from]
  const reverseAdj = new Map<string, string[]>()
  for (const node of graph.nodes) reverseAdj.set(node.id, [])
  for (const edge of graph.edges) {
    const list = reverseAdj.get(edge.to)
    if (list) list.push(edge.from)
  }

  for (const start of filterNodes) {
    if (visited.has(start.id)) continue

    const chain: MaterialNode[] = [start]
    let current: MaterialNode = start

    // 向后追踪
    while (true) {
      const downstream = forwardAdj.get(current.id) ?? []
      // 下游必须只有一个 vec4 → vec4 FILTER 节点
      if (downstream.length !== 1) break
      const next = graph.nodes.find((n) => n.id === downstream[0])
      if (!next) break
      if (next.type !== 'FILTER') break
      if (next.inputs.length !== 1 || next.inputs[0].type !== 'vec4') break
      if (next.outputs.length !== 1 || next.outputs[0].type !== 'vec4') break
      // 下游节点的上游必须只有 current(确保线性链)
      const upstreamOfNext = reverseAdj.get(next.id) ?? []
      if (upstreamOfNext.length !== 1) break

      chain.push(next)
      current = next
    }

    if (chain.length >= 2) {
      chains.push({ nodes: chain })
      for (const n of chain) visited.add(n.id)
    }
  }

  return chains
}

/**
 * 统计优化潜力(用于 UI 显示)。
 *
 * @returns 可融合的节点数 / 可减少的 GPU pass 数
 */
export function estimateFusionSavings(graph: MaterialGraph): {
  fusibleNodeCount: number
  passReduction: number
} {
  const chains = detectFusionChains(graph)
  let fusibleNodeCount = 0
  let passReduction = 0
  for (const chain of chains) {
    fusibleNodeCount += chain.nodes.length
    // N 个节点融合后从 N pass 降到 1 pass,减少 N-1 pass
    passReduction += chain.nodes.length - 1
  }
  return { fusibleNodeCount, passReduction }
}
