/**
 * PixelForge Timeline Core — 统一导出。
 *
 * 导出 Timeline 数据内核的全部类型和函数。
 */

// ---- Core 数据类型 ----
export type { Time } from './core/time';
export { SECOND, sec, frameToTime, timeToFrame } from './core/time';

export type { Transform } from './core/transform';
export { defaultTransform } from './core/transform';

export type { Clip } from './core/clip';

export { TrackType } from './core/track';
export type { Track } from './core/track';

export type { Sequence } from './core/sequence';

export type { Project } from './core/project';

// ---- Operation 命令系统 ----
export type { Command } from './operation/command';
export { CommandStack } from './operation/commandStack';
export { MoveClipCommand } from './operation/moveClipCommand';
export { TrimClipCommand, type ClipTrimState } from './operation/trimClipCommand';
export { SplitClipCommand } from './operation/splitClipCommand';
export { DeleteClipCommand, RippleDeleteCommand } from './operation/deleteClipCommand';
export { BatchMoveCommand } from './operation/batchMoveCommand';

// ---- Interaction 交互系统 ----
export { Selection, type SelectionState } from './interaction/selection';
export { SnapEngine, snap } from './interaction/snapEngine';
export { ClipMover, pixelToTime } from './interaction/clipMover';
export { ClipTrimmer } from './interaction/clipTrimmer';
export { BladeTool } from './interaction/bladeTool';
export { TimelineController } from './interaction/timelineController';

// ---- Utils 工具 ----
export { hitTestClip, checkCollision, type ClipRect, type TimeInterval } from './utils/collision';

// ---- Resolver 解析器 ----
export type { ResolvedFrame } from './resolver/timelineResolver';
export { resolve } from './resolver/timelineResolver';
export { TimelineIndex } from './resolver/timelineIndex';

// ---- Store 状态管理 ----
export { useTimelineStore } from './store/timelineStore';
