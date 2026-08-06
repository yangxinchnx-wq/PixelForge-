/**
 * PixelForge - RenderGraph 验证器 + 拓扑排序(Step 40.5)
 *
 * 借鉴 Orillusion GraphValidator + topoSort 算法,纯函数实现,零 GPU 依赖,便于单测。
 *
 * 静态图不变量强制器。由 RenderGraph.compile 调用;独立抽出便于单测无需 GPU。
 */

import type { RenderGraphPass } from './renderGraphPass'
import {
  CyclicDependencyError,
  DuplicateCreatorError,
  GraphCompileError,
  MissingCreatorError,
  UnresolvedResourceError,
} from './graphErrors'

/**
 * 静态图不变量强制器。
 */
export class GraphValidator {
  /** name → 创建者 Pass 名(每资源单创建者) */
  private readonly _creators: Map<string, string> = new Map()
  /** name → 所有写入者 Pass 名(创建者 + 修改者),按注册顺序 */
  private readonly _writers: Map<string, string[]> = new Map()
  /** name → 读取者 Pass 名 */
  private readonly _consumers: Map<string, string[]> = new Map()
  private readonly _byName: Map<string, RenderGraphPass> = new Map()
  /** 跟踪重复创建者,便于 validateSingleCreator 一次性报告全部 */
  private readonly _duplicateCreators: Map<string, string[]> = new Map()

  constructor(passes: readonly RenderGraphPass[]) {
    for (const p of passes) {
      if (this._byName.has(p.name)) {
        throw new GraphCompileError(
          `RenderGraph: 重复的 Pass 名 '${p.name}'。` +
            `用不同的名字,或调用 graph.replace('${p.name}', NewCtor) 替换 add。`,
        )
      }
      this._byName.set(p.name, p)
      for (const c of p.creates) {
        if (!this._duplicateCreators.has(c)) this._duplicateCreators.set(c, [])
        this._duplicateCreators.get(c)!.push(p.name)
        if (!this._creators.has(c)) this._creators.set(c, p.name)
      }
      for (const w of p.writes) {
        if (!this._writers.has(w)) this._writers.set(w, [])
        this._writers.get(w)!.push(p.name)
      }
      for (const r of p.reads) {
        if (!this._consumers.has(r)) this._consumers.set(r, [])
        this._consumers.get(r)!.push(p.name)
      }
    }
  }

  /** 每个 name 最多一个创建者。仅修改者(无创建者)的资源由 validateResolvable 捕获。 */
  public validateSingleCreator(): void {
    for (const [name, list] of this._duplicateCreators) {
      if (list.length > 1) {
        throw new DuplicateCreatorError(name, list)
      }
    }
  }

  /** 每条 read 和每条 mutator-write 必须指向有创建者的资源。 */
  public validateResolvable(): void {
    for (const [resource, consumers] of this._consumers) {
      if (this._creators.has(resource)) continue
      throw new UnresolvedResourceError(consumers[0], resource)
    }
    for (const [resource, writers] of this._writers) {
      if (this._creators.has(resource)) continue
      // 无创建者却有人写入 —— 必是无 backing 创建者的 mutator
      const mutator = writers[0]
      throw new MissingCreatorError(mutator, resource)
    }
  }
}

/**
 * reads/writes DAG 上的 Kahn 风格拓扑排序。
 *
 * 同等就绪的 Pass 之间用"有效调度顺序"破平:
 *   - 无显式 dependencies 的 Pass 用其原始 insertedOrder 作 key(add() 顺序)。
 *   - 有显式 dependencies 的 Pass 位移到其最新显式 dep 之后 ——
 *     b.dependsOn(X) 读作"把我调度到 X 旁边",而非"在 X 后面某处"。
 *     后加入但依赖早加入 Pass 的 Pass 会从就绪队列里在 dep 之后立即弹出,
 *     排在恰好插入顺序更低的不相关 Pass 之前。
 *
 * 配合资源和 dependencies 边,这完整决定了调度:相同输入 → 相同输出。
 *
 * 多写入者支持:
 * - 同资源的写入者按插入顺序排。
 * - 每个后续写入者有一条从前一写入者来的入边(创建者之后的 mutator)。
 * - 每个读取者有一条从其插入序号不超过读取者的最新写入者来的入边。
 *   这让读取者可以夹在创建者和后续 mutator 之间采样创建者输出
 *   (例如 SceneColorPyramidPass 在 ColorPass 之后、SortedTransparentPass 之前读 ColorBuffer)。
 *
 * 副作用顺序用 RenderGraphPass.dependencies(set via b.dependsOn(name) 或直接字段赋值)
 * 处理图无法从 reads/writes 推断的场景。
 * 资源派生的读写边不参与有效顺序位移:它们经常是长程的(最终 GUI Pass 读 FINAL_COLOR),
 * 每条读边都位移会完全破坏插入顺序调度。
 *
 * 返回有序 Pass 名;检测到环时抛 CyclicDependencyError(含环路径)。
 */
