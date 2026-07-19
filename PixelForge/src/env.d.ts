/// <reference types="vite/client" />
/// <reference types="vitest/globals" />
/// <reference types="@webgpu/types" />

declare module '*.wgsl' {
  const source: string
  export default source
}

declare module '*.wgsl?raw' {
  const source: string
  export default source
}
