/**
 * 问心卦 · 断语引擎
 * ------------------------------------------------------------
 * 一卦两说：
 *   「卦象定调」——主 / 互 / 变 / 断 / 宜 / 忌 / 应期，用文言之气，立卦之骨；
 *   「通俗解」——一句话、缘由、如何做，说人话，落到地上。
 *
 * 断语文气不靠随机堆砌：体用生克定骨，月令旺衰定气，本互变三卦之卦德定肉，
 * 动爻之辞定应。同一卦局重算，其文必同（按卦局指纹取变体，保证可复现）。
 */

import { interpretXlr } from './xiaoliuren.mjs';

/* ============================================================
 * 一、词汇与模板
 * ========================================================== */

/** 旺衰之文言简称：死作「衰」更合断辞之体 */
const STATE_SHORT = { 旺: '旺', 相: '相', 休: '休', 囚: '囚', 死: '衰' };
const SEASON_WORD = { 春: '春', 夏: '夏', 秋: '秋', 冬: '冬', 四季: '四季土旺之月' };
const STATE_ADVICE = { 旺: '气盛可乘', 相: '得辅可进', 休: '力闲宜养', 囚: '受制多阻', 死: '力竭难为' };
const STATE_RANK = { 旺: 4, 相: 3, 休: 2, 囚: 1, 死: 0 };

/** 生克直断（骨） */
const RELATION_TONE = {
  ti_ke_yong: [
    '体{ti}{tiNature}克用{yong}{yongNature}，权操于我，事在掌中；然克者耗也，力尽则衰，宜速断不宜久持。',
    '体{ti}制用{yong}，以{tiNature}临{yongNature}，事由己出而不由人；惟克之为道，用力而后得，得之亦费。',
    '以体克用，如以{tiNature}烁{yongNature}，其势在我；然焰盛易竭，当乘其锐而决之。',
  ],
  yong_sheng_ti: [
    '用{yong}{yongNature}生体{ti}{tiNature}，来者资我，不求而自至；然受生于人者，亦当知所偿。',
    '用生体，如{yongNature}润{tiNature}，其源在外而利归我；宜迎不宜拒，宜惜不宜竭。',
    '体得用生，事来就我，得之易而守之难；易得之物，尤须以敬持之。',
  ],
  bihe: [
    '体用比和，皆属{tiElement}，同气相求，人谋既协，事无龃龉，谋之必谐。',
    '体用同气，如鼓应桴，此唱彼和；无须强力，守其常道，久而有成。',
    '体用比和，彼我同心，内外无间；惟同者易狃于安，当以有恒继之。',
  ],
  yong_ke_ti: [
    '用{yong}{yongNature}克体{ti}{tiNature}，势在人而不在己，境压其身；强争则伤，宜守宜避，待其衰而乘之。',
    '用克体，彼众我寡，{yongNature}逼{tiNature}；非战之罪，乃时之不利，避其锋而蓄其力。',
    '体受用克，动则见制，静则苟安；此时之要，在于不争而自养。',
  ],
  ti_sheng_yong: [
    '体{ti}{tiNature}生用{yong}{yongNature}，我往资彼，费而不获；力出于己而功归于人，宜量力度德而后动。',
    '体生用，以我之膏润彼之田；若问收成，未必归我，当审其可者而后与之。',
    '体去生用，气泄于外，事虽无咎而力已耗；宜节其出，不宜尽与。',
  ],
  unknown: ['体用生克未明，姑且平看，以常道行之。'],
};

/** 通俗版生克（说人话） */
const RELATION_PLAIN = {
  ti_ke_yong: '你能压住这件事（你克它），所以主动权在你手里；但「克」是要花力气的，拖久了你会先累。',
  yong_sheng_ti: '这件事本身在给你让路（它生你），资源、机会、帮助会自己找上来，属于「顺着就成」的那一类。',
  bihe: '你和这件事是同一个频率（比和），不别扭、不打架，配合得好，成不成主要看你有没有断。',
  yong_ke_ti: '这件事压着你（它克你），你眼下在弱势；硬顶着上会受伤，要会守、会等。',
  ti_sheng_yong: '你会为这件事付出很多（你生它），力气从你这儿出，好处未必落在你这儿，要先算账。',
  unknown: '体用关系不明，就按平常心对待。',
};

