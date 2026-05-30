# Blueprint Session Skill Upload Package

这是给 Trae “上传技能”使用的最小技能包。

## 包含内容

- `SKILL.md`：上传技能的主入口文件
- `README.md`：本说明文件
- `examples.md`：常用调用示例

## 上传方法

1. 打开 Trae 的“技能”页面
2. 点击“上传技能”
3. 上传整个目录压缩出来的 zip 文件
4. 启用上传后的技能

## 使用前准备

在项目根目录启动本地服务：

```bash
env SOLO_TRAE_BYPASS_AUTH=true PORT=3101 SKILL_BRIDGE_BASE_URL=http://127.0.0.1:3101 pnpm exec tsx server/index.ts
```

## 技能依赖

这个技能包本身不包含后端实现。
它只是 Skill 外壳，真正的能力来自本地运行的会话接口：

```text
http://127.0.0.1:3101/api/skill/session/*
```
