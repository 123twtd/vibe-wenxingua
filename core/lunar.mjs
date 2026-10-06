/**
 * 问心卦 · 农历模块
 * ------------------------------------------------------------
 * 小六壬的「月日时辰起课」依传统用农历月、日。本模块给出**自算的农历日期**：
 *   朔（新月时刻）→ 定月首 → 冬至基准定十一月 → 无中气置闰 → 定月序与日序。
 *
 * 算法为低精度天文近似（朔时刻用截断三角级数，误差在分钟级），
 * 落在子夜前后极近处者，可能与正式历书相差一日——这是**起课用的近似**，
 * 不作历书推算。适用范围 1900–2100，越界抛错而不静默算错。
 *
 * 与 core/calendar.mjs 同一风格：只说事实，不引第三方库。
 */

import { julianDay, fromJulianDay, sunEclipticLongitude } from './calendar.mjs';

export const LUNAR_MIN_YEAR = 1900;
export const LUNAR_MAX_YEAR = 2100;

/** 北京时与 UT 的固定偏移（民用历以北京时为准） */
const TZ = 8 / 24;
const RAD = Math.PI / 180;
/** 平朔望月长度（日） */
const SYNODIC_MONTH = 29.530588861;
/** 2000 年 1 月 6 日平朔的儒略日（Meeus 第 49 章基准） */
const NEW_MOON_EPOCH = 2451550.09766;
/** 太阳平均日行度（度/日） */
const SUN_DAILY_MOTION = 0.9856473;

/**
 * ΔT（TD − UT，秒）近似：按十年锚点线性插值。
 * 朔时刻的 TD→UT 换算只差这一点点；对本用途（定民用日）够用。
 */
const DT_ANCHORS = [
  [1900, -2.8], [1910, 10.4], [1920, 21.2], [1930, 24.0], [1940, 24.3],
  [1950, 29.1], [1960, 33.2], [1970, 40.2], [1980, 50.5], [1990, 56.9],
  [2000, 63.8], [2010, 66.1], [2020, 69.4], [2030, 74.5], [2040, 81.0],
  [2050, 89.0], [2060, 98.0], [2080, 118.0], [2100, 140.0],
];

function deltaTSeconds(jd) {
  const year = 2000 + (jd - 2451545.0) / 365.2425;
  if (year <= DT_ANCHORS[0][0]) return DT_ANCHORS[0][1];
  const last = DT_ANCHORS[DT_ANCHORS.length - 1];
  if (year >= last[0]) return last[1];
  for (let i = 1; i < DT_ANCHORS.length; i += 1) {
    const [y1, s1] = DT_ANCHORS[i - 1];
    const [y2, s2] = DT_ANCHORS[i];
    if (year <= y2) return s1 + ((year - y1) / (y2 - y1)) * (s2 - s1);
  }
  return last[1];
}

/**
 * 第 k 个朔的民用儒略日（北京时）。
 * k 以 2000-01-06 的朔为 0（Meeus 第 49 章记号）。
 */