/** 谶语（总纲四句，卦象气质最重处） */
const SIGNATURE = {
  ti_ke_yong: [
    '{tiNature}烁{yongNature}，权归我掌。速断则利，久缠则伤。',
    '以{tiNature}临{yongNature}，事由己出。执之勿疑，当机则决。',
    '力能制彼，气恐自耗。功成在速，败在迟留。',
  ],
  yong_sheng_ti: [
    '{yongNature}来生{tiNature}，不求得而自至。受之有道，勿贪其多。',
    '源活则流长，人助则事举。借此一臂，可以远行。',
    '彼来资我，宜迎宜惜。惜其来处，方能再得。',
  ],
  bihe: [
    '同声相应，同气相求。谋之无忤，行则必谐。',
    '两情既叶，事无龃龉。守其常道，久而有成。',
    '此唱彼和，如鼓应桴。无须强力，自然而成。',
  ],
  yong_ke_ti: [
    '{yongNature}压其{tiNature}，势不在我。强争则损，善守则全。',
    '境有重压，暂宜低伏。待彼气衰，我可徐图。',
    '不利非罪，时也势也。避其锋，蓄其力，俟其隙。',
  ],
  ti_sheng_yong: [
    '我往资彼，力出功归。量力而行，勿竭其源。',
    '费而不获，徒劳其形。审其可者，而后与之。',
    '以我之膏，润彼之田。若问收成，未必归我。',
  ],
  unknown: ['卦气未显，且守常道，静以待之。'],
};

/** 互卦（中途）：意象与劝诫 */
const HU_TONE = {
  ti_ke_yong: '中段之势犹在我也，然其间须以力向前，不可坐待。',
  yong_sheng_ti: '中段有人相济，得助之象；宜广其耳目，勿闭门独行。',
  bihe: '中段彼此相安，气脉相通，可循已成之轨而行。',
  yong_ke_ti: '中段见阻，外力相逼；须预备退步与周转之地。',
  ti_sheng_yong: '中段我气外泄，多耗于无形；宜立界以节之。',
  unknown: '中段平平，无甚异动。',
};

/** 变卦（归宿）：意象与判语 */
const BIAN_TONE = {
  ti_ke_yong: '事终归我掌握，收局由己，可为善后之主。',
  yong_sheng_ti: '事终来就于我，得济之象，收成归己手。',
  bihe: '事终归于调和，首尾一贯，圆而不缺。',
  yong_ke_ti: '事终为外力所牵，结局不由己出，须早为之备。',
  ti_sheng_yong: '事终为我所耗，成而费力，宜先算其代价。',
  unknown: '结局平淡，无大喜亦无大忧。',
};

/** 变卦白话补充 */
const BIAN_PLAIN = {
  yong_ke_ti: '也就是说，越到后面外部压力越大，不要以为「过了前半程就轻松了」。',
  yong_sheng_ti: '也就是说，后面会有人或机会来帮你，收成在你自己手上。',
  bihe: '也就是说，开头结尾是一致的，不是「先甜后苦」的结构。',
  ti_ke_yong: '也就是说，最后的收束由你决定，你有善后的能力。',
  ti_sheng_yong: '也就是说，事情能成，但代价由你出，要提前算这笔账。',
  unknown: '',
};

/** 互卦白话补充 */
const HU_PLAIN = {
  yong_ke_ti: '过程的中段会有阻力，最好提前准备退路和周转的余地。',
  yong_sheng_ti: '过程的中段会有人帮你，别闷头自己扛。',
  bihe: '过程的中段比较顺，按已经走通的路子走就行。',
  ti_ke_yong: '过程的中段仍然是你推着走，得主动，不能等。',
  ti_sheng_yong: '过程的中段会不知不觉消耗你，要给自己设边界。',
  unknown: '',
};

/** 应期：动爻之位定时段；体气得令则其应提前，故作「未得气／已得气」两说 */
const YING_QI_POSITION = {
  1: { name: '初', window: '旬日', windowFit: '旬日' },
  2: { name: '二', window: '一月', windowFit: '旬日' },
  3: { name: '三', window: '一季', windowFit: '一月' },
  4: { name: '四', window: '三四个月', windowFit: '一至两月' },
  5: { name: '五', window: '半载', windowFit: '三四个月' },
  6: { name: '上', window: '逾年', windowFit: '半载' },
};

