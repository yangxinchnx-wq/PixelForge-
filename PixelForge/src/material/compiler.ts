/**
 * Material Compiler(Step 28.9)— Material Graph → WGSL 编译器。
 *
 * 职责:
 * - 接收 MaterialGraph,输出 CompileResult(完整 WGSL fragment shader)
 * - 流程(spec §9):
 *     1. Topological Sort(拓扑排序,确保依赖在前)
 *     2. Variable Allocation(为每个节点的每个输出端口分配唯一变量名)
 *     3. Node Generation(按拓扑序调用每个节点的 generateWGSL)
 *     4. Variable Resolve(解析输入端口的引用:从边找到上游输出变量名 + 自动 cast)
 *     5. WGSL Merge(组装成完整 shader:struct + binding + helper + fn main)
 *
 * 生成 WGSL 结构(完整示例):
 *   struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
 *
 *   @group(0) @binding(0) var tex_xxx: texture_2d<f32>;
 *   @group(0) @binding(1) var sampler_xxx: sampler;
 *
 *   fn pf_hash(p: vec2<f32>) -> f32 { ... }
 *
 *   @fragment
 *   fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
 *     let uv_0: vec2<f32> = input.uv;
 *     let noise_0: f32 = pf_hash(uv_0 * 4.0);
 *     let color_0: vec4<f32> = vec4<f32>(noise_0, noise_0, noise_0, 1.0);
 *     return color_0;
 *   }
 *
 * 与 graph/graphCompiler.ts 的关系:
 * - graph/graphCompiler.ts:  RenderGraph → RenderIR(高层 IR,描述场景结构)
 * - material/compiler.ts:    MaterialGraph → WGSL(底层 shader,描述像素计算)
 */

import type {
  CompileContext,
  CompileResult,
  MaterialBinding,
  MaterialEdge,
  MaterialGraph,
  MaterialNode,
  MaterialPort,
} from './types'
import { WGSLBuilder, castPortType } from './wgslBuilder'
import { getShaderNode } from './shaderRegistry'
import { detectFusionChains, type FusionChain } from './optimizer'

// ============================================================================
// 1. 拓扑排序(与 graph/runtime/scheduler.ts 类似,但独立实现避免循环依赖)
// ============================================================================

/**
 * 拓扑排序(DAG,DFS 后序,依赖在前)。
 *
 * @param graph Material Graph
 * @returns 节点 ID 数组(拓扑序,源头在前,OUTPUT 在最后)
 * @throws 如果检测到环
 */
export function topologicalSort(graph: MaterialGraph): string[] {
  const visited = new Set<string>()
  const inStack = new Set<string>()  // 用于环检测
  const result: string[] = []

  // 反向邻接表:to → [from]
  const reverseAdj = new Map<string, string[]>()
  for (const node of graph.nodes) {
    reverseAdj.set(node.id, [])
  }
  for (const edge of graph.edges) {
    const list = reverseAdj.get(edge.to)
    if (list) list.push(edge.from)
  }

  function visit(id: string, path: string[] = []) {
    if (visited.has(id)) return
    if (inStack.has(id)) {
      throw new Error(`检测到环: ${[...path, id].join(' → ')}`)
    }
    inStack.add(id)
    const deps = reverseAdj.get(id) ?? []
    for (const dep of deps) {
      visit(dep, [...path, id])
    }
    inStack.delete(id)
    visited.add(id)
    result.push(id)
  }

  for (const node of graph.nodes) {
    visit(node.id)
  }

  return result
}

// ============================================================================
// 2. 变量分配
// ============================================================================

/**
 * 为每个节点的每个输出端口分配唯一变量名。
 *
 * 命名规则:`${portId}_${nodeCounter}`(如 'uv_0' / 'color_1' / 'value_2')
 *
 * @returns Map<`${nodeId}:${portId}`, varName>
 */
function allocateVariables(
  graph: MaterialGraph,
  order: string[],
): Map<string, string> {
  const varMap = new Map<string, string>()
  let counter = 0
  for (const nodeId of order) {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) continue
    for (const port of node.outputs) {
      // 用 portId 作为基础名(如 'uv' / 'color' / 'value')
      const baseName = port.id.replace(/[^a-zA-Z0-9_]/g, '_')
      const varName = `${baseName}_${counter}`
      varMap.set(`${nodeId}:${port.id}`, varName)
    }
    counter++
  }
  return varMap
}

// ============================================================================
// 3. 端口查找
// ============================================================================

/** 在节点中查找端口 */
function findPort(node: MaterialNode, portId: string): MaterialPort | undefined {
  return [...node.inputs, ...node.outputs].find((p) => p.id === portId)
}

