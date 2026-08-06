// 检测指定 commit 下 12 个文件的编码状态
const { execSync } = require('child_process');
const commit = process.argv[2];
const cwd = 'C:/Users/yangx/Desktop/PixelForge';
const files = [
  'PixelForge/src/components/editor/AssetPanel.vue',
  'PixelForge/src/components/editor/CanvasView.vue',
  'PixelForge/src/components/editor/ClarifierDialog.vue',
  'PixelForge/src/components/editor/CommandPalette.vue',
  'PixelForge/src/components/editor/ErrorBoundary.vue',
  'PixelForge/src/components/editor/ErrorToast.vue',
  'PixelForge/src/components/editor/inspector/InspectorPanel.vue',
  'PixelForge/src/components/editor/inspector/LayerTree.vue',
  'PixelForge/src/components/editor/inspector/PropertyControl.vue',
  'PixelForge/src/components/editor/inspector/PropertyGroup.vue',
  'PixelForge/src/components/editor/PromptPanel.vue',
  'PixelForge/src/components/editor/TopBar.vue',
];
let ok = 0, bad = 0, missing = 0;
for (const f of files) {
  try {
    const buf = execSync(`git cat-file -p ${commit}:${f}`, { cwd, maxBuffer: 20 * 1024 * 1024 });
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
      ok++;
    } catch {
      bad++;
      console.log(`非UTF-8: ${f}`);
    }
  } catch {
    missing++;
    console.log(`不存在: ${f}`);
  }
}
console.log(`${commit}: UTF-8正常=${ok} 非UTF-8=${bad} 不存在=${missing}`);