/** 生体五行 → 得气之月支 */
const ELEMENT_MONTHS = {
  木: ['寅', '卯'], 火: ['巳', '午'], 土: ['辰', '未', '戌', '丑'],
  金: ['申', '酉'], 水: ['亥', '子'],
};

/** 白话：动爻之位 */
const YAO_PLAIN = {
  1: '事刚开始，别急着放大动作，先把最保守的地基垫好。',
  2: '事情走到中段，你处在「做实事」的位置，稳比快重要。',
  3: '这是内卦的极点，最容易用力过猛而出错，宁可慢半步。',
  4: '局势刚开始变化，离决定性的时刻近了，心里要有准备。',
  5: '事情的枢纽在这里，成与不成，多半在这段时间定下来。',
  6: '已经到了收尾处，再硬推没有意义，该转身时就转身。',
};

/** 分类 */
export const CATEGORIES = [
  '考研学业', '求职事业', '财运生计', '心态情绪', '作息健康',
  '人际情感', '决策取舍', '其他',
];

const CATEGORY_PLAIN = {
  考研学业: {
    focus: '此事之要在「恒」而不在「猛」——卦以积渐成之，非以一夕取之。',
    good: ['按已定之序日进一课，不求速效', '先保主线，余事设硬边界，勿令其漫溢', '把「今天做完该做的」当成唯一目标'],
    bad: ['先减所求，勿以全力并逐二事', '先把最弱一环补齐，再谈拔高', '宁慢而稳，勿快而虚'],
  },
  求职事业: {
    focus: '此事之要在「辨上下、定民志」——须知何者为主、何者为备。',
    good: ['合同条款细看，口头之诺不足恃', '把岗位、薪资结构、通勤成本逐项折算', '依卦气之方，向{tiDirection}与{yongDirection}之地求之'],
    bad: ['不宜海投，宜精选数家而精投', '先保生存，再谈理想，勿一次求全', '不宜因一时之诺而弃已成之势'],
  },
  财运生计: {
    focus: '此事之要在「纪律」二字——进不如守，守不如节。',
    good: ['即刻记账，把支出分作必需／可省／可延', '债务主动商洽，勿待逾期', '开源择时不夺主线者为之'],
    bad: ['先活下来，再谈攒钱，勿硬撑体面', '不可举债补债，不可因分期而松其纪', '非必要之费一概延后'],
  },
  心态情绪: {
    focus: '此事之要在「心不受境转」——卦象所示，多是你自己与自己的角力。',
    good: ['以事定心：做完一件，心自安一分', '不与旁人比进度，只与昨日之己比', '信已定之策，不再反复叩问'],
    bad: ['焦虑非罪，然不可据焦虑以行事', '卦不再占、问不再问，反复求卜即是心散', '勿以「全都要」自苦'],
  },
  作息健康: {
    focus: '此事之要在「顺身体之自然」——逆之则百事俱废。',
    good: ['该睡则睡，该食则食，此即蓄力', '作息立定，不因一日之差而自弃', '劳而有节，日中留隙'],
    bad: ['熬夜硬撑是「征凶」之象，非自强', '不可用身体的债去还事情的债', '缓则治本，急则伤身'],
  },
  人际情感: {
    focus: '此事之要在「同气」与「留余」——情深者宜缓，势逼者宜退。',
    good: ['以诚相待，言有物而行有恒', '留三分余地，不妨把话说明', '贵人常在旧识之中，可主动相询'],
    bad: ['强求则伤，宜缓图之', '勿以一时之气断长久之情', '先把己身立稳，再论及人'],
  },
  决策取舍: {
    focus: '此事之要在「取舍」二字——卦以「不满」为吉，以「孤注」为凶。',
    good: ['取其一为主，余者降为备', '留一条细线作退路，心安方能专注', '以半年之期试之，再定去留'],
    bad: ['孤注一掷者易竭，须留一条细线为退路', '两头并力则两失，先定其一为主', '沉没之费不可决将来之事，已付出者不复计'],
  },
  其他: {
    focus: '卦示其理，事在人为，守常道而行可也。',
    good: ['循理而行，不妄动，不迟疑', '先立其本，再图其末'],
    bad: ['宜缓不宜急，宜守不宜攻'],
  },
};

