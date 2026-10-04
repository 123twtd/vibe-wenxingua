#!/usr/bin/env python3
"""
问心卦 · 应用图标生成
------------------------------------------------------------
生成 desktop/build/icon.ico（多尺寸）与 icon.png（512，托盘与窗口用）。

为什么用 Python 画而不是放一张现成图：图标要能随主题色改，也要能重新生成，
把手写像素换成一段可读的脚本更耐久。运行时依旧零依赖——这只是构建期资产。

用法：  python desktop/build/make-icon.py
需要：  Pillow（本仓库自带运行时已含）
"""

import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

INK = (13, 17, 23, 255)          # 底色：夜墨
INK_2 = (22, 28, 38, 255)
GOLD = (232, 200, 106, 255)      # 卦线：鎏金
GOLD_DIM = (201, 162, 39, 255)
CINNABAR = (216, 96, 74, 255)

# ䷊ 泰：下三爻阳（实线），上三爻阴（断线）——一眼认得出是卦
TAI = [1, 1, 1, 0, 0, 0]


def rounded(size, radius, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=fill)
    return img


def hexagram(img, box, lines, color, gap_ratio=0.16, bar_ratio=0.085):
    """在 box=(x0,y0,x1,y1) 内画六爻：自下而上。"""
    x0, y0, x1, y1 = box
    w = x1 - x0
    h = y1 - y0
    n = 6
    slot = h / n
    bar_h = max(2, int(h * bar_ratio))
    gap = w * gap_ratio / 2
    d = ImageDraw.Draw(img)
    for i, yang in enumerate(lines):
        # i=0 是初爻（最下）
        cy = y1 - slot * (i + 0.5)
        top = cy - bar_h / 2
        bot = cy + bar_h / 2
        if yang:
            d.rounded_rectangle([x0, top, x1, bot], radius=bar_h / 2, fill=color)
        else:
            mid = (x0 + x1) / 2
            d.rounded_rectangle([x0, top, mid - gap, bot], radius=bar_h / 2, fill=color)
            d.rounded_rectangle([mid + gap, top, x1, bot], radius=bar_h / 2, fill=color)


def make(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = size

    # 底：圆角方 + 真正的竖向渐变（逐行插值，别用两层叠加——那样会留一道接缝）
    body = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    px = body.load()
    for y in range(s):
        t = y / max(1, s - 1)
        # 顶部稍亮，底部回到墨色
        r = int(INK_2[0] + (INK[0] - INK_2[0]) * t)
        g = int(INK_2[1] + (INK[1] - INK_2[1]) * t)
        b = int(INK_2[2] + (INK[0] - INK_2[2]) * t)
        for x in range(s):
            px[x, y] = (r, g, b, 255)
    mask = rounded(s, int(s * 0.22), (255, 255, 255, 255))
    img.alpha_composite(Image.composite(body, Image.new("RGBA", (s, s), (0, 0, 0, 0)), mask))

    # 金色细边
    d = ImageDraw.Draw(img)
    lw = max(1, int(s * 0.018))
    d.rounded_rectangle([lw / 2, lw / 2, s - 1 - lw / 2, s - 1 - lw / 2],
                        radius=int(s * 0.22), outline=GOLD_DIM, width=lw)

    # 卦线
    pad = s * 0.26
    hexagram(img, (pad, pad * 0.86, s - pad, s - pad * 0.86), TAI, GOLD,
             gap_ratio=0.20, bar_ratio=0.088)

    # 大尺寸加点层次：底部一条朱砂细线（"动爻"的意思）
    if s >= 96:
        d = ImageDraw.Draw(img)
        y = s - pad * 0.62
        x0, x1 = s * 0.40, s * 0.60
        d.rounded_rectangle([x0, y, x1, y + max(2, int(s * 0.015))],
                            radius=s * 0.008, fill=CINNABAR)
    return img


def main():
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [make(n) for n in sizes]
    frames[-1].save(os.path.join(OUT_DIR, "icon.ico"),
                    format="ICO", sizes=[(n, n) for n in sizes])
    make(512).save(os.path.join(OUT_DIR, "icon.png"), format="PNG")
    # 托盘用的小图（Windows 托盘 16/32 最好从 32 缩）
    make(64).save(os.path.join(OUT_DIR, "tray.png"), format="PNG")
    print("已生成：icon.ico（%s）、icon.png（512）、tray.png（64）"
          % ", ".join("%d" % n for n in sizes))


if __name__ == "__main__":
    main()
