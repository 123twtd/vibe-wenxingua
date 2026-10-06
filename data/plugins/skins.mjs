/**
 * 插件：皮肤集（skins）
 * ------------------------------------------------------------
 * 四款成套皮肤，每款都是一整套设计语言而不是换色——
 * 材质、字体、色彩、控件形状、装饰、密度、动效一起变；
 * 每款又自带**宣纸**与**夜读**两式（白天黑夜），由顶栏那枚按钮切换。
 *
 *   id      名字        意象
 *   tang    唐风宫苑    绢黄团花、朱墙金瓦——端庄富丽
 *   ru      宋瓷汝窑    雨过天青、开片冰裂——温润克制
 *   zhu     竹影清舍    竹篱茅舍、斜阳叶影——清简透气
 *   xing    星野玄穹    夜幕星穹、观星历象——辽远安静
 *
 * 契约（ADR-0014）：CSS 必须自带 [data-skin="<id>"] 与
 * [data-skin="<id>"][data-theme="night"] 两式，且不得泄漏到全局；
 * 两式缺一时，夜读下会亮着白纸——所以这不是可选项。
 * 纹理全部用渐变与内联 SVG 画（复用基座的纸纹层 body::after），零外部资源。
 * 皮肤选择在「设置 → 外观」；停用本插件，皮肤即刻撤下并回到默认宣纸水墨。
 */

/* ============================================================
 * 一、唐风宫苑
 * 绢黄底、朱墙红、鎏金饰。材质＝唐锦菱格；卡片＝描金双线的装裱；
 * 控件偏方圆（8px）、字距更开、动效略缓——取「端庄」。
 * ========================================================== */
