// 在**真产品界面**里跑一次推演，然后逐页走生成出来的应用并量化每一页。
//
// 用法：UI_EMAIL=… UI_PASSWORD=… node walk_generated_app.mjs <输出目录> <目标文本>
// 前置：pnpm run dev:all
//
// ## 三处是被自己的错误观测逼出来的，别删
//
// 1) **等「填了 N 处」再截，不要固定等 N 秒**。宿主填数据是异步的
//    （live-runtime/html-binding-runtime.ts 按 data-rows 克隆行）。实测同一页
//    同一应用：等 9 秒截到 **1 行**、等到「填了 93 处」再截是 **10 行**。
//    我拿前者当「表格只生成一条数据」报过缺陷，是错的。
//
// 2) **每次点击后 iframe 会重载，句柄立刻失效**（Frame was detached）。
//    必须每轮重新取 frame，不能复用第一次拿到的那个。
//
// 3) **先点「新建会话」**。不新建就落进上一个会话，界面显示的是旧会话的步数
//    （实测一直显示「52 步 218s」），会让人以为推演没动。
//
// ⚠ 还有一条不在代码里但同样会骗人：**未登录时推演接口 401，而前端只是原地
//   重试、界面转圈**，表现完全像「推演很慢」。所以这里登录失败就直接退出。
import { chromium } from '@playwright/test';
const OUT=process.argv[2], GOAL=process.argv[3];
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1920,height:1080}});
const lr=await ctx.request.post('http://127.0.0.1:3000/api/sliderule/account/login',
  {data:{email:process.env.UI_EMAIL,password:process.env.UI_PASSWORD}});
console.log('  登录',lr.status());
const p=await ctx.newPage();
p.on('console',m=>{const t=m.text(); if(/error|Error/i.test(t)&&!/favicon/.test(t))console.log('  [console]',t.slice(0,110));});
await p.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(5000);
// 新建会话，避免落进已有会话
const nb=p.locator('text=新建会话').first();
if(await nb.count()){ await nb.click(); await p.waitForTimeout(2500); }
// ⚠ **移动端必须点输入框里那个「应用」开关**，不是在话题里写「手机端」。
//   那个开关走 device_policy._override，**优先级压过话题里的设备词**
//   （resolve_preferred_device：用户开关 > 话题设备词 > 模型选择 > desktop）。
//   我第一次没点它，话题里写足了「手机端/小程序」，照样出 1920×1080 桌面版。
const wantPhone = /^phone:/.test(GOAL);
const text = GOAL.replace(/^phone:/, '');
if (wantPhone) {
  // ⚠ 侧边栏里有「应用市场」，`:has-text("应用")` 会命中它。必须限定在输入框
  //   那一行里，且用**精确文本**。我上一版就是点中了侧边栏，日志还打了
  //   「已点开关」——然后照样出 1920×1080 桌面版，白烧一轮推演。
  const composer = p.locator('form, [class*=composer]').filter({ has: p.locator('textarea') }).first();
  const scope = (await composer.count()) ? composer : p.locator('body');
  const btn = scope.getByText(/^应用$/).first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(800); }

  // ★ 点了不算数，**必须验证真的切过去了**：选中「应用」后输入框的
  //   placeholder 会从「描述你想构建的业务系统…」变成「…手机应用…」。
  //   验不过就退出——白跑一轮推演比报错糟得多。
  const ph = await p.locator('textarea').first().getAttribute('placeholder');
  console.log(`  输入框提示：「${ph}」`);
  if (!/手机/.test(ph || '')) {
    console.log('  ✗ 「应用」开关没切过去（提示文字未变），不提交，避免白跑一轮');
    await b.close(); process.exit(1);
  }
  console.log('  ✓ 已切到「应用」（竖屏）');
}
const box=p.locator('textarea, input[type=text]').first();
await box.click(); await box.fill(text); await p.waitForTimeout(400);
await p.keyboard.press('Enter');
console.log('  已提交移动端话题，等闭环…');
const t0=Date.now();
for(let i=0;i<160;i++){
  await p.waitForTimeout(5000);
  const t=await p.evaluate(()=>document.body.innerText);
  if(/closed\s*6\/6|本次推演已顺利闭环/.test(t)){ console.log(`  ✓ 闭环 ${((Date.now()-t0)/1000)|0}s`); break; }
  if(i%6===0) console.log(`  [${((Date.now()-t0)/1000)|0}s] 等待中`);
}
// 等宿主填数据
const waitFilled=async(ms=45000)=>{const s=Date.now();
  while(Date.now()-s<ms){const t=await p.evaluate(()=>document.body.innerText);
    const m=t.match(/填了\s*(\d+)\s*处/); if(m&&+m[1]>0)return +m[1]; await p.waitForTimeout(1000);} return 0;};
const filled=await waitFilled();
console.log(`  首屏 填了 ${filled} 处`);
await p.screenshot({path:`${OUT}/m00-first.png`});
const frame=()=>p.frames().find(fr=>fr!==p.mainFrame());
const f0=frame();
if(!f0){ console.log('  没有应用 iframe'); await b.close(); process.exit(0); }
const labels=await f0.locator('nav a, aside a').allInnerTexts();
console.log(`  底栏/菜单 ${labels.length} 项: ${labels.map(s=>s.trim().slice(0,6)).join(' / ')}`);
for(let i=0;i<labels.length && i<6;i++){
  const label=(labels[i].trim().slice(0,8).replace(/[^\w一-龥]/g,''))||`p${i}`;
  try{
    await frame().locator('nav a, aside a').nth(i).click({timeout:5000});
    const fl=await waitFilled(30000); await p.waitForTimeout(1500);
    await p.screenshot({path:`${OUT}/m${String(i+1).padStart(2,'0')}-${label}.png`});
    const s=await frame().evaluate(()=>{
      const txt=document.body.innerText;
      const seq=(txt.match(/[一-龥]{2,8}\s\d{1,3}(?=\s|$)/gm)||[]).length;
      const ph=(txt.match(/20XX|XXXX|###/g)||[]).length;
      const rows=[...document.querySelectorAll('table')].map(t=>t.querySelectorAll('tbody tr').length);
      const dup=(()=>{const c={};for(const el of document.querySelectorAll('body *')){
        if(el.children.length)continue;const t=(el.textContent||'').trim();
        if(t&&/[一-龥]/.test(t))c[t]=(c[t]||0)+1;}
        const m=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];return m?`${m[0].slice(0,14)}×${m[1]}`:'—';})();
      return {seq,ph,rows,dup};
    });
    console.log(`    ${label.padEnd(8)} 填${String(fl).padStart(3)}处 行${JSON.stringify(s.rows)} 序号枚举${s.seq} 占位符${s.ph} 最大重复「${s.dup}」`);
  }catch(e){ console.log(`    ${label.padEnd(8)} ✗ ${String(e).slice(0,44)}`); }
}
await b.close();