/* ============================================================
 * 二、工具
 * ========================================================== */

/** 稳定散列：同卦同答，保证断语可复现 */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(arr, seed) {
  if (!arr || !arr.length) return '';
  return arr[hash(seed) % arr.length];
}

function fill(tpl, dict) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (dict[k] !== undefined && dict[k] !== null ? String(dict[k]) : ''));
}

/** 拼句：去空、去首尾标点、统一句读为「。」，避免出现「。」。 */
function zh(...parts) {
  return parts
    .filter((s) => s !== null && s !== undefined && String(s).trim() !== '')
    .map((s) => String(s).trim().replace(/^[；。，、]+/, '').replace(/[；。，、]+$/, ''))
    .join('。')
    .replace(/。+/g, '。') + '。';
}

/** 引文：去掉原句末标点，交由外层统一断句，避免出现「。」。 */
function quote(text) {
  return `「${String(text).trim().replace(/[。！？]+$/, '')}」`;
}

function stripYaoTitle(text) {
  return String(text).replace(/^(初|上|[九六][二三四五])[九六]?：/, '').trim();
}

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}

/* ============================================================
 * 三、主函数
 * ========================================================== */

/**
 * 由卦局生成断语。
 * @param {object} chart core/divination.mjs 的 cast() / buildChart() 结果
 */
