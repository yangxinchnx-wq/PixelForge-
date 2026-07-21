// PixelForge Compositor — Composite Shader
//
// 最简单：把视频画出来。
// 输入：texture + sampler
// 输出：fragment color
//
// @group(0) @binding(0) var texture: texture_2d<f32>;
// @group(0) @binding(1) var sampler: sampler;

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var inputSampler: sampler;
@group(0) @binding(2) var<uniform> layerUniforms: LayerUniform;

struct LayerUniform {
    matrix: mat3x3<f32>,
    opacity: f32,
    blendMode: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    // 全屏四边形（两个三角形）
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    );

    let pos = positions[vi];
    var out: VertexOutput;
    out.position = vec4<f32>(pos, 0.0, 1.0);
    out.uv = vec2<f32>((pos.x + 1.0) * 0.5, 1.0 - (pos.y + 1.0) * 0.5);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(inputTexture, inputSampler, in.uv);
    return vec4<f32>(color.rgb * layerUniforms.opacity, color.a * layerUniforms.opacity);
}
