import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    bin: 'src/bin.ts',
    index: 'src/index.ts',
  },
  clean: true,
  dts: true,
  format: ['esm'],
  platform: 'node',
  sourcemap: true,
  target: 'node20',
  treeshake: true,
})
