# dsh-frontvia-customer

Frontvia shopping tools and native chat cards for official DeepSeek Harness 0.2.1-rc.3. Requires an activated dsh-pap bundle. Five Agent tool groups prepare shopping and query results; purchase confirmation is only on the owner UI route. Phone personal accounts support consultation and US/USD shopping without per-client merchant approval. See the repository README for server prerequisites and Mock-payment acceptance boundaries.

人民币对话购物的收货地址与服务端一致：国家为 CN，姓名、电话和完整地址必填；省、市、邮编及补充地址是可选字符串。插件保留商家返回的地址原文，不要求把完整地址拆成省、市，也不自动补造这些字段。订单金额、确认摘要和付款链接仍单独校验。

## 浏览商品与查询反馈

“有什么商品”使用 `frontvia_products` 的 `browse` 操作，不发送搜索关键词。
旧 `search` 的空白或缺省关键词也按浏览目录处理；有关键词时去除首尾空白。
每次只返回一页，只有用户要求更多且服务返回 `page.has_more` 时才按游标翻页，
不猜测关键词遍历目录，也不在概览时自动读取规格。模型获得返回数量和后续动作提示。

聊天工具结果直接显示商品名称、价格、数量和是否还有下一页，整轮结束前即可查看。
失败显示可读说明，不把协议错误 JSON 或内部引用直接呈现给用户；完整购物卡片继续
保留在回复下方，连接后默认显示商品页。

## 服务页手动操作

「Frontvia 服务」上方常驻商家选择区，选中商家后直接显示购物卡片，下方只列出
这家商家的历史记录。商家按完整 issuer 与 store_id 归组，同域名下不同店铺和
不同 issuer 不会合并；同一店铺的购物与咨询入口归在一起。已配置但尚无记录的
商家也会显示；已移除商家及其记录不在此页面展示，底层历史数据仍保留。页面只记住商家与流程引用，重开时
以当前账号可见记录校验选择；账号变化立即清空旧面板。切换历史分类不会收起面板。

在商家操作面板中复用聊天购物卡片，
直接浏览商品、选择规格、加购、填写收货资料、查询配送、选择配送并生成报价。
过期报价可重新获取；核对完整报价后仍须本人点击确认购买。
已有的原订单支付、二次确认取消和结果恢复入口保持可用。
首次连接商家、建立购物记录仍从聊天发起；聊天卡片的选购按钮继续交给 Agent。

服务页通过 owner 专用 `frontvia-customer/shopping` 接口调用现有购物规则，
不发聊天消息、不调用模型。多步配送报价持有同一 flow 锁，沿用购物车版本检查和
持久化幂等操作；失败或回执未知即停止，查询原结果不会自动继续报价或购买。
该接口不接受确认购买、付款或取消订单动作，也不接受客户端金额和身份覆盖。

## 个人账号入口

**Frontvia 服务** 页面提供手机号（含国家代码）、验证码登录/注册、重发倒计时、
退出及退出重试。owner UI 接口为 `frontvia-customer/personal-status`、
`frontvia-customer/personal-code`、`frontvia-customer/personal-verify`、
`frontvia-customer/personal-logout`；严格校验输入，非 owner 不可调用，
也不注册相应模型工具。PAP 页面只显示同一账号的脱敏身份和连接状态。
登录、退出和换号会通知两页清除旧账号状态，迟到的旧结果不能恢复显示。
原有 PAP 加密账号会话保持兼容，不搬迁或复制凭据。

## 个人号咨询

配合本次 PAP 插件的个人账号配置，`frontvia_connection` 和
`frontvia_consultation` 复用同一手机号账号的公开咨询身份。个人账号无需商家
成员权限或客户端审批。咨询记录按当前个人账号过滤，换号不可读取缓存结果；
同一账号重登可以接续原聊天的咨询回执。不同账号须使用不同 DSH 聊天，避免
把旧模型上下文带入新账号。购物和订单使用服务端验证的个人主体，不按手机号
认领已有 Medusa 买方或订单。两插件应一起更新。

## 个人号购物

个人登录购物使用 `frontvia.personal_purchase.v1`：服务端支持该 profile 时，
Customer 复用 PAP 当前个人连接的证明签名，购物车和确认不依赖商家逐客户端审批
或本机 HMAC 购买密钥。确认仍只在用户卡片入口发起，Agent 工具不能代确认。
游客不自动获得此能力；旧配置的签名购买 profile 保留原有凭据边界。

购物卡片按当前 capabilities 控制加购入口，未开通时说明原因并禁止点击。
只有明确配置 `mockPayment: true` 才标注 Mock 支付；否则显示结算提示。

## 卡片扫码支付

已确认的 CNY 原订单可在卡片中点击「获取支付二维码」。owner 专用的
`frontvia-customer/payment-start` 只接受会话和 flow 引用；付款链接、金额、
收款方、订单及有效期由保存的结算和服务端回执确定，不接受模型或 UI 传入。
PAP 宿主复用商家同源 `/companies/{issuer}/hosted-payer/rpc` 的单订单能力，
沿用服务端身份、订单、原确认及支付幂等约束，不向该接口转发 PAP access token。

二维码作为受限 SVG 图片显示，随 flow 加密保存以支持重开会话；不会进入模型
上下文。卡片显示收款方和有效期，通过现有共享轮询及窗口重新聚焦读取原订单。
支付成功、关闭、未知结果、过期或账号变化后停止显示二维码。重复获取仍使用
原订单付款，不重新确认或创建购物订单。真实扣款需用户在支付宝完成扫码授权。
仅支持服务端已提供的 `alipay_qr`；其他币种保留原付款页入口。

未付款人民币订单支持 owner 卡片「取消订单」及二次确认。仅在原结算已确认、
单笔订单尚未履约且商家声明 `commerce.checkouts.cancel` 时显示入口；模型工具
不提供取消动作。宿主重新读取原订单和支付状态，使用持久化幂等操作调用商家
已有取消接口，由商家先确认支付渠道关闭再取消订单。已付款订单不走此路径。
未知结果保留原操作用于查询恢复，不新建订单或重发取消；取消成功保留历史
结算与订单，同一 flow 的卡片同步关闭付款入口和二维码。退款和已履约订单
的售后申请仍需联系商家，不由此按钮处理。
