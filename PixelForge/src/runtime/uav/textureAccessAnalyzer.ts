/**
 * TextureAccessAnalyzer — WGSL 存储纹理访问分析器。
 *
 * 纯函数实现，不依赖 GPU。从 WGSL 源码中解析出所有
 * `texture_storage_2d / _2d_array / _3d<format, access>` 声明，
 * 提取纹理名、格式与访问限定符，并汇总到跨 shader/pass 的访问信息。
 */

import {
  READ_WRITE_STORAGE_FORMATS,
  type StorageTextureAccess,
  type StorageTextureDeclaration,
  type TextureAccessInfo,
} from './types'

/** 单条 shader 输入 */
export interface ShaderInput {
  /** shader 名 */
  name: string
  /** 所属 pass 名 */
  pass: string
  /** WGSL 源码 */
  code: string
}

/**
 * 识别 WGSL 存储纹理声明。
 *
 * 覆盖维度：
 * - texture_storage_2d
 * - texture_storage_2d_array
 * - texture_storage_3d
 * 访问限定符取值：read | write | read_write
 */
const STORAGE_TEXTURE_RE =
  /var\s+([A-Za-z_]\w*)\s*:\s*texture_storage_(?:2d|2d_array|3d)\s*<\s*([A-Za-z0-9_]+)\s*,\s*(read|write|read_write)\s*>/g

/**
 * 分析单段 WGSL 源码，返回所有存储纹理声明。
 */
export function analyzeShaderCode(code: string): StorageTextureDeclaration[] {
  const decls: StorageTextureDeclaration[] = []
  STORAGE_TEXTURE_RE.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = STORAGE_TEXTURE_RE.exec(code)) !== null) {
    const [, textureName, formatToken, access] = m
    decls.push({
      textureName,
      formatToken,
      format: normalizeFormat(formatToken),
      access: access as StorageTextureAccess,
      location: m.index,
      length: m[0].length,
    })
  }

  return decls
}

/**
 * 分析多段 shader，汇总为跨 shader/pass 的访问信息。
 */
export function analyzeShaders(shaders: ShaderInput[]): TextureAccessInfo[] {
  const infos: TextureAccessInfo[] = []

  for (const shader of shaders) {
    const decls = analyzeShaderCode(shader.code)
    for (const decl of decls) {
      infos.push({
        textureName: decl.textureName,
        accessType: decl.access,
        shaderName: shader.name,
        passName: shader.pass,
        format: decl.format,
      })
    }
  }

  return infos
}

/**
 * 判断某格式是否支持 read_write 存储访问。
 *
 * 仅 r32float / r32uint / r32sint 三种格式支持（WebGPU 规范）。
 */
export function isReadWriteStorageFormatSupported(format: string): boolean {
  return READ_WRITE_STORAGE_FORMATS.has(normalizeFormat(format))
}

/**
 * 判断单个声明是否需要拆分（read_write 且格式不支持）。
 */
export function declarationNeedsSplit(decl: StorageTextureDeclaration): boolean {
  return decl.access === 'read_write' && !isReadWriteStorageFormatSupported(decl.format)
}

/**
 * 归一化格式名：去空白、转小写。
 */
export function normalizeFormat(format: string): string {
  return format.trim().toLowerCase()
}
