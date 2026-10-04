/**
 * 问心卦 · 历法模块
 * ------------------------------------------------------------
 * 提供梅花易数起卦与断卦所需的全部时间量：
 *   儒略日 / 真太阳时 / 均时差 / 时辰 / 月建（节气）/ 日干支
 *
 * 算法为低精度天文近似（太阳视黄经误差约 0.01°，折合时刻误差 ≲ 15 分钟），
 * 对定节气、定月建、定时辰足够；不用于正式历书推算。
 */

import { DIZHI, TIANGAN } from './bagua.mjs';

/** 常用城市经纬度（东经为正、北纬为正），便于起卦时一键填入 */
export const PLACES = [
  { name: '兰州', longitude: 103.83, latitude: 36.06 },
  { name: '北京', longitude: 116.41, latitude: 39.90 },
  { name: '上海', longitude: 121.47, latitude: 31.23 },
  { name: '长沙', longitude: 112.94, latitude: 28.23 },
  { name: '成都', longitude: 104.07, latitude: 30.57 },
  { name: '苏州', longitude: 120.58, latitude: 31.30 },
  { name: '杭州', longitude: 120.15, latitude: 30.27 },
  { name: '深圳', longitude: 114.06, latitude: 22.55 },
  { name: '天津', longitude: 117.20, latitude: 39.13 },
  { name: '石家庄', longitude: 114.51, latitude: 38.04 },
];

/** 中国标准时区中央经线 */
export const CHINA_STANDARD_MERIDIAN = 120;

/**
 * 儒略日（含日内小数）。month 为 1-12，day 为 1-31，hour 为 0-23 的小数小时。
 */
export function julianDay(year, month, day, hour = 12) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    day +
    b -
    1524.5 +
    hour / 24
  );
}

/** 儒略日 → 日历（含日内小数小时），返回 { year, month, day, hour } */
export function fromJulianDay(jd) {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const dayWithFrac = b - d - Math.floor(30.6001 * e) + f;
  const day = Math.floor(dayWithFrac);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { year, month, day, hour: (dayWithFrac - day) * 24 };
}

/** 太阳视黄经（度，0-360），精度约 0.01° */
export function sunEclipticLongitude(jd) {
  const t = (jd - 2451545.0) / 36525;
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const m = (357.52911 + 35999.05029 * t - 0.0001537 * t * t) * (Math.PI / 180);
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(m) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * m) +
    0.000289 * Math.sin(3 * m);
  const trueLong = l0 + c;
  const omega = (125.04 - 1934.136 * t) * (Math.PI / 180);
  const apparent = trueLong - 0.00569 - 0.00478 * Math.sin(omega);
  return ((apparent % 360) + 360) % 360;
}

/** 均时差（分钟），真太阳时 − 平太阳时 */
export function equationOfTime(jd) {
  const t = (jd - 2451545.0) / 36525;
  const l0 = ((280.46646 + 36000.76983 * t) % 360) * (Math.PI / 180);
  const m = (357.52911 + 35999.05029 * t) * (Math.PI / 180);
  const e = 0.016708634 - 0.000042037 * t;
  const epsilon = (23.439291 - 0.0130042 * t) * (Math.PI / 180);
  const y = Math.tan(epsilon / 2) ** 2;
  const eot =
    y * Math.sin(2 * l0) -
    2 * e * Math.sin(m) +
    4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
    0.5 * y * y * Math.sin(4 * l0) -
    1.25 * e * e * Math.sin(2 * m);
  return eot * (180 / Math.PI) * 4;
}

/** 经度时差（分钟）：相对中央经线，东经为正 */
export function longitudeOffsetMinutes(longitude, meridian = CHINA_STANDARD_MERIDIAN) {
  return (longitude - meridian) * 4;
}

/**
 * 真太阳时换算。
 * @param {object} p
 * @param {string} p.localTime  'YYYY-MM-DDTHH:mm' 或 'YYYY-MM-DD HH:mm'（钟表时间/标准时）
 * @param {number} p.longitude  当地东经
 * @param {number} [p.meridian] 标准时中央经线，默认 120（北京时间）
 * @returns {{localTime:string,trueSolarTime:string,offsetMinutes:number,longitudeMinutes:number,equationMinutes:number,trueSolarHour:number,date:Date}}
 */
