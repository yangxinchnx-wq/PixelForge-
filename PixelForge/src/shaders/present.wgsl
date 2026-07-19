struct PresentUniforms {
  canvasSize: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: PresentUniforms;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var nearestSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var output: VertexOutput;
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let position = positions[vid];
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = vec2f((position.x + 1.0) * 0.5, (position.y + 1.0) * 0.5);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let flippedUV = vec2f(input.uv.x, 1.0 - input.uv.y);
  return textureSample(srcTex, nearestSampler, flippedUV);
}
