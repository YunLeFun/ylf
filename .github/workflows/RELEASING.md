# 发布（CI）

npm 包通过 GitHub Actions 发布（`.github/workflows/release.yml`），用 **npm Trusted
Publishing（OIDC，免 token）**：CI 凭 GitHub 的 OIDC id-token 直接换取发布凭证，
**不需要任何长期密钥**。公开仓库发布公开包时，npm 会自动附带 provenance 供应链溯源；
公开仓库使用标准 GitHub-hosted runner 发布，无需本地 npm 登录。

## 一次性配置（每个包做一次）

推荐用 npm CLI 配置（需 npm ≥ 11.10.0，首次会要求一次 WebAuth/2FA）：

```bash
npm trust github @yunlefun/sso \
  --repo YunLeFun/ylf \
  --file release.yml \
  --allow-publish
```

也可以在 npmjs.com 打开包页 → **Settings** → **Trusted Publisher** → 选 GitHub
Actions，填：

- Organization / user：`YunLeFun`
- Repository：`ylf`
- Workflow filename：`release.yml`
- Environment：留空

对 `cilicili`、`ylf` 等其它要发的包重复一次（每个包独立配置一次）。可用
`npm trust list <包名>` 验证配置。

Support SDK 的一次性配置同样绑定本仓库已有工作流：

```bash
npm trust github @yunlefun/support-client \
  --repo YunLeFun/ylf \
  --file release.yml \
  --allow-publish
```

Support 主服务继续私有，SDK 的源码、测试、MIT 许可与发布元数据统一维护在
`packages/support-client`。不从公开 CI 拉取 Support 私有仓库或生产配置。

> npm 只能在已存在的包上配置 Trusted Publisher。新包需由维护者用 WebAuth/2FA
> 完成一次 `npm publish --access public` 引导发布，再立即配置 Trusted Publisher；
> 后续发布全部走 OIDC。工作流已带 `--access public`。

## 发布一个包

**方式 A：手动触发（推荐）**

```bash
gh workflow run release.yml -f package=server-session
# Support SDK：
gh workflow run release.yml --repo YunLeFun/ylf -f package=support-client
```

或 GitHub 网页 Actions → Release → Run workflow 选包。
版本号取自该包 `package.json` 的 `version`（先用 `bumpp` 改好并提交、推送到 `main`）。

**方式 B：推 tag**

```bash
git tag '@yunlefun/deploy@0.0.12' && git push origin '@yunlefun/deploy@0.0.12'
```

## 工作流做了什么

1. `pnpm install` → 定位包目录（手动输入或从 tag `<name>@<version>` 反查）；
2. 若该版本已在 registry 上存在则**跳过**（可重复运行）；
3. `pnpm run build` 构建；
4. `pnpm pack` 打包 —— 会把 `workspace:*` 协议转成真实版本号（`npm publish` 不认 `workspace:`）；
5. `npm publish *.tgz --access public` —— OIDC 自动鉴权 + provenance；
6. **仅 tag 触发**时，`changelogithub` 按 conventional commits 自动创建/更新该 tag 的
   **GitHub Release**（仓库级：纳入与上一个 tag 之间的全部提交，按 feat/fix 等分类）。

Support SDK 发布前额外执行自身类型检查、离线测试与实际 tarball 安装验收；包内
白名单只允许运行产物、类型、元数据、README 和 MIT LICENSE。发布后通过无凭据
registry 读取并校验 SHA-512 integrity，下载回装，验证根入口、两个 Node 子入口和
TypeScript 类型。临时消费项目在结束时自动清理。可在本地复用：

```bash
pnpm --filter @yunlefun/support-client pack --out /tmp/support-client.tgz
node scripts/check-support-client-package.mjs /tmp/support-client.tgz
node scripts/check-support-client-package.mjs --registry 0.4.0
```

tag 示例为 `@yunlefun/support-client@0.4.0`，必须与包内版本完全一致。首次引导后
同版本的工作流只会跳过已有发布；后续更新版本再推对应 tag，验证真实 OIDC 发布。
每个包使用独立版本，不要求一次发布全部 SDK。

要点：

- `publish` 任务只有 `contents: read` + `id-token: write`；建 GitHub Release 的
  `contents: write` 被隔离在独立的 `release` 任务；
- 固定使用经过验证的 npm 11.16.0（Trusted Publishing 需 npm ≥ 11.5.1）；
- 发布提交必须位于 `main` 历史中，tag 必须严格等于 `<package-name>@<version>`；
- tarball 固定写入 Runner 临时目录的唯一文件，避免误发工作区残留包；
- 发布串行执行；安装依赖前先核对发布提交属于 main，发布任务不恢复依赖缓存；
- 各包 `package.json` 含 `repository` 字段（provenance 必需）；
- changelog 需要完整 git 历史，故 `checkout` 用 `fetch-depth: 0`；
- 自动 changelog 只在**推 tag**时生成（手动 `workflow_dispatch` 无 tag，会跳过该步——
  想要 Release 就用推 tag 的方式发布）。

Trusted Publisher 会让能够修改仓库和该工作流的成员获得包发布能力。仓库写权限只授予
同时拥有 npm 发布权限的维护者，并强制启用 GitHub 2FA。应使用受保护分支；若配置带
审批人的 `npm-publish` Environment，须把同名 Environment 同时绑定到 npm Trusted
Publisher，避免信任配置与工作流不一致。

## 回退原则

不要为常规发布保存 Classic Automation Token。只有 npm Trusted Publishing 服务异常且
必须紧急发布时，才临时创建短期、最小权限的 granular access token；使用后立即吊销，
并在发布记录中注明例外原因。
