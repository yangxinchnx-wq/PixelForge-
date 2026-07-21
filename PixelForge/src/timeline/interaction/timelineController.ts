/**
 * PixelForge Timeline — TimelineController（交互控制器）。
 *
 * 不要让 Vue 直接改数据：
 *   错误：Vue MouseMove → clip.start = ...
 *   正确：Vue → Interaction Controller → Command → Store → Renderer
 *
 * 负责：
 *   onMouseDown()
 *   onMouseMove()
 *   onMouseUp()
 *
 * 例如：
 *   onDragMove(x) {
 *     const delta = pixelToTime(x)
 *     controller.moveClip(clipId, delta)
 *   }
 */

import type { Clip } from '../core/clip';
import type { Track } from '../core/track';
import type { Time } from '../core/time';
import type { CommandStack } from '../operation/commandStack';
import { MoveClipCommand } from '../operation/moveClipCommand';
import { DeleteClipCommand, RippleDeleteCommand } from '../operation/deleteClipCommand';
import { SplitClipCommand } from '../operation/splitClipCommand';
import { ClipMover, pixelToTime } from '../interaction/clipMover';
import { Selection } from '../interaction/selection';
import { SnapEngine } from '../interaction/snapEngine';

/**
 * TimelineController — 连接 Vue UI 和 Command/Store 的中间层。
 *
 * Vue 组件调用 controller 的方法，controller 负责生成 Command 并提交。
 */
export class TimelineController {
  private commandStack: CommandStack;
  private selection: Selection;
  private snapEngine: SnapEngine;
  private clipMover: ClipMover;
  private scale: number;

  constructor(commandStack: CommandStack, scale: number = 100) {
    this.commandStack = commandStack;
    this.selection = new Selection();
    this.snapEngine = new SnapEngine();
    this.clipMover = new ClipMover(scale);
    this.scale = scale;
  }

  /** 设置缩放（pixelsPerSecond）。 */
  setScale(scale: number): void {
    this.scale = scale;
    this.clipMover.setScale(scale);
  }

  /** 获取 Selection 管理器。 */
  getSelection(): Selection {
    return this.selection;
  }

  /** 获取 SnapEngine。 */
  getSnapEngine(): SnapEngine {
    return this.snapEngine;
  }

  // ---- 鼠标交互 ----

  /**
   * 鼠标按下：Hit Test → 选中 Clip → 开始拖动。
   *
   * @param clip 被点击的 Clip（由 UI 层 hitTest 找到）
   */
  onMouseDown(clip: Clip | null): void {
    if (clip) {
      this.selection.selectSingle(clip.id);
      this.clipMover.onDragStart(clip);
    } else {
      this.selection.clear();
    }
  }

  /**
   * 鼠标移动：计算 delta → 实时预览移动。
   *
   * @param pixelDelta X 方向像素偏移
   */
  onMouseMove(pixelDelta: number): void {
    this.clipMover.onDragMove(pixelDelta);
  }

  /**
   * 鼠标释放：生成 MoveClipCommand → 提交到 CommandStack。
   */
  onMouseUp(): void {
    this.clipMover.onDragEnd(this.commandStack);
  }

  // ---- 编辑操作 ----

  /**
   * 移动 Clip。
   *
   * @param clip 要移动的 Clip
   * @param delta 时间偏移量
   */
  moveClip(clip: Clip, delta: Time): void {
    const before = clip.timelineStart;
    const after = before + delta;
    const cmd = new MoveClipCommand(clip, before, after);
    this.commandStack.execute(cmd);
  }

  /**
   * 切割 Clip。
   *
   * @param clip  要切割的 Clip
   * @param track 所在轨道
   * @param time  切割时间点
   */
  splitClip(clip: Clip, track: Track, time: Time): string | null {
    const cutTime = time - clip.timelineStart;
    if (cutTime <= 0n || cutTime >= clip.duration) return null;

    const cmd = new SplitClipCommand(clip, track, cutTime);
    this.commandStack.execute(cmd);
    return cmd.getNewClipId();
  }

  /**
   * 普通删除 Clip。
   *
   * @param clip  要删除的 Clip
   * @param track 所在轨道
   */
  deleteClip(clip: Clip, track: Track): void {
    const cmd = new DeleteClipCommand(clip, track);
    this.commandStack.execute(cmd);
  }

  /**
   * Ripple Delete：删除 Clip，后方 Clip 自动前移。
   *
   * @param clip  要删除的 Clip
   * @param track 所在轨道
   */
  rippleDelete(clip: Clip, track: Track): void {
    const cmd = new RippleDeleteCommand(clip, track);
    this.commandStack.execute(cmd);
  }

  // ---- Undo / Redo ----

  undo(): void {
    this.commandStack.undo();
  }

  redo(): void {
    this.commandStack.redo();
  }

  // ---- 工具方法 ----

  /**
   * 像素转时间。
   *
   * @param px 像素值
   * @returns 时间值
   */
  pixelToTime(px: number): Time {
    return pixelToTime(px, this.scale);
  }
}