const TANG = `
:root[data-skin="tang"] {
  color-scheme: light;

  --bg: #f6ecd8;
  --surface: #fdf7ea;
  --surface-2: #f1e3c8;
  --surface-3: #e8d5b0;
  --surface-4: #d9c08c;

  --ink: #2b1c12;
  --ink-2: #5c4230;
  --ink-3: #94795c;

  --rule: #e3d2ad;
  --rule-2: #c9a96e;

  --accent: #a5302a;
  --accent-2: #c04a35;
  --accent-3: #7c1f1c;

  --good: #3e7a55;
  --bad: #a5302a;
  --bad-2: #c04a35;
  --warn: #a8763e;
  --info: #48668f;

  --lift: inset 0 1px 0 rgba(255, 255, 255, .85), 0 1px 2px rgba(122, 86, 40, .12), 0 10px 26px rgba(122, 86, 40, .09);
  --lift-hi: inset 0 1px 0 rgba(255, 255, 255, .95), 0 2px 6px rgba(122, 86, 40, .16), 0 16px 38px rgba(122, 86, 40, .12);
  --shadow-md: 0 10px 30px rgba(96, 62, 26, .20);
  --shadow-lg: 0 18px 48px rgba(96, 62, 26, .26);
  --mask: rgba(70, 44, 20, .38);

  --tint-1: rgba(122, 86, 40, .06);
  --tint-2: rgba(176, 141, 63, .16);
  --tint-accent: rgba(165, 48, 42, .12);
  --tint-bad: rgba(165, 48, 42, .09);
  --tint-good: rgba(62, 122, 85, .10);
  --tint-info: rgba(72, 102, 143, .09);
  --edge-bad: rgba(165, 48, 42, .45);
  --edge-good: rgba(62, 122, 85, .45);
  --edge-info: rgba(72, 102, 143, .40);
  --on-accent: #fdf6e6;
  --grain: .38;

  --radius: 8px;
  --radius-sm: 5px;
}

/* 唐绢：两层细斜纹交叉，织出绢丝的经纬感。
   早先用过 26px 的联珠菱格——成块的方格比正文还抢眼，整屏像格子布，
   被当场否掉。绢纹要「近看才有」，远看仍是干净的底。 */
:root[data-skin="tang"] body::after {
  background-image:
    repeating-linear-gradient(45deg, rgba(176, 141, 63, .30) 0 1px, transparent 1px 8px),
    repeating-linear-gradient(-45deg, rgba(165, 48, 42, .15) 0 1px, transparent 1px 8px);
}

/* 卡片＝装裱：外描金线、内再一道细金线，顶部压一道朱衬 */
:root[data-skin="tang"] .card {
  border: 1px solid rgba(176, 141, 63, .50);
  border-top: 2px solid rgba(165, 48, 42, .45);
  padding: 11px 14px;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, .40), transparent 44px);
}
:root[data-skin="tang"] .card::before {
  content: ""; position: absolute; inset: 3px; pointer-events: none;
  border: 1px solid rgba(176, 141, 63, .26);
  border-radius: calc(var(--radius) - 3px);
}
:root[data-skin="tang"] .card-title,
:root[data-skin="tang"] .card > h3 { letter-spacing: 3.2px; }
/* 题前的金菱形：画出来的（不借字体里的符号，跨机稳定） */
:root[data-skin="tang"] .card-title::before,
:root[data-skin="tang"] .card > h3::before {
  content: ""; width: 7px; height: 7px; background: #b08d3f;
  transform: rotate(45deg); border-radius: 1px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .55);
}

:root[data-skin="tang"] .btn { letter-spacing: 1.4px; transition-duration: .2s; }
:root[data-skin="tang"] .btn.primary {
  border-color: #b08d3f;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .28), 0 2px 8px rgba(165, 48, 42, .25);
}
:root[data-skin="tang"] .nav a.on {
  border-left-width: 3px;
  background: linear-gradient(90deg, rgba(176, 141, 63, .20), transparent 78%);
}
:root[data-skin="tang"] .page-head h1 { letter-spacing: 3.4px; text-shadow: 0 1px 0 rgba(255, 255, 255, .55); }
:root[data-skin="tang"] .rec { padding: 7px 11px; transition-duration: .2s; }
:root[data-skin="tang"] .main { padding: 12px 16px 24px; }

/* ---- 夜读式：宫灯夜宴（深绛褐底、鎏金线） ---- */
:root[data-skin="tang"][data-theme="night"] {
  color-scheme: dark;

  --bg: #17100d;
  --surface: #201613;
  --surface-2: #281b16;
  --surface-3: #34241c;
  --surface-4: #453024;

  --ink: #f1e4c8;
  --ink-2: #c2ac8b;
  --ink-3: #8b7458;

  --rule: #342519;
  --rule-2: #513a29;

  --accent: #c0503a;
  --accent-2: #d97a55;
  --accent-3: #a03a28;

  --good: #4f9d78;
  --bad: #d8604a;
  --bad-2: #e08d6f;
  --warn: #c9a227;
  --info: #6d8fbf;

  --lift: inset 0 1px 0 rgba(255, 235, 200, .06), 0 1px 2px rgba(0, 0, 0, .40), 0 10px 30px rgba(0, 0, 0, .30);
  --lift-hi: inset 0 1px 0 rgba(255, 235, 200, .09), 0 2px 6px rgba(0, 0, 0, .50), 0 16px 40px rgba(0, 0, 0, .38);
  --shadow-md: 0 10px 32px rgba(0, 0, 0, .58);
  --shadow-lg: 0 24px 70px rgba(0, 0, 0, .64);
  --mask: rgba(8, 5, 4, .74);

  --tint-1: rgba(201, 162, 39, .05);
  --tint-2: rgba(201, 162, 39, .13);
  --tint-accent: rgba(192, 80, 58, .22);
  --tint-bad: rgba(216, 96, 74, .10);
  --tint-good: rgba(79, 157, 120, .10);
  --tint-info: rgba(109, 143, 191, .09);
  --edge-bad: rgba(216, 96, 74, .50);
  --edge-good: rgba(79, 157, 120, .45);
  --edge-info: rgba(109, 143, 191, .45);
  --on-accent: #f7ecdc;
  --grain: .30;
}
:root[data-skin="tang"][data-theme="night"] body::after {
  background-image:
    repeating-linear-gradient(45deg, rgba(201, 162, 39, .28) 0 1px, transparent 1px 8px),
    repeating-linear-gradient(-45deg, rgba(192, 80, 58, .16) 0 1px, transparent 1px 8px);
}
:root[data-skin="tang"][data-theme="night"] .card {
  border-color: rgba(201, 162, 39, .38);
  border-top-color: rgba(192, 80, 58, .55);
  background-image: linear-gradient(180deg, rgba(255, 220, 160, .06), transparent 44px);
}
:root[data-skin="tang"][data-theme="night"] .card::before { border-color: rgba(201, 162, 39, .15); }
:root[data-skin="tang"][data-theme="night"] .card-title::before,
:root[data-skin="tang"][data-theme="night"] .card > h3::before {
  background: #c9a227;
  box-shadow: 0 0 6px rgba(201, 162, 39, .45);
}
:root[data-skin="tang"][data-theme="night"] .page-head h1 { text-shadow: 0 1px 0 rgba(0, 0, 0, .4); }
:root[data-skin="tang"][data-theme="night"] .btn.primary { box-shadow: inset 0 0 0 1px rgba(255, 235, 200, .18), 0 2px 10px rgba(0, 0, 0, .50); }
`;