export function trueSolarTime({ localTime, longitude, meridian = CHINA_STANDARD_MERIDIAN }) {
  const date = parseLocalTime(localTime);
  const jdLocal = julianDay(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours() + date.getMinutes() / 60,
  );
  const longitudeMinutes = longitudeOffsetMinutes(longitude, meridian);
  // 均时差随时刻变化极小，用当日值即可
  const equationMinutes = equationOfTime(jdLocal);
  const offsetMinutes = longitudeMinutes + equationMinutes;
  const trueSolarHour = date.getHours() + date.getMinutes() / 60 + offsetMinutes / 60;
  return {
    localTime,
    trueSolarTime: formatHour(trueSolarHour),
    offsetMinutes: round(offsetMinutes, 2),
    longitudeMinutes: round(longitudeMinutes, 2),
    equationMinutes: round(equationMinutes, 2),
    trueSolarHour,
    date,
  };
}

/** 'YYYY-MM-DD HH:mm' → Date（本地时区解析，避免 UTC 偏移） */
export function parseLocalTime(text) {
  const m = String(text).trim().match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) throw new Error(`时间格式无法解析：${text}`);
  const [, y, mo, d, h, mi] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
}

/** 0-24 小数小时 → 'HH:mm' */
export function formatHour(hour) {
  let h = hour % 24;
  if (h < 0) h += 24;
  let m = Math.round((h - Math.floor(h)) * 60);
  let hh = Math.floor(h);
  if (m === 60) {
    m = 0;
    hh = (hh + 1) % 24;
  }
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 由小数小时取时辰地支（23-1 为子时，余者顺推） */
export function hourZhi(hour) {
  const h = ((hour % 24) + 24) % 24;
  const idx = Math.floor(((h + 1) % 24) / 2);
  return DIZHI[idx];
}

/** 地支 → 时辰序数（子1 丑2 … 亥12），梅花易数取数用 */
export function zhiNumber(zhi) {
  const i = DIZHI.indexOf(zhi);
  return i < 0 ? null : i + 1;
}

/** 节气名（按太阳黄经每 15°）。285°=小寒，315°=立春，345°=惊蛰，45°=立夏… */
const SOLAR_TERM_NAMES = {
  0: '春分', 15: '清明', 30: '谷雨', 45: '立夏', 60: '小满', 75: '芒种',
  90: '夏至', 105: '小暑', 120: '大暑', 135: '立秋', 150: '处暑', 165: '白露',
  180: '秋分', 195: '寒露', 210: '霜降', 225: '立冬', 240: '小雪', 255: '大雪',
  270: '冬至', 285: '小寒', 300: '大寒', 315: '立春', 330: '雨水', 345: '惊蛰',
};

/** 十二「节」（非「气」）对应的月建地支，自立春起 */
const JIE_TO_MONTH_ZHI = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑'];
const JIE_NAMES = ['立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪', '小寒'];

/**
 * 月建（以节气为界）与所处节气区间。
 * @returns {{monthZhi:string,season:string,jie:string,term:string,sunLongitude:number,monthIndex:number,nextJie:string,progress:number}}
 */
export function monthBuild(jd) {
  const lambda = sunEclipticLongitude(jd);
  const shifted = ((lambda - 315) % 360 + 360) % 360;
  const monthIndex = Math.floor(shifted / 30); // 0=寅月(立春起)
  const progress = (shifted % 30) / 30;
  const termIndex = Math.round(lambda / 15) % 24;
  return {
    monthZhi: JIE_TO_MONTH_ZHI[monthIndex],
    monthIndex,
    jie: JIE_NAMES[monthIndex],
    nextJie: JIE_NAMES[(monthIndex + 1) % 12],
    term: SOLAR_TERM_NAMES[(termIndex * 15) % 360],
    sunLongitude: round(lambda, 4),
    progress: round(progress, 3),
  };
}

/** 下一个「节」的近似日期时间（用于断应期） */
export function nextJieTime(jd) {
  const lambda = sunEclipticLongitude(jd);
  const shifted = ((lambda - 315) % 360 + 360) % 360;
  const target = 315 + (Math.floor(shifted / 30) + 1) * 30;
  let lo = jd;
  let hi = jd + 35;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const l = sunEclipticLongitude(mid);
    const s = ((l - 315) % 360 + 360) % 360;
    const t = ((target - 315) % 360 + 360) % 360;
    if (s < t) lo = mid;
    else hi = mid;
  }
  const mid = (lo + hi) / 2;
  const { year, month, day, hour } = fromJulianDay(mid + 8 / 24); // 近似东八区
  return {
    jie: JIE_NAMES[(Math.floor(shifted / 30) + 1) % 12],
    text: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${formatHour(hour)}`,
  };
}

/** 日干支：以儒略日连续推六十甲子（甲子为 0） */
export function dayGanZhi(jd) {
  const n = (Math.floor(jd + 0.5) + 49) % 60;
  return {
    index: n,
    gan: TIANGAN[n % 10],
    zhi: DIZHI[n % 12],
    name: `${TIANGAN[n % 10]}${DIZHI[n % 12]}`,
  };
}

/** 年干支（以立春为界） */
export function yearGanZhi(jd) {
  const { year, month, day } = fromJulianDay(jd + 8 / 24);
  const lambda = sunEclipticLongitude(jd);
  const beforeLiChun = month < 2 || (month === 2 && lambda < 315);
  const solarYear = beforeLiChun ? year - 1 : year;
  const n = ((solarYear - 4) % 60 + 60) % 60;
  return { gan: TIANGAN[n % 10], zhi: DIZHI[n % 12], name: `${TIANGAN[n % 10]}${DIZHI[n % 12]}`, solarYear };
}

/**
 * 一次性汇总一个时刻的全部历法信息。
 * @param {object} p { localTime, longitude?, latitude?, placeName? }
 */
export function calendarInfo({ localTime, longitude, latitude, placeName }) {
  const date = parseLocalTime(localTime);
  const jd = julianDay(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours() + date.getMinutes() / 60,
  );
  const useLongitude = typeof longitude === 'number' ? longitude : CHINA_STANDARD_MERIDIAN;
  const trueSolar = trueSolarTime({ localTime, longitude: useLongitude });
  const trueZhi = hourZhi(trueSolar.trueSolarHour);
  const clockZhi = hourZhi(date.getHours() + date.getMinutes() / 60);
  const build = monthBuild(jd);
  const ganzhiDay = dayGanZhi(jd);
  const ganzhiYear = yearGanZhi(jd);
  return {
    localTime,
    dateTime: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    placeName: placeName || '',
    longitude: useLongitude,
    latitude: latitude ?? null,
    julianDay: round(jd, 5),
    trueSolarTime: trueSolar.trueSolarTime,
    trueSolarHour: round(trueSolar.trueSolarHour, 4),
    equationMinutes: trueSolar.equationMinutes,
    longitudeMinutes: trueSolar.longitudeMinutes,
    offsetMinutes: trueSolar.offsetMinutes,
    clockHourZhi: clockZhi,
    clockHourNumber: zhiNumber(clockZhi),
    trueHourZhi: trueZhi,
    trueHourNumber: zhiNumber(trueZhi),
    monthZhi: build.monthZhi,
    monthIndex: build.monthIndex,
    jie: build.jie,
    term: build.term,
    nextJie: build.nextJie,
    sunLongitude: build.sunLongitude,
    yearGanZhi: ganzhiYear.name,
    dayGanZhi: ganzhiDay.name,
    dayGanZhiIndex: ganzhiDay.index,
    summary: `${ganzhiYear.name}年 ${build.monthZhi}月（${build.jie}后） ${ganzhiDay.name}日 ${trueZhi}时`,
  };
}

function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
