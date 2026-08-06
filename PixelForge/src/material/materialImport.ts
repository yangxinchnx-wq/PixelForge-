/**
 * Material Import — 材质导入逻辑。
 *
 * 支持三种导入格式:
 * 1. .pfmat  — PixelForge 原生格式（完整 MaterialAsset JSON，支持往返编辑）
 * 2. .gltf   — glTF 2.0 材质 JSON（PBR 参数，来自主流 3D 软件导出）
 * 3. .mtl    — Wavefront OBJ 材质（传统格式）
 *
 * 导入流程:
 *   文件内容 → 解析 → 校验 → 提取 PBR 参数 + 纹理 → 创建 MaterialAsset
 *
 * 与导出的关系:
 *   exportMaterial() 的逆操作，但导入时只提取 PBR 参数，
 *   MaterialGraph 在 .pfmat 格式下完整保留，在 .gltf/.mtl 格式下为 null。
 */

import type {
  MaterialAsset,
  MaterialCategory,
  MaterialTextureRef,
  PBRMaterialParams,
} from './materialAsset'
import { createMaterialAsset, DEFAULT_PBR_PARAMS } from './materialAsset'
import type { GLTFDocument, GLTFMaterial } from './materialExport'
import type { MaterialGraph } from './types'

// ============================================================================
// 1. 导入结果类型
// ============================================================================

/**
 * 自动检测的导入格式。
 */
export type MaterialImportFormat = 'pfmat' | 'gltf' | 'mtl' | 'unknown'

/**
 * 导入结果。
 */
export interface MaterialImportResult {
  /** 是否成功 */
  ok: boolean
  /** 导入的材质资产（ok=true 时有效） */
  asset?: MaterialAsset
  /** 检测到的格式 */
  format: MaterialImportFormat
  /** 错误信息（ok=false 时有效） */
  error?: string
  /** 警告信息 */
  warnings: string[]
}

// ============================================================================
// 2. 格式检测
// ============================================================================

/**
 * 根据文件名扩展名检测格式。
 */
export function detectFormatByExtension(filename: string): MaterialImportFormat {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pfmat') return 'pfmat'
  if (ext === 'gltf') return 'gltf'
  if (ext === 'glb') return 'gltf' // GLB 也按 glTF 处理（简化）
  if (ext === 'mtl') return 'mtl'
  return 'unknown'
}

/**
 * 根据文件内容自动检测格式。
 */
export function detectFormatByContent(content: string): MaterialImportFormat {
  const trimmed = content.trim()
  if (!trimmed) return 'unknown'

  // JSON 格式
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      // 检查是否为 .pfmat 格式
      if (parsed.format === 'pixelforge-material' && parsed.asset) {
        return 'pfmat'
      }
      // 检查是否为 glTF
      if (parsed.asset && parsed.asset.version === '2.0' && parsed.materials) {
        return 'gltf'
      }
      return 'unknown'
    } catch {
      return 'unknown'
    }
  }

  // MTL 格式（以 # 或 newmtl 开头）
  if (trimmed.startsWith('#') || /^newmtl\s/m.test(trimmed)) {
    return 'mtl'
  }

  return 'unknown'
}

// ============================================================================
// 3. .pfmat 导入
// ============================================================================

/**
 * 解析 .pfmat 原生格式。
 */
