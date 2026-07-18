# 发布（CI）

npm 包通过 GitHub Actions 发布（`.github/workflows/release.yml`），用 **npm Trusted
Publishing（OIDC，免 token）**：CI 凭 GitHub 的 OIDC id-token 直接换取发布凭证，
**不需要任何长期密钥**。公开仓库发布公开包时，npm 会自动附带 provenance 供应链溯源；
本仓库当前为 private，Trusted Publishing 仍可用，但不会生成公开可验证的 provenance 声明。

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

> npm 只能在已存在的包上配置 Trusted Publisher。新包需由维护者用 WebAuth/2FA
> 完成一次 `npm publish --access public` 引导发布，再立即配置 Trusted Publisher；
> 后续发布全部走 OIDC。工作流已带 `--access public`。

## 发布一个包

**方式 A：手动触发（推荐）**

```bash
gh workflow run release.yml -f package=server-session
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

要点：

- `publish` 任务只有 `contents: read` + `id-token: write`；建 GitHub Release 的
  `contents: write` 被隔离在独立的 `release` 任务；
- 固定使用经过验证的 npm 11.16.0（Trusted Publishing 需 npm ≥ 11.5.1）；
- 发布提交必须位于 `main` 历史中，tag 必须严格等于 `<package-name>@<version>`；
- tarball 固定写入 Runner 临时目录的唯一文件，避免误发工作区残留包；
- 各包 `package.json` 含 `repository` 字段（provenance 必需）；
- changelog 需要完整 git 历史，故 `checkout` 用 `fetch-depth: 0`；
- 自动 changelog 只在**推 tag**时生成（手动 `workflow_dispatch` 无 tag，会跳过该步——
  想要 Release 就用推 tag 的方式发布）。

Trusted Publisher 会让能够修改仓库和该工作流的成员获得包发布能力。当前 private 仓库
套餐不提供 `main` branch protection，因此仓库写权限必须只授予同时拥有 npm 发布权限的
维护者，并强制启用 GitHub 2FA。若升级套餐，应立即启用受保护分支和带审批人的
`npm-publish` Environment，并把同名 Environment 同时绑定到 npm Trusted Publisher。

## 回退原则

不要为常规发布保存 Classic Automation Token。只有 npm Trusted Publishing 服务异常且
必须紧急发布时，才临时创建短期、最小权限的 granular access token；使用后立即吊销，
并在发布记录中注明例外原因。
