/**
 * Material Asset 类型定义 — 材质资产的完整数据模型。
 *
 * MaterialAsset 是材质管理系统中的核心实体，它将底层 MaterialGraph（节点图）
 * 与上层元数据（名称、标签、PBR 参数、导入导出信息）组合在一起。
 *
 * 与 MaterialGraph 的关系:
 * - MaterialGraph: 纯数据结构（nodes + edges + canvas），描述"像素怎么算"
 * - MaterialAsset:  MaterialGraph + 元数据（id, name, tags, PBR, timestamps），描述"这是个什么材质"
 *
 * 导出格式兼容性:
 * - glTF 2.0 material:  从 pbr 字段映射到 glTF 的 pbrMetallicRoughness
 * - .pfmat (原生):      完整 MaterialAsset JSON（含 MaterialGraph，支持往返编辑）
 * - .mtl (Wavefront):   从 pbr 字段映射到传统 MTL 属性
 */

import type { MaterialGraph } from './types'
import type { JsonLiteral } from '@/shared/types'

// ============================================================================
// 1. PBR 材质参数（glTF 2.0 兼容）
// ============================================================================

/**
 * glTF 2.0 PBR 材质参数。
 *
 * 与 glTF 2.0 规范的 pbrMetallicRoughness 对齐:
 * https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-material-pbrmetallicroughness
 *
 * 这些参数可被 Blender / Maya / 3ds Max / Unity / Unreal 等主流 3D 软件直接读取。
 */
export interface PBRMaterialParams {
  /** 基础色 RGBA，范围 [0, 1]，对应 glTF baseColorFactor */
  baseColorFactor: [number, number, number, number]
  /** 金属度 [0, 1]，对应 glTF metallicFactor */
  metallicFactor: number
  /** 粗糙度 [0, 1]，对应 glTF roughnessFactor */
  roughnessFactor: number
  /** 自发光颜色 RGB，范围 [0, 1]，对应 glTF emissiveFactor */
  emissiveFactor: [number, number, number]
  /** 法线纹理缩放，对应 glTF normalTexture.scale */
  normalScale: number
  /** 环境光遮蔽强度，对应 glTF occlusionTexture.strength */
  occlusionStrength: number
  /** Alpha 模式: 'OPAQUE' | 'MASK' | 'BLEND'，对应 glTF alphaMode */
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND'
  /** Alpha 截断值，对应 glTF alphaCutoff */
  alphaCutoff: number
  /** 是否双面渲染，对应 glTF doubleSided */
  doubleSided: boolean
}

/**
 * 默认 PBR 参数（白色不透明金属度 0、粗糙度 0.5 的标准材质）。
 */
export const DEFAULT_PBR_PARAMS: PBRMaterialParams = {
  baseColorFactor: [1.0, 1.0, 1.0, 1.0],
  metallicFactor: 0.0,
  roughnessFactor: 0.5,
  emissiveFactor: [0.0, 0.0, 0.0],
  normalScale: 1.0,
  occlusionStrength: 1.0,
  alphaMode: 'OPAQUE',
  alphaCutoff: 0.5,
  doubleSided: false,
}

// ============================================================================
// 2. 材质纹理引用
// ============================================================================

/**
 * 材质纹理引用（glTF 兼容）。
 *
 * 描述材质中使用的纹理及其采样参数。
 * 与 glTF 2.0 的 textureInfo / normalTextureInfo / occlusionTextureInfo 对齐。
 */
export interface MaterialTextureRef {
  /** 纹理用途 */
  usage: 'baseColor' | 'metallicRoughness' | 'normal' | 'occlusion' | 'emissive'
  /** 纹理数据 URI（data:image/png;base64,...）或文件路径 */
  uri: string
  /** 纹理索引（在 glTF textures 数组中的位置，导出时填充） */
  texCoord: number
}

// ============================================================================
// 3. 材质资产
// ============================================================================

/**
 * 材质分类。
 */
export type MaterialCategory =
  | 'procedural'    // 程序化材质（由 MaterialGraph 生成）
  | 'pbr'           // PBR 标准材质（参数驱动）
  | 'stylized'      // 风格化材质
  | 'custom'        // 自定义