export function importFromPFMAT(content: string): MaterialImportResult {
  const warnings: string[] = []

  try {
    const parsed = JSON.parse(content)

    if (parsed.format !== 'pixelforge-material') {
      return { ok: false, format: 'pfmat', error: '不是合法的 .pfmat 格式（缺少 format 标识）', warnings }
    }

    if (!parsed.asset || typeof parsed.asset !== 'object') {
      return { ok: false, format: 'pfmat', error: '.pfmat 文件缺少 asset 字段', warnings }
    }

    const asset = parsed.asset as MaterialAsset

    // 校验必需字段
    if (!asset.name || typeof asset.name !== 'string') {
      return { ok: false, format: 'pfmat', error: '.pfmat 材质缺少 name 字段', warnings }
    }

    // 确保 PBR 参数完整
    asset.pbr = { ...DEFAULT_PBR_PARAMS, ...asset.pbr }

    // 确保 textures 数组存在
    if (!Array.isArray(asset.textures)) {
      asset.textures = []
    }

    // 确保 metadata 存在
    if (!asset.metadata || typeof asset.metadata !== 'object') {
      asset.metadata = {}
    }

    // 确保 tags 是数组
    if (!Array.isArray(asset.tags)) {
      asset.tags = []
    }

    // 清除 ID（让 store 生成新的）
    asset.id = ''

    // 更新导入时间
    asset.createdAt = new Date().toISOString()
    asset.modifiedAt = asset.createdAt

    return { ok: true, asset, format: 'pfmat', warnings }
  } catch (e) {
    return {
      ok: false,
      format: 'pfmat',
      error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`,
      warnings,
    }
  }
}

// ============================================================================
// 4. .gltf 导入
// ============================================================================

/**
 * 从 glTF 材质对象提取 PBR 参数。
 */
function gltfMaterialToPBR(mat: GLTFMaterial): PBRMaterialParams {
  const pbr = mat.pbrMetallicRoughness ?? {}

  return {
    baseColorFactor: pbr.baseColorFactor
      ? [...pbr.baseColorFactor] as [number, number, number, number]
      : [...DEFAULT_PBR_PARAMS.baseColorFactor] as [number, number, number, number],
    metallicFactor: typeof pbr.metallicFactor === 'number' ? pbr.metallicFactor : DEFAULT_PBR_PARAMS.metallicFactor,
    roughnessFactor: typeof pbr.roughnessFactor === 'number' ? pbr.roughnessFactor : DEFAULT_PBR_PARAMS.roughnessFactor,
    emissiveFactor: mat.emissiveFactor
      ? [...mat.emissiveFactor] as [number, number, number]
      : [...DEFAULT_PBR_PARAMS.emissiveFactor] as [number, number, number],
    normalScale: mat.normalTexture?.scale ?? DEFAULT_PBR_PARAMS.normalScale,
    occlusionStrength: mat.occlusionTexture?.strength ?? DEFAULT_PBR_PARAMS.occlusionStrength,
    alphaMode: mat.alphaMode ?? DEFAULT_PBR_PARAMS.alphaMode,
    alphaCutoff: mat.alphaCutoff ?? DEFAULT_PBR_PARAMS.alphaCutoff,
    doubleSided: mat.doubleSided ?? DEFAULT_PBR_PARAMS.doubleSided,
  }
}

/**
 * 从 glTF 文档提取纹理引用。
 */
function extractGLTFTextures(
  doc: GLTFDocument,
  mat: GLTFMaterial,
): MaterialTextureRef[] {
  const refs: MaterialTextureRef[] = []
  const textures = doc.textures ?? []
  const images = doc.images ?? []

  function addTexRef(
    texInfo: { index: number; texCoord?: number } | undefined,
    usage: MaterialTextureRef['usage'],
  ) {
    if (!texInfo) return
    const tex = textures[texInfo.index]
    if (!tex) return
    const img = images[tex.source]
    if (!img || !img.uri) return
    refs.push({
      usage,
      uri: img.uri,
      texCoord: texInfo.texCoord ?? 0,
    })
  }

  addTexRef(mat.pbrMetallicRoughness?.baseColorTexture, 'baseColor')
  addTexRef(mat.pbrMetallicRoughness?.metallicRoughnessTexture, 'metallicRoughness')
  addTexRef(mat.normalTexture, 'normal')
  addTexRef(mat.occlusionTexture, 'occlusion')
  addTexRef(mat.emissiveTexture, 'emissive')

  return refs
}

/**
 * 从 glTF extras 中提取元数据。
 */
function extractGLTFExtras(mat: GLTFMaterial): {
  tags: string[]
  description: string
  category: MaterialCategory
  originalId: string
} {
  const extras = (mat.extras ?? {}) as Record<string, unknown>
  const tags = Array.isArray(extras['pixelforge:tags']) ? extras['pixelforge:tags'] as string[] : []
  const description = typeof extras['pixelforge:description'] === 'string' ? extras['pixelforge:description'] : ''
  const category = (typeof extras['pixelforge:category'] === 'string' ? extras['pixelforge:category'] : 'pbr') as MaterialCategory
  const originalId = typeof extras['pixelforge:materialId'] === 'string' ? extras['pixelforge:materialId'] : ''
  return { tags, description, category, originalId }
}

/**
 * 解析 glTF 2.0 材质 JSON。
 *
 * 如果 glTF 文档包含多个材质，只导入第一个（返回第一个材质的 MaterialAsset）。
 * 调用者可以多次调用以导入所有材质。
 */
export function importFromGLTF(content: string, materialIndex: number = 0): MaterialImportResult {
  const warnings: string[] = []

  try {
    const doc = JSON.parse(content) as GLTFDocument

    if (!doc.asset || doc.asset.version !== '2.0') {
      return { ok: false, format: 'gltf', error: '不是合法的 glTF 2.0 文档（缺少 asset.version=2.0）', warnings }
    }

    if (!Array.isArray(doc.materials) || doc.materials.length === 0) {
      return { ok: false, format: 'gltf', error: 'glTF 文档不包含材质', warnings }
    }

    if (materialIndex >= doc.materials.length) {
      return { ok: false, format: 'gltf', error: `材质索引 ${materialIndex} 超出范围（共 ${doc.materials.length} 个材质）`, warnings }
    }

    const mat = doc.materials[materialIndex]
    const pbr = gltfMaterialToPBR(mat)
    const textures = extractGLTFTextures(doc, mat)
    const extras = extractGLTFExtras(mat)

    if (doc.materials.length > 1 && materialIndex === 0) {
      warnings.push(`glTF 文档包含 ${doc.materials.length} 个材质，仅导入了第 1 个`)
    }

    const asset = createMaterialAsset(mat.name || `glTF材质_${materialIndex + 1}`, {
      category: extras.category,
      tags: extras.tags,
      description: extras.description,
      pbr,
      textures,
      graph: null, // glTF 不包含节点图
      metadata: extras.originalId ? { originalMaterialId: extras.originalId } : {},
    })

    return { ok: true, asset, format: 'gltf', warnings }
  } catch (e) {
    return {
      ok: false,
      format: 'gltf',
      error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`,
      warnings,
    }
  }
}

