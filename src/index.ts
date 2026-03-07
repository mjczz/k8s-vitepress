import { createAssetHandler } from '@cloudflare/kv-asset-handler';

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // 使用 Asset Handler 处理静态文件
      return await createAssetHandler({
        request,
        env,
        ctx,
        // 自定义配置
        cacheControl: {
          browserTTL: 60 * 60 * 24 * 365, // 1 年
          edgeTTL: 60 * 60 * 24 * 30,     // 30 天
          bypassCache: false,
        },
      });
    } catch (e: any) {
      // 如果找不到文件，返回 index.html（SPA 支持）
      if (e.status === 404) {
        try {
          const notFoundResponse = await env.ASSETS.fetch(
            new Request(`${new URL(request.url).origin}/index.html`)
          );
          return new Response(notFoundResponse.body, {
            ...notFoundResponse,
            status: 200,
          });
        } catch (e2: any) {
          return new Response('Not Found', { status: 404 });
        }
      }

      return new Response(e.message || 'Internal Error', { status: e.status || 500 });
    }
  },
};
