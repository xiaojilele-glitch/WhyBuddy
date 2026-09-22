// 量「生成出来的页面，首屏是不是被一个默认打开的浮层盖住」。
//
// 用法：node overlay_probe.mjs <目录> <tailwind.js 路径> [截图输出目录]
//   目录下每个子目录名以 phone__ / desktop__ 开头，决定用哪个视口
//   （提示词里的浮层约束本身就是分设备写的，用错视口会把覆盖率算歪）。
//
// 2026-08-22 用它在 53 份真机页面上抓到 3 份首屏被模态盖死：
// 生成侧照做了（浮层根节点带了 `hidden`），是消费侧 page_shell 的铺满层
// `body>div[class*="justify-center"]{display:flex!important}` 把它掀开的。
// 详见 services/page_shell.py 模块头「第四趟」。
//
// ## 三处是被自己的错误观测逼出来的，别删
//
// 1) **样本要对**。第一次拿 refine-fingerprint/runs-phone 那批量，量出 0，
//    差点据此结论「不存在这个缺陷」——那批是另一个应用。真正出问题的那版
//    只在会话里（GET /api/sliderule/sessions/{sid} → state.specFirstPages.pages）。
// 2) **`file:` 也匹配 `**://**`**。route 里不显式放行，整页 ERR_FAILED，
//    而报错长得像「页面坏了」。
// 3) **机械命中要用眼睛复核**。`absolute bottom-16 left-0 right-0
//    pointer-events-none` 的悬浮 CTA 会被算成 92% 覆盖——它不是浮层。
//    所以留了截图口子：拿到命中先截出来看，别直接当缺陷报。
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
import { chromium } from '@playwright/test';
import { readdirSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
const ROOT = process.argv[2];
const TW = process.argv[3];
const SHOT = process.argv[4] || '';
if (SHOT) mkdirSync(SHOT, { recursive: true });
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const PROBE = () => {
  const VW=innerWidth, VH=innerHeight, A=VW*VH, out=[];
  for (const el of document.querySelectorAll('body *')) {
    const cs=getComputedStyle(el);
    if(!['fixed','absolute'].includes(cs.position)) continue;
    if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0) continue;
    if(el.hasAttribute('hidden')) continue;
    const bb=el.getBoundingClientRect();
    const w=Math.min(bb.right,VW)-Math.max(bb.left,0), h=Math.min(bb.bottom,VH)-Math.max(bb.top,0);
    if(w<=0||h<=0) continue;
    const cover=(w*h)/A, z=parseInt(cs.zIndex)||0;
    if(cover>=0.40||(cover>=0.25&&z>=10))
      out.push({cover:+cover.toFixed(2), z, cls:(el.className||'').toString().slice(0,50),
                txt:(el.innerText||'').trim().slice(0,26).replace(/\s+/g,' ')});
  }
  return out.filter((o,i)=>!out.some((q,j)=>j<i&&q.cover>=o.cover&&q.z<=o.z));
};
for (const dev of ['phone','desktop']) {
  const vp = dev==='phone'?{width:390,height:844}:{width:1920,height:1080};
  const ctx = await b.newContext({viewport:vp});
  const p = await ctx.newPage();
  await p.route('**://**', r => {
    const u = r.request().url();
    if (u.startsWith('file:')) return r.continue();   // ⚠ 不放行整页 ERR_FAILED
    if (/tailwind/.test(u)) return r.fulfill({path:TW, contentType:'application/javascript'});
    return r.abort();                                  // 外链一律断，跟离线环境一致
  });
  let n=0, hit=0;
  for (const d of readdirSync(ROOT).filter(x=>x.startsWith(dev+'__'))) {
    for (const f of readdirSync(join(ROOT,d)).filter(x=>x.endsWith('.html'))) {
      await p.goto('file://'+resolve(ROOT,d,f),{waitUntil:'load'});
      await p.waitForTimeout(900);
      const r = await p.evaluate(PROBE);
      n++;
      if (r.length) { hit++;
        console.log(`  ${dev} ${d.slice(-12)}/${f.padEnd(20)} ${r.map(o=>`${o.cover*100|0}%屏 z=${o.z} 「${o.txt}」`).join(' | ')}`);
        if (SHOT) await p.screenshot({path: join(SHOT, `${d}_${f.replace('.html','')}.png`)});
      }
    }
  }
  console.log(`${dev}: ${hit}/${n} 页首屏被浮层盖住\n`);
  await ctx.close();
}
await b.close();