/**
 * 获取 glTF 文档中的材质数量。
 */
export function countGLTFMaterials(content: string): number {
  try {
    const doc = JSON.parse(content) as GLTFDocument
    return Array.isArray(doc.materials) ? doc.materials.length : 0
  } catch {
    return 0
  }
}

// ============================================================================
// 5. .mtl 导入
// ============================================================================

/** MTL 材质块 */
interface MTLMaterialBlock {
  name: string
  properties: Map<string, string[]>
}

/**
 * 解析 .mtl 文件内容为材质块列表。
 */
function parseMTL(content: string): MTLMaterialBlock[] {
  const blocks: MTLMaterialBlock[] = []
  let current: MTLMaterialBlock | null = null

  const lines = content.split('\n')
  for (const rawLine of lines) {
    // 去除注释和首尾空白
    const hashIdx = rawLine.indexOf('#')
    const line = (hashIdx >= 0 ? rawLine.substring(0, hashIdx) : rawLine).trim()
    if (!line) continue

    const tokens = line.split(/\s+/)
    const key = tokens[0].toLowerCase()
    const values = tokens.slice(1)

    if (key === 'newmtl') {
      // 开始新材质块
      if (current) blocks.push(current)
      current = {
        name: values.join(' ') || 'unnamed',
        properties: new Map(),
      }
    } else if (current) {
      // 累积属性（同 key 可多次出现，保留最后一个或合并）
      current.properties.set(key, values)
    }
  }
  if (current) blocks.push(current)

  return blocks
}

/**
 * 将 MTL 材质块转换为 PBR 参数（近似映射）。
 */
function mtlBlockToPBR(block: MTLMaterialBlock): PBRMaterialParams {
  const get = (key: string): string[] | undefined => block.properties.get(key)

  // Kd (漫反射颜色)
  const kd = get('kd')
  const [r, g, b] = kd && kd.length >= 3
    ? [parseFloat(kd[0]), parseFloat(kd[1]), parseFloat(kd[2])]
    : [1, 1, 1]

  // Ks (镜面反射颜色) → metallic 近似
  const ks = get('ks')
  let metallic = 0.0
  if (ks && ks.length >= 3) {
    const ksAvg = (parseFloat(ks[0]) + parseFloat(ks[1]) + parseFloat(ks[2])) / 3
    metallic = ksAvg > 0.5 ? 1.0 : 0.0
  }

  // Ns (specular exponent) → roughness 近似
  const ns = get('ns')
  let roughness = 0.5
  if (ns && ns.length >= 1) {
    const nsVal = parseFloat(ns[0])
    roughness = Math.max(0, Math.min(1, 1 - nsVal / 1000))
  }

  // Ke (自发光)
  const ke = get('ke')
  const [er, eg, eb] = ke && ke.length >= 3
    ? [parseFloat(ke[0]), parseFloat(ke[1]), parseFloat(ke[2])]
    : [0, 0, 0]

  // d (透明度) / Tr (transparency)
  const d = get('d')
  const tr = get('tr')
  let alpha = 1.0
  if (d && d.length >= 1) {
    alpha = parseFloat(d[0])
  } else if (tr && tr.length >= 1) {
    alpha = 1 - parseFloat(tr[0])
  }

  const isTransparent = alpha < 1.0

  return {
    baseColorFactor: [r, g, b, alpha],
    metallicFactor: metallic,
    roughnessFactor: roughness,
    emissiveFactor: [er, eg, eb],
    normalScale: DEFAULT_PBR_PARAMS.normalScale,
    occlusionStrength: DEFAULT_PBR_PARAMS.occlusionStrength,
    alphaMode: isTransparent ? 'BLEND' : 'OPAQUE',
    alphaCutoff: DEFAULT_PBR_PARAMS.alphaCutoff,
    doubleSided: false,
  }
}

