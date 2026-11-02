# 隔离测试栈

这些脚本只用于验收，插件安装包不包含它们。需要已构建的 Frontvia 源码、Rust、PostgreSQL 16、Python 3 和 Medusa 依赖。参考代码基线为 `5e8cb68b44aa630de2cc634d9b75d2da8c7033f7`。不要改变用户正在修改的 Frontvia 源码。

```sh
export PATH=/opt/homebrew/bin:$PATH
export FRONTVIA_SOURCE=/Users/howard/workspace/frontvia-core
cd /Users/howard/workspace/dsh-frontvia-plugins
python3 -m venv .local/venv
.local/venv/bin/pip install cryptography==50.0.2
python3 "$FRONTVIA_SOURCE/platform/scripts/local-db.py" up \
  --local-directory "$PWD/.local/postgres" --port 21439 \
  --pg-bin /opt/homebrew/opt/postgresql@16/bin
```

在 Frontvia `platform` 中运行 `cargo build --locked`；在 `ecommerce/medusa-app` 中运行：

```sh
FRONTVIA_B1_BUILD_DIR="$PWD/.local/dsh-plugin-build" npm run build:b1-test
```

测试栈复用 Frontvia 测试工具的 TLS fixture（`platform/.local/fixtures`，包括 CA/server 和 C2 测试文件），但生成自己的 C1 私钥、CIMD、JWKS 和确认密钥。若 fixture 尚未准备，应按该基线仓库自身的测试文档准备；不能替换为真实用户身份。

在本插件仓库启动：

```sh
PATH="$PWD/.local/venv/bin:/opt/homebrew/bin:$PATH" .local/venv/bin/python scripts/native-stack.py
```

等 `.local/native/status.json` 为 `READY`。该进程管理自己创建的 Rust 平台、Medusa 服务、数据库和测试商品；最多运行两小时。现有共享 PG/Redis/Frontvia 服务不在其控制范围。一个仍在运行的原测试栈会阻止再次初始化。每个新测试栈使用新的身份、凭据引用和状态目录。

另一个终端：

```sh
pnpm check
pnpm pack:local
node scripts/harness.mjs --install --setup-only
node scripts/controlled-model.mjs
# 再开一个终端运行宿主：
node scripts/run-configured.mjs --controlled-model
```

打开宿主打印的认证地址。受控模型在 loopback 4348；DSH 在 4347。新聊天输入 `[controlled-denials]` 可验证缺版本重新加购和模型调用 confirm 被拒绝。该模型为确定性测试程序，无外部模型请求。后续重启可加 `--stored-credentials`，确认凭据由 DSH 存储恢复。

实际 API 验证：

```sh
node scripts/native-commerce-check.mjs  # 创建独立主体的草稿，不确认购买
node scripts/native-requote-check.mjs   # 释放草稿、旧确认失效、保留输入重新报价
node --import tsx scripts/native-isolation-check.mjs
```

隔离检查需要先在 `.local/native/browser-confirm.json` 保存本次 UI 订单的公开 ID；脚本不会自行确认购买。`native-commerce-check` 应在新测试栈首次运行，不能将旧请求键当成新测试运行。

只有再次取得对应费用授权，才运行 `node scripts/run-configured.mjs --real-model`。它通过当前 Mac Keychain 中既有 DeepSeek 凭据启动，不输出或写盘该模型密钥；本次开发验收已经用满五轮（两次 schema/安装缓存失败、三轮成功购物），不会继续付费对话。

取实际商家订单及 Mock capture 数量：`touch .local/native/audit-request`，读取 `facts.json`。请求经过测试栈的管理适配器；不是从插件直接查询 Medusa。

结束：

```sh
# 先在 DSH 和受控模型各自终端 Ctrl-C。
touch .local/native/stop
# 等 cleanup.json 为 PASS、status.json 为 STOPPED 后停止本任务的 PG：
python3 "$FRONTVIA_SOURCE/platform/scripts/local-db.py" down \
  --local-directory "$PWD/.local/postgres" --port 21439 \
  --pg-bin /opt/homebrew/opt/postgresql@16/bin
```

保留安装包、加密本地状态、历史聊天和验收证据；不删除用户工作或其他已安装应用。首次停止后的示例订单属于已销毁的隔离数据库，不能再当成在线订单查询结果。
