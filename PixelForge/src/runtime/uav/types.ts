/**
 * UAV Split（纹理读写分离）共享类型。
 *
 * 背景：WebGPU 仅允许 r32float / r32uint / r32sint 三种格式的存储纹理
 * 以 `read_write` 访问；rgba8unorm / rgba16float 等常用格式不支持同时读写。
 * 借鉴 Gigi 的 WebGPU UAV Split 思路，将「读写同一纹理」拆分为：
 *   - 原始纹理：只写（write）
 *   - 只读副本：只读（read），由原纹理内容复制而来
 *   - 着色器内的读取操作重定向到只读副本
 *
 * 本模块与具体 GPU 实现解耦：执行器通过 UavSplitBackend 注入texture 创建/
 * 复制/销毁能力，便于在单元测试中使用 mock backend。
 */

/** WGSL 存储纹理访问限定符 */
export type StorageTextureAccess = 'read' | 'write' | 'read_write'

/**
 * WGSL 中解析出的存储纹理声明。
 */
export interface StorageTextureDeclaration {
  /** 变量名（纹理名） */
  textureName: string
  /** 原始格式 token（如 'rgba8unorm'） */
  formatToken: string
  /** 归一化后的格式名（小写，去掉多余空白） */
  format: string
  /** 访问限定符 */
  access: StorageTextureAccess
  /** 该声明在源码中的字符下标（便于精确替换/诊断） */
  location: number
  /** 声明匹配的总长度 */
  length: number
}

/**
 * 跨 shader/pass 汇总的纹理访问信息。
 */
export interface TextureAccessInfo {
  /** 纹理名 */
  textureName: string
  /** 访问类型 */
  accessType: StorageTextureAccess
  /** 所在 shader 名 */
  shaderName: string
  /** 所在 pass 名 */
  passName: string
  /** 纹理格式 */
  format: string
}

/**
 * 单条纹理拆分方案。
 */
export interface TextureSplitPlan {
  /** 原始纹理名 */
  originalTexture: string
  /** 只读副本名（约定为 `${originalTexture}_readOnly`） */
  readOnlyCopy: string
  /** 纹理格式 */
  format: string
  /** 受影响的 shader 列表（含读访问的那个 shader） */
  affectedShaders: Array<{
    shaderName: string
    passName: string
    /** 原始 read_write 绑定的绑定槽（可选，运行时回填） */
    originalBinding?: number
    /** 新增只读副本的绑定槽（可选，运行时回填） */
    readOnlyBinding?: number
  }>
  /** 复制操作的执行时机 */
  copyTiming: 'before-pass' | 'before-shader' | 'manual'
}

/**
 * 拆分执行结果。
 */
export interface TextureSplitResult {
  /** 采用的拆分方案 */
  plan: TextureSplitPlan
  /** 只读副本的抽象句柄（backend 返回的 id/对象） */
  readOnlyTexture: unknown
  /** 是否已向 backend 记录复制命令 */
  copyCommandRecorded: boolean
}

/**
 * 只读副本纹理描述符（backend 用于创建纹理）。
 */
export interface ReadOnlyTextureDescriptor {
  /** 宽度（像素） */
  width: number
  /** 高度（像素） */
  height: number
  /** 格式 */
  format: string
  /** 标签（调试用） */
  label: string
}

/**
 * GPU 后端抽象（注入式）。
 *
 * UAV Split 执行器不直接依赖浏览器 GPU 类型，
 * 而是通过此接口创建/复制/销毁只读副本纹理，
 * 从而可在单元测试中用 mock 验证行为。
 */
export interface UavSplitBackend {
  /**
   * 创建只读副本纹理。
   * @returns 抽象句柄（真实环境是 GPUTexture，测试环境是字符串 id）
   */
  createReadOnlyTexture(desc: ReadOnlyTextureDescriptor): unknown

  /**
   * 将原纹理内容复制到只读副本。
   * 真实环境会在某个 command encoder 上记录 copyTextureToTexture；
   * 测试环境只需记录一次调用。
   */
  copyTextureToTexture(source: unknown, destination: unknown): void

  /**
   * 销毁只读副本纹理。
   */
  destroyTexture(handle: unknown): void
}

/**
 * 支持 read_write 存储访问的格式（WebGPU 规范限定）。
 */
export const READ_WRITE_STORAGE_FORMATS: ReadonlySet<string> = new Set([
  'r32float',
  'r32uint',
  'r32sint',
])
