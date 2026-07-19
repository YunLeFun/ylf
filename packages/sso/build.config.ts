import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    './src/index',
    './src/legacy',
    './src/protocol',
  ],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: true,
  },
})
