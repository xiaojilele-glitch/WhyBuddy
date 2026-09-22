# vendor/

## tailwind-play-3.js

Tailwind CSS 的 **Play CDN** 构建（运行时 JIT），从 `https://cdn.tailwindcss.com` 取下来固化在这里。

### 为什么不直接用 CDN

生成出来的页面**全部样式**都来自这一个脚本（第 3 步的提示词让模型写 Tailwind 类名 +
一段 `tailwind.config` 配色）。它加载不到 = 整页零 CSS，就是一堆裸文字加撑满屏的图标。

而 `cdn.tailwindcss.com` 在国内经常连不上——这个仓的容器里就一直连不上（跑离线渲染
要靠 Playwright 路由拦截喂本地）。**把交付物的可用性押在一个境外 CDN 上是不成立的。**

同源自托管之后：不受网络环境影响、不多一次跨域请求、首屏更快。

### 更新

    curl -sSL -o client/public/vendor/tailwind-play-3.js https://cdn.tailwindcss.com

⚠ 必须是 **v3 的 Play CDN**：生成侧写的是 v3 语义的 `tailwind.config = {...}`，
v4 改成了 CSS-first 的 `@theme`，换过去这些页面的配色会整片失效。