export function interpret(chart) {
  // 小六壬是同录一库的另一种占法：断课在 core/xiaoliuren.mjs，
  // 在此分派是为了让所有调用点（记录、接口、助手）都只认这一个入口。
  if (chart?.kind === 'xlr') return interpretXlr(chart);
  const { ben, hu, bian, moving, tiyong, calendar, score, inputs } = chart;
  const category = normalizeCategory(inputs?.category);
  const rel = tiyong.relation.key;
  const bianRel = tiyong.bianRelation.key;
  const huRel = tiyong.huRelation.key;

  const dict = {
    ti: tiyong.ti.name, yong: tiyong.yong.name,
    tiNature: tiyong.ti.nature, yongNature: tiyong.yong.nature,
    tiElement: tiyong.ti.element, yongElement: tiyong.yong.element,
    tiDirection: tiyong.ti.direction, yongDirection: tiyong.yong.direction,
    benName: ben.name, benFull: ben.fullName,
    huFull: hu.fullName, bianFull: bian.fullName,
    season: SEASON_WORD[tiyong.wang.ti.season] || tiyong.wang.ti.season,
    tiState: STATE_SHORT[tiyong.wang.ti.state] || tiyong.wang.ti.state,
    yongState: STATE_SHORT[tiyong.wang.yong.state] || tiyong.wang.yong.state,
  };

  const seed = `${ben.fullName}|${hu.fullName}|${bian.fullName}|${moving.position}|${rel}|${inputs?.question || ''}`;

  /* ---------- 谶语 ---------- */
  const signature = fill(pick(SIGNATURE[rel] || SIGNATURE.unknown, seed), dict);

  /* ---------- 主：体用为骨 → 月令为气 → 卦德为肉 → 动爻为应 ---------- */
  const tiW = tiyong.wang.ti;
  const yongW = tiyong.wang.yong;
  const tiAdvice = STATE_ADVICE[tiW.state] || '平平';
  const qiClause = `时维${dict.season}令，体${dict.ti}属${tiW.element}而${dict.tiState}，${tiAdvice}；用${dict.yong}属${yongW.element}而${dict.yongState}。`;

  const tRank = STATE_RANK[tiW.state] ?? 2;
  const yRank = STATE_RANK[yongW.state] ?? 2;
  let qiExtra = '';
  if (rel === 'ti_ke_yong') {
    if (tRank < yRank) qiExtra = '虽居其势，而气不及其时，故此中用力当倍，功半而劳倍，久持则自耗。';
    else if (tRank >= 3) qiExtra = '体既当令，克之如反掌，宜乘此气而速决之。';
  } else if (rel === 'yong_sheng_ti') {
    if (tRank < yRank) qiExtra = '体气未足，虽有用生，未能骤受；宜先养其体，而后承其助。';
    else qiExtra = '体气得令而用又来生，天时人助俱在，可为之时也。';
  } else if (rel === 'bihe') {
    if (tRank >= 3) qiExtra = '体用同气而又当令，此天时在我，可为之时也。';
    else if (tRank <= 1) qiExtra = '体用虽同气，然气已衰，须待生扶之月，方有着力处。';
  } else if (rel === 'yong_ke_ti' || rel === 'ti_sheng_yong') {
    if (tRank > yRank) qiExtra = '彼虽见逼，然气已退，逼之不久；我虽受制，气尚在，守之可也。';
    else if (tRank < yRank) qiExtra = '体气既衰，彼又当令，此时不可与争，唯守与避而已。';
  }

  const benClause = zh(
    `本卦${ben.symbol || ''}${ben.fullName}，${ben.coreMeaning || ben.xiang || '守正而行'}`,
    ben.guaci ? `卦辞曰${quote(ben.guaci)}` : '',
  );

  const yaoBody = moving.yaoText ? stripYaoTitle(moving.yaoText) : '';
  const yaoClause = zh(
    `动在${YING_QI_POSITION[moving.position].name}爻，${moving.yaoTitle}${yaoBody ? `：${quote(yaoBody)}` : ''}`,
    moving.positionSymbol,
  );

  const main = zh(
    fill(pick(RELATION_TONE[rel] || RELATION_TONE.unknown, seed), dict),
    qiClause + qiExtra,
    benClause,
    yaoClause,
  );

  /* ---------- 互：中段光景 ---------- */
  const huTri = hu.upper && hu.lower ? `（上${hu.upper}下${hu.lower}）` : '';
  const huMech = huMechanics(huRel, tiyong, huTri);
  const huText = zh(
    `互见${hu.symbol || ''}${hu.fullName}，${hu.coreMeaning || ''}`,
    HU_TONE[huRel] || HU_TONE.unknown,
    huMech,
  );

  /* ---------- 变：归宿 ---------- */
  const bianTri = tiyong.bianTri;
  const bianMech = bianMechanics(bianRel, tiyong, dict);
  const bianText = zh(
    `变归${bian.symbol || ''}${bian.fullName}，${bian.coreMeaning || ''}`,
    BIAN_TONE[bianRel] || BIAN_TONE.unknown,
    bianMech,
    bian.guaci ? `其辞曰${quote(bian.guaci)}` : '',
  );

  /* ---------- 断：总断 ---------- */
  const duan = zh(
    `${score.grade.label}`,
    score.grade.desc,
    totalJudgement(rel, bianRel, score, dict, ben),
    categoryClause(category, score),
  );

  /* ---------- 宜 / 忌 ---------- */
  const { yi, ji } = adviceFor({ category, rel, bianRel, score, dict });

  /* ---------- 应期 ---------- */
  const yingqi = timingFor({ chart, category });

  const tone = [
    { key: 'main', label: '主', text: main },
    { key: 'hu', label: '互', text: huText },
    { key: 'bian', label: '变', text: bianText },
    { key: 'duan', label: '断', text: duan },
    { key: 'yi', label: '宜', text: yi.join('；') + '。' },
    { key: 'ji', label: '忌', text: ji.join('；') + '。' },
    { key: 'yingqi', label: '应期', text: yingqi },
  ];

  /* ---------- 通俗解 ---------- */
  const catPlain = CATEGORY_PLAIN[category] || CATEGORY_PLAIN.其他;
  const good = score.grade.tone === 'good';
  const plain = {
    oneLine: plainOneLine(rel, bianRel, score, category),
    focus: fill(catPlain.focus, dict),
    why: [
      RELATION_PLAIN[rel] || RELATION_PLAIN.unknown,
      `你（体卦${dict.ti}·${tiW.element}）在这个月令里是「${tiW.state}」，` +
        `事情（用卦${dict.yong}·${yongW.element}）是「${yongW.state}」。` +
        comparePlain(tiW.state, yongW.state),
      `过程看互卦${hu.fullName}（${hu.coreMeaning || ''}）：${HU_PLAIN[huRel] || ''}`,
      `结局看变卦${bian.fullName}（${bian.coreMeaning || ''}）：${BIAN_PLAIN[bianRel] || ''}`,
      `动在第${moving.position}爻：${YAO_PLAIN[moving.position]}`,
    ],
    how: (good || score.grade.tone === 'neutral' ? catPlain.good : catPlain.bad)
      .map((s) => fill(s, dict))
      .concat(extraHow(category, rel, bianRel)),
  };

  /* ---------- 古辞佐证 ---------- */
  const classical = {
    guaci: ben.guaci ? { text: ben.guaci, source: `《${ben.name}·卦辞》` } : null,
    xiang: ben.xiang ? { text: ben.xiang, source: `《${ben.name}·象传》` } : null,
    yaoci: moving.yaoText ? { text: moving.yaoText, source: `《${ben.name}·${moving.yaoTitle}》` } : null,
    huXiang: hu.xiang ? { text: hu.xiang, source: `《${hu.name}·象传》` } : null,
    bianXiang: bian.xiang ? { text: bian.xiang, source: `《${bian.name}·象传》` } : null,
  };

  return { signature, tone, classical, plain, grade: score.grade, category, generatedBy: '问心卦·断语引擎 v1' };
}