export function newMoonCivilJD(k) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  let jde = NEW_MOON_EPOCH + SYNODIC_MONTH * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = (2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3) * RAD;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * RAD;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * RAD;
  const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) * RAD;
  const c =
    -0.40720 * Math.sin(Mp)
    + 0.17241 * E * Math.sin(M)
    + 0.01608 * Math.sin(2 * Mp)
    + 0.01039 * Math.sin(2 * F)
    + 0.00739 * E * Math.sin(Mp - M)
    - 0.00514 * E * Math.sin(Mp + M)
    + 0.00208 * E * E * Math.sin(2 * M)
    - 0.00111 * Math.sin(Mp - 2 * F)
    - 0.00057 * Math.sin(Mp + 2 * F)
    + 0.00056 * E * Math.sin(2 * Mp + M)
    - 0.00042 * Math.sin(3 * Mp)
    + 0.00042 * E * Math.sin(M + 2 * F)
    + 0.00038 * E * Math.sin(M - 2 * F)
    - 0.00024 * E * Math.sin(2 * Mp - M)
    - 0.00017 * Math.sin(Om)
    - 0.00007 * Math.sin(Mp + 2 * M)
    + 0.00004 * Math.sin(2 * Mp - 2 * F)
    + 0.00004 * Math.sin(3 * M)
    + 0.00003 * Math.sin(Mp + M - 2 * F)
    + 0.00003 * Math.sin(2 * Mp + 2 * F)
    - 0.00003 * Math.sin(Mp + M + 2 * F)
    + 0.00003 * Math.sin(Mp - M + 2 * F)
    - 0.00002 * Math.sin(Mp - M - 2 * F)
    - 0.00002 * Math.sin(3 * Mp + M)
    + 0.00002 * Math.sin(4 * Mp);
  jde += c;
  return jde - deltaTSeconds(jde) / 86400 + TZ;
}

/** 民用儒略日 → 「日号」（同日的中午与子夜同号） */
export function dayNumberOf(civilJd) {
  return Math.floor(civilJd + 0.5);
}

function lambdaAt(civilJd) {
  // sunEclipticLongitude 要的是真实 UT；民用儒略日减回 8 小时
  return sunEclipticLongitude(civilJd - TZ);
}

/**
 * 太阳视黄经下一次到达 target（度）的民用儒略日。
 * nearCivilJd 只需落在目标**之前数日**；用日行度估值后二分收敛。
 */
