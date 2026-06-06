# 发布（CI）

npm 包通过 GitHub Actions 发布（`.github/workflows/release.yml`），用 **npm Trusted
Publishing（OIDC，免 token）**：CI 凭 GitHub 的 OIDC id-token 直接换取发布凭证，
**不需要任何长期密钥**，且自动带 provenance 供应链溯源。本地也就不用再处理 2FA OTP。

## 一次性配置（每个包做一次）

在 npmjs.com 打开包页（如 `@yunlefun/deploy`）→ **Settings** → **Trusted Publisher**
→ 选 GitHub Actions，填：

- Organization / user：`YunLeFun`
- Repository：`ylf`
- Workflow filename：`release.yml`
- Environment：留空

对 `cilicili`、`ylf` 等其它要发的包重复一次（每个包独立配置一次）。

> 包名首次创建需是 public：工作流已带 `--access public`。

## 发布一个包

**方式 A：手动触发（推荐）**

```bash
gh workflow run release.yml -f package=deploy   # 或 package=cilicili
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

- 工作流权限含 `id-token: write`（OIDC 必需）、`contents: write`（建 Release 必需）；
- 用 `npm@latest`（Trusted Publishing 需 npm ≥ 11.5.1）；
- 各包 `package.json` 含 `repository` 字段（provenance 必需）；
- changelog 需要完整 git 历史，故 `checkout` 用 `fetch-depth: 0`；
- 自动 changelog 只在**推 tag**时生成（手动 `workflow_dispatch` 无 tag，会跳过该步——
  想要 Release 就用推 tag 的方式发布）。

## 回退方案：Automation Token

若暂不想配 Trusted Publisher，可改用 token：npmjs.com 生成 Classic「Automation」token →
`gh secret set NPM_TOKEN --repo YunLeFun/ylf`，并在 `release.yml` 的 Publish 步骤加回
`env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }`。