/**
 * 材质资产。
 *
 * 这是材质管理系统中的核心实体。
 * 每个 MaterialAsset 拥有全局唯一的 ID（由 materialId.ts 生成）。
 */
export interface MaterialAsset {
  /** 全局唯一 ID（格式: pfmat_<timestamp>_<uuid>） */
  id: string
  /** 用户可读名称 */
  name: string
  /** 分类 */
  category: MaterialCategory
  /** 用户标签（用于搜索和筛选） */
  tags: string[]
  /** 描述 */
  description: string
  /** 创建时间（ISO 8601 字符串） */
  createdAt: string
  /** 最后修改时间（ISO 8601 字符串） */
  modifiedAt: string
  /** 作者/来源 */
  author: string
  /** 版本号（语义化版本） */
  version: string
  /** PBR 参数（glTF 兼容，用于导出到主流 3D 软件） */
  pbr: PBRMaterialParams
  /** 纹理引用列表 */
  textures: MaterialTextureRef[]
  /** MaterialGraph（底层节点图，可为 null 表示纯 PBR 参数材质） */
  graph: MaterialGraph | null
  /** 缩略图 Data URI（可选，用于 UI 预览） */
  thumbnail: string | null
  /** 自定义元数据（扩展字段） */
  metadata: Record<string, JsonLiteral>
}

// ============================================================================
// 4. 工厂函数
// ============================================================================

/**
 * 创建一个新的材质资产。
 *
 * @param name 材质名称
 * @param options 部分字段覆盖
 * @returns 完整的 MaterialAsset
 */
export function createMaterialAsset(
  name: string,
  options?: Partial<Omit<MaterialAsset, 'id' | 'createdAt' | 'modifiedAt'>>,
): MaterialAsset {
  const now = new Date().toISOString()
  return {
    id: '', // 由 store 在添加时生成
    name,
    category: options?.category ?? 'procedural',
    tags: options?.tags ?? [],
    description: options?.description ?? '',
    createdAt: now,
    modifiedAt: now,
    author: options?.author ?? 'PixelForge',
    version: options?.version ?? '1.0.0',
    pbr: options?.pbr ?? { ...DEFAULT_PBR_PARAMS },
    textures: options?.textures ?? [],
    graph: options?.graph ?? null,
    thumbnail: options?.thumbnail ?? null,
    metadata: options?.metadata ?? {},
  }
}

/**
 * 更新材质资产的修改时间。
 */
export function touchMaterialAsset(asset: MaterialAsset): void {
  asset.modifiedAt = new Date().toISOString()
}

// ============================================================================
// 5. 导出格式枚举
// ============================================================================

/**
 * 支持的材质导出格式。
 */
export type MaterialExportFormat = 'gltf' | 'pfmat' | 'mtl'

/**
 * 导出格式的元信息。
 */
export interface MaterialExportFormatInfo {
  id: MaterialExportFormat
  label: string
  extension: string
  mimeType: string
  description: string
}

/**
 * 全部支持的导出格式。
 */
export const MATERIAL_EXPORT_FORMATS: MaterialExportFormatInfo[] = [
  {
    id: 'pfmat',
    label: 'PixelForge 材质 (.pfmat)',
    extension: '.pfmat',
    mimeType: 'application/json',
    description: '原生格式，保留完整节点图和元数据，支持往返编辑',
  },
  {
    id: 'gltf',
    label: 'glTF 2.0 材质 (.gltf)',
    extension: '.gltf',
    mimeType: 'application/json',
    description: 'glTF 2.0 标准 PBR 材质，兼容 Blender / Maya / 3ds Max / Unity / Unreal',
  },
  {
    id: 'mtl',
    label: 'Wavefront 材质 (.mtl)',
    extension: '.mtl',
    mimeType: 'text/plain',
    description: '传统 OBJ 材质格式，兼容几乎所有 3D 软件',
  },
]

/**
 * 根据格式 ID 获取格式信息。
 */
export function getExportFormatInfo(id: MaterialExportFormat): MaterialExportFormatInfo | undefined {
  return MATERIAL_EXPORT_FORMATS.find((f) => f.id === id)
}
