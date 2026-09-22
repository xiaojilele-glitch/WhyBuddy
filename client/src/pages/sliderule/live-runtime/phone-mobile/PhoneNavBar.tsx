/**
 * PhoneNavBar — 手机档顶栏（antd-mobile NavBar）。
 *
 * 此前是 AppRuntimeScreen 里手搓的一个 48px flex div：自己摆 logo、自己写
 * `flex:1` 把角色选择器顶到右边。NavBar 就是这件事的组件
 *（官方定位：「需要显示当前页面内容的标题和操作」），左/中/右三段是它给的，
 * 标题居中、超长省略、右侧操作区对齐都不用自己算。
 *
 * `back={null}` 整块隐藏返回区——源码里是 `back !== null &&` 才渲染那一段
 *（nav-bar.tsx:44）。这个应用是 TabBar 导航，没有"返回上一页"的语义，给一个
 * 点了没反应的返回箭头比没有更糟。
 *
 * 单独成文件是为了走 React.lazy：AppRuntimeScreen 在主包里，直接 import
 * antd-mobile 会把整个移动端库拖进主 bundle（phone-mobile/* 全是这么拆的）。
 */

import React from "react";
import { NavBar } from "antd-mobile";

export interface PhoneNavBarProps {
  /** 左侧品牌标记（应用图标） */
  brand?: React.ReactNode;
  /** 中间标题（当前页名） */
  title: string;
  /** 右侧操作区（角色切换器） */
  right?: React.ReactNode;
}

export default function PhoneNavBar({ brand, title, right }: PhoneNavBarProps) {
  return (
    <NavBar
      data-testid="phone-nav-bar"
      back={null}
      left={brand}
      right={right}
      style={{
        // 高度沿用原来的 48，跟下面 TabBar 的 54 一起构成内容区高度的计算基准，
        // 改了会让画布里的可视高度对不上（spec.h 是按这两个数减出来的）。
        "--height": "48px",
        zIndex: 1,
        flexShrink: 0,
      } as React.CSSProperties}
    >
      {title}
    </NavBar>
  );
}
