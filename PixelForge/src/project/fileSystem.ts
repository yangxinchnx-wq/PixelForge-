import type { PixelForgeProject } from './types'
import { PROJECT_FILE_EXTENSION } from './types'
import { deserializeProject, serializeProject } from './serializer'

/**
 * 浏览器版项目文件系统(基于 File API + Blob 下载)。
 *
 * 当前为单文件 JSON 模式:
 *   saveProjectToFile(project)  → 触发浏览器下载 .pixelforge 文件
 *   loadProjectFromFile(file)   → 解析用户选择的 .pixelforge 文件
 *   pickProjectFile()           → 弹出文件选择对话框(隐藏 input)
 *
 * 后续可替换为 Tauri 文件系统实现(保留同名 API,内部用 fs.writeFile / fs.readFile):
 *   - saveProjectToFile  → Tauri dialog.save() + fs.writeTextFile()
 *   - loadProjectFromFile → Tauri dialog.open() + fs.readTextFile()
 *
 * 设计原则:
 * - 接口与 Tauri 实现保持一致(便于无缝切换)
 * - 不在主线程做重 IO(浏览器版本本身是异步的)
 * - 错误用 throw,调用方 try/catch 处理
 */

/**
 * 把项目保存为 .pixelforge 文件(触发浏览器下载)。
 *
 * @param project 项目对象
 * @param filename 可选文件名(不带扩展名,默认用 project.metadata.name)
 */
export function saveProjectToFile(
  project: PixelForgeProject,
  filename?: string,
): void {
  const json = serializeProject(project)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const safeName = sanitizeFilename(filename ?? project.metadata.name)
  const fullName = safeName.endsWith(PROJECT_FILE_EXTENSION)
    ? safeName
    : safeName + PROJECT_FILE_EXTENSION

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fullName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)

  // 释放 URL(给浏览器一点时间发起下载)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * 从用户选择的 File 解析项目。
 *
 * @param file input[type=file] 选中的文件
 * @returns 解析后的 PixelForgeProject
 * @throws 文件读取失败 / JSON 解析失败 / 结构校验失败
 */
export async function loadProjectFromFile(file: File): Promise<PixelForgeProject> {
  const text = await file.text()
  return deserializeProject(text)
}

/**
 * 弹出文件选择对话框,返回用户选择的文件。
 *
 * 用隐藏 <input type="file"> 实现(避免依赖第三方库)。
 * 调用方 await 后用 loadProjectFromFile(file) 解析。
 */
export function pickProjectFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = PROJECT_FILE_EXTENSION + ',application/json'
    input.style.display = 'none'

    input.onchange = () => {
      const file = input.files?.[0] ?? null
      document.body.removeChild(input)
      resolve(file)
    }

    // 用户取消时 onchange 不触发,这里依赖 focus 回到 window 来清理
    const onFocusBack = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) {
          if (input.parentNode) document.body.removeChild(input)
          window.removeEventListener('focus', onFocusBack)
          resolve(null)
        }
      }, 500)
    }
    window.addEventListener('focus', onFocusBack)

    document.body.appendChild(input)
    input.click()
  })
}

/**
 * 把项目保存到 localStorage(供自动保存轻量版使用)。
 *
 * 注意:
 * - localStorage 有 5MB 限制,大项目可能失败
 * - 仅作为崩溃恢复兜底,正式保存仍走 saveProjectToFile
 *
 * @returns 是否保存成功
 */
export function saveProjectToLocalStorage(
  project: PixelForgeProject,
  key = 'pixelforge:autosave',
): boolean {
  try {
    const json = serializeProject(project)
    localStorage.setItem(key, json)
    return true
  } catch (e) {
    console.warn('[project] localStorage 自动保存失败:', e)
    return false
  }
}

/**
 * 从 localStorage 读取自动保存的项目(若存在)。
 *
 * @returns 项目对象,无自动保存或读取失败时返回 null
 */
export function loadProjectFromLocalStorage(
  key = 'pixelforge:autosave',
): PixelForgeProject | null {
  try {
    const json = localStorage.getItem(key)
    if (!json) return null
    return deserializeProject(json)
  } catch (e) {
    console.warn('[project] localStorage 自动保存读取失败:', e)
    return null
  }
}

/** 清除 localStorage 中的自动保存 */
export function clearLocalStorageAutosave(
  key = 'pixelforge:autosave',
): void {
  localStorage.removeItem(key)
}

/** 文件名清洗(去掉路径分隔符 / 非法字符) */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'
}
