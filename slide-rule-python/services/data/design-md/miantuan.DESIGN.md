---
version: alpha
name: 面团 · 品牌
description: 默认设计系统。种子色取自面团标识渐变的中段，与 identity_theme_presets.json 的 brandSeed 同值——换掉它等于换掉全站默认配色。
colors:
  primary: "#3B82F6"
  on-primary: "#ffffff"
  secondary: "#6588c0"
  tertiary: "#ac68bc"
  neutral: "#657288"
  surface: "#eafaff"
  on-surface: "#0c1627"
  outline: "#a0afc6"
  error: "#d32f2f"
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
  body-md:
    fontFamily: Inter
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Inter
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  label-md:
    fontFamily: Inter
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  none: "0px"
  sm: "4px"
  md: "8px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
---

# 面团 · 品牌

## Overview

一套企业内部工具的默认外观：白底、克制的蓝、信息优先，像一份排版良好的后台报表，不像一个营销落地页。

默认设计系统。种子色取自面团标识渐变的中段，与 identity_theme_presets.json 的 brandSeed 同值——换掉它等于换掉全站默认配色。

主色由种子色 `#3B82F6` 派生。中性色**跟随主色色相、彩度压到两成**——
这一条是整套配色的支点：中性灰不是纯灰，绿色系统的灰偏绿、暖色系统的灰偏暖。
手挑的灰永远挑不准这个量。

## Colors

`primary` 只出现在**选中态、主按钮、图表**上。菜单与页头保持中性底
（`surface`），不要整片铺主色。

`error` 只用于真正的失败与破坏性操作，不要拿它当强调色。

## Typography

标题 `Inter`，正文 `Inter`。正文行高不低于 1.6——
业务系统里长表格和长段落是常态，行高偏紧会显著拖慢扫读。

## Shapes

圆角档位 `md`（8px）。同一屏里不要混用多个圆角档。

## Do's and Don'ts

- **Do** 表格行高不低于 44px：这是触摸目标的下限，手机档直接照搬桌面行高会点不中。
- **Do** 每个列表/表格都要有空态：真机上"没有数据"比"有数据"更早出现。
- **Don't** 用颜色作为唯一的状态区分：状态必须同时有文字或图标，色盲用户看不出绿/红。
- **Don't** 把主色铺满页头或侧栏：主色铺开之后，真正需要被看见的按钮就没有对比度可用了。
- **Don't** 自己发明新的圆角/间距数值：上面 `rounded` / `spacing` 两档已经够用，
  多一个数值就多一处对不齐。
- **Don't** 不要渐变背景、玻璃拟态、发光边框
- **Don't** 不要把主色铺满页头或侧栏
- **Don't** 不要装饰性插画占位