/**
 * 从 MTL 材质块提取纹理引用。
 */
function mtlBlockToTextures(block: MTLMaterialBlock): MaterialTextureRef[] {
  const refs: MaterialTextureRef[] = []
  const map = block.properties

  const mapping: Array<{ key: string; usage: MaterialTextureRef['usage'] }> = [
    { key: 'map_kd', usage: 'baseColor' },
    { key: 'map_bump', usage: 'normal' },
    { key: 'bump', usage: 'normal' },
    { key: 'map_ke', usage: 'emissive' },
    { key: 'map_pm', usage: 'metallicRoughness' },
    { key: 'map_ao', usage: 'occlusion' },
  ]

  for (const { key, usage } of mapping) {
    const vals = map.get(key)
    if (vals && vals.length >= 1) {
      refs.push({ usage, uri: vals[vals.length - 1], texCoord: 0 })
    }
  }

  return refs
}

/**
 * 解析 .mtl 材质文件。
 *
 * 如果 .mtl 包含多个材质，只导入第一个（返回第一个材质的 MaterialAsset）。
 */
export function importFromMTL(content: string, materialIndex: number = 0): MaterialImportResult {
  const warnings: string[] = []

  const blocks = parseMTL(content)
  if (blocks.length === 0) {
    return { ok: false, format: 'mtl', error: '.mtl 文件不包含任何材质（未找到 newmtl 声明）', warnings }
  }

  if (materialIndex >= blocks.length) {
    return { ok: false, format: 'mtl', error: `材质索引 ${materialIndex} 超出范围（共 ${blocks.length} 个材质）`, warnings }
  }

  if (blocks.length > 1 && materialIndex === 0) {
    warnings.push(`.mtl 文件包含 ${blocks.length} 个材质，仅导入了第 1 个`)
  }

  const block = blocks[materialIndex]
  const pbr = mtlBlockToPBR(block)
  const textures = mtlBlockToTextures(block)

  const asset = createMaterialAsset(block.name || `MTL材质_${materialIndex + 1}`, {
    category: 'pbr',
    tags: ['mtl-import'],
    description: `从 MTL 文件导入: ${block.name}`,
    pbr,
    textures,
    graph: null,
  })

  return { ok: true, asset, format: 'mtl', warnings }
}

/**
 * 获取 .mtl 文件中的材质数量。
 */
export function countMTLMaterials(content: string): number {
  return parseMTL(content).length
}

// ============================================================================
// 6. 统一导入入口
// ============================================================================

/**
 * 自动检测格式并导入材质。
 *
 * @param content 文件内容字符串
 * @param filename 文件名（用于辅助格式检测）
 * @param materialIndex 材质索引（glTF/.mtl 可包含多个材质，默认取第一个）
 * @returns 导入结果
 */
export function importMaterial(
  content: string,
  filename?: string,
  materialIndex: number = 0,
): MaterialImportResult {
  // 优先用扩展名检测
  let format: MaterialImportFormat = 'unknown'
  if (filename) {
    format = detectFormatByExtension(filename)
  }
  if (format === 'unknown') {
    format = detectFormatByContent(content)
  }

  switch (format) {
    case 'pfmat':
      return importFromPFMAT(content)
    case 'gltf':
      return importFromGLTF(content, materialIndex)
    case 'mtl':
      return importFromMTL(content, materialIndex)
    default:
      return {
        ok: false,
        format: 'unknown',
        error: `无法识别的材质文件格式${filename ? `: ${filename}` : ''}`,
        warnings: [],
      }
  }
}

/**
 * 从 File 对象读取文本内容。
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`))
    reader.readAsText(file)
  })
}

/**
 * 获取文件中的材质数量（用于批量导入提示）。
 */
export function countMaterialsInFile(content: string, filename?: string): number {
  let format: MaterialImportFormat = 'unknown'
  if (filename) {
    format = detectFormatByExtension(filename)
  }
  if (format === 'unknown') {
    format = detectFormatByContent(content)
  }

  switch (format) {
    case 'pfmat':
      return 1
    case 'gltf':
      return countGLTFMaterials(content)
    case 'mtl':
      return countMTLMaterials(content)
    default:
      return 0
  }
}
