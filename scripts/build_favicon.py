"""重打 client/public/favicon.ico —— 16/32 用**专画**的帧，不是等比缩下来的。

## 为什么需要这个脚本

2026-08-07 用户反馈"favicon 看着有点糊"，并猜是"像素太高"。量下来正好相反，
而且主因不在分辨率：

    画布 512×512，实心主体占 82% 宽        （留白正常，不是缩得太小）
    半透明像素只占非透明区 1%              （没有柔和投影在糊边）
    ICO 里 16/32/48/64/128/256 都有        （多尺寸是齐的）

真正的原因是**图形对 16px 来说太复杂**：整个标记缩到 16px 只有 13px 宽，
里面那张白脸约 7px，两只眼睛和嘴各自不到 1px。1px 的特征过一遍抗锯齿就是
一团灰——源图再大也救不回来，因为 16 个像素装不下"一张有眼睛有嘴的脸"。

而 ICO 里原本的 16/32 帧只是等比缩放：实测它跟"直接拿 512 缩到 16"几乎
逐像素相同，没有为小尺寸做任何处理。

## 做法：轮廓走缩放，五官走硬边

小图标的通行做法不是"缩得更聪明"，而是**把两件事分开**：

  · 外轮廓与渐变 —— 照常从 512 缩下来。边缘抗锯齿在这里是好事，blob 的
    形状和青→蓝→紫的渐变都靠它保住，观感上仍是同一个标。
  · 五官（眼睛/嘴）—— **在目标分辨率上直接盖实心矩形**，不经过任何缩放，
    所以永远是干净的整像素，不会被 AA 抹成灰。

尺寸取舍：

    32px  脸约 15px → 眼睛给 2×3 实心，嘴给一条 5×2 的粗弧，放得下
    16px  脸只有 7px → 眼睛压到 1×2，**嘴不画**

16px 不画嘴不是偷懒：3px 宽 1px 高的嘴在这个尺寸上只会变成脸中间一道灰，
反而把两只眼睛的对比也拉低。小图标的常规取舍是保住"能认出是它"的最少特征。

48 及以上照旧从 512 缩——那个尺寸上原始图形本来就清楚，不需要动。

## 用法

    slide-rule-python/.venv/bin/python scripts/build_favicon.py
    slide-rule-python/.venv/bin/python scripts/build_favicon.py --preview

**为什么是 Python 而不是 .mjs**：仓库的 node_modules 里没有任何图像库
（sharp/jimp/pngjs 都没有），为一个一年重打一次的资源装 sharp 不划算；
而 slide-rule-python 那个 venv 里 Pillow 现成。这是个构建期一次性工具，
不进运行时依赖。
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "client/public/miantuan-mark-512.png"
#: 32px 的**手工版**（2026-08-07 用户提供 miantuan-favicon-32.ico，已转存为 PNG）。
#: 存在就直接当 32 帧用，并且 16 帧也从它推——它的外轮廓比从 512 缩下来的干净
#: 得多（边缘 AA 少、blob 形状更实）。不存在则整体回落到从 512 缩。
SRC_32 = ROOT / "client/public/miantuan-mark-32.png"
OUT = ROOT / "client/public/favicon.ico"

#: 五官颜色：原图眼睛中心采到的品牌蓝（左 #0189f1 / 右 #006bfb，取中）
FEATURE = (0x04, 0x7A, 0xF6, 0xFF)

#: ICO 里要装的尺寸。16/32 走专画，其余走缩放。
SIZES = [16, 32, 48, 64, 128, 256]

#: 五官版式。坐标是**目标分辨率上的整像素**，量自实际缩放结果的字符轮廓图。
#:
#: erase —— 先把糊掉的旧五官擦成白的范围。**必须是贴着五官的小框，不能是
#:   整张脸**：第一版拿整个脸框去擦，把脸边缘那圈半透明过渡也一起抹平了，
#:   圆脸当场变成方块（做完看图才发现，所以这条写在这里）。
#: mouth —— 一组矩形而不是单个矩形：单个矩形只能是一条直杠，读起来是"面无
#:   表情"，笑脸没了。拆成"两端高、中间低"三段才是弧。
GLYPH = {
    16: {
        # 脸只有 7px：擦掉中间那团灰，只留两只眼睛
        "erase": [(5, 6, 4, 4)],
        "eyes": [(5, 6, 1, 2), (8, 6, 1, 2)],
        "mouth": [],  # 3×1 的嘴在 7px 的脸上只会变成一道灰，反而拉低眼睛的对比
    },
    32: {
        "erase": [(10, 12, 4, 6), (15, 12, 5, 6), (12, 17, 7, 4)],
        "eyes": [(11, 13, 2, 3), (16, 13, 2, 3)],
        # 笑弧：左端 y=18，中段 y=19（更低），右端 y=18
        "mouth": [(13, 18, 1, 2), (14, 19, 3, 2), (17, 18, 1, 2)],
    },
}


def _stamp(img: Image.Image, box: tuple[int, int, int, int]) -> None:
    x, y, w, h = box
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if 0 <= xx < img.width and 0 <= yy < img.height:
                img.putpixel((xx, yy), FEATURE)


def draw_frame(img: Image.Image, size: int) -> Image.Image:
    """把糊掉的旧五官擦成白，再盖上硬边新五官。"""
    spec = GLYPH.get(size)
    if not spec:
        return img
    out = img.copy()
    for x0, y0, w, h in spec["erase"]:
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                if not (0 <= x < out.width and 0 <= y < out.height):
                    continue
                r, g, b, a = out.getpixel((x, y))
                # 只动"本来就在脸上"的像素：不透明的才擦，透明区不碰，
                # 免得在脸外侧长出一块白。
                if a > 200:
                    out.putpixel((x, y), (255, 255, 255, a))
    for box in spec["eyes"] + spec["mouth"]:
        _stamp(out, box)
    return out


def frame_at(base: Image.Image, size: int, hand32: Image.Image | None = None) -> Image.Image:
    """出一帧。

    32 —— 有手工版就**原样用**，不做任何加工：那是设计给过的成品，我们再
          去"修"眼睛高度或把点状的嘴连成弧，等于替设计做决定。
    16 —— 手工版在的话从它缩（轮廓更干净），再照常盖硬边眼睛；
          手工版不在就退回从 512 缩。
    其余 —— 一律从 512 缩，那些尺寸原图本来就清楚。
    """
    if size == 32 and hand32 is not None:
        return hand32.copy()
    source = hand32 if (size == 16 and hand32 is not None) else base
    return draw_frame(source.resize((size, size), Image.LANCZOS), size)


def pack_ico(frames: list[Image.Image]) -> bytes:
    """手写 ICO 容器，每帧存成 PNG。

    **不用 Pillow 的 ICO 写入器**：它的 `sizes=` 是"拿第一张图自己缩"，
    `append_images` 在 ICO 上不按 GIF/TIFF 那套语义走——实测传了 6 个尺寸
    加 5 张附图，落盘后**只有 16×16 一帧**，其余全丢（读回来
    `ico.sizes()` 就是 `[(16,16)]`）。而我们恰恰需要"每帧是我给的那一张"，
    否则专画的 16/32 会被重新从大图缩一遍，等于白做。

    PNG 帧格式从 Vista 起支持，所有现代浏览器都认；256 的边长按规范用 0 表示。
    """
    import io
    import struct

    blobs = []
    for f in frames:
        buf = io.BytesIO()
        f.save(buf, format="PNG")
        blobs.append(buf.getvalue())

    n = len(frames)
    out = bytearray(struct.pack("<HHH", 0, 1, n))  # reserved / type=icon / count
    offset = 6 + 16 * n
    for f, blob in zip(frames, blobs):
        side = 0 if f.width >= 256 else f.width
        out += struct.pack(
            "<BBBBHHII",
            side, side,   # 宽 / 高
            0,            # 调色板数（真彩为 0）
            0,            # reserved
            1,            # color planes
            32,           # bpp
            len(blob),
            offset,
        )
        offset += len(blob)
    for blob in blobs:
        out += blob
    return bytes(out)


def main() -> int:
    if not SRC.exists():
        print(f"源图不存在：{SRC}")
        return 1
    base = Image.open(SRC).convert("RGBA")
    hand32 = Image.open(SRC_32).convert("RGBA") if SRC_32.exists() else None
    if hand32 is not None:
        print(f"32px 用手工版：{SRC_32.name}（16px 也从它推）")
    frames = [frame_at(base, s, hand32) for s in SIZES]

    if "--preview" in sys.argv:
        scale = 12
        tiles = []
        for size in (16, 32):
            plain = base.resize((size, size), Image.LANCZOS)
            drawn = frame_at(base, size, hand32)
            for tag, im in (("缩放", plain), ("专画", drawn)):
                tiles.append((f"{size}-{tag}", im.resize((size * scale, size * scale), Image.NEAREST)))
        h = 32 * scale + 32
        w = sum(t[1].width + 16 for t in tiles) + 16
        canvas = Image.new("RGBA", (w, h), (255, 255, 255, 255))
        x = 16
        for _, im in tiles:
            canvas.paste(im, (x, 16), im)
            x += im.width + 16
        p = ROOT / ".favicon-preview.png"
        canvas.save(p)
        print("对比图:", p)
        print("顺序:", " | ".join(t[0] for t in tiles))

    OUT.write_bytes(pack_ico(frames))
    print(f"已重打 {OUT}")
    print(f"  尺寸 {' / '.join(map(str, SIZES))}，其中 16 与 32 为专画帧")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