/** 查找指向目标端口的上游边 */
function findIncomingEdge(graph: MaterialGraph, nodeId: string, portId: string): MaterialEdge | undefined {
  return graph.edges.find((e) => e.to === nodeId && e.toPort === portId)
}

// ============================================================================
// 4. 编译主函数
// ============================================================================

/**
 * 把 MaterialGraph 编译为 WGSL fragment shader。
 *
 * 优化: 如果图中存在连续的 FILTER 链(vec4→vec4)，编译器会:
 *   1. 检测所有可融合链(detectFusionChains)
 *   2. 对链中的非首节点，不生成独立的 let 语句
 *   3. 而是记录链中每个节点的 WGSL 表达式，最终内联为嵌套调用
 *   4. 只有链的首节点生成正常 let 语句（绑定到上游变量）
 *
 * 效果:
 *   未优化: Noise → Blur → ColorCorrect → 3 个 let 语句 + 3 次中间变量赋值
 *   优化后: 1 个 let 语句，内部为 pf_color_correct(pf_blur(pf_noise(uv)))
 *
 * @param graph Material Graph
 * @returns CompileResult(wgsl / bindings / entryPoint / hash)
 * @throws 如果 graph 无效(无 OUTPUT 节点 / 有环 / 节点定义缺失)
 */
