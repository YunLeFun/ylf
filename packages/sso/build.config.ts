import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    './src/index',
    './src/protocol',
  ],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: true,
  },
})
