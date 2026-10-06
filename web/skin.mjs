/**
 * 问心卦 · 皮肤的应用与记忆
 * ------------------------------------------------------------
 * 「宣纸／夜读」是明暗的轴（`data-theme`，见 app.js 的 applyTheme）；
 * 「皮肤」是设计语言的轴（`data-skin`），由插件经 ctx.registerSkin 注册，
 * 清单随 /api/meta 的 plugins.skins 到达（ADR-0014）。
 *
 * 外壳在这里只做三件事：
 *   1. 启动即套用 localStorage 里的选择——不等 meta，避免先闪一下默认样式；
 *   2. meta 到达后校验：清单里还在就用；不在（插件停用／载入失败／已删除）
 *      就回默认，但**保留选择**，插件重新启用后自动恢复；
 *   3. 给设置页提供读（readSkinPref）与写（applySkin）。
 *
 * 本模块不认识任何具体插件，回退规则对官方皮肤与第三方皮肤一视同仁。
 */

const LS_SKIN = 'qxg.skin';

/** 当前可用皮肤（外壳每次拿到 meta 后经 setAvailableSkins 灌入） */
let available = [];

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 存不了就算了 */ }
};

/** 已选皮肤（可能暂时不可用）；null = 内置默认「宣纸水墨」 */
export function readSkinPref() {
  try {
    const v = JSON.parse(lsGet(LS_SKIN) || 'null');
    return v && v.id && v.url
      ? { id: String(v.id), name: String(v.name || v.id), url: String(v.url) }
      : null;
  } catch {
    return null;   // 存储值被手改坏了，就当没选过
  }
}

/**
 * 应用一款皮肤；pref = { id, name, url } 或 null（回默认）。
 * persist=false 用于「按清单校验后的自动应用」——那次不该再写一遍盘。
 */
export function applySkin(pref, { persist = true } = {}) {
  const root = document.documentElement;
  if (pref && pref.url) {
    let link = document.getElementById('skin-css');
    if (!link) {
      link = document.createElement('link');
      link.id = 'skin-css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== pref.url) link.setAttribute('href', pref.url);
    // 与 applyTheme 同款写法：dataset.skin 落在 <html> 上就是 data-skin 属性
    root.dataset.skin = pref.id;
  } else {
    document.getElementById('skin-css')?.remove();
    if (root.dataset) delete root.dataset.skin;
  }
  if (persist) {
    lsSet(LS_SKIN, pref
      ? JSON.stringify({ id: pref.id, name: pref.name || pref.id, url: pref.url })
      : null);
  }
}

/**
 * 外壳每次拿到 meta 后调用：维持仍可用的选择，或回落默认（选择保留）。
 * 「默认」状态下无需动作——没有 data-skin 属性就是内置宣纸水墨。
 */
export function setAvailableSkins(list) {
  available = (Array.isArray(list) ? list : []).filter((s) => s && s.id && s.url);
  const pref = readSkinPref();
  if (!pref) return;
  const hit = available.find((s) => s.id === pref.id);
  applySkin(hit ? { id: hit.id, name: hit.name, url: hit.url } : null, { persist: false });
}

/** 当前可用皮肤清单（设置页「外观」区用） */
export function availableSkins() {
  return available.slice();
}

/** 启动即套用：app.js 在模块顶部调用（那时只要 localStorage，碰不到网络） */
export function applyStoredSkin() {
  const pref = readSkinPref();
  if (pref) applySkin(pref, { persist: false });
}