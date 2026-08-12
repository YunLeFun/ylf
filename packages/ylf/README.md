# ylf

YunLeFun CLI，使用 [Bun](https://bun.sh) 直接运行 TypeScript：

```bash
bunx ylf [command]
```

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
