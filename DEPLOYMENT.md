# Cloudflare Workers 部署文档

## 项目概述

本项目使用 **VitePress** 构建静态网站，通过 **Cloudflare Workers** 进行部署。

## 部署架构

```
VitePress (docs/) → 构建 → docs/.vitepress/dist/ → Cloudflare Assets → Workers
```

## 配置文件

### wrangler.toml

```toml
name = "k8s-vitepress"
main = "src/index.ts"
compatibility_date = "2026-03-07"

# 静态资源配置（使用 Assets）
[assets]
directory = "docs/.vitepress/dist"
binding = "ASSETS"

# 环境变量
[vars]
NODE_ENV = "production"
```

### src/index.ts

使用 `@cloudflare/kv-asset-handler` 处理静态资源请求，支持 SPA 路由回退：

```typescript
import { createAssetHandler } from '@cloudflare/kv-asset-handler';

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ... 处理静态资源和 SPA 路由
  },
};
```

### docs/.vitepress/config.ts

关键配置：

```typescript
{
  base: '/',  // 部署到根路径时使用
  // ...
}
```

## 部署命令

```bash
npm run deploy
```

该命令会依次执行：
1. `vitepress build docs` - 构建静态网站到 `docs/.vitepress/dist`
2. `wrangler deploy` - 部署到 Cloudflare Workers

## 常见问题

### base 路径配置

| 部署目标 | base 配置 |
|---------|-----------|
| `https://your-worker.workers.dev/` | `base: '/'` |
| `https://your-domain.com/` | `base: '/'` |
| `https://your-domain.com/k8s-vitepress/` | `base: '/k8s-vitepress/'` |

### Assets 目录配置

必须确保 `wrangler.toml` 中的 `assets.directory` 指向 VitePress 的实际构建输出目录：

```toml
[assets]
directory = "docs/.vitepress/dist"  # 正确
```