/* ============================================================
 * 二、宋瓷汝窑
 * 天青釉、开片冰裂、极简。材质＝釉面与三道细裂纹；卡片＝薄胎瓷片
 * （细边、浅影、几乎无圆角）；题字改用宋——汝窑不喜手写气。
 * ========================================================== */
const RU = `
:root[data-skin="ru"] {
  color-scheme: light;

  --bg: #e9f0ec;
  --surface: #f6faf7;
  --surface-2: #e2ece7;
  --surface-3: #d5e3dc;
  --surface-4: #c2d5cc;

  --ink: #1e2b27;
  --ink-2: #46584f;
  --ink-3: #7b8d83;

  --rule: #d3e0d9;
  --rule-2: #aec4b8;

  --accent: #4e7f74;
  --accent-2: #63968a;
  --accent-3: #3a655c;

  --good: #4e8f78;
  --bad: #a8604f;
  --bad-2: #b97a68;
  --warn: #9a8348;
  --info: #5c7f9e;

  --lift: inset 0 1px 0 rgba(255, 255, 255, .75), 0 1px 2px rgba(46, 74, 66, .06), 0 10px 24px rgba(46, 74, 66, .05);
  --lift-hi: inset 0 1px 0 rgba(255, 255, 255, .90), 0 2px 5px rgba(46, 74, 66, .09), 0 14px 32px rgba(46, 74, 66, .07);
  --shadow-md: 0 10px 28px rgba(30, 50, 44, .16);
  --shadow-lg: 0 18px 44px rgba(30, 50, 44, .20);
  --mask: rgba(28, 48, 42, .32);

  --tint-1: rgba(46, 74, 66, .045);
  --tint-2: rgba(79, 131, 120, .14);
  --tint-accent: rgba(79, 131, 120, .13);
  --tint-bad: rgba(168, 96, 79, .09);
  --tint-good: rgba(78, 143, 120, .10);
  --tint-info: rgba(92, 127, 158, .08);
  --edge-bad: rgba(168, 96, 79, .45);
  --edge-good: rgba(78, 143, 120, .45);
  --edge-info: rgba(92, 127, 158, .40);
  --on-accent: #f4faf7;
  --grain: .50;

  --radius: 3px;
  --radius-sm: 2px;

  /* 题字用宋（清瘦），不用楷 */
  --kai: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", "Georgia", serif;
}

/* 开片：三道角度不同的极细裂纹，疏而长 */
:root[data-skin="ru"] body::after {
  background-image:
    repeating-linear-gradient(74deg, rgba(79, 131, 120, .12) 0 1px, transparent 1px 34px),
    repeating-linear-gradient(-64deg, rgba(79, 131, 120, .09) 0 1px, transparent 1px 47px),
    repeating-linear-gradient(16deg, rgba(79, 131, 120, .07) 0 1px, transparent 1px 61px);
}

/* 卡片＝薄胎瓷片：细边、浅影 */
:root[data-skin="ru"] .card { padding: 10px 13px; border-color: var(--rule-2); }
:root[data-skin="ru"] .card-title,
:root[data-skin="ru"] .card > h3 { font-weight: 400; letter-spacing: 3.4px; }
/* 题前的釉点：一个小圆环 */
:root[data-skin="ru"] .card-title::before,
:root[data-skin="ru"] .card > h3::before {
  content: ""; width: 6px; height: 6px; border-radius: 50%;
  background: transparent; border: 1px solid var(--accent);
}
:root[data-skin="ru"] .btn { background: transparent; transition-duration: .18s; }
:root[data-skin="ru"] .btn:hover { background: var(--tint-2); }
:root[data-skin="ru"] .btn.primary {
  background: linear-gradient(160deg, var(--accent-2), var(--accent));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35), 0 2px 6px rgba(30, 50, 44, .18);
}
:root[data-skin="ru"] .page-head h1 { font-weight: 400; letter-spacing: 3.6px; }
/* 悬停不上浮，像釉面被水濡湿：只加深一档、添一圈柔光 */
:root[data-skin="ru"] .rec { transition-duration: .18s; }
:root[data-skin="ru"] .rec:hover { transform: none; box-shadow: 0 2px 12px rgba(30, 50, 44, .12); }

/* ---- 夜读式：墨青（深青黑底、釉色微光） ---- */
:root[data-skin="ru"][data-theme="night"] {
  color-scheme: dark;

  --bg: #0d1413;
  --surface: #121b19;
  --surface-2: #17231f;
  --surface-3: #1e2d28;
  --surface-4: #293b34;

  --ink: #dbe7e0;
  --ink-2: #9db3a8;
  --ink-3: #66796e;

  --rule: #1e2c26;
  --rule-2: #2f443b;

  --accent: #6fa79a;
  --accent-2: #8cc0b1;
  --accent-3: #54867b;

  --good: #5fa98b;
  --bad: #c47a62;
  --bad-2: #d09680;
  --warn: #b99a5e;
  --info: #6f96bd;

  --lift: inset 0 1px 0 rgba(220, 245, 235, .04), 0 1px 2px rgba(0, 0, 0, .35), 0 10px 28px rgba(0, 0, 0, .26);
  --lift-hi: inset 0 1px 0 rgba(220, 245, 235, .06), 0 2px 6px rgba(0, 0, 0, .45), 0 15px 38px rgba(0, 0, 0, .34);
  --shadow-md: 0 10px 32px rgba(0, 0, 0, .55);
  --shadow-lg: 0 22px 64px rgba(0, 0, 0, .60);
  --mask: rgba(5, 10, 9, .74);

  --tint-1: rgba(111, 167, 154, .05);
  --tint-2: rgba(111, 167, 154, .14);
  --tint-accent: rgba(111, 167, 154, .20);
  --tint-bad: rgba(196, 122, 98, .10);
  --tint-good: rgba(95, 169, 139, .10);
  --tint-info: rgba(111, 150, 189, .09);
  --edge-bad: rgba(196, 122, 98, .50);
  --edge-good: rgba(95, 169, 139, .45);
  --edge-info: rgba(111, 150, 189, .45);
  --on-accent: #0c1513;
  --grain: .40;
}
:root[data-skin="ru"][data-theme="night"] body::after {
  background-image:
    repeating-linear-gradient(74deg, rgba(140, 192, 177, .09) 0 1px, transparent 1px 34px),
    repeating-linear-gradient(-64deg, rgba(140, 192, 177, .07) 0 1px, transparent 1px 47px),
    repeating-linear-gradient(16deg, rgba(140, 192, 177, .05) 0 1px, transparent 1px 61px);
}
`;

