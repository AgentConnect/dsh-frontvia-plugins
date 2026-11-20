import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
export const requiredPapVersion = '0.2.2';
export function assertPapPackage(manifest, lockedVersion = requiredPapVersion) {
  if (manifest?.name !== '@awiki/dsh-pap' || manifest.version !== lockedVersion ||
      !Array.isArray(manifest.dshPapUcpOperations) ||
      !['get_store_context', 'list_orders', 'commerce.orders.file'].every(operation => manifest.dshPapUcpOperations.includes(operation))) {
    throw new Error(`Frontvia UCP requires @awiki/dsh-pap@${lockedVersion} with Store Context, Order History and verified PDF downloads.`);
  }
}

export async function assertBundleInputs(folder, name) {
  try {
    const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
    if (manifest.name !== name) throw new Error('wrong package');
    for (const file of ['index.js', 'core.js', 'client.js']) {
      const info = await stat(join(folder, 'dist', file));
      if (!info.isFile() || !info.size) throw new Error('missing build output');
    }
  } catch {
    throw new Error(`构建产物不完整：${name}。先在本插件仓库执行 pnpm build（Customer）；不会安装不完整的包。`);
  }
}