export function sunTermCivilJD(target, nearCivilJd) {
  const diff = ((target - lambdaAt(nearCivilJd)) % 360 + 360) % 360;
  const guess = nearCivilJd + (diff === 0 ? 360 : diff) / SUN_DAILY_MOTION;
  let lo = guess - 3;
  let hi = guess + 3;
  const g = (x) => ((lambdaAt(x) - target + 180) % 360 + 360) % 360 - 180;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (g(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 某朔望月首的日号 */
function monthStartDay(k) {
  return dayNumberOf(newMoonCivilJD(k));
}

/** 找到 k 使 monthStartDay(k) <= day < monthStartDay(k+1) */
function monthIndexOfDay(day) {
  let k = Math.round((day - 0.5 - NEW_MOON_EPOCH - TZ) / SYNODIC_MONTH);
  let guard = 0;
  while (monthStartDay(k) > day && guard < 40) { k -= 1; guard += 1; }
  guard = 0;
  while (monthStartDay(k + 1) <= day && guard < 40) { k += 1; guard += 1; }
  return k;
}

/**
 * 该月内是否含「中气」（太阳黄经过 30° 的整数倍）——闰月判定用。
 *
 * 判定按**民用日**从月初日到下一月初日（不含）：中气落在哪一天的日界内就算哪个月。
 * 不能拿两个朔时刻的黄经相比——朔常在午后，中气若在当日朔之前，按时刻算会在本月、
 * 按民用日算却属下月，2020 年闰四月、2025 年闰六月正是这样被判错位的。
 */
function monthHasMajorTerm(k) {
  const dayStart = monthStartDay(k);
  const dayEnd = monthStartDay(k + 1);
  const l1 = lambdaAt(dayStart - 0.5); // 月初零点
  const next = (Math.floor(l1 / 30) + 1) * 30; // 沿黄经向前的下一个中气
  const jd = sunTermCivilJD(next % 360, dayStart - 0.5);
  return dayNumberOf(jd) < dayEnd;
}

function gregorianYearOfDay(day) {
  return fromJulianDay(day).year;
}

/**
 * 由公历日期取农历日期。
 * @param {{year:number, month:number, day:number}} p 公历年月日（民用）
 * @returns {{year:number, month:number, day:number, isLeap:boolean,
 *            monthName:string, dayName:string, suiLeapMonth:number}}
 *   year 为农历年号（以正月初一为界）；suiLeapMonth 为「本岁」的闰月序（0 为无闰）。
 */
export function lunarFromSolar({ year, month, day }) {
  if (!(year >= LUNAR_MIN_YEAR && year <= LUNAR_MAX_YEAR)) {
    throw new Error(`农历推算只覆盖 ${LUNAR_MIN_YEAR}–${LUNAR_MAX_YEAR} 年（本程序不掺假数据）。`);
  }
  const targetDay = dayNumberOf(julianDay(year, month, day, 12));

  // 一、找不晚于目标日的最近一个冬至（自年底往前试，near 取 12-15 保证落在当年冬至之前）
  let wsCivil = null;
  for (let y = year + 1; y >= year - 2; y -= 1) {
    const jd = sunTermCivilJD(270, julianDay(y, 12, 15, 12));
    if (dayNumberOf(jd) <= targetDay) { wsCivil = jd; break; }
  }
  if (wsCivil === null) throw new Error('冬至推算失败，请检查日期。');

  // 二、冬至所在月即十一月（岁首）；下一冬至所在月为下一岁之十一月
  const kStart = monthIndexOfDay(dayNumberOf(wsCivil));
  const wsNextCivil = sunTermCivilJD(270, wsCivil + 300);
  const kEnd = monthIndexOfDay(dayNumberOf(wsNextCivil));
  const leapSui = (kEnd - kStart) === 13;

  // 三、自十一月起定月序：闰月取岁内第一个无中气之月，月序不前进
  const kTarget = monthIndexOfDay(targetDay);
  let num = 11;
  let leap = false;
  let assigned = false;
  let leapMonthOfSui = 0;
  let lunarYear = gregorianYearOfDay(monthStartDay(kStart));
  let targetNum = 11;
  let targetIsLeap = false;
  let targetYear = lunarYear;
  for (let i = 0; i < kEnd - kStart; i += 1) {
    const k = kStart + i;
    if (i > 0) {
      if (leapSui && !assigned && !monthHasMajorTerm(k)) {
        assigned = true;
        leap = true;
      } else {
        num = num === 12 ? 1 : num + 1;
        leap = false;
        if (num === 1) lunarYear = gregorianYearOfDay(monthStartDay(k));
      }
    }
    if (leap) leapMonthOfSui = num;
    // 年份要在命中目标月时**当场定格**：遍历还要走过下一个正月，不能等循环结束再取
    if (k === kTarget) { targetNum = num; targetIsLeap = leap; targetYear = lunarYear; }
  }

  const dayNum = targetDay - monthStartDay(kTarget) + 1;
  return {
    year: targetYear,
    month: targetNum,
    day: dayNum,
    isLeap: targetIsLeap,
    monthName: chineseMonthName(targetNum, targetIsLeap),
    dayName: chineseDayName(dayNum),
    suiLeapMonth: leapMonthOfSui,
  };
}

/**
 * 由 'YYYY-MM-DD HH:mm' 取农历信息（起课用）。
 * castingMonth 为起课取数的月序：闰月按本月计。
 */
export function lunarInfo({ localTime }) {
  const m = String(localTime || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) throw new Error(`时间格式无法解析：${localTime}`);
  const out = lunarFromSolar({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    isLeap: out.isLeap,
    monthName: out.monthName,
    dayName: out.dayName,
    suiLeapMonth: out.suiLeapMonth,
    /** 起课取数的月序：闰月按本月计（与 chart.casting.steps 里的说明一致） */
    castingMonth: out.month,
  };
}

const MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];

export function chineseMonthName(month, isLeap = false) {
  return `${isLeap ? '闰' : ''}${MONTH_NAMES[month - 1] || `${month}月`}`;
}

const DAY_NAMES = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

export function chineseDayName(day) {
  return DAY_NAMES[day - 1] || `${day}`;
}