export function topoSort(
  passes: readonly RenderGraphPass[],
  byName: ReadonlyMap<string, RenderGraphPass>,
  insertedOrder: (p: RenderGraphPass) => number,
): string[] {
  // 按插入顺序构建每资源的写入者链
  const writers = new Map<string, string[]>()
  for (const p of passes) {
    for (const w of p.writes) {
      if (!writers.has(w)) writers.set(w, [])
      writers.get(w)!.push(p.name)
    }
  }
  for (const [, list] of writers) {
    list.sort((a, b) => insertedOrder(byName.get(a)!) - insertedOrder(byName.get(b)!))
  }

  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const p of passes) {
    inDegree.set(p.name, 0)
    adj.set(p.name, [])
  }

  const addEdge = (from: string, to: string) => {
    if (from === to) return
    adj.get(from)!.push(to)
    inDegree.set(to, inDegree.get(to)! + 1)
  }

  // 1) 链接同资源的写入者
  for (const [, list] of writers) {
    for (let i = 1; i < list.length; i++) {
      addEdge(list[i - 1], list[i])
    }
  }
  // 2) 每个读取者依赖其插入序号 ≤ 读取者的最新写入者 —— 即读取者实际观察到的写入者输出
  for (const p of passes) {
    for (const r of p.reads) {
      const ws = writers.get(r)
      if (!ws || ws.length === 0) continue
      const readerOrder = insertedOrder(p)
      let picked: string | null = null
      for (let i = ws.length - 1; i >= 0; i--) {
        if (insertedOrder(byName.get(ws[i])!) <= readerOrder) {
          picked = ws[i]
          break
        }
      }
      // 全部写入者都在读取者之后加入的回退(无创建者会被 validateResolvable 捕获;
      // 此处只在 mutator 链 + 图尾读取者的奇景下发生)
      if (!picked) picked = ws[0]
      addEdge(picked, p.name)
    }
  }
  // 3) 显式 dependencies 边。每条加 <dep> → p,独立于资源流。
  //    用于图看不见的副作用依赖(indirect buffer 经 GlobalBindGroup 消费、离屏 RT 经兄弟材质消费)。
  //    未知 name 这里容忍 —— b.dependsOn 已在 setup 时拒绝;若 Pass 的 dependencies 直接赋值给缺失 name 则静默跳过
  for (const p of passes) {
    if (!p.dependencies) continue
    for (const dep of p.dependencies) {
      if (!byName.has(dep)) continue
      addEdge(dep, p.name)
    }
  }

  // 有效调度 key:有显式 dependencies 的 Pass 位移到最新 dep 之后,
  // 让 dependsOn(X) 把后加入的 Pass 拉到 X 旁边,而非排在队列尾部不相关早插入 Pass 之后。
  // 按插入顺序遍历 —— b.dependsOn 强制 dep 已注册,所以走到 dependent 时 dep 已在 eff 中。
  // 剩余边界(dep 通过直接字段赋值后加入)回退到 dep 的 insertedOrder,保持位移单调但近似;
  // 拓扑边仍锁定实际顺序。
  const eff = new Map<string, number>()
  const epsilon = 1 / (passes.length + 1)
  const byInsertion = [...passes].sort((a, b) => insertedOrder(a) - insertedOrder(b))
  for (const p of byInsertion) {
    let key = insertedOrder(p)
    if (p.dependencies && p.dependencies.size > 0) {
      let maxDepKey = -Infinity
      for (const depName of p.dependencies) {
        if (depName === p.name) continue
        const dep = byName.get(depName)
        if (!dep) continue
        const depKey = eff.get(depName) ?? insertedOrder(dep)
        if (depKey > maxDepKey) maxDepKey = depKey
      }
      if (maxDepKey > -Infinity) key = maxDepKey + epsilon
    }
    eff.set(p.name, key)
  }

  // Kahn,主 key 用有效顺序,同 key 时插入顺序作次级破平保证确定性
  const ready: RenderGraphPass[] = []
  for (const p of passes) {
    if (inDegree.get(p.name) === 0) ready.push(p)
  }
  const cmp = (a: RenderGraphPass, b: RenderGraphPass) => {
    const da = eff.get(a.name)!
    const db = eff.get(b.name)!
    if (da !== db) return da - db
    return insertedOrder(a) - insertedOrder(b)
  }
  ready.sort(cmp)

  const order: string[] = []
  while (ready.length > 0) {
    const next = ready.shift()!
    order.push(next.name)
    for (const child of adj.get(next.name)!) {
      const d = inDegree.get(child)! - 1
      inDegree.set(child, d)
      if (d === 0) {
        ready.push(byName.get(child)!)
        ready.sort(cmp)
      }
    }
  }

  if (order.length !== passes.length) {
    const remaining = new Set<string>()
    for (const p of passes) if (inDegree.get(p.name)! > 0) remaining.add(p.name)
    const cycle = extractCycle(remaining, adj)
    throw new CyclicDependencyError(cycle)
  }

  return order
}

/**
 * 走残余邻接表找出一条具体环路径。
 */
function extractCycle(remaining: Set<string>, adj: ReadonlyMap<string, string[]>): string[] {
  const start = remaining.values().next().value as string
  const path: string[] = []
  const seen = new Map<string, number>()
  let cur = start
  while (!seen.has(cur)) {
    seen.set(cur, path.length)
    path.push(cur)
    const next = adj.get(cur)!.find((n) => remaining.has(n))
    if (!next) break
    cur = next
  }
  const idx = seen.get(cur)
  return idx !== undefined ? path.slice(idx) : path
}
