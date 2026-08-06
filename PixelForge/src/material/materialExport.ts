/**
 * Material Export — 材质导出逻辑。
 *
 * 支持三种导出格式:
 * 1. .pfmat  — PixelForge 原生格式（完整 MaterialAsset JSON，支持往返编辑）
 * 2. .gltf   — glTF 2.0 材质 JSON（PBR 参数，兼容主流 3D 软件）
 * 3. .mtl    — Wavefront OBJ 材质（传统格式，广泛兼容）
 *
 * glTF 2.0 材质规范:
 *   https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-material
 *
 * MTL 规范:
 *   https://en.wikipedia.org/wiki/Wavefront_.obj_file#Material_template_library
 */

import type { MaterialAsset, MaterialExportFormat, PBRMaterialParams } from './materialAsset'
import { DEFAULT_PBR_PARAMS } from './materialAsset'

// ============================================================================
// 1. .pfmat — PixelForge 原生格式
// ============================================================================

/**
 * .pfmat 文件的 JSON 结构。
 */
export interface PFMATFile {
  /** 文件格式标识 */
  format: 'pixelforge-material'
  /** 格式版本 */
  formatVersion: string
  /** 导出时间 */
  exportedAt: string
  /** 材质资产（完整 MaterialAsset） */
  asset: MaterialAsset
}

/**
 * 导出为 .pfmat 原生格式 JSON 字符串。
 *
 * 保留完整的 MaterialAsset（含 MaterialGraph），支持往返编辑。
 *
 * @param asset 材质资产
 * @returns JSON 字符串
 */
export function exportToPFMAT(asset: MaterialAsset): string {
  const file: PFMATFile = {
    format: 'pixelforge-material',
    formatVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    asset: JSON.parse(JSON.stringify(asset)), // 深拷贝
  }
  return JSON.stringify(file, null, 2)
}

// ============================================================================
// 2. .gltf — glTF 2.0 材质格式
// ============================================================================

/**
 * glTF 2.0 材质对象（pbrMetallicRoughness 子集）。
 * 仅包含材质相关字段，不含 mesh/animation 等。
 */
export interface GLTFMaterial {
  name: string
  pbrMetallicRoughness: {
    baseColorFactor?: [number, number, number, number]
    metallicFactor?: number
    roughnessFactor?: number
    baseColorTexture?: {
      index: number
      texCoord?: number
    }
    metallicRoughnessTexture?: {
      index: number
      texCoord?: number
    }
  }
  normalTexture?: {
    index: number
    texCoord?: number
    scale?: number
  }
  occlusionTexture?: {
    index: number
    texCoord?: number
    strength?: number
  }
  emissiveTexture?: {
    index: number
    texCoord?: number
  }
  emissiveFactor?: [number, number, number]
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND'
  alphaCutoff?: number
  doubleSided?: boolean
  extensions?: Record<string, unknown>
  extras?: Record<string, unknown>
}

/**
 * glTF 2.0 纹理定义。
 */
export interface GLTFTexture {
  source: number
  sampler?: number
}

/**
 * glTF 2.0 图像定义。
 */
export interface GLTFImage {
  uri: string
  mimeType?: string
}

/**
 * glTF 2.0 采样器定义。
 */
export interface GLTFSampler {
  magFilter?: number
  minFilter?: number
  wrapS?: number
  wrapT?: number
}

/**
 * 简化版 glTF 2.0 文档（仅材质相关部分）。
 */
export interface GLTFDocument {
  asset: {
    version: string
    generator: string
    copyright?: string
  }
  materials: GLTFMaterial[]
  textures?: GLTFTexture[]
  images?: GLTFImage[]
  samplers?: GLTFSampler[]
  extensionsUsed?: string[]
}

/**
 * 将 PBR 参数转换为 glTF 材质对象。
 *
 * @param asset 材质资产
 * @param textureIndexMap 纹理用途 → glTF texture index 的映射（由调用者构建）
 * @returns glTF 材质对象
 */