/* ============================================================
 * 四、细分构件
 * ========================================================== */

/** 互卦之五行机理（与 HU_TONE 互补，不复述） */
function huMechanics(huRel, tiyong, huTri) {
  const tri = tiyong.huTri;
  switch (huRel) {
    case 'yong_ke_ti':
      return `互卦${huTri}中，${tri.name}${tri.nature}属${tri.element}而克体，是中道有阻，外力将试其心志。`;
    case 'yong_sheng_ti':
      return `互卦${huTri}中，${tri.name}${tri.nature}属${tri.element}而生体，是中道得助，其间当有意外之济。`;
    case 'ti_ke_yong':
      return `互卦${huTri}中，${tri.name}${tri.nature}属${tri.element}而为体所克，是中道由我推动。`;
    case 'ti_sheng_yong':
      return `互卦${huTri}中，体去生${tri.name}${tri.nature}，是中道耗我之气，多用于无形之处。`;
    case 'bihe':
      return `互卦${huTri}中，${tri.name}${tri.nature}与体同属${tri.element}，无耗无伤。`;
    default:
      return '';
  }
}

/** 变卦之五行机理 */
function bianMechanics(bianRel, tiyong, dict) {
  const tri = tiyong.bianTri;
  switch (bianRel) {
    case 'yong_ke_ti':
      return `变卦之中，${tri.name}${tri.nature}属${tri.element}而来克体，是后期之难甚于前期，不可先松其心。`;
    case 'yong_sheng_ti':
      return `变卦之中，${tri.name}${tri.nature}属${tri.element}而来生体，是晚景胜于初程。`;
    case 'ti_ke_yong':
      return `变卦之中，${tri.name}${tri.nature}仍为体所克，是收局由己。`;
    case 'ti_sheng_yong':
      return `变卦之中，体去生${tri.name}${tri.nature}，是终局耗我，成而费力。`;
    case 'bihe':
      return `变卦之中，${tri.name}${tri.nature}与体同属${tri.element}，无耗无伤。`;
    default:
      return '';
  }
}

/** 总断：把三卦与气合成一句 */
function totalJudgement(rel, bianRel, score, dict, ben) {
  const good = score.grade.tone === 'good';
  const bad = score.grade.tone === 'bad' || score.grade.tone === 'warn';
  const opening = `总而观之，${ben.fullName}${ben.symbol || ''}之为卦，其德在「${ben.coreMeaning || '守正'}」`;

  let mid;
  if (good && bianRel === 'yong_sheng_ti') mid = '，本卦既顺而结局来济，事可为也';
  else if (good && bianRel === 'bihe') mid = '，本卦既顺而首尾同气，事可谐也';
  else if (good && bianRel === 'ti_ke_yong') mid = '，势既在我而收局由己，事可制也';
  else if (bad && bianRel === 'yong_ke_ti') mid = '，体气不足而结局受制，事多阻也';
  else if (bad) mid = '，本卦与变卦皆不尽顺，事有险也';
  else if (bianRel === 'yong_ke_ti') mid = '，中程虽可，而后段须防外压';
  else mid = '，可与可为，然须以人力继之';

  // 势顺而卦德反凶者，须明说其兆，免得只见其吉
  const FORTUNE = { 大吉: 4, 吉: 2, 中吉: 1, 平: 0, 小凶: -2, 凶: -4 };
  let caveat = '';
  if ((FORTUNE[ben.fortune] ?? 0) < 0 && good) {
    caveat = `惟本卦${ben.name}之德本偏「${ben.fortune}」，其象为${ben.coreMeaning || '守正'}——势虽可乘，仍当先减其负、谨其始，方不负此气。`;
  }

  const tail = good
    ? '惟吉者易弛，愿以「有恒」二字守之。'
    : bad
      ? '愿以「留余」二字处之，勿以孤注自困。'
      : '不必求其必成，但求日日行之不辍。';
  return opening + mid + '；' + caveat + tail;
}

