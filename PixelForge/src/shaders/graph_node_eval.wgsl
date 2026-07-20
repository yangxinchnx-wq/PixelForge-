// PixelForge Graph Runtime - 单节点区域求值着色器
//
// 与 region_eval.wgsl 的区别:
// - region_eval.wgsl: 遍历所有图层(layer loop), 每个像素混合多个图层颜色
// - graph_node_eval.wgsl: 只求值单个 REGION 节点, 无图层循环, 无混合
//
// 每个REGION节点独立dispatch, 输出到节点自己的纹理
//
// 物理绑定布局 (Group 0):
//   binding 0: uniform   Uniforms       全局元数据 (resolution / seed / opcode)
//   binding 1: storage   outputTex      rgba8unorm 写入纹理
//   binding 2: storage   auxBuffer      vec4f 参数数组 (按 opcode 不同布局)
//
// auxBuffer 布局 (与 regionCompiler createAuxData 对齐):
//   SOLID_COLOR:     [0] = color (vec4f)
//   LINEAR_GRADIENT: [0] = from.xy, to.xy | [1] = colorA | [2] = colorB
//   NOISE:           [0] = scale, amount, 0, 0 | [1] = colorA | [2] = colorB
//   CIRCLE_SHAPE:    [0] = center.xy, radius, 0 | [1] = fill | [2] = background

struct Uniforms {
    resolution: vec2f,
    seed: u32,
    opcode: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> auxBuffer: array<vec4f>;

// Opcode 枚举常量 (与 shared/types.ts Opcode enum 对齐)
const OP_SOLID_COLOR: u32 = 0u;
const OP_LINEAR_GRADIENT: u32 = 1u;
const OP_NOISE: u32 = 2u;
const OP_CIRCLE_SHAPE: u32 = 4u;

// 简单伪随机
fn hash2(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let texSize = textureDimensions(outputTex);

    if (gid.x >= texSize.x || gid.y >= texSize.y) {
        return;
    }

    let coords = vec2f(
        f32(gid.x) / f32(texSize.x),
        f32(gid.y) / f32(texSize.y)
    );

    var color = vec4f(0.0, 0.0, 0.0, 1.0);

    switch (uniforms.opcode) {
        case OP_SOLID_COLOR: {
            color = auxBuffer[0u];
        }
        case OP_LINEAR_GRADIENT: {
            let fromTo = auxBuffer[0u];
            let colorA = auxBuffer[1u];
            let colorB = auxBuffer[2u];
            // 计算渐变方向: from -> to
            let from = fromTo.xy;
            let to = fromTo.zw;
            let dir = to - from;
            let lenSq = dot(dir, dir);
            var t = 0.0;
            if (lenSq > 0.0001) {
                t = dot(coords - from, dir) / lenSq;
            } else {
                t = coords.y;
            }
            t = clamp(t, 0.0, 1.0);
            color = mix(colorA, colorB, t);
        }
        case OP_NOISE: {
            let scale = auxBuffer[0u].x;
            let amount = auxBuffer[0u].y;
            let scaled_coords = coords * scale;
            // 多层噪声叠加, 产生更自然的纹理
            let n1 = hash2(scaled_coords);
            let n2 = hash2(scaled_coords * 2.1 + vec2f(17.0, 31.0)) * 0.5;
            let n3 = hash2(scaled_coords * 4.3 + vec2f(53.0, 7.0)) * 0.25;
            let n = clamp(n1 + n2 + n3, 0.0, 1.0);
            let colorA = auxBuffer[1u].rgb;
            let colorB = auxBuffer[2u].rgb;
            color = vec4f(mix(colorA, colorB, n * amount), 1.0);
        }
        case OP_CIRCLE_SHAPE: {
            let data = auxBuffer[0u];
            let center = vec2f(data.x, data.y);
            let radius = data.z;
            let fill = auxBuffer[1u];
            let background = auxBuffer[2u];
            let dist = distance(coords, center);
            // 抗锯齿边缘
            let edge = 1.0 - smoothstep(radius - 0.002, radius + 0.002, dist);
            color = mix(background, fill, edge);
        }
        default: {
            color = vec4f(0.0, 0.0, 0.0, 1.0);
        }
    }

    textureStore(outputTex, vec2i(gid.xy), color);
}
