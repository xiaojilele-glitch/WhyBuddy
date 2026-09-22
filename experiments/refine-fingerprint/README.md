# 精修逐段指纹：量清「0/6」的成分

2026-08-17。为了回答一个问题而写：**「逐段指纹 0/6」到底是内容被重写，
还是只是 id 换了一批？**

答案是后者占多数（六段里四段），详见
`docs/交接-精修增量化-2026-08-16.md` 第五节。而在量清楚之前，四次修复的
方案选型都建立在「内容被重写」这个**从没被单独验证过**的假设上。

## 用法

```bash
# 1) 跑两轮真机直驱，把两版模型落盘（约 10~15 分钟，真调 LLM，要钱）
#    ⚠ 必须先导 .env！LLM 客户端读的是 os.environ（sliderule_llm/config.py:19），
#      而 pydantic 的 env_file 只喂它自己声明的字段。不导出会**静默**降级成
#      "没配 LLM"，跑出来一份 fallback 结果，看起来像成功。
set -a && . .env && set +a
slide-rule-python/.venv/bin/python experiments/refine-fingerprint/two_round_drive.py "做一个社区养老服务管理平台"

# 2) 分析（纯本地、零成本，改算法随便重跑）
python3 experiments/refine-fingerprint/analyze_ids.py experiments/refine-fingerprint
```

跑与分析**故意拆成两个脚本**：跑一次十几分钟要钱，分析要改十遍。第一版焊在
一起，拿到结论想换个算法就得重跑。

## 三把尺子，别只看第一把

```
raw          原样 sha256                              ← 现在判据在用的那把
抹 id 后      id 换成被引对象的名字、列表按内容排序
名字 Jaccard  每段里人类可读名字的集合相似度
```

`raw` 单独用会把「id 抖动」和「内容重写」混成同一个读数——**四次修复就是被它
误导的**。

## ⚠ 这把尺子自己踩过的两个坑

1. **两边各用自己的 id→name 表解引用**，会让同一份字节被判成"变"（引用的对象
   在新一轮没了）。结果"抹 id 后"比 raw 还低，荒谬。已用单调性兜底修掉。
2. **权限是裸字符串**（`elder:read`），没有 `name` 字段，永远进不了 id→name 表。
   只看这把尺子会得出「id 不是主因」的**错误结论**——第一版就是这么错的，
   是回头直接把 `rbac.roles` 的原始数据摊开看（3/3 名字相同、0/3 id 相同）
   才纠正过来。

**量不清楚的时候，直接把两版数据摊开看比造尺子快。**

## 自检

改完算法先拿合成数据验一遍它还分得开——一把把什么都判成"id 抖动"的尺子
比没有尺子更糟：

- 只换 id、内容一字不改 → 应读出 `raw 0/6`、`抹 id 后 6/6`
- 真改内容 → 对应段应落在「基本重写」

## ab-2026-08-17/：id 冻结的 A/B 数据

同模型（flash-lite）、同话题、同指令，只差 `SLIDERULE_REFINE_ID_FREEZE`：

```bash
python3 experiments/refine-fingerprint/analyze_ids.py experiments/refine-fingerprint/ab-2026-08-17
# ↑ 默认读 model_round{1,2}.json，比 A/B 要先把 on_/off_ 那对改名或分目录放
```

结果见 `docs/交接-精修增量化-2026-08-16.md` 第六节。每臂 n=1，方向一致
幅度大但下不了统计结论。

## ⚠ 跨模型不能比

根目录那两份 `model_round{1,2}.json` 是 **flash** 跑的，`ab-2026-08-17/` 四份是
**flash-lite**。**别互相比**——换模型比前后是把两个变量混在一起。要对照就
同模型重跑两臂（跑一轮才 100~150 秒，别省这个）。
