# DSH Frontvia Client (`dsh-frontvia-client`)

Frontvia 专用 DSH 账号插件，提供登录、退出、设备身份以及绑定商家目标的短期身份证明。复制自 `AgentConnect/pap-server/client`；原仓库 Client 暂时保留，不在本次删除或重命名。

服务端继续独立部署；本包不包含 Rust 服务或用户数据库。Frontvia 客户端后续以本目录维护，无需跨仓库本地链接。

通过 `ctx.frontviaIdentity` 提供宿主接口；账号 owner RPC 使用 `frontvia-identity/*`，页面为“Frontvia 账号”，面板ID为 `dsh-frontvia-client`。个人 bearer 和私钥不进入模型或浏览器响应。

为保留现有数据，默认 `identity-config.json`、Vault 目录、凭据 key、设备及身份协议标识保持不变；不要同时启用原 `dsh-identity-client` 和本包。安装/旧版替换及回滚说明见仓库 README。
