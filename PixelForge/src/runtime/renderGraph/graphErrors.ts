/**
 * PixelForge - RenderGraph 图编译错误(Step 40.5)
 *
 * 借鉴 Orillusion GraphValidator 的错误体系。
 * 子类消息内嵌具体的 Pass / 资源名,方便用户 grep 到出错位置。
 */

/**
 * 图编译错误基类。
 */
export class GraphCompileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/**
 * Pass 之间在 reads/writes 上形成环时抛出。
 * message 按顺序列出环上的 Pass 名。
 */
export class CyclicDependencyError extends GraphCompileError {
  public readonly cycle: readonly string[]
  constructor(cycle: readonly string[]) {
    super(
      `RenderGraph: 检测到循环依赖 — ${cycle.join(' → ')} → ${cycle[0]}. ` +
        `通过移除一条 reads/writes 边打破环,或把资源拆成两个命名句柄。`,
    )
    this.cycle = cycle
  }
}

/**
 * Pass 声明了 b.read('foo') (或 b.write('foo') 但无 factory) 但没有其它 Pass 是 'foo' 的创建者时抛出。
 */
export class UnresolvedResourceError extends GraphCompileError {
  public readonly pass: string
  public readonly resource: string
  constructor(pass: string, resource: string) {
    super(
      `RenderGraph: Pass '${pass}' 读取 '${resource}' 但没有找到创建者 Pass。` +
        `请在某 Pass 的 setup() 中调用 b.write('${resource}', factory)。`,
    )
    this.pass = pass
    this.resource = resource
  }
}

/**
 * Pass 调用 b.write('foo') (mutator, 无 factory) 但没有其它 Pass 是 'foo' 的创建者时抛出。
 */
export class MissingCreatorError extends GraphCompileError {
  public readonly pass: string
  public readonly resource: string
  constructor(pass: string, resource: string) {
    super(
      `RenderGraph: Pass '${pass}' 声明写入 '${resource}' (mutator) 但没有创建者 Pass。` +
        `请让某 Pass 在 setup() 中调用 b.write('${resource}', factory),或把本 Pass 改为创建者。`,
    )
    this.pass = pass
    this.resource = resource
  }
}

/**
 * Pass 调用 b.useRenderTarget('foo') (或任何其它类型化访问器) 时,
 * name 对应的池条目类型不是预期类型。在 setup 时立即抛出,堆栈指向真实调用点。
 */
export class WrongResourceKindError extends GraphCompileError {
  public readonly pass: string
  public readonly resource: string
  public readonly expected: string
  public readonly actual: string
  constructor(pass: string, resource: string, expected: string, actual: string) {
    super(
      `RenderGraph: Pass '${pass}' 把 '${resource}' 当作类型 '${expected}' 使用,但池条目类型是 '${actual}'。` +
        `创建者 Pass 是否用了不同的 builder 方法(如 b.write vs b.createRenderTarget),或 name 写错了?`,
    )
    this.pass = pass
    this.resource = resource
    this.expected = expected
    this.actual = actual
  }
}

/**
 * 两个 Pass 对同一 name 调用 b.write(name, factory) 时抛出。
 * 一个资源只能有一个创建者;其它写入者必须去掉 factory 变成 mutator。
 */
export class DuplicateCreatorError extends GraphCompileError {
  public readonly resource: string
  public readonly creators: readonly string[]
  constructor(resource: string, creators: readonly string[]) {
    super(
      `RenderGraph: 资源 '${resource}' 有多个创建者: ${creators.map((c) => `'${c}'`).join(', ')}。` +
        `只有一个 Pass 可以调用 b.write('${resource}', factory)。其它写入者必须去掉 factory 成为 mutator (b.write('${resource}'))。`,
    )
    this.resource = resource
    this.creators = [...creators]
  }
}
