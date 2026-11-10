import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
export async function assertBundleInputs(folder, name) {
  try {
    const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
    if (manifest.name !== name) throw new Error('wrong package');
    for (const file of ['index.js', 'core.js', 'client.js']) {
      const info = await stat(join(folder, 'dist', file));
      if (!info.isFile() || !info.size) throw new Error('missing build output');
    }
  } catch {
    throw new Error(`构建产物不完整：${name}。先构建同级 pap-server（pnpm build），再构建插件；不会安装不完整的包。`);
  }
}
