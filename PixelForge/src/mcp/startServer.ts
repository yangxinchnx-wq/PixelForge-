/**
 * PixelForge MCP 服务端启动入口(Node stdio 传输层)。
 *
 * 通过 RealEditorBridge 将 23 个 MCP 工具真实映射到 PixelForge 编辑器能力:
 *   图 / 子图 / 时间轴 / 渲染 / AI Director / 资产。
 *
 * 协议: JSON-RPC 2.0 over stdio(每行一条消息)。
 *
 * 用法(构建后):
 *   node dist/mcp/startServer.js
 * 或由 Tauri 主进程以子进程方式拉起该脚本,经 stdin/stdout 与 MCP 客户端通信。
 *
 * 注意:
 * - 本进程运行在 Node 环境,需手动激活 Pinia 才能访问真实 store。
 * - 真实 GPU 渲染无法在此进程内执行(需要浏览器 WebGPU 上下文与帧渲染器),
 *   故 render_start 等会优雅返回说明性错误,真正渲染仍由前端触发。
 */

import { createPinia, setActivePinia } from 'pinia'
import { MCPServer, StdioTransport, registerToolModule } from './server'
import { RealEditorBridge } from './realBridge'
import {
  createGraphTools,
  createTimelineTools,
  createRenderTools,
  createAIDirectorTools,
  createAssetTools,
} from './tools'

function main(): void {
  // MCP 运行在独立 Node 进程,需手动激活 Pinia 才能访问真实 store
  setActivePinia(createPinia())

  const bridge = new RealEditorBridge()
  const server = new MCPServer(bridge)

  // 注册全部 5 个工具模块(共 23 个工具)到全局注册中心
  registerToolModule(server.getRegistry(), createGraphTools(bridge))
  registerToolModule(server.getRegistry(), createTimelineTools(bridge))
  registerToolModule(server.getRegistry(), createRenderTools(bridge))
  registerToolModule(server.getRegistry(), createAIDirectorTools(bridge))
  registerToolModule(server.getRegistry(), createAssetTools(bridge))

  const transport = new StdioTransport()
  // run() 是主消息循环,阻塞直到 stdin EOF
  void server.run(transport).then(() => {
    ;(globalThis as { process?: { exit(code: number): void } }).process?.exit(0)
  })
}

main()