function assetToGLTFMaterial(
  asset: MaterialAsset,
  textureIndexMap: Map<string, number>,
): GLTFMaterial {
  const pbr: PBRMaterialParams = asset.pbr ?? DEFAULT_PBR_PARAMS
  const material: GLTFMaterial = {
    name: asset.name,
    pbrMetallicRoughness: {
      baseColorFactor: [...pbr.baseColorFactor] as [number, number, number, number],
      metallicFactor: pbr.metallicFactor,
      roughnessFactor: pbr.roughnessFactor,
    },
    emissiveFactor: [...pbr.emissiveFactor] as [number, number, number],
    alphaMode: pbr.alphaMode,
    alphaCutoff: pbr.alphaMode === 'MASK' ? pbr.alphaCutoff : undefined,
    doubleSided: pbr.doubleSided,
    extras: {
      'pixelforge:materialId': asset.id,
      'pixelforge:category': asset.category,
      'pixelforge:tags': asset.tags,
      'pixelforge:description': asset.description,
    },
  }

  // 填充纹理引用
  const baseColorTex = textureIndexMap.get('baseColor')
  if (baseColorTex !== undefined) {
    material.pbrMetallicRoughness.baseColorTexture = { index: baseColorTex }
  }
  const mrTex = textureIndexMap.get('metallicRoughness')
  if (mrTex !== undefined) {
    material.pbrMetallicRoughness.metallicRoughnessTexture = { index: mrTex }
  }
  const normalTex = textureIndexMap.get('normal')
  if (normalTex !== undefined) {
    material.normalTexture = { index: normalTex, scale: pbr.normalScale }
  }
  const occlusionTex = textureIndexMap.get('occlusion')
  if (occlusionTex !== undefined) {
    material.occlusionTexture = { index: occlusionTex, strength: pbr.occlusionStrength }
  }
  const emissiveTex = textureIndexMap.get('emissive')
  if (emissiveTex !== undefined) {
    material.emissiveTexture = { index: emissiveTex }
  }

  return material
}

/**
 * 导出为 glTF 2.0 材质 JSON 字符串。
 *
 * 生成一个包含材质、纹理、图像定义的 glTF 2.0 文档。
 * 该文档可被 Blender / Maya / 3ds Max / Unity / Unreal 等主流 3D 软件导入。
 *
 * @param asset 材质资产
 * @returns glTF 2.0 JSON 字符串
 */
export function exportToGLTF(asset: MaterialAsset): string {
  // 收集纹理和图像
  const textures: GLTFTexture[] = []
  const images: GLTFImage[] = []
  const samplers: GLTFSampler[] = [
    { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }, // LINEAR / LINEAR_MIPMAP_LINEAR / REPEAT
  ]
  const textureIndexMap = new Map<string, number>()

  for (const texRef of asset.textures) {
    const imageIndex = images.length
    images.push({
      uri: texRef.uri,
      mimeType: texRef.uri.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
    })
    const textureIndex = textures.length
    textures.push({
      source: imageIndex,
      sampler: 0,
    })
    textureIndexMap.set(texRef.usage, textureIndex)
  }

  const material = assetToGLTFMaterial(asset, textureIndexMap)

  const doc: GLTFDocument = {
    asset: {
      version: '2.0',
      generator: 'PixelForge Material Exporter',
      copyright: `© ${new Date().getFullYear()} ${asset.author}`,
    },
    materials: [material],
  }

  // 仅在有纹理时添加纹理相关数组
  if (textures.length > 0) {
    doc.textures = textures
    doc.images = images
    doc.samplers = samplers
  }

  return JSON.stringify(doc, null, 2)
}

// ============================================================================
// 3. .mtl — Wavefront OBJ 材质格式
// ============================================================================

/**
 * 导出为 Wavefront .mtl 材质字符串。
 *
 * MTL 是传统 OBJ 材质格式，被几乎所有 3D 软件支持。
 * 它使用 Phong 光照模型，我们将 PBR 参数映射到最接近的 MTL 属性。
 *
 * 映射关系:
 * - baseColorFactor  → Kd (漫反射颜色)
 * - metallicFactor   → Km (镜面反射系数, 近似)
 * - roughnessFactor  → Ns ( specular exponent = (1 - roughness) * 1000 )
 * - emissiveFactor   → Ke (自发光颜色)
 * - alphaMode        → illum / d (透明度)
 *
 * @param asset 材质资产
 * @returns .mtl 格式字符串
 */