function categoryClause(category, score) {
  const phrase = {
    考研学业: '此问关乎学业进取，卦以积渐成之，非以一夕取之',
    求职事业: '此问关乎出处进退，卦以辨上下、定民志为先',
    财运生计: '此问关乎财用盈缩，卦以纪律为先，进不如守',
    心态情绪: '此问关乎心之安否，卦以不受境转为要',
    作息健康: '此问关乎身体作息，卦以顺其自然为吉',
    人际情感: '此问关乎人我之间，卦以同气留余为则',
    决策取舍: '此问关乎取舍，卦以不满为吉，以孤注为凶',
    其他: '此问之理，卦已具陈',
  }[category] || '此问之理，卦已具陈';
  const grade = score.grade.tone === 'good'
    ? '，今卦气向顺，可循此勉之'
    : score.grade.tone === 'neutral'
      ? '，今卦气平平，成败在人'
      : '，今卦气不顺，宜先自守';
  return phrase + grade;
}

function adviceFor({ category, rel, bianRel, score, dict }) {
  const yi = [];
  const ji = [];

  const relAdvice = {
    ti_ke_yong: { yi: ['乘势速决，勿使事久生变', '以己之力主动开局'], ji: ['久持不下，力尽则衰', '因小胜而骄，因小挫而疑'] },
    yong_sheng_ti: { yi: ['开门纳助，主动就人问计', '顺其来势而受之'], ji: ['闭门自守，拒人于外', '贪多而竭其源'] },
    bihe: { yi: ['守已成之轨，循常道而行', '与人协谋，同气共事'], ji: ['狃于安逸而懈其志', '无事生变，自扰其局'] },
    yong_ke_ti: { yi: ['避其锋，蓄其力，待其衰', '先立不败之地，再图进取'], ji: ['以弱争强，硬碰硬顶', '孤注一掷，不留后路'] },
    ti_sheng_yong: { yi: ['量力度德，节其出', '先立界，再谈付出'], ji: ['竭源以奉，费而不获', '以己之膏润彼之田而不知止'] },
  }[rel] || { yi: ['守常道而行'], ji: ['妄动'] };
  yi.push(...relAdvice.yi);
  ji.push(...relAdvice.ji);

  if (bianRel === 'yong_ke_ti') {
    yi.push('为后段之难先作预备，宜早不宜迟');
    ji.push('因前段顺手而松其后心');
  } else if (bianRel === 'yong_sheng_ti' || bianRel === 'bihe') {
    yi.push('收局已顺，宜守成而不宜再张');
    ji.push('成而轻之，守之不谨');
  }

  const catAdvice = {
    考研学业: { yi: ['主线不动，日课有恒', '课程之事设硬边界，集中时段了之'], ji: ['与旁人比进度', '以课设之忙替代实质之复习'] },
    求职事业: { yi: ['精投数家，逐条核其条款', '留一备选，心安而后专注'], ji: ['海投以自安', '以口头之诺为凭'] },
    财运生计: { yi: ['即刻记账，分必需／可省／可延', '债务主动商洽，勿待逾期'], ji: ['举债补债', '因分期而松纪律'] },
    心态情绪: { yi: ['以事定心，做完一件安一分', '信已定之策，不再反复叩问'], ji: ['反复起卦以求解，问愈多而心愈散', '以焦虑为据而行事'] },
    作息健康: { yi: ['该睡则睡，该食则食', '作息立定，不因一日之差而自弃'], ji: ['熬夜硬撑，以身体之债还事情之债'] },
    人际情感: { yi: ['言有物而行有恒', '主动就旧识故交相询'], ji: ['强求速成', '以一时之气断长久之情'] },
    决策取舍: { yi: ['取其一为主，余者降为备', '留一条细线作退路'], ji: ['两头并力，力分则两失', '以沉没之费决将来之事'] },
    其他: { yi: ['先立其本，再图其末'], ji: ['躁进'] },
  }[category] || { yi: [], ji: [] };
  yi.push(...(catAdvice.yi || []));
  ji.push(...(catAdvice.ji || []));

  return { yi: dedupe(yi).slice(0, 5), ji: dedupe(ji).slice(0, 5) };
}

