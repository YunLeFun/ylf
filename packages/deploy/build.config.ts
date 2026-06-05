import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    './src/index',
  ],
  declaration: true,
  clean: true,
  // cilicili 是同仓私有小工具（devDependency），unbuild 默认会把它内联进产物，
  // 使 deploy 自包含、避免跨包发布版本错配；放行内联产生的 implicit-external 告警。
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
})
