import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    './src/index',
    './src/browser',
    './src/protocol',
    './src/server',
  ],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: true,
  },
})
