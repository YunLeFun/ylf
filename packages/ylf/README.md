# ylf

YunLeFun CLI，需要 Node.js 20.19 或更高版本。无需全局安装时可直接运行：

```bash
pnpm dlx ylf [command]
```

## YunLeFun Pages

将静态构建目录部署到 `pages.yunle.fun/<project>/`：

```bash
pnpm add -g ylf
ylf auth login
ylf pages init --workspace yunlefun --project demo --output dist
pnpm build
ylf pages deploy --dry-run
ylf pages deploy
```

项目 `demo` 的 Vite、Nuxt 或 VitePress base path 应设置为 `/demo/`；CLI 会提示，但不会修改构建配置。`ylf.pages.json` 只记录工作区、不可变项目路径和输出目录，公开/分享/private 权限仍由 [Admin Pages](https://admin.yunle.fun/pages) 管理。

CLI 默认清理上一份受管清单中的旧文件；可以用 `--no-clean` 保留，用 `--allow-large-delete` 明确确认大规模删除。也可以跳过配置文件直接运行：

```bash
ylf pages deploy ./dist --workspace yunlefun --project demo
```

GitHub Actions 使用 `permissions: { contents: read, id-token: write }` 和 Admin 中的精确 repository/ref OIDC 绑定，不需要长期云密钥。完整权限模型、配置示例、CI 工作流和排障见 [YunLeFun Pages 指南](https://wiki.yunle.fun/technical/frontend/cloud-storage/pages-hosting)。

## EdgeOne 缓存刷新

`tc teo purge` 使用腾讯云 Node.js SDK 的 `CreatePurgeTask` 提交刷新任务。先配置最小权限的腾讯云凭据：

```bash
export TENCENT_CLOUD_SECRET_ID=...
export TENCENT_CLOUD_SECRET_KEY=...
```

Hostname 刷新：

```bash
bunx ylf tc teo purge \
  --zoneId zone-abc123 \
  --type purge_host \
  --targets cdn.example.com static.example.com
```

URL 或目录刷新必须传完整 HTTP(S) URL。`--method delete` 会直接删除节点缓存；不传时由 EdgeOne 使用默认的 `invalidate`：

```bash
bunx ylf tc teo purge \
  --zoneId zone-abc123 \
  --type purge_prefix \
  --method invalidate \
  --targets https://cdn.example.com/assets/
```

全站刷新影响最大，必须省略 `--targets` 并通过 `--confirmAll` 精确重复 ZoneId：

```bash
bunx ylf tc teo purge \
  --zoneId zone-abc123 \
  --type purge_all \
  --confirmAll zone-abc123
```

Cache-Tag 刷新需要同时指定标签和受影响域名：

```bash
bunx ylf tc teo purge \
  --zoneId zone-abc123 \
  --type purge_cache_tag \
  --targets release-42 \
  --cacheTagDomains www.example.com
```

CI 接入前先用 `--dryRun --json` 校验请求；dry-run 不读取凭据、不访问腾讯云。实际提交配合 `--json` 会输出稳定的单行结果：

```text
{"jobId":"job-42","requestId":"request-42"}
```

命令会拒绝空 ZoneId、空目标、不带协议的 URL、通配 Hostname、未确认的全站刷新、部分失败和缺少 JobId 的异常响应。腾讯云参数与清除语义见 [CreatePurgeTask](https://cloud.tencent.com/document/api/1552/80703) 和 [清除缓存](https://cloud.tencent.com/document/product/1552/70759)。
