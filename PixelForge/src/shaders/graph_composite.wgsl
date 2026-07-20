// PixelForge Graph Runtime - 合成混合着色器
//
// 将多个上游纹理按混合模式合成到单个输出纹理。
// 当前支持最多 2 个输入纹理 (COMPOSITE 节点通常合并 2 个输入)。
//
// 物理绑定布局 (Group 0):
//   binding 0: uniform   Uniforms       (resolution / inputCount / blendMode)
//   binding 1: texture   inputTex0      第一个输入纹理 (base layer)
//   binding 2: texture   inputTex1      第二个输入纹理 (blend layer)
//   binding 3: storage   outputTex      rgba8unorm 写入纹理
//
// 混合模式常量 (与 regionCompiler BLEND_MODE_IDS 对齐):
//   0=normal  1=multiply  2=screen  3=overlay  4=add  5=subtract

struct Uniforms {
    resolution: vec2f,
    inputCount: u32,
    blendMode: u32,
    _pad: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTex0: texture_2d<f32>;
@group(0) @binding(2) var inputTex1: texture_2d<f32>;
@group(0) @binding(3) var outputTex: texture_storage_2d<rgba8unorm, write>;

const BLEND_NORMAL: u32 = 0u;
const BLEND_MULTIPLY: u32 = 1u;
const BLEND_SCREEN: u32 = 2u;
const BLEND_OVERLAY: u32 = 3u;
const BLEND_ADD: u32 = 4u;
const BLEND_SUBTRACT: u32 = 5u;

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

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let texSize = textureDimensions(outputTex);

    if (gid.x >= texSize.x || gid.y >= texSize.y) {
        return;
    }

    let pixelCoord = vec2i(gid.xy);

    // base layer
    var color = textureLoad(inputTex0, pixelCoord);

    // 叠加第二个输入
    if (uniforms.inputCount > 1u) {
        let src = textureLoad(inputTex1, pixelCoord);
        color = blend_colors(color, src, uniforms.blendMode);
    }

    textureStore(outputTex, pixelCoord, color);
}
