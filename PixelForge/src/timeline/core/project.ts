/**
 * PixelForge Timeline Core — Project（工程）。
 *
 * 项目是顶层容器，包含一个或多个 Sequence。
 */

import type { Sequence } from './sequence';

/** 项目。 */
export interface Project {
  /** 稳定 ID */
  id: string;
  /** 项目名称 */
  name: string;
  /** 序列列表 */
  sequences: Sequence[];
  /** 创建时间戳（毫秒） */
  created: number;
  /** 最后修改时间戳（毫秒） */
  modified: number;
}