/** 应期：将动爻之期与体之旺衰合成一段，不作两说 */
function timingFor({ chart }) {
  const { moving, tiyong, calendar } = chart;
  const pos = YING_QI_POSITION[moving.position];
  const tiW = tiyong.wang.ti;
  const rank = STATE_RANK[tiW.state] ?? 2;
  const parts = [];
  if (rank >= 3) {
    parts.push(
      `动在${pos.name}爻，本主${pos.window}之期；然体${tiW.element}${tiW.state}，气得其令，`
        + `故其应不至久留，约在${pos.windowFit}之内见其端。`,
    );
  } else {
    const months = ELEMENT_MONTHS[tiW.element] || [];
    parts.push(
      `动在${pos.name}爻，本主${pos.window}之期；体${tiW.element}${tiW.state}，气犹未至，`
        + `事之成须待${months.join('、')}月${tiW.element}气得令之时，故当以${months.join('、')}月为观察之节。`,
    );
  }
  if (calendar?.nextJie) parts.push(`下一个节气为${calendar.nextJie}，可作近日之节点。`);
  return parts.join('');
}

function plainOneLine(rel, bianRel, score, category) {
  const catWord = {
    考研学业: '这件事', 求职事业: '这件事', 财运生计: '钱财这件事',
    心态情绪: '你的心', 作息健康: '你的身体', 人际情感: '这段关系',
    决策取舍: '这个选择', 其他: '这件事',
  }[category] || '这件事';
  const gradeWord = { good: '整体偏顺', neutral: '整体平平', warn: '整体偏难', bad: '整体难办' }[score.grade.tone];
  return `${catWord}${gradeWord}。${BIAN_PLAIN[bianRel] || ''}`.replace(/。。/g, '。');
}

function comparePlain(tiState, yongState) {
  const t = STATE_RANK[tiState] ?? 2;
  const y = STATE_RANK[yongState] ?? 2;
  if (t > y) return '你比这件事「当令」，眼下是你状态相对好的时候，可以借这股气往前推。';
  if (t < y) return '这件事比你先「当令」，你眼下气不足，别指望用力气硬顶，要借势、要等时机。';
  return '你和这件事的气是相当的，成不成主要看你的执行有没有断。';
}

function extraHow(category, rel, bianRel) {
  const out = [];
  if (bianRel === 'yong_ke_ti') out.push('把「最难的一段」提前想到，先写好退路与预案，别等压力到了才想。');
  if (rel === 'yong_ke_ti') out.push('这段时间的目标不是赢，是「不失分」：少犯错比多做事重要。');
  if (rel === 'ti_ke_yong') out.push('给自己设一个期限，到期就决断，不要把「再等等」当策略。');
  if (category === '考研学业') out.push('每天固定时段，雷打不动；状态差也坐满时间，这就是「自强不息」的字面意思。');
  return out.slice(0, 2);
}

/** 分类归一 */
export function normalizeCategory(raw) {
  if (!raw) return '其他';
  const s = String(raw).trim();
  if (CATEGORIES.includes(s)) return s;
  const map = [
    [/考|研|学|课|复习|初试|复试|上岸|论文|毕设|stm32/i, '考研学业'],
    [/求|职|工作|面试|offer|简历|投递|事业|晋升|跳槽/i, '求职事业'],
    [/财|钱|债|攒|收入|薪|投资|股|花销|预算/i, '财运生计'],
    [/心|情绪|焦虑|安|迷茫|压力|决定|动摇/i, '心态情绪'],
    [/睡|作息|身体|健康|熬夜|饭|吃/i, '作息健康'],
    [/情|恋|爱|婚|朋友|家人|人际|室友|父母/i, '人际情感'],
    [/选|择|取舍|要不要|该不该/i, '决策取舍'],
  ];
  for (const [re, cat] of map) if (re.test(s)) return cat;
  return '其他';
}
