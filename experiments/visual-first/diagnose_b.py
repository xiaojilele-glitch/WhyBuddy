"""B 组为什么解析失败——拿到完整原文再判，别靠 200 字的错误消息猜。"""
import json, os, pathlib, sys, time
_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE)); sys.path.insert(0, str(_HERE.parent.parent / "slide-rule-python"))
for line in (_HERE.parent.parent / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("="); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
os.environ["APP_STORE_HTTP_API_URL"] = ""; os.environ["APP_STORE_HTTP_API_KEY"] = ""

import runner
from services.v5_llm_generate import _build_user_content, schema_instruction_for
from sliderule_llm.client import call_llm

goal, spec, images = runner.load_goal(), runner.load_spec_digest(), runner.load_images()
parts = [{"type": "text", "text": _build_user_content(goal) + "\n\n需求树：\n" + spec +
          "\n\n随附界面草样，作结构证据，不要把图上的占位文字当枚举值。"}]
for name, b64 in images:
    parts += [{"type": "text", "text": f"界面草样：{name}"},
              {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}]

t0 = time.time()
r = call_llm([{"role": "system", "content": schema_instruction_for(goal)},
              {"role": "user", "content": parts}], temperature=0.2)
raw = r.content or ""
print(f"{time.time()-t0:.0f}s  finish={r.finish_reason}  正文 {len(raw)} 字符  usage={r.usage}")
(_HERE / "runs" / "diag_raw.txt").write_text(raw, encoding="utf-8")

print("\n① 直接 json.loads：", end="")
try:
    json.loads(raw); print("成功")
except Exception as e:
    print(f"失败 → {e}")
    print("   出错位置附近：", repr(raw[max(0,int(getattr(e,'pos',0))-90):int(getattr(e,'pos',0))+90]))

print("② 剥 markdown 围栏后：", end="")
import re
t = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
try:
    json.loads(t); print("成功 ← 那就是围栏的问题")
except Exception as e: print(f"仍失败 → {str(e)[:90]}")

print("③ json_repair 机械修复：", end="")
try:
    import json_repair
    fixed = json_repair.repair_json(t)
    obj = json.loads(fixed)
    missing = [k for k in ("datamodel","rbac","workflow","page","aigc","appbundle") if k not in obj]
    print(f"成功 ← 缺段 {missing or '无'}；修复前 {len(t)} 字符 → 修复后 {len(fixed)}")
except Exception as e:
    print(f"仍失败 → {str(e)[:120]}")