export function compileMaterialGraph(graph: MaterialGraph): CompileResult {
  // —— 基本校验 ——
  const outputNodes = graph.nodes.filter((n) => n.type === 'OUTPUT')
  if (outputNodes.length === 0) {
    throw new Error('Material Graph 必须有一个 OUTPUT 节点')
  }
  if (outputNodes.length > 1) {
    throw new Error(`Material Graph 只能有一个 OUTPUT 节点(当前 ${outputNodes.length} 个)`)
  }

  // —— 拓扑排序 ——
  const order = topologicalSort(graph)

  // —— 变量分配 ——
  const varMap = allocateVariables(graph, order)

  // —— 准备 builder + 上下文累积器 ——
  const builder = new WGSLBuilder()
  const bindings: MaterialBinding[] = []
  const bindingDecls: string[] = []
  const helperFunctions = new Set<string>()

  // —— 节点 → 输出变量名映射(用于调试 / 优化器) ——
  const nodeVarMap = new Map<string, string>()
  // —— 实际编译的节点总数(含 OUTPUT,用于摘要统计) ——
  let compiledNodeCount = 0

  // —— 优化: 检测可融合的 FILTER 链 ——
  const fusionChains = detectFusionChains(graph)
  // 构建节点 → 所属链的映射
  const nodeToChain = new Map<string, FusionChain>()
  // 链首节点 → 链中后续节点的内联表达式累积器
  // chainInlineExpr: 链首节点 ID → 当前累积的内联表达式
  const chainInlineExpr = new Map<string, string>()
  for (const chain of fusionChains) {
    for (let i = 0; i < chain.nodes.length; i++) {
      nodeToChain.set(chain.nodes[i].id, chain)
    }
  }
  // 记录哪些节点已被内联处理（跳过正常编译）
  const inlinedNodes = new Set<string>()

  // —— 按拓扑序遍历节点,调用每个节点的 generateWGSL ——
  for (const nodeId of order) {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) continue

    // 优化: 如果节点在融合链中且不是链首，跳过正常编译
    // （已在链首节点的融合处理中计数和内联）
    const chain = nodeToChain.get(nodeId)
    if (chain && chain.nodes[0].id !== nodeId) {
      // 已在 inlinedNodes 中标记的节点不重复计数
      if (!inlinedNodes.has(nodeId)) {
        inlinedNodes.add(nodeId)
        compiledNodeCount++
      }
      continue
    }

    const def = getShaderNode(node.templateKey)
    if (!def) {
      throw new Error(`未找到节点定义: ${node.templateKey}(节点 ${node.name})`)
    }

    // 构造输入端口 → 上游变量名映射(含类型转换)
    const inputVarNames = new Map<string, string>()
    for (const inPort of node.inputs) {
      const edge = findIncomingEdge(graph, nodeId, inPort.id)
      if (!edge) {
        // 输入未连接:使用默认零值
        inputVarNames.set(inPort.id, WGSLBuilder.zeroLiteral(inPort.type))
        continue
      }
      const upstreamVar = varMap.get(`${edge.from}:${edge.fromPort}`)
      if (!upstreamVar) {
        inputVarNames.set(inPort.id, WGSLBuilder.zeroLiteral(inPort.type))
        continue
      }
      // 查找上游端口类型(用于决定是否需要 cast)
      const upstreamNode = graph.nodes.find((n) => n.id === edge.from)
      const upstreamPort = upstreamNode ? findPort(upstreamNode, edge.fromPort) : undefined
      if (upstreamPort && upstreamPort.type !== inPort.type) {
        // 类型不同:插入 cast 表达式(包装在临时变量中)
        const castedVar = `${upstreamVar}_cast`
        const castExpr = castPortType(upstreamPort.type, inPort.type, upstreamVar)
        builder.addLine(`let ${castedVar}: ${WGSLBuilder.typeDecl(inPort.type)} = ${castExpr};`)
        inputVarNames.set(inPort.id, castedVar)
      } else {
        inputVarNames.set(inPort.id, upstreamVar)
      }
    }

    // 构造输出端口 → 本节点变量名映射
    const outputVarNames = new Map<string, string>()
    for (const outPort of node.outputs) {
      const v = varMap.get(`${nodeId}:${outPort.id}`)
      if (v) outputVarNames.set(outPort.id, v)
    }

    // 记录节点主输出(用于调试)
    if (node.outputs.length > 0) {
      const mainOut = node.outputs[0]
      const mainVar = varMap.get(`${nodeId}:${mainOut.id}`)
      if (mainVar) nodeVarMap.set(nodeId, mainVar)
    }

    // 添加节点注释(便于调试 WGSL)
    builder.addComment(`节点: ${node.name}(${node.templateKey})`)
    compiledNodeCount++

    // 构造 context 并调用 generateWGSL
    const ctx: CompileContext = {
      nodeId,
      node,
      inputVarNames,
      outputVarNames,
      resolution: graph.canvas,
      bindings: bindingDecls,
      helperFunctions,
      builder,
    }

    // 注:TEXTURE 节点需要在 binding 列表中注册资源
    // 我们通过包装 generateWGSL 来捕获 binding 变化
    if (node.type === 'TEXTURE') {
      const bindingIdx = bindings.length
      const texName = `tex_${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}`
      const samplerName = `sampler_${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}`
      bindings.push(
        { kind: 'texture', group: 0, binding: bindingIdx, name: texName, sourceNodeId: nodeId },
        { kind: 'sampler', group: 0, binding: bindingIdx + 1, name: samplerName, sourceNodeId: nodeId },
      )
    }

    // 如果是融合链的首节点，使用专用 builder 捕获表达式
    if (chain && chain.nodes[0].id === nodeId && chain.nodes.length >= 2) {
      // 为链首节点创建独立 builder，捕获生成的代码
      const fusedBuilder = new WGSLBuilder()
      const fusedCtx: CompileContext = {
        ...ctx,
        builder: fusedBuilder,
      }

      // TEXTURE 节点仍需注册 binding（用 fusedCtx）
      if (node.type === 'TEXTURE') {
        // 已在上方处理 binding 注册（使用 bindingDecls）
      }

      def.generateWGSL(fusedCtx)

      // 提取链首节点生成的 let 语句中的表达式
      const fusedCode = fusedBuilder.build()
      // 解析生成的代码，提取赋值表达式
      // 格式: let varName: type = expr;
      const match = fusedCode.match(/let\s+(\w+):\s*\S+\s*=\s*(.+);/s)
      if (match) {
        chainInlineExpr.set(nodeId, match[2].trim())
      }

      // 融合后的 let 语句使用链【尾】节点的输出变量名
      // （下游节点引用的是链尾节点的输出变量，不是链首的）
      builder.addLine(`// [Fused chain start] ${chain.nodes.map((n) => n.name).join(' → ')}`)
      const lastChainNode = chain.nodes[chain.nodes.length - 1]
      const lastOut = lastChainNode.outputs[0]
      const lastVar = varMap.get(`${lastChainNode.id}:${lastOut?.id}`)
      if (lastVar && chainInlineExpr.has(nodeId)) {
        // 累积链中后续节点的表达式
        let inlineExpr = chainInlineExpr.get(nodeId)!

        // 遍历链中后续节点，逐步内联
        for (let ci = 1; ci < chain.nodes.length; ci++) {
          const chainNode = chain.nodes[ci]
          const chainDef = getShaderNode(chainNode.templateKey)
          if (!chainDef) break

          // 为后续节点创建上下文，输入用当前累积的内联表达式
          const chainInputVars = new Map<string, string>()
          // FILTER 节点只有一个 vec4 输入，用上游的内联表达式
          const chainInPort = chainNode.inputs[0]
          if (chainInPort) {
            // 检查上游是否就是链中前一个节点
            const chainEdge = findIncomingEdge(graph, chainNode.id, chainInPort.id)
            if (chainEdge && chainEdge.from === chain.nodes[ci - 1].id) {
              chainInputVars.set(chainInPort.id, inlineExpr)
            } else {
              chainInputVars.set(chainInPort.id, WGSLBuilder.zeroLiteral(chainInPort.type))
            }
          }

          const chainOutputVars = new Map<string, string>()
          const chainOutPort = chainNode.outputs[0]
          if (chainOutPort) {
            const v = varMap.get(`${chainNode.id}:${chainOutPort.id}`)
            if (v) chainOutputVars.set(chainOutPort.id, v)
          }

          const chainBuilder = new WGSLBuilder()
          const chainCtx: CompileContext = {
            nodeId: chainNode.id,
            node: chainNode,
            inputVarNames: chainInputVars,
            outputVarNames: chainOutputVars,
            resolution: graph.canvas,
            bindings: bindingDecls,
            helperFunctions,
            builder: chainBuilder,
          }

          chainDef.generateWGSL(chainCtx)
          const chainCode = chainBuilder.build()
          const chainMatch = chainCode.match(/let\s+\w+:\s*\S+\s*=\s*(.+);/s)
          if (chainMatch) {
            inlineExpr = chainMatch[1].trim()
            chainInlineExpr.set(nodeId, inlineExpr)
          }
          inlinedNodes.add(chainNode.id)
          compiledNodeCount++
        }

        // 最终生成一个 let 语句，用内联表达式，变量名用链尾节点的
        builder.addLine(`let ${lastVar}: ${WGSLBuilder.typeDecl(lastOut.type)} = ${inlineExpr};`)
        builder.addLine(`// [Fused chain end]`)
        builder.addEmptyLine()
        // 更新 nodeVarMap：链尾节点的输出变量映射
        nodeVarMap.set(lastChainNode.id, lastVar)
        // helper functions 仍由 fusedCtx 累积
        continue
      }
      // 如果解析失败，回退到正常编译
    }

    def.generateWGSL(ctx)
    builder.addEmptyLine()
  }

  // —— 组装完整 WGSL ——
  const fullBuilder = new WGSLBuilder()
  fullBuilder.addLine('// PixelForge Material Graph - Auto-generated WGSL')
  fullBuilder.addLine('// DO NOT EDIT - 修改请在 Material Editor 中操作')
  fullBuilder.addEmptyLine()

  // struct VertexOutput(由 vertex shader 传递给 fragment shader)
  fullBuilder.addLine('struct VertexOutput {')
  fullBuilder.pushIndent()
  fullBuilder.addLine('@builtin(position) position: vec4<f32>,')
  fullBuilder.addLine('@location(0) uv: vec2<f32>,')
  fullBuilder.popIndent()
  fullBuilder.addLine('};')
  fullBuilder.addEmptyLine()

  // bindings(由 TEXTURE 节点追加)
  for (const decl of bindingDecls) {
    fullBuilder.addLine(decl)
  }
  if (bindingDecls.length > 0) fullBuilder.addEmptyLine()

  // helper functions(由 NOISE / FBM / VORONOI 等追加)
  for (const fn of helperFunctions) {
    fullBuilder.addLine(fn)
    fullBuilder.addEmptyLine()
  }

  // 主函数 fs_main
  fullBuilder.openBlock('@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32>')
  // 注:节点生成的代码使用 `input.position.xy` 来计算 UV(与 UV 节点对齐)
  // 但实际 WGSL 中 VertexOutput.position 是 @builtin(position) 即屏幕坐标
  // 这里复用节点生成的代码(已用 input.position.xy)
  // 把 builder 内容嵌入(去掉缩进,因为 openBlock 已加一层缩进)
  const innerCode = builder.build()
  for (const line of innerCode.split('\n')) {
    fullBuilder.addLine(line)
  }
  fullBuilder.closeBlock()

  const wgsl = fullBuilder.build()

  // —— 计算 hash(供 shaderCache 使用) ——
  const hash = computeHash(wgsl)

  return {
    wgsl,
    bindings,
    entryPoint: 'fs_main',
    nodeVarMap,
    compiledNodeCount,
    hash,
  }
}

// ============================================================================
// 5. Hash 计算(简单 djb2)
// ============================================================================

/**
 * 简单字符串 hash(djb2 算法)。
 * 用于 shaderCache 的 key 生成(不需要密码学强度)。
 */
function computeHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i)
    h = h & 0xffffffff  // 转 32 位
  }
  // 转 16 进制字符串
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ============================================================================
// 6. 编译结果摘要(用于 UI 显示)
// ============================================================================

export interface CompileSummary {
  nodeCount: number
  edgeCount: number
  bindingCount: number
  helperFunctionCount: number
  wgslLineCount: number
  hash: string
}

export function summarizeCompileResult(result: CompileResult): CompileSummary {
  return {
    nodeCount: result.compiledNodeCount,
    edgeCount: 0,  // 由调用方填充(若需要)
    bindingCount: result.bindings.length,
    helperFunctionCount: 0,  // 不在 CompileResult 中,简化
    wgslLineCount: result.wgsl.split('\n').length,
    hash: result.hash,
  }
}
