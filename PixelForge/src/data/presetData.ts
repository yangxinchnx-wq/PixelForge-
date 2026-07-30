import type { ElementTag, TuningParams, IRTreeNode } from '../types';

export const initialPromptText = `壮丽的高分辨率电影级夜景:一座静谧的水晶般高山湖泊,倒映着深邃的星空与闪耀的银河系。湖面飘荡着轻柔薄雾,远处是松林。8K 分辨率,照片级真实感,程序化光照。`;

export const initialElements: ElementTag[] = [];

export const initialTuningParams: TuningParams = {
  starDensity: 0.45,
  brightness: 0.60,
  hue: 270,
  contrast: 0.55,
};

export const initialIRTree: IRTreeNode[] = [
  {
    id: 'root',
    name: '根场景图',
    type: '场景',
    visible: true,
    children: [
      { id: 'node-camera', name: '主电影摄影机', type: '摄影机', fov: 60, visible: true },
      {
        id: 'node-environment',
        name: '天空与环境系统',
        type: '环境',
        visible: true,
        children: [
          { id: 'node-stars', name: '程序化星空生成器', type: '粒子系统', visible: true },
          { id: 'node-fog', name: '体积湖面雾气', type: '体积', visible: true },
        ],
      },
      { id: 'node-lake', name: '湖面水体网格', type: '网格', material: 'WaterShaderPBR', visible: true },
    ],
  },
];
