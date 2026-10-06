/**
 * 问心卦 · 随包示例插件落到数据目录的规则
 * ------------------------------------------------------------
 * 纯函数 + 文件操作，不依赖 Electron——桌面版与命令行版共用这一份
 * （桌面版 seed 于 resources/seed-data/plugins，命令行版取自 <代码目录>/seed-data/plugins）。
 *
 * 三条规矩，缺一条就会出事：
 *
 *   1. **新样例要送到。** 升级带来的新示例插件必须进数据目录。早先的判据是
 *      「records 里没有卦录才算首次」，于是老用户升级时整段跳过——
 *      v1.5.0 的四款皮肤因此没送到任何一台已用过的机器上（用户当场发现
 *      「插件页没有皮肤集、外观区说没有可用皮肤」）。
 *   2. **用户删掉的不复活。** 清单里记着「程序给过它」，此刻文件不在，就是用户删的，
 *      不能下次启动又塞回来。
 *   3. **用户改过的不覆盖。** 已存在的同名文件一律不动——有人会照着示例改自己的插件。
 *
 * 清单 `<plugins>/.seed-manifest.json` 是**程序自管**的元数据（不是用户数据）：
 * 它存在的唯一目的，就是把「升级新带来的」与「用户主动删掉的」区分开。
 */

import fs from 'node:fs';
import path from 'node:path';

export const SEED_MANIFEST = '.seed-manifest.json';

/**
 * @param {object} opts
 * @param {string} opts.seedDir    随包示例插件所在目录（放 *.mjs 的地方）
 * @param {string} opts.targetDir  用户数据目录下的 plugins/（会按需创建）
 * @returns {{seeded:string[], existing:string[], keptRemoved:string[], manifest:string|null}}
 *          seeded=这次补进去的；existing=本来就在、没动的；keptRemoved=给过但已被用户删掉、故意不还原的
 */
export function seedPlugins({ seedDir, targetDir }) {
  const out = { seeded: [], existing: [], keptRemoved: [], manifest: null };
  if (!seedDir || !targetDir || !fs.existsSync(seedDir)) return out;

  const files = fs.readdirSync(seedDir).filter((f) => f.endsWith('.mjs')).sort();
  if (!files.length) return out;

  const manifestPath = path.join(targetDir, SEED_MANIFEST);
  let known = [];
  try {
    const j = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(j?.plugins)) known = j.plugins.filter((x) => typeof x === 'string');
  } catch { /* 没有或坏了都当没有——下面会重建 */ }

  fs.mkdirSync(targetDir, { recursive: true });
  const inManifest = new Set(known);

  for (const f of files) {
    const dst = path.join(targetDir, f);
    if (fs.existsSync(dst)) {
      // 已有：不覆盖（规矩 3）。它确实是我们给过的，记进清单。
      out.existing.push(f);
      inManifest.add(f);
      continue;
    }
    if (known.includes(f)) {
      // 给过、现在没了 = 用户删的（规矩 2）
      out.keptRemoved.push(f);
      continue;
    }
    fs.copyFileSync(path.join(seedDir, f), dst);   // 升级新带来的（规矩 1）
    out.seeded.push(f);
    inManifest.add(f);
  }

  const next = [...inManifest].sort();
  const before = [...new Set(known)].sort();
  const same = next.length === before.length && next.every((x, i) => x === before[i]);
  if (!same) {
    try {
      fs.writeFileSync(manifestPath, `${JSON.stringify({
        note: '程序自管：记录随包示例插件给过哪些，用来区分「升级新增」与「用户删除」。删掉这一行不影响使用，只是下次会把删过的样例又补回来。',
        plugins: next,
      }, null, 2)}\n`, 'utf8');
      out.manifest = manifestPath;
    } catch { /* 写不了清单也不影响本次复制 */ }
  }
  return out;
}