/* ============================================================
 * 三、竹影清舍
 * 竹青与素木。材质＝斜向竹影；卡片＝竹片（上下两道细线）；
 * 密度更紧（卡片与列表的留白都收一档）；悬停微微一浮——风过竹梢。
 * ========================================================== */
const ZHU = `
:root[data-skin="zhu"] {
  color-scheme: light;

  --bg: #f0f3e7;
  --surface: #f9fbf2;
  --surface-2: #e8eeda;
  --surface-3: #dce5c8;
  --surface-4: #c8d4ae;

  --ink: #22281c;
  --ink-2: #4c563e;
  --ink-3: #7d8a6b;

  --rule: #d8e0c6;
  --rule-2: #b3c19a;

  --accent: #4e7a45;
  --accent-2: #63925a;
  --accent-3: #3a5c34;

  --good: #4e7a45;
  --bad: #9a5b3f;
  --bad-2: #b06f4e;
  --warn: #a88a3e;
  --info: #527d86;

  --lift: inset 0 1px 0 rgba(255, 255, 255, .70), 0 1px 2px rgba(48, 62, 34, .08), 0 8px 20px rgba(48, 62, 34, .06);
  --lift-hi: inset 0 1px 0 rgba(255, 255, 255, .85), 0 2px 5px rgba(48, 62, 34, .12), 0 12px 28px rgba(48, 62, 34, .09);
  --shadow-md: 0 10px 26px rgba(40, 52, 28, .18);
  --shadow-lg: 0 16px 42px rgba(40, 52, 28, .24);
  --mask: rgba(34, 44, 24, .34);

  --tint-1: rgba(52, 66, 38, .05);
  --tint-2: rgba(78, 122, 69, .14);
  --tint-accent: rgba(78, 122, 69, .12);
  --tint-bad: rgba(154, 91, 63, .09);
  --tint-good: rgba(78, 122, 69, .10);
  --tint-info: rgba(82, 125, 134, .09);
  --edge-bad: rgba(154, 91, 63, .45);
  --edge-good: rgba(78, 122, 69, .45);
  --edge-info: rgba(82, 125, 134, .40);
  --on-accent: #f6faf0;
  --grain: .40;

  --radius: 6px;
  --radius-sm: 4px;
}

/* 竹影：几道斜向极淡的叶痕 */
:root[data-skin="zhu"] body::after {
  background-image:
    repeating-linear-gradient(58deg, rgba(78, 122, 69, .10) 0 2px, transparent 2px 26px),
    repeating-linear-gradient(64deg, rgba(78, 122, 69, .07) 0 1px, transparent 1px 41px),
    repeating-linear-gradient(-34deg, rgba(78, 122, 69, .07) 0 2px, transparent 2px 52px);
}

/* 卡片＝竹片：上下两道细线，左右不描边 */
:root[data-skin="zhu"] .card {
  border-top-color: var(--rule-2);
  border-bottom-color: var(--rule-2);
  padding: 8px 11px;
}
:root[data-skin="zhu"] .card-title,
:root[data-skin="zhu"] .card > h3 { font-size: 12px; letter-spacing: 2px; }
/* 题前一片竹叶：细长的圆角短条 */
:root[data-skin="zhu"] .card-title::before,
:root[data-skin="zhu"] .card > h3::before {
  content: ""; width: 3px; height: 11px; border-radius: 2px;
  background: var(--accent); transform: rotate(14deg);
}
/* 竹节：侧栏分隔线变成短竖纹 */
:root[data-skin="zhu"] .nav-sep { height: 3px; background: repeating-linear-gradient(90deg, var(--rule-2) 0 2px, transparent 2px 9px); }
:root[data-skin="zhu"] .btn { background: transparent; transition-duration: .12s; }
:root[data-skin="zhu"] .btn:hover { background: var(--tint-2); }
:root[data-skin="zhu"] .btn.primary { background: linear-gradient(135deg, var(--accent-3), var(--accent)); box-shadow: 0 2px 6px rgba(34, 40, 28, .18); }
:root[data-skin="zhu"] .main { padding: 9px 12px 20px; }
:root[data-skin="zhu"] .rec { padding: 5px 9px; transition-duration: .12s; }
:root[data-skin="zhu"] .rec:hover { transform: translateX(3px) translateY(-1px); box-shadow: 0 4px 12px rgba(40, 52, 28, .14); }
:root[data-skin="zhu"] .page-head h1 { letter-spacing: 2.6px; }

/* ---- 夜读式：竹舍夜（深绿灰底、月白） ---- */
:root[data-skin="zhu"][data-theme="night"] {
  color-scheme: dark;

  --bg: #10150f;
  --surface: #151c14;
  --surface-2: #1b2419;
  --surface-3: #232e20;
  --surface-4: #2f3d2a;

  --ink: #e0e8d4;
  --ink-2: #a9b598;
  --ink-3: #71805f;

  --rule: #212c1c;
  --rule-2: #35452c;

  --accent: #7fae63;
  --accent-2: #9cc47c;
  --accent-3: #65904e;

  --good: #7fae63;
  --bad: #c07a56;
  --bad-2: #d08e69;
  --warn: #c2a35a;
  --info: #6f9aa6;

  --lift: inset 0 1px 0 rgba(220, 240, 200, .04), 0 1px 2px rgba(0, 0, 0, .35), 0 8px 22px rgba(0, 0, 0, .26);
  --lift-hi: inset 0 1px 0 rgba(220, 240, 200, .06), 0 2px 5px rgba(0, 0, 0, .45), 0 12px 30px rgba(0, 0, 0, .34);
  --shadow-md: 0 10px 30px rgba(0, 0, 0, .55);
  --shadow-lg: 0 20px 60px rgba(0, 0, 0, .60);
  --mask: rgba(6, 10, 5, .74);

  --tint-1: rgba(127, 174, 99, .05);
  --tint-2: rgba(127, 174, 99, .13);
  --tint-accent: rgba(127, 174, 99, .20);
  --tint-bad: rgba(192, 122, 86, .10);
  --tint-good: rgba(127, 174, 99, .10);
  --tint-info: rgba(111, 154, 166, .09);
  --edge-bad: rgba(192, 122, 86, .50);
  --edge-good: rgba(127, 174, 99, .45);
  --edge-info: rgba(111, 154, 166, .45);
  --on-accent: #0f140c;
  --grain: .32;
}
:root[data-skin="zhu"][data-theme="night"] body::after {
  background-image:
    repeating-linear-gradient(58deg, rgba(156, 196, 124, .08) 0 2px, transparent 2px 26px),
    repeating-linear-gradient(64deg, rgba(156, 196, 124, .06) 0 1px, transparent 1px 41px),
    repeating-linear-gradient(-34deg, rgba(156, 196, 124, .06) 0 2px, transparent 2px 52px);
}
`;

