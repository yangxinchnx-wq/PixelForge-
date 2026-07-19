// PixelForge Phase B - 多图层/区域/混合 GPU 求值核心着色器
//
// 物理绑定布局（Group 0）：
//   binding 0: uniform     Uniforms           全局元数据（resolution/seed/time/layerCount）
//   binding 1: storage     outputTex          rgba8unorm 直写纹理
//   binding 2: storage     auxBuffer          vec4f 对齐辅助显存（所有图层参数拼接）
//   binding 3: storage     descriptorBuffer   u32 描述符数组（图层描述符，无前缀）
//   binding 4: storage     regionBuffer       vec4f 区域边界数组
//
// V2 描述符布局（对齐骨架 §4.4 / §4.5 迁移路径）：
//   descriptorBuffer 长度 = 2 * layerCount（无 layerCount 前缀）
//   For each visible layer i:
//     descriptorBuffer[2*i]     = opcode(8) | blendMode(8) | auxIndex(16)
//     descriptorBuffer[2*i + 1] = regionIndex(16) | reserved(16)
//                                 regionIndex = 0xFFFF 表示无区域限制
//
// layerCount 通过 Uniforms.layerCount 传入（不在 descriptorBuffer 中）
//
// V2 区域缓冲布局：
//   regionBuffer[i] = vec4f(x, y, width, height)  归一化坐标
//
// 混合模式（Layer.blendMode，非 Opcode.BLEND）：
//   0=normal  1=multiply  2=screen  3=overlay  4=add  5=subtract
//   注意：Opcode.BLEND 走独立 blend pass，不进 region_eval（骨架 §4.3/§10.3）

struct Uniforms {
    resolution: vec2f,
    seed: u32,
    layerCount: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> auxBuffer: array<vec4f>;
@group(0) @binding(3) var<storage, read> descriptorBuffer: array<u32>;
@group(0) @binding(4) var<storage, read> regionBuffer: array<vec4f>;

// Opcode 枚举常量
const OP_SOLID_COLOR: u32 = 0u;
const OP_LINEAR_GRADIENT: u32 = 1u;
const OP_NOISE: u32 = 2u;
const OP_CIRCLE_SHAPE: u32 = 4u;

// 混合模式常量（Layer.blendMode）
const BLEND_NORMAL: u32 = 0u;
const BLEND_MULTIPLY: u32 = 1u;
const BLEND_SCREEN: u32 = 2u;
const BLEND_OVERLAY: u32 = 3u;
const BLEND_ADD: u32 = 4u;
const BLEND_SUBTRACT: u32 = 5u;

const NO_REGION: u32 = 0xFFFFu;

// 单 layer 求值核心
fn evaluate_opcode(opcode: u32, auxIndex: u32, coords: vec2f) -> vec4f {
    switch (opcode) {
        case OP_SOLID_COLOR: {
            return auxBuffer[auxIndex];
        }
        case OP_LINEAR_GRADIENT: {
            let color1 = auxBuffer[auxIndex];
            let color2 = auxBuffer[auxIndex + 1u];
            return mix(color1, color2, coords.y);
        }
        case OP_NOISE: {
            let scale = auxBuffer[auxIndex].x;
            let amount = auxBuffer[auxIndex].y;
            let scaled_coords = coords * scale;
            let n = fract(sin(dot(scaled_coords, vec2f(12.9898, 78.233))) * 43758.5453);
            let colorA = auxBuffer[auxIndex + 1u].rgb;
            let colorB = auxBuffer[auxIndex + 2u].rgb;
            return vec4f(mix(colorA, colorB, n * amount), 1.0);
        }
        case OP_CIRCLE_SHAPE: {
            let data = auxBuffer[auxIndex];
            let center = vec2f(data.x, data.y);
            let radius = data.z;
            let fill = auxBuffer[auxIndex + 1u];
            let background = auxBuffer[auxIndex + 2u];
            let dist = distance(coords, center);
            if (dist < radius) {
                return fill;
            }
            return background;
        }
        default: {
            return vec4f(0.0, 0.0, 0.0, 1.0);
        }
    }
}

// 混合函数（Layer.blendMode 实现，非 Opcode.BLEND）
fn blend_colors(dst: vec4f, src: vec4f, mode: u32) -> vec4f {
    let alpha = src.a;
    switch (mode) {
        case BLEND_NORMAL: {
            return vec4f(mix(dst.rgb, src.rgb, alpha), mix(dst.a, 1.0, alpha));
        }
        case BLEND_MULTIPLY: {
            let mixed = dst.rgb * src.rgb;
            return vec4f(mix(dst.rgb, mixed, alpha), mix(dst.a, 1.0, alpha));
        }
        case BLEND_SCREEN: {
            let mixed = 1.0 - (1.0 - dst.rgb) * (1.0 - src.rgb);
            return vec4f(mix(dst.rgb, mixed, alpha), mix(dst.a, 1.0, alpha));
        }
        case BLEND_OVERLAY: {
            let overlay = mix(
                2.0 * dst.rgb * src.rgb,
                1.0 - 2.0 * (1.0 - dst.rgb) * (1.0 - src.rgb),
                step(0.5, dst.rgb)
            );
            return vec4f(mix(dst.rgb, overlay, alpha), mix(dst.a, 1.0, alpha));
        }
        case BLEND_ADD: {
            let added = min(dst.rgb + src.rgb, vec3f(1.0));
            return vec4f(mix(dst.rgb, added, alpha), mix(dst.a, 1.0, alpha));
        }
        case BLEND_SUBTRACT: {
            let subbed = max(dst.rgb - src.rgb, vec3f(0.0));
            return vec4f(mix(dst.rgb, subbed, alpha), mix(dst.a, 1.0, alpha));
        }
        default: {
            return vec4f(mix(dst.rgb, src.rgb, alpha), mix(dst.a, 1.0, alpha));
        }
    }
}

// 区域边界检测
fn is_in_region(coords: vec2f, regionIndex: u32) -> bool {
    if (regionIndex == NO_REGION) {
        return true;
    }
    let bounds = regionBuffer[regionIndex];
    return coords.x >= bounds.x && coords.x < bounds.x + bounds.z &&
           coords.y >= bounds.y && coords.y < bounds.y + bounds.w;
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

    // 从 uniform 读取可见图层数量
    let layerCount = uniforms.layerCount;
    var accumulatedColor = vec4f(0.0, 0.0, 0.0, 1.0);

    // 从底到顶遍历所有可见图层
    for (var i = 0u; i < layerCount; i++) {
        let packedDesc = descriptorBuffer[2u * i];
        let opcode = (packedDesc >> 24u) & 0xFFu;
        let blendMode = (packedDesc >> 16u) & 0xFFu;
        let auxIndex = packedDesc & 0xFFFFu;

        let packedMeta = descriptorBuffer[2u * i + 1u];
        let regionIndex = packedMeta & 0xFFFFu;

        // 区域边界检测
        if (!is_in_region(coords, regionIndex)) {
            continue;
        }

        let layerColor = evaluate_opcode(opcode, auxIndex, coords);
        accumulatedColor = blend_colors(accumulatedColor, layerColor, blendMode);
    }

    textureStore(outputTex, vec2i(gid.xy), accumulatedColor);
}
