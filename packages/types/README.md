# @yunlefun/types

云乐坊（Yunle.fun）跨端共享的 TypeScript 类型定义。

供 `apps.yunle.fun`（云居 App）与 `www.yunle.fun`（官网 / 支付）共用，
收敛两端都需要的核心类型：

- **app** — 应用信息 `YlfAppInfo`（含付费 `coinCost` / 会员专属 `requiresMembership` 字段）
- **payment** — 平台账户与云币（`AccountSnapshot` / `CoinTransaction` / 会员等级等）

## 安装

```bash
pnpm add @yunlefun/types
```

```ts
import type { AccountSnapshot, YlfAppInfo } from '@yunlefun/types'
import { formatCoin } from '@yunlefun/types'
```

## 开发 / 构建

```bash
bun run build   # unbuild 产出 dist（esm + cjs + d.ts）
```

## 发布

通过仓库根的 `.github/workflows/release.yml`（npm Trusted Publishing / OIDC）发布：

```bash
git tag '@yunlefun/types@0.0.1' && git push origin '@yunlefun/types@0.0.1'
```

> 首次发布前需在 npmjs.com 的包设置里把本仓库的 `release.yml` 配为 trusted publisher，
> 详见 `.github/workflows/RELEASING.md`。