/* ============================================================
 * 四、星野玄穹
 * 星金与星光银蓝。材质＝星野（夜式是主场：银河带 + 疏密两层星点；
 * 宣纸式＝拂晓青穹，几粒残星）；卡片＝观测窗（冷光细边 + 顶沿微光）；
 * 顶栏品牌旁一点会呼吸的星芒——全程序唯一一处常驻动效。
 * ========================================================== */
const XING = `
:root[data-skin="xing"] {
  color-scheme: light;

  --bg: #eaeff6;
  --surface: #f6f9fd;
  --surface-2: #e0e7f1;
  --surface-3: #d2dbe9;
  --surface-4: #b9c6da;

  --ink: #1c2432;
  --ink-2: #46536a;
  --ink-3: #78869e;

  --rule: #d7dfeb;
  --rule-2: #b4c1d4;

  --accent: #3f6ea8;
  --accent-2: #5685bd;
  --accent-3: #2f5687;

  --good: #3f8f7a;
  --bad: #b85a44;
  --bad-2: #c97a62;
  --warn: #a8862f;
  --info: #7a6cc0;

  --lift: inset 0 1px 0 rgba(255, 255, 255, .80), 0 1px 2px rgba(40, 58, 86, .07), 0 10px 26px rgba(40, 58, 86, .06);
  --lift-hi: inset 0 1px 0 rgba(255, 255, 255, .90), 0 2px 5px rgba(40, 58, 86, .10), 0 14px 34px rgba(40, 58, 86, .08);
  --shadow-md: 0 10px 30px rgba(28, 40, 60, .16);
  --shadow-lg: 0 18px 48px rgba(28, 40, 60, .22);
  --mask: rgba(20, 30, 48, .34);

  --tint-1: rgba(40, 58, 86, .045);
  --tint-2: rgba(63, 110, 168, .12);
  --tint-accent: rgba(63, 110, 168, .12);
  --tint-bad: rgba(184, 90, 68, .09);
  --tint-good: rgba(63, 143, 122, .10);
  --tint-info: rgba(122, 108, 192, .10);
  --edge-bad: rgba(184, 90, 68, .45);
  --edge-good: rgba(63, 143, 122, .45);
  --edge-info: rgba(122, 108, 192, .40);
  --on-accent: #f4f8fd;
  --grain: .35;

  --radius: 6px;
  --radius-sm: 4px;

  /* 星野辽远：题字用宋、放宽字距 */
  --kai: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", "Georgia", serif;
}

/* 拂晓残星：几粒极淡的疏星 */
:root[data-skin="xing"] body::after {
  background-image:
    radial-gradient(circle, rgba(63, 110, 168, .38) .8px, transparent 1.3px),
    radial-gradient(circle, rgba(122, 108, 192, .28) .6px, transparent 1.1px);
  background-size: 113px 97px, 71px 83px;
  background-position: 13px 17px, 41px 7px;
}

/* 卡片＝观测窗：冷光细边 + 顶沿一线微光 */
:root[data-skin="xing"] .card {
  border-color: rgba(120, 150, 200, .30);
  box-shadow: var(--lift), inset 0 1px 0 rgba(150, 190, 240, .10);
}
:root[data-skin="xing"] .card-title,
:root[data-skin="xing"] .card > h3 { font-weight: 400; letter-spacing: 3.2px; }
/* 题前一点星芒 */
:root[data-skin="xing"] .card-title::before,
:root[data-skin="xing"] .card > h3::before {
  content: ""; width: 6px; height: 6px; background: var(--warn);
  transform: rotate(45deg); border-radius: 1px;
  box-shadow: 0 0 7px var(--warn);
}
:root[data-skin="xing"] .btn { transition-duration: .22s; }
:root[data-skin="xing"] .btn.primary { box-shadow: 0 0 14px rgba(120, 160, 220, .30); }
:root[data-skin="xing"] .nav a.on { box-shadow: inset 0 0 0 1px rgba(140, 175, 230, .18); }
:root[data-skin="xing"] .rec:hover { box-shadow: 0 0 0 1px rgba(140, 175, 230, .18); }
:root[data-skin="xing"] .page-head h1 { font-weight: 400; letter-spacing: 3.8px; }
/* 谶语牌改走青蓝→星云紫的冷调渐变（红蓝对冲会发浑） */
:root[data-skin="xing"] .sig { background: linear-gradient(150deg, var(--tint-2), var(--tint-info)); }
/* 顶栏品牌旁的一点星芒：会呼吸 */
:root[data-skin="xing"] .top .top-brand::after {
  content: ""; width: 6px; height: 6px; border-radius: 50%;
  background: var(--warn); box-shadow: 0 0 8px var(--warn);
  align-self: center; margin-left: -2px;
  animation: xing-twinkle 3.4s ease-in-out infinite;
}
@keyframes xing-twinkle { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }

/* ---- 夜读式（主场）：玄穹（玄黑靛底、星野银河） ---- */
:root[data-skin="xing"][data-theme="night"] {
  color-scheme: dark;

  --bg: #0a0e18;
  --surface: #101623;
  --surface-2: #161e2e;
  --surface-3: #1d2739;
  --surface-4: #273349;

  --ink: #e6ebf5;
  --ink-2: #a7b3c9;
  --ink-3: #6c7a95;

  --rule: #1b2434;
  --rule-2: #2c3a52;

  --accent: #a9c9ea;
  --accent-2: #c6dcf5;
  --accent-3: #86a9d3;

  --good: #5fb3a1;
  --bad: #cf6a52;
  --bad-2: #e08d74;
  --warn: #caa63f;
  --info: #a89ae0;

  --lift: inset 0 1px 0 rgba(200, 220, 255, .05), 0 1px 2px rgba(0, 0, 0, .40), 0 10px 30px rgba(0, 0, 0, .30);
  --lift-hi: inset 0 1px 0 rgba(200, 220, 255, .08), 0 2px 6px rgba(0, 0, 0, .50), 0 16px 40px rgba(0, 0, 0, .38);
  --shadow-md: 0 10px 32px rgba(0, 0, 0, .58);
  --shadow-lg: 0 24px 70px rgba(0, 0, 0, .64);
  --mask: rgba(4, 6, 12, .76);

  --tint-1: rgba(169, 201, 234, .05);
  --tint-2: rgba(169, 201, 234, .13);
  --tint-accent: rgba(169, 201, 234, .20);
  --tint-bad: rgba(207, 106, 82, .10);
  --tint-good: rgba(95, 179, 161, .10);
  --tint-info: rgba(168, 154, 224, .10);
  --edge-bad: rgba(207, 106, 82, .50);
  --edge-good: rgba(95, 179, 161, .45);
  --edge-info: rgba(168, 154, 224, .45);
  --on-accent: #0b1220;
  --grain: .85;
}
/* 夜穹：一道银河带 + 两层疏密星点 + 几粒金砂。
   星点第一版偏小偏稀，实拍几乎认不出「星野」——所以略放大、加密一档；
   仍压在正文之下（比正文淡得多），只做氛围。 */
:root[data-skin="xing"][data-theme="night"] body::after {
  background-image:
    radial-gradient(ellipse 90% 55% at 76% -8%, rgba(140, 170, 220, .16), transparent 62%),
    radial-gradient(circle, rgba(226, 235, 250, .85) 1.1px, transparent 1.8px),
    radial-gradient(circle, rgba(200, 215, 245, .60) .8px, transparent 1.4px),
    radial-gradient(circle, rgba(230, 205, 150, .70) .7px, transparent 1.2px);
  background-size: 100% 100%, 89px 79px, 61px 71px, 131px 121px;
  background-position: 0 0, 13px 17px, 41px 7px, 97px 53px;
}
:root[data-skin="xing"][data-theme="night"] .card { border-color: rgba(120, 150, 200, .20); }
`;

