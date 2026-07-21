/**
 * PixelForge Timeline — Selection 选择系统。
 *
 * 视频编辑器第一步：选择。
 *
 * 用户操作流程：
 *   点击 Clip → 选中 → 拖动
 *
 * 不能直接修改 Clip，需要先通过 Selection 系统管理选中状态。
 */

/** 选择状态。 */
export interface SelectionState {
  /** 所有选中的 Clip ID 列表 */
  selectedClipIds: string[];
  /** 当前活跃 Clip（主选中项，用于属性面板显示） */
  activeClipId: string | null;
}

/** 创建空的 SelectionState。 */
export function createSelectionState(): SelectionState {
  return {
    selectedClipIds: [],
    activeClipId: null,
  };
}

/**
 * Selection 管理器。
 *
 * 管理 Clip 的选中、多选、取消选中状态。
 */
export class Selection {
  private state: SelectionState;

  constructor() {
    this.state = createSelectionState();
  }

  /** 获取当前选择状态。 */
  getState(): SelectionState {
    return this.state;
  }

  /** 选中的 Clip 数量。 */
  get count(): number {
    return this.state.selectedClipIds.length;
  }

  /** 是否有选中项。 */
  get hasSelection(): boolean {
    return this.state.selectedClipIds.length > 0;
  }

  /** 单选一个 Clip（清除其他选中）。 */
  selectSingle(clipId: string): void {
    this.state.selectedClipIds = [clipId];
    this.state.activeClipId = clipId;
  }

  /** 追加选中一个 Clip（多选）。 */
  selectAdd(clipId: string): void {
    if (!this.state.selectedClipIds.includes(clipId)) {
      this.state.selectedClipIds.push(clipId);
    }
    this.state.activeClipId = clipId;
  }

  /** 切换选中状态（Ctrl+点击）。 */
  toggle(clipId: string): void {
    const idx = this.state.selectedClipIds.indexOf(clipId);
    if (idx >= 0) {
      this.state.selectedClipIds.splice(idx, 1);
      if (this.state.activeClipId === clipId) {
        this.state.activeClipId =
          this.state.selectedClipIds.length > 0
            ? this.state.selectedClipIds[this.state.selectedClipIds.length - 1]
            : null;
      }
    } else {
      this.state.selectedClipIds.push(clipId);
      this.state.activeClipId = clipId;
    }
  }

  /** 取消所有选中。 */
  clear(): void {
    this.state.selectedClipIds = [];
    this.state.activeClipId = null;
  }

  /** 判断某个 Clip 是否被选中。 */
  isSelected(clipId: string): boolean {
    return this.state.selectedClipIds.includes(clipId);
  }
}
