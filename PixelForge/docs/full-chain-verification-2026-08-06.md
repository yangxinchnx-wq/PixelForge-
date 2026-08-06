# 全链路打通验证报告

- **日期**：2026-08-06
- **验证方式**：真实运行测试 + 阅读真实源码（非仅复述结论）
- **结论**：三项 Gigi 借鉴功能（SubGraph / MCP / UAV Split）均为真实接入、全链路打通，无占位或空壳。

---

## 1. MCP —— 全链路打通 ✅

- **测试**：`src/mcp/mcpFullChain.test.ts` → **7/7 通过**
- **证据**：测试驱动的是**真实** `MCPServer` + `MemoryTransport` + `RealEditorBridge` + 真实 Pinia stores（非 Mock 桥）。经 JSON-RPC 真实改写/读取：
  - graph store（图节点/边）
  - timeline store（关键帧）
  - asset store（素材）
  - AI Director（离线优雅降级）
  - render store（状态读取）
- **关键点**：`graph_compile` 等 23 个工具真实映射到 `RealEditorBridge` → 真实 stores。

## 2. UAV Split —— 接入真实渲染管线且通路打通 ✅

- **测试**：`src/runtime/uav/__tests__/effectUavPath.test.ts`(5/5) + `src/runtime/uav/__tests__/uavSplit.test.ts`(23/23)
- **端到端证据（EP05）**：真实 `effect_post.wgsl` 被改写 → `createRegionEvaluator(fakeDevice).render(含效果工件)`：
  - 真的编译出拆分后的着色器
  - 效果绑定组真的带了 `binding 5`（只读副本 `outputTex_readOnly`）
  - 编码器真的录制了逐帧复制 `recordUavCopy(output.texture → readOnlyCopy)`
- **解决的真实 WebGPU 坑**：
  - `read_write` 非 r32 格式必须拆分（原 `effect_post.wgsl` binding 1 的 `rgba8unorm read_write`）
  - 只读副本绑定须为 `STORAGE_BINDING` 且注入显式 `@binding(5)`
  - 复制须逐帧录制（图层 pass 每帧覆盖 `output.texture`）

## 3. SubGraph —— 真接入节点图 + 编译主链路 ✅

- **测试**：`src/graph/subgraph.test.ts` 共 **34 项全过**（SG-T / SG-I / SG-C / SG-V / SG-S / SG-E 全维度）
- **UI 真接线**：`src/components/editor/graph/GraphEditor.vue`
  - `handlePackageSubgraph`(line 329，绑定 `@package-subgraph` 按钮) → `createSubGraphFromSelection` → `graph.addSubGraphDefinition`
  - `handleAddSubGraphToCanvas`(line 352) → `graph.addSubGraphNode`
  - 真实组件 `SubGraphLibraryPanel.vue`（库管理/添加/删除）
- **编译真调用**：`src/graph/graphCompiler.ts` 第 **239 行** `const resolvedGraph = inlineSubGraphs(graph)` —— 真实代码调用（函数定义于 `src/graph/subgraphInliner.ts:65`），非空壳
- **链路真覆盖**：SG-C1/C2 直接用 `compileGraph` 编译含 `SUBGRAPH` 节点的图，断言产物 IR 真出现内联后的 `SOLID_COLOR` + `NOISE` 图层与 `blur` 效果；graphStore 13 个子图 action（SG-S1~S13）全测

---

## 最终验证

```
vitest run → 99 测试文件 / 2970 通过 / 21 跳过 / 0 失败
```

> 注：全程使用 `C:/Users/yangx/.workbuddy/binaries/node/versions/22.22.2/node.exe node_modules/vitest/vitest.mjs run <file>` 运行。

## 备注

- Grep 工具带 `glob: "src/**/*.{ts,vue}"` 时曾误报 "No matches found"；排查代码存在性建议不使用 glob 或改用 `path` 限定目录。
- 三项功能均已接进真实系统（真实 store / 真实编译主链路 / 真实渲染管线），且有端到端测试佐证。