export function exportToMTL(asset: MaterialAsset): string {
  const pbr: PBRMaterialParams = asset.pbr ?? DEFAULT_PBR_PARAMS
  const [r, g, b] = pbr.baseColorFactor

  // specular exponent: roughness 0 → Ns=1000 (镜面), roughness 1 → Ns=1 (粗糙)
  const ns = Math.max(1, Math.round((1 - pbr.roughnessFactor) * 1000))

  // specular color: 金属度高时接近基色,非金属时接近白色
  const metallic = pbr.metallicFactor
  const ksR = r * metallic + (1 - metallic) * 0.04
  const ksG = g * metallic + (1 - metallic) * 0.04
  const ksB = b * metallic + (1 - metallic) * 0.04

  // emissive
  const [er, eg, eb] = pbr.emissiveFactor

  // alpha / transparency
  const alpha = pbr.baseColorFactor[3]
  const isTransparent = pbr.alphaMode !== 'OPAQUE' || alpha < 1.0

  // illumination model:
  // 0 - Color on and Ambient off
  // 1 - Color on and Ambient on
  // 2 - Highlight on
  // 3 - Reflection on and Ray trace on
  // 5 - Reflection on and Ray trace off
  // 7 - Reflection on and Ray trace on + Transparency
  const illum = isTransparent ? 7 : 2

  const lines: string[] = [
    '# PixelForge Material Export',
    `# Material ID: ${asset.id}`,
    `# Category: ${asset.category}`,
    `# Exported: ${new Date().toISOString()}`,
    '',
    f`newmtl ${sanitizeMTLName(asset.name)}`,
    '',
    f`Ka ${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`,
    f`Kd ${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`,
    f`Ks ${ksR.toFixed(6)} ${ksG.toFixed(6)} ${ksB.toFixed(6)}`,
    f`Ke ${er.toFixed(6)} ${eg.toFixed(6)} ${eb.toFixed(6)}`,
    f`Ns ${ns}`,
    f`Ni 1.0`,
    f`d ${alpha.toFixed(6)}`,
    f`illum ${illum}`,
  ]

  // 添加纹理映射注释
  for (const texRef of asset.textures) {
    const mtlKey = texRef.usage === 'baseColor' ? 'map_Kd'
      : texRef.usage === 'normal' ? 'map_Bump' // or 'norm'
      : texRef.usage === 'emissive' ? 'map_Ke'
      : texRef.usage === 'metallicRoughness' ? 'map_Pm' // 非标准但部分软件支持
      : texRef.usage === 'occlusion' ? 'map_Ao' // 非标准
      : null
    if (mtlKey) {
      lines.push(f`${mtlKey} ${texRef.uri}`)
    }
  }

  return lines.join('\n') + '\n'
}

/** 标签化字符串模板（简化版，避免反引号嵌套问题） */
function f(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ''), '')
}

/**
 * 清理 MTL 材质名（保留字母、数字、下划线和 Unicode 字符如中文）。
 *
 * 现代主流 3D 软件（Blender / Maya / 3ds Max）均支持 Unicode 材质名,
 * 因此保留 CJK / 拉丁 / 西里尔等 Unicode 字母，仅去除空格和特殊符号。
 */
function sanitizeMTLName(name: string): string {
  // 保留 Unicode 字母、数字、下划线、连字符；其余替换为下划线
  const sanitized = name.replace(/[\s\p{P}\p{S}]/gu, '_')
  return sanitized || 'unnamed_material'
}

// ============================================================================
// 4. 统一导出入口
// ============================================================================

/**
 * 导出结果。
 */
export interface MaterialExportResult {
  /** 文件名（含扩展名） */
  filename: string
  /** MIME 类型 */
  mimeType: string
  /** 文件内容字符串 */
  content: string
  /** 导出格式 */
  format: MaterialExportFormat
}

/**
 * 导出材质资产到指定格式。
 *
 * @param asset 材质资产
 * @param format 导出格式
 * @returns 导出结果
 */
export function exportMaterial(
  asset: MaterialAsset,
  format: MaterialExportFormat,
): MaterialExportResult {
  const extensionMap: Record<MaterialExportFormat, string> = {
    pfmat: '.pfmat',
    gltf: '.gltf',
    mtl: '.mtl',
  }
  const mimeMap: Record<MaterialExportFormat, string> = {
    pfmat: 'application/json',
    gltf: 'application/json',
    mtl: 'text/plain',
  }

  let content: string
  switch (format) {
    case 'pfmat':
      content = exportToPFMAT(asset)
      break
    case 'gltf':
      content = exportToGLTF(asset)
      break
    case 'mtl':
      content = exportToMTL(asset)
      break
    default:
      throw new Error(`不支持的导出格式: ${format}`)
  }

  const baseName = asset.name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_') || 'material'
  return {
    filename: `${baseName}${extensionMap[format]}`,
    mimeType: mimeMap[format],
    content,
    format,
  }
}

/**
 * 将导出结果转为 Blob。
 */
export function exportResultToBlob(result: MaterialExportResult): Blob {
  return new Blob([result.content], { type: result.mimeType })
}
