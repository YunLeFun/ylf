import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: ['src/index', 'src/server', 'src/feishu'],
  declaration: 'node16',
  clean: true,
})
