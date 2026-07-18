import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    './src/index',
    './src/h3',
  ],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: true,
  },
})