export default {
  id: 'skins',
  name: '皮肤集',
  version: '1.0.0',
  author: '问心卦内置样例',
  description: '四款成套皮肤：唐风宫苑、宋瓷汝窑、竹影清舍、星野玄穹。'
    + '每款自带宣纸与夜读两式，到「设置 → 外观」选用；停用本插件，皮肤即刻撤下并回到默认。',

  activate(ctx) {
    ctx.registerSkin({
      id: 'tang',
      name: '唐风宫苑',
      hint: '绢黄团花、朱墙金瓦——端庄富丽的宫苑气派。',
      swatch: ['#f6ecd8', '#b08d3f', '#a5302a'],
      css: TANG,
    });
    ctx.registerSkin({
      id: 'ru',
      name: '宋瓷汝窑',
      hint: '雨过天青、开片冰裂——温润克制的汝窑釉色。',
      swatch: ['#e9f0ec', '#4e7f74', '#a8604f'],
      css: RU,
    });
    ctx.registerSkin({
      id: 'zhu',
      name: '竹影清舍',
      hint: '竹篱茅舍、斜阳叶影——清简透气的山居。',
      swatch: ['#f0f3e7', '#4e7a45', '#9a5b3f'],
      css: ZHU,
    });
    ctx.registerSkin({
      id: 'xing',
      name: '星野玄穹',
      hint: '夜幕星穹、观星历象——辽远而安静的星野。',
      swatch: ['#0a0e18', '#a9c9ea', '#caa63f'],
      css: XING,
    });
    ctx.log('皮肤集就绪：唐风宫苑／宋瓷汝窑／竹影清舍／星野玄穹（各含宣纸与夜读两式）');
  },
};