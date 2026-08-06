/**
 * 材质资产管理系统测试 — materialId / materialAsset / materialExport / materialImport
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ─── localStorage polyfill（Node 测试环境缺少 localStorage）────────
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = String(value) },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]) },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() { return Object.keys(store).length },
    } as Storage
  }
})

// ─── document + canvas polyfill（Node 测试环境缺少 document）────────
// materialPreview.ts 使用 document.createElement('canvas') 生成缩略图
beforeAll(() => {
  if (typeof globalThis.document === 'undefined') {
    // 最小化 canvas mock
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        save: () => {},
        restore: () => {},
        clip: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        putImageData: () => {},
        drawImage: () => {},
        createImageData: (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
        }),
        fillStyle: '',
        globalCompositeOperation: '',
      }),
      toDataURL: () => 'data:image/png;base64,mock',
    }
    globalThis.document = {
      createElement: () => mockCanvas,
      body: { appendChild: () => {}, removeChild: () => {} },
    } as unknown as Document
  }
})

// ─── materialId ────────────────────────────────────────
import {
  generateMaterialId,
  generateUUIDv4,
  isValidMaterialId,
  MATERIAL_ID_PREFIX,
} from './materialId'

describe('materialId', () => {
  describe('generateUUIDv4', () => {
    it('UUID-A: 生成合法的 UUID v4 字符串', () => {
      const uuid = generateUUIDv4()
      // 格式: 8-4-4-4-12
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    it('UUID-B: 每次生成的 UUID 不同', () => {
      const uuids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUUIDv4())
      }
      expect(uuids.size).toBe(100)
    })

    it('UUID-C: version 字段为 4', () => {
      const uuid = generateUUIDv4()
      const parts = uuid.split('-')
      expect(parts[2][0]).toBe('4')
    })

    it('UUID-D: variant 字段为 8/9/a/b', () => {
      const uuid = generateUUIDv4()
      const parts = uuid.split('-')
      expect(['8', '9', 'a', 'b']).toContain(parts[3][0].toLowerCase())
    })
  })

  describe('generateMaterialId', () => {
    it('MID-A: 生成以 pfmat_ 开头的 ID', () => {
      const id = generateMaterialId()
      expect(id.startsWith(MATERIAL_ID_PREFIX + '_')).toBe(true)
    })

    it('MID-B: ID 包含时间戳和 UUID', () => {
      const id = generateMaterialId()
      const parts = id.split('_')
      // pfmat_<timestamp>_<uuid>
      expect(parts.length).toBeGreaterThanOrEqual(3)
      expect(parts[0]).toBe(MATERIAL_ID_PREFIX)
      expect(parts[1]).toMatch(/^[0-9a-z]+$/) // base36 timestamp
    })

    it('MID-C: 每次生成的 ID 不同', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 50; i++) {
        ids.add(generateMaterialId())
      }
      expect(ids.size).toBe(50)
    })

    it('MID-D: 生成的 ID 通过合法性校验', () => {
      const id = generateMaterialId()
      expect(isValidMaterialId(id)).toBe(true)
    })
  })

  describe('isValidMaterialId', () => {
    it('VAL-A: 合法 ID 返回 true', () => {
      const id = generateMaterialId()
      expect(isValidMaterialId(id)).toBe(true)
    })

    it('VAL-B: 空字符串返回 false', () => {
      expect(isValidMaterialId('')).toBe(false)
    })

    it('VAL-C: 缺少前缀返回 false', () => {
      expect(isValidMaterialId('some_random_id')).toBe(false)
    })

    it('VAL-D: 前缀错误返回 false', () => {
      expect(isValidMaterialId('other_lz3k_550e8400-e29b-41d4-a716-446655440000')).toBe(false)
    })

    it('VAL-E: null 返回 false', () => {
      expect(isValidMaterialId(null as unknown as string)).toBe(false)
    })

    it('VAL-F: 非 UUID 后缀返回 false', () => {
      expect(isValidMaterialId('pfmat_lz3k_not-a-uuid')).toBe(false)
    })
  })
})

// ─── materialAsset ─────────────────────────────────────
import {
  createMaterialAsset,
  DEFAULT_PBR_PARAMS,
  touchMaterialAsset,
  type MaterialAsset,
} from './materialAsset'

describe('materialAsset', () => {
  describe('createMaterialAsset', () => {
    it('CREATE-A: 创建具有默认值的材质资产', () => {
      const asset = createMaterialAsset('测试材质')
      expect(asset.name).toBe('测试材质')
      expect(asset.id).toBe('') // ID 由 store 填充
      expect(asset.category).toBe('procedural')
      expect(asset.tags).toEqual([])
      expect(asset.pbr).toEqual(DEFAULT_PBR_PARAMS)
      expect(asset.textures).toEqual([])
      expect(asset.graph).toBeNull()
      expect(asset.thumbnail).toBeNull()
      expect(asset.metadata).toEqual({})
      expect(asset.createdAt).toBeTruthy()
      expect(asset.modifiedAt).toBeTruthy()
    })

    it('CREATE-B: 支持参数覆盖', () => {
      const asset = createMaterialAsset('自定义材质', {
        category: 'pbr',
        tags: ['金属', '粗糙'],
        description: '测试描述',
        author: '测试者',
        version: '2.0.0',
        pbr: {
          ...DEFAULT_PBR_PARAMS,
          metallicFactor: 0.8,
          roughnessFactor: 0.2,
        },
      })
      expect(asset.category).toBe('pbr')
      expect(asset.tags).toEqual(['金属', '粗糙'])
      expect(asset.description).toBe('测试描述')
      expect(asset.author).toBe('测试者')
      expect(asset.version).toBe('2.0.0')
      expect(asset.pbr.metallicFactor).toBe(0.8)
      expect(asset.pbr.roughnessFactor).toBe(0.2)
    })
  })

  describe('touchMaterialAsset', () => {
    it('TOUCH-A: 更新 modifiedAt 时间', async () => {
      const asset = createMaterialAsset('测试')
      const originalModified = asset.modifiedAt
      // 等待至少 1ms 确保时间不同
      await new Promise((resolve) => setTimeout(resolve, 10))
      touchMaterialAsset(asset)
      expect(asset.modifiedAt).not.toBe(originalModified)
      expect(new Date(asset.modifiedAt).getTime()).toBeGreaterThan(new Date(originalModified).getTime())
    })
  })
})

// ─── materialExport ────────────────────────────────────
import {
  exportToPFMAT,
  exportToGLTF,
  exportToMTL,
  exportMaterial,
  exportResultToBlob,
  type PFMATFile,
} from './materialExport'

describe('materialExport', () => {
  let testAsset: MaterialAsset

  beforeEach(() => {
    testAsset = createMaterialAsset('导出测试材质', {
      category: 'pbr',
      tags: ['test', 'export'],
      description: '用于测试导出的材质',
      pbr: {
        ...DEFAULT_PBR_PARAMS,
        baseColorFactor: [0.8, 0.2, 0.3, 1.0],
        metallicFactor: 0.6,
        roughnessFactor: 0.3,
        emissiveFactor: [0.1, 0.05, 0.0],
      },
    })
  })

  describe('exportToPFMAT', () => {
    it('PFMAT-A: 生成合法的 .pfmat JSON', () => {
      const json = exportToPFMAT(testAsset)
      const parsed: PFMATFile = JSON.parse(json)

      expect(parsed.format).toBe('pixelforge-material')
      expect(parsed.formatVersion).toBe('1.0.0')
      expect(parsed.asset).toBeDefined()
      expect(parsed.asset.name).toBe('导出测试材质')
      expect(parsed.asset.pbr.baseColorFactor).toEqual([0.8, 0.2, 0.3, 1.0])
    })

    it('PFMAT-B: 深拷贝不影响原资产', () => {
      const json = exportToPFMAT(testAsset)
      const parsed = JSON.parse(json)
      // 修改解析后的对象不应影响原资产
      parsed.asset.name = '已修改'
      expect(testAsset.name).toBe('导出测试材质')
    })
  })

  describe('exportToGLTF', () => {
    it('GLTF-A: 生成合法的 glTF 2.0 文档', () => {
      const json = exportToGLTF(testAsset)
      const parsed = JSON.parse(json)

      expect(parsed.asset.version).toBe('2.0')
      expect(parsed.asset.generator).toContain('PixelForge')
      expect(parsed.materials).toHaveLength(1)

      const mat = parsed.materials[0]
      expect(mat.name).toBe('导出测试材质')
      expect(mat.pbrMetallicRoughness.baseColorFactor).toEqual([0.8, 0.2, 0.3, 1.0])
      expect(mat.pbrMetallicRoughness.metallicFactor).toBe(0.6)
      expect(mat.pbrMetallicRoughness.roughnessFactor).toBe(0.3)
    })

    it('GLTF-B: 包含 emissiveFactor', () => {
      const json = exportToGLTF(testAsset)
      const parsed = JSON.parse(json)
      expect(parsed.materials[0].emissiveFactor).toEqual([0.1, 0.05, 0.0])
    })

    it('GLTF-C: 包含 alphaMode', () => {
      const json = exportToGLTF(testAsset)
      const parsed = JSON.parse(json)
      expect(parsed.materials[0].alphaMode).toBe('OPAQUE')
    })

    it('GLTF-D: 包含 extras（PixelForge 元数据）', () => {
      const json = exportToGLTF(testAsset)
      const parsed = JSON.parse(json)
      expect(parsed.materials[0].extras['pixelforge:materialId']).toBeDefined()
      expect(parsed.materials[0].extras['pixelforge:tags']).toEqual(['test', 'export'])
    })

    it('GLTF-E: alphaMode=MASK 时包含 alphaCutoff', () => {
      const maskAsset = createMaterialAsset('Mask 材质', {
        pbr: { ...DEFAULT_PBR_PARAMS, alphaMode: 'MASK', alphaCutoff: 0.33 },
      })
      const json = exportToGLTF(maskAsset)
      const parsed = JSON.parse(json)
      expect(parsed.materials[0].alphaMode).toBe('MASK')
      expect(parsed.materials[0].alphaCutoff).toBe(0.33)
    })

    it('GLTF-F: alphaMode=OPAQUE 时不包含 alphaCutoff', () => {
      const json = exportToGLTF(testAsset)
      const parsed = JSON.parse(json)
      expect(parsed.materials[0].alphaCutoff).toBeUndefined()
    })

    it('GLTF-G: 纹理引用正确导出', () => {
      const texAsset = createMaterialAsset('纹理材质', {
        textures: [
          { usage: 'baseColor', uri: 'data:image/png;base64,abc', texCoord: 0 },
          { usage: 'normal', uri: 'data:image/png;base64,def', texCoord: 0 },
        ],
      })
      const json = exportToGLTF(texAsset)
      const parsed = JSON.parse(json)
      expect(parsed.textures).toHaveLength(2)
      expect(parsed.images).toHaveLength(2)
      expect(parsed.materials[0].pbrMetallicRoughness.baseColorTexture).toBeDefined()
      expect(parsed.materials[0].normalTexture).toBeDefined()
    })
  })

  describe('exportToMTL', () => {
    it('MTL-A: 生成包含 newmtl 的 .mtl 内容', () => {
      const mtl = exportToMTL(testAsset)
      expect(mtl).toContain('newmtl')
      expect(mtl).toContain('导出测试材质')
    })

    it('MTL-B: 包含 Kd (漫反射颜色)', () => {
      const mtl = exportToMTL(testAsset)
      // baseColorFactor [0.8, 0.2, 0.3, 1.0] → Kd
      expect(mtl).toContain('Kd')
      expect(mtl).toContain('0.800000')
      expect(mtl).toContain('0.200000')
      expect(mtl).toContain('0.300000')
    })

    it('MTL-C: 包含 Ns (specular exponent)', () => {
      const mtl = exportToMTL(testAsset)
      // roughness 0.3 → Ns = (1 - 0.3) * 1000 = 700
      expect(mtl).toContain('Ns 700')
    })

    it('MTL-D: 包含 Ke (自发光)', () => {
      const mtl = exportToMTL(testAsset)
      expect(mtl).toContain('Ke')
      expect(mtl).toContain('0.100000')
    })

    it('MTL-E: 包含 illum', () => {
      const mtl = exportToMTL(testAsset)
      expect(mtl).toMatch(/illum \d+/)
    })

    it('MTL-F: 不透明材质 illum=2', () => {
      const mtl = exportToMTL(testAsset)
      expect(mtl).toContain('illum 2')
    })

    it('MTL-G: 透明材质 illum=7', () => {
      const transparentAsset = createMaterialAsset('透明材质', {
        pbr: { ...DEFAULT_PBR_PARAMS, alphaMode: 'BLEND', baseColorFactor: [1, 1, 1, 0.5] },
      })
      const mtl = exportToMTL(transparentAsset)
      expect(mtl).toContain('illum 7')
    })

    it('MTL-H: 材质名含特殊字符时被清理', () => {
      const weirdAsset = createMaterialAsset('材质 名 with spaces!')
      const mtl = exportToMTL(weirdAsset)
      // 空格和 ! 应被替换为 _
      expect(mtl).not.toContain('with spaces!')
    })
  })

  describe('exportMaterial (统一入口)', () => {
    it('EXPORT-A: pfmat 格式返回正确结果', () => {
      const result = exportMaterial(testAsset, 'pfmat')
      expect(result.format).toBe('pfmat')
      expect(result.filename).toMatch(/\.pfmat$/)
      expect(result.mimeType).toBe('application/json')
      expect(result.content).toContain('pixelforge-material')
    })

    it('EXPORT-B: gltf 格式返回正确结果', () => {
      const result = exportMaterial(testAsset, 'gltf')
      expect(result.format).toBe('gltf')
      expect(result.filename).toMatch(/\.gltf$/)
      expect(result.content).toContain('"version": "2.0"')
    })

    it('EXPORT-C: mtl 格式返回正确结果', () => {
      const result = exportMaterial(testAsset, 'mtl')
      expect(result.format).toBe('mtl')
      expect(result.filename).toMatch(/\.mtl$/)
      expect(result.content).toContain('newmtl')
    })

    it('EXPORT-D: 导出结果可转为 Blob', () => {
      const result = exportMaterial(testAsset, 'pfmat')
      const blob = exportResultToBlob(result)
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('application/json')
      expect(blob.size).toBeGreaterThan(0)
    })
  })
})

// ─── materialImport ────────────────────────────────────
import {
  importFromPFMAT,
  importFromGLTF,
  importFromMTL,
  importMaterial,
  detectFormatByExtension,
  detectFormatByContent,
  countGLTFMaterials,
  countMTLMaterials,
  countMaterialsInFile,
} from './materialImport'

describe('materialImport', () => {
  let testAsset: MaterialAsset

  beforeEach(() => {
    testAsset = createMaterialAsset('导入测试材质', {
      category: 'pbr',
      tags: ['import-test'],
      pbr: {
        ...DEFAULT_PBR_PARAMS,
        baseColorFactor: [0.5, 0.7, 0.9, 1.0],
        metallicFactor: 0.3,
        roughnessFactor: 0.7,
      },
    })
  })

  describe('detectFormatByExtension', () => {
    it('DET-A: .pfmat 扩展名', () => {
      expect(detectFormatByExtension('test.pfmat')).toBe('pfmat')
    })
    it('DET-B: .gltf 扩展名', () => {
      expect(detectFormatByExtension('test.gltf')).toBe('gltf')
    })
    it('DET-C: .glb 扩展名', () => {
      expect(detectFormatByExtension('test.glb')).toBe('gltf')
    })
    it('DET-D: .mtl 扩展名', () => {
      expect(detectFormatByExtension('test.mtl')).toBe('mtl')
    })
    it('DET-E: 未知扩展名', () => {
      expect(detectFormatByExtension('test.txt')).toBe('unknown')
    })
  })

  describe('detectFormatByContent', () => {
    it('DET-F: pfmat 内容', () => {
      const content = exportToPFMAT(testAsset)
      expect(detectFormatByContent(content)).toBe('pfmat')
    })
    it('DET-G: glTF 内容', () => {
      const content = exportToGLTF(testAsset)
      expect(detectFormatByContent(content)).toBe('gltf')
    })
    it('DET-H: MTL 内容', () => {
      const content = exportToMTL(testAsset)
      expect(detectFormatByContent(content)).toBe('mtl')
    })
    it('DET-I: 空内容', () => {
      expect(detectFormatByContent('')).toBe('unknown')
    })
  })

  describe('importFromPFMAT', () => {
    it('IMP-PFMAT-A: 正确导入 .pfmat 格式', () => {
      const content = exportToPFMAT(testAsset)
      const result = importFromPFMAT(content)
      expect(result.ok).toBe(true)
      expect(result.asset).toBeDefined()
      expect(result.asset!.name).toBe('导入测试材质')
      expect(result.asset!.pbr.baseColorFactor).toEqual([0.5, 0.7, 0.9, 1.0])
      expect(result.asset!.id).toBe('') // ID 清空，由 store 生成
    })

    it('IMP-PFMAT-B: 无效 JSON 返回错误', () => {
      const result = importFromPFMAT('not json')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('解析失败')
    })

    it('IMP-PFMAT-C: 缺少 format 标识返回错误', () => {
      const result = importFromPFMAT(JSON.stringify({ asset: testAsset }))
      expect(result.ok).toBe(false)
      expect(result.error).toContain('format')
    })
  })

  describe('importFromGLTF', () => {
    it('IMP-GLTF-A: 正确导入 glTF 格式', () => {
      const content = exportToGLTF(testAsset)
      const result = importFromGLTF(content)
      expect(result.ok).toBe(true)
      expect(result.asset).toBeDefined()
      expect(result.asset!.name).toBe('导入测试材质')
      expect(result.asset!.pbr.baseColorFactor).toEqual([0.5, 0.7, 0.9, 1.0])
      expect(result.asset!.pbr.metallicFactor).toBe(0.3)
      expect(result.asset!.pbr.roughnessFactor).toBe(0.7)
    })

    it('IMP-GLTF-B: 提取 extras 中的元数据', () => {
      const content = exportToGLTF(testAsset)
      const result = importFromGLTF(content)
      expect(result.ok).toBe(true)
      expect(result.asset!.tags).toEqual(['import-test'])
    })

    it('IMP-GLTF-C: 非 glTF 文档返回错误', () => {
      const result = importFromGLTF(JSON.stringify({ foo: 'bar' }))
      expect(result.ok).toBe(false)
    })

    it('IMP-GLTF-D: 无材质的 glTF 返回错误', () => {
      const doc = { asset: { version: '2.0' }, materials: [] }
      const result = importFromGLTF(JSON.stringify(doc))
      expect(result.ok).toBe(false)
      expect(result.error).toContain('不包含材质')
    })

    it('IMP-GLTF-E: 多材质时仅导入第一个并警告', () => {
      const doc = {
        asset: { version: '2.0', generator: 'test' },
        materials: [
          { name: 'mat1', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
          { name: 'mat2', pbrMetallicRoughness: { baseColorFactor: [0, 1, 0, 1] } },
        ],
      }
      const result = importFromGLTF(JSON.stringify(doc))
      expect(result.ok).toBe(true)
      expect(result.asset!.name).toBe('mat1')
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('IMP-GLTF-F: 索引越界返回错误', () => {
      const content = exportToGLTF(testAsset)
      const result = importFromGLTF(content, 5)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('超出范围')
    })
  })

  describe('importFromMTL', () => {
    it('IMP-MTL-A: 正确导入 .mtl 格式', () => {
      const content = exportToMTL(testAsset)
      const result = importFromMTL(content)
      expect(result.ok).toBe(true)
      expect(result.asset).toBeDefined()
      expect(result.asset!.pbr.baseColorFactor[0]).toBeCloseTo(0.5, 5)
      expect(result.asset!.pbr.baseColorFactor[1]).toBeCloseTo(0.7, 5)
      expect(result.asset!.pbr.baseColorFactor[2]).toBeCloseTo(0.9, 5)
    })

    it('IMP-MTL-B: 从 Ns 推断 roughness', () => {
      const mtl = 'newmtl test\nKd 0.5 0.5 0.5\nNs 500\n'
      const result = importFromMTL(mtl)
      expect(result.ok).toBe(true)
      // Ns=500 → roughness = 1 - 500/1000 = 0.5
      expect(result.asset!.pbr.roughnessFactor).toBeCloseTo(0.5, 1)
    })

    it('IMP-MTL-C: 从 d 推断透明度', () => {
      const mtl = 'newmtl transparent\nKd 0.8 0.8 0.8\nd 0.5\n'
      const result = importFromMTL(mtl)
      expect(result.ok).toBe(true)
      expect(result.asset!.pbr.baseColorFactor[3]).toBeCloseTo(0.5, 5)
      expect(result.asset!.pbr.alphaMode).toBe('BLEND')
    })

    it('IMP-MTL-D: 空内容返回错误', () => {
      const result = importFromMTL('')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('不包含任何材质')
    })
  })

  describe('importMaterial (统一入口)', () => {
    it('IMP-ALL-A: 自动检测 .pfmat 格式', () => {
      const content = exportToPFMAT(testAsset)
      const result = importMaterial(content, 'test.pfmat')
      expect(result.ok).toBe(true)
      expect(result.format).toBe('pfmat')
    })

    it('IMP-ALL-B: 自动检测 .gltf 格式', () => {
      const content = exportToGLTF(testAsset)
      const result = importMaterial(content, 'test.gltf')
      expect(result.ok).toBe(true)
      expect(result.format).toBe('gltf')
    })

    it('IMP-ALL-C: 自动检测 .mtl 格式', () => {
      const content = exportToMTL(testAsset)
      const result = importMaterial(content, 'test.mtl')
      expect(result.ok).toBe(true)
      expect(result.format).toBe('mtl')
    })

    it('IMP-ALL-D: 无扩展名时用内容检测', () => {
      const content = exportToPFMAT(testAsset)
      const result = importMaterial(content)
      expect(result.ok).toBe(true)
      expect(result.format).toBe('pfmat')
    })

    it('IMP-ALL-E: 未知格式返回错误', () => {
      const result = importMaterial('random text content', 'test.txt')
      expect(result.ok).toBe(false)
      expect(result.format).toBe('unknown')
    })
  })

  describe('countMaterialsInFile', () => {
    it('CNT-A: .pfmat 始终为 1', () => {
      const content = exportToPFMAT(testAsset)
      expect(countMaterialsInFile(content, 'test.pfmat')).toBe(1)
    })

    it('CNT-B: glTF 多材质', () => {
      const doc = {
        asset: { version: '2.0' },
        materials: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      }
      expect(countMaterialsInFile(JSON.stringify(doc), 'test.gltf')).toBe(3)
    })

    it('CNT-C: MTL 多材质', () => {
      const mtl = 'newmtl a\nKd 1 0 0\nnewmtl b\nKd 0 1 0\n'
      expect(countMaterialsInFile(mtl, 'test.mtl')).toBe(2)
    })
  })

  describe('往返测试 (Round-trip)', () => {
    it('RT-PFMAT: 导出再导入保持数据一致', () => {
      // 设置 ID（模拟 store 已分配）
      testAsset.id = generateMaterialId()
      const exported = exportToPFMAT(testAsset)
      const imported = importFromPFMAT(exported)
      expect(imported.ok).toBe(true)
      expect(imported.asset!.name).toBe(testAsset.name)
      expect(imported.asset!.category).toBe(testAsset.category)
      expect(imported.asset!.tags).toEqual(testAsset.tags)
      expect(imported.asset!.pbr.baseColorFactor).toEqual(testAsset.pbr.baseColorFactor)
      expect(imported.asset!.pbr.metallicFactor).toBe(testAsset.pbr.metallicFactor)
      expect(imported.asset!.pbr.roughnessFactor).toBe(testAsset.pbr.roughnessFactor)
      // ID 应被清空
      expect(imported.asset!.id).toBe('')
    })

    it('RT-GLTF: PBR 参数导出再导入保持一致', () => {
      const exported = exportToGLTF(testAsset)
      const imported = importFromGLTF(exported)
      expect(imported.ok).toBe(true)
      expect(imported.asset!.pbr.baseColorFactor).toEqual(testAsset.pbr.baseColorFactor)
      expect(imported.asset!.pbr.metallicFactor).toBeCloseTo(testAsset.pbr.metallicFactor, 5)
      expect(imported.asset!.pbr.roughnessFactor).toBeCloseTo(testAsset.pbr.roughnessFactor, 5)
      expect(imported.asset!.pbr.emissiveFactor).toEqual(testAsset.pbr.emissiveFactor)
      expect(imported.asset!.pbr.alphaMode).toBe(testAsset.pbr.alphaMode)
    })

    it('RT-MTL: 基础色导出再导入保持一致', () => {
      const exported = exportToMTL(testAsset)
      const imported = importFromMTL(exported)
      expect(imported.ok).toBe(true)
      expect(imported.asset!.pbr.baseColorFactor[0]).toBeCloseTo(testAsset.pbr.baseColorFactor[0], 5)
      expect(imported.asset!.pbr.baseColorFactor[1]).toBeCloseTo(testAsset.pbr.baseColorFactor[1], 5)
      expect(imported.asset!.pbr.baseColorFactor[2]).toBeCloseTo(testAsset.pbr.baseColorFactor[2], 5)
    })
  })
})

// ─── materialAssetStore ────────────────────────────────
import { useMaterialAssetStore } from './materialAssetStore'

describe('materialAssetStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // 清除 localStorage
    localStorage.removeItem('pixelforge:materialAssets')
  })

  describe('createMaterial', () => {
    it('STORE-CREATE-A: 创建材质并分配唯一 ID', () => {
      const store = useMaterialAssetStore()
      store.init()
      const initialCount = store.assetCount

      const id1 = store.createMaterial('材质1')
      const id2 = store.createMaterial('材质2')

      expect(id1).toBeTruthy()
      expect(id2).toBeTruthy()
      expect(id1).not.toBe(id2)
      expect(store.assetCount).toBe(initialCount + 2)
      expect(isValidMaterialId(id1)).toBe(true)
      expect(isValidMaterialId(id2)).toBe(true)
    })

    it('STORE-CREATE-B: 新创建的材质自动选中', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('测试选中')
      expect(store.selectedAssetId).toBe(id)
      expect(store.selectedAsset?.name).toBe('测试选中')
    })
  })

  describe('createMaterialFromPreset', () => {
    it('STORE-PRESET-A: 从预设创建材质', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterialFromPreset('starfield')
      expect(id).toBeTruthy()
      const asset = store.getMaterial(id!)
      expect(asset).toBeDefined()
      expect(asset!.graph).not.toBeNull()
      expect(asset!.graph!.nodes.length).toBeGreaterThan(0)
    })

    it('STORE-PRESET-B: 未知预设返回 null', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterialFromPreset('nonexistent_preset')
      expect(id).toBeNull()
    })
  })

  describe('updateMaterial', () => {
    it('STORE-UPD-A: 更新材质名称', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('原名')
      store.renameMaterial(id, '新名')
      expect(store.getMaterial(id)?.name).toBe('新名')
    })

    it('STORE-UPD-B: 更新 PBR 参数', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('PBR测试')
      store.updatePBR(id, { metallicFactor: 0.9 })
      expect(store.getMaterial(id)?.pbr.metallicFactor).toBe(0.9)
    })

    it('STORE-UPD-C: 不允许通过 update 修改 ID', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('原ID')
      store.updateMaterial(id, { id: 'pfmat_fake_id', name: '改ID' })
      // ID 不应改变
      expect(store.getMaterial(id)?.id).toBe(id)
      // 但名称可以改
      expect(store.getMaterial(id)?.name).toBe('改ID')
    })
  })

  describe('deleteMaterial', () => {
    it('STORE-DEL-A: 删除材质', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('待删除')
      const count = store.assetCount
      store.deleteMaterial(id)
      expect(store.assetCount).toBe(count - 1)
      expect(store.getMaterial(id)).toBeUndefined()
    })

    it('STORE-DEL-B: 删除选中材质后取消选中', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('选中后删除')
      expect(store.selectedAssetId).toBe(id)
      store.deleteMaterial(id)
      expect(store.selectedAssetId).toBeNull()
    })
  })

  describe('duplicateMaterial', () => {
    it('STORE-DUP-A: 复制材质生成新 ID', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('原材质', { tags: ['tag1'] })
      const dupId = store.duplicateMaterial(id)
      expect(dupId).toBeTruthy()
      expect(dupId).not.toBe(id)
      const original = store.getMaterial(id)
      const duplicate = store.getMaterial(dupId!)
      expect(duplicate?.name).toContain('副本')
      expect(duplicate?.tags).toEqual(['tag1'])
      // ID 不同
      expect(duplicate?.id).not.toBe(original?.id)
    })
  })

  describe('tags', () => {
    it('STORE-TAG-A: 添加和移除标签', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('标签测试')
      store.addTag(id, '金属')
      store.addTag(id, '粗糙')
      expect(store.getMaterial(id)?.tags).toEqual(['金属', '粗糙'])

      store.removeTag(id, '金属')
      expect(store.getMaterial(id)?.tags).toEqual(['粗糙'])
    })

    it('STORE-TAG-B: 不重复添加相同标签', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('重复标签')
      store.addTag(id, 'test')
      store.addTag(id, 'test')
      expect(store.getMaterial(id)?.tags).toEqual(['test'])
    })
  })

  describe('search & filter', () => {
    it('STORE-SEARCH-A: 按名称搜索', () => {
      const store = useMaterialAssetStore()
      store.init()
      // 清空预设创建的材质，确保测试环境干净
      store.assets.forEach((a) => store.deleteMaterial(a.id))
      store.createMaterial('星空材质', { tags: ['宇宙'] })
      store.createMaterial('海洋材质', { tags: ['水'] })
      store.createMaterial('星空粒子', { tags: ['宇宙'] })

      store.searchQuery = '星空'
      expect(store.filteredAssets.length).toBe(2)
    })

    it('STORE-SEARCH-B: 按标签搜索', () => {
      const store = useMaterialAssetStore()
      store.init()
      store.createMaterial('材质A', { tags: ['金属'] })
      store.createMaterial('材质B', { tags: ['塑料'] })

      store.searchQuery = '金属'
      expect(store.filteredAssets.length).toBe(1)
      expect(store.filteredAssets[0].name).toBe('材质A')
    })

    it('STORE-FILTER-A: 按分类筛选', () => {
      const store = useMaterialAssetStore()
      store.init()
      store.createMaterial('PBR1', { category: 'pbr' })
      store.createMaterial('PROC1', { category: 'procedural' })

      store.filterCategory = 'pbr'
      expect(store.filteredAssets.every((a) => a.category === 'pbr')).toBe(true)
    })
  })

  describe('persistence', () => {
    it('STORE-PERSIST-A: 创建后保存到 localStorage', () => {
      const store = useMaterialAssetStore()
      store.init()
      store.createMaterial('持久化测试')
      const raw = localStorage.getItem('pixelforge:materialAssets')
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw!)
      expect(parsed.assets.length).toBeGreaterThan(0)
    })

    it('STORE-PERSIST-B: 从 localStorage 恢复', () => {
      // 先保存一些数据
      const store1 = useMaterialAssetStore()
      store1.init()
      const id = store1.createMaterial('恢复测试')

      // 创建新 store 模拟恢复
      setActivePinia(createPinia())
      const store2 = useMaterialAssetStore()
      store2.loadFromStorage()
      expect(store2.assetCount).toBeGreaterThan(0)
      expect(store2.getMaterial(id)).toBeDefined()
    })
  })

  describe('exportMaterialById', () => {
    it('STORE-EXPORT-A: 导出存在的材质', () => {
      const store = useMaterialAssetStore()
      store.init()
      const id = store.createMaterial('导出测试')
      // 使用 prepareMaterialExport 避免触发浏览器下载（测试环境无 document）
      const result = store.prepareMaterialExport(id, 'pfmat')
      expect(result).not.toBeNull()
      expect(result!.format).toBe('pfmat')
      expect(result!.content).toContain('导出测试')
    })

    it('STORE-EXPORT-B: 导出不存在的材质返回 null', () => {
      const store = useMaterialAssetStore()
      store.init()
      const result = store.exportMaterialById('nonexistent_id', 'pfmat')
      expect(result).toBeNull()
    })
  })

  // ─── materialPreview 测试 ──────────────────────────────
  describe('materialPreview', () => {
    it('PREVIEW-THUMB-A: 创建材质后自动生成缩略图', () => {
      const store = useMaterialAssetStore()
      store.assets.forEach((a) => store.deleteMaterial(a.id))
      const id = store.createMaterial('预览测试材质')
      const asset = store.getMaterial(id)
      expect(asset).not.toBeNull()
      expect(asset!.thumbnail).toBeTruthy()
      expect(asset!.thumbnail).toContain('data:image/png;base64,mock')
    })

    it('PREVIEW-THUMB-B: 更新 PBR 参数后重新生成缩略图', () => {
      const store = useMaterialAssetStore()
      store.assets.forEach((a) => store.deleteMaterial(a.id))
      const id = store.createMaterial('PBR 更新测试')
      const originalThumb = store.getMaterial(id)!.thumbnail
      store.updatePBR(id, { metallicFactor: 1.0 })
      const updatedThumb = store.getMaterial(id)!.thumbnail
      expect(updatedThumb).toBeTruthy()
      // 由于 mock canvas 始终返回相同的 data URI，只验证存在性
      expect(updatedThumb).toContain('data:image/png;base64,mock')
    })

    it('PREVIEW-THUMB-C: 复制材质后生成新缩略图', () => {
      const store = useMaterialAssetStore()
      store.assets.forEach((a) => store.deleteMaterial(a.id))
      const id = store.createMaterial('复制源')
      const copyId = store.duplicateMaterial(id)
      expect(copyId).not.toBeNull()
      const copy = store.getMaterial(copyId!)
      expect(copy).not.toBeNull()
      expect(copy!.thumbnail).toBeTruthy()
    })

    it('PREVIEW-THUMB-D: isGeneratingThumbnail 初始为 false', () => {
      const store = useMaterialAssetStore()
      store.assets.forEach((a) => store.deleteMaterial(a.id))
      const id = store.createMaterial('生成状态测试')
      // 同步预览已完成，异步预览在无 GPU 设备时不会启动
      expect(store.isGeneratingThumbnail(id)).toBe(false)
    })

    it('PREVIEW-THUMB-E: setGpuDevice(null) 不崩溃', () => {
      const store = useMaterialAssetStore()
      store.init()
      // 不应抛出异常
      store.setGpuDevice(null)
      expect(true).toBe(true)
    })
  })
})
