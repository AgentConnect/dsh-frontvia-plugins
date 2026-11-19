# dsh-frontvia-customer

Frontvia shopping tools and native chat cards for DeepSeek Harness 0.2.2-rc.1 and 0.2.2-rc.3. The rc.3 build uses matching PAP and Identity candidates.
The three plugins share one DSH profile. Install public Identity 0.1.18 or newer
and a build of DSH PAP that supports PAP 1.0. Merchant configuration can be empty.
Give Customer the shop domain in the conversation.

## Install and connect

Install the matching source candidates in the selected DSH profile using the
[workspace packaging and installation instructions](../../README.md#本地开发).
The UCP build requires PAP 0.2.1 with Store Context and Order History. The
current registry build of PAP 0.2.1 lacks those operations.

首次使用须在当前 Profile 的 `cordis.patch.yml` 中显式开启域名接入（合并到已有同 ID 配置）：

```yaml
- id: anp-identity
  config:
    domainAccess:
      enabled: true
      scopes: []
      secretStore: local-file
```

`local-file` 适用于 Mac 的 PAP 会话存储，不更改 Identity 私钥后端。保存后完全退出并重启 DSH，在公共 Identity 设置中创建／选择 awiki.me 身份、设为默认身份，并在协议管理中授权店铺域名。仅安装插件不会自动开启全局域名接入。

在对话中说“去 https://frontvia-xlgshi.awiki.info 看商品”；通过卡片选规格、加购和核对报价，最后由公共 PAP 批准下单。购物不要求安装 `@agent-network-protocol/dsh-anp`。

人民币对话购物的收货地址与服务端一致：国家为 CN，姓名、电话和完整地址必填；省、市、邮编及补充地址是可选字符串。插件保留商家返回的地址原文，不要求把完整地址拆成省、市，也不自动补造这些字段。订单金额、确认摘要和付款链接仍单独校验。

## 浏览商品与查询反馈

“有什么商品”使用 `frontvia_products` 的 `browse` 操作，不发送搜索关键词。
旧 `search` 的空白或缺省关键词也按浏览目录处理；有关键词时去除首尾空白。
每次只返回一页，只有用户要求更多且服务返回 `page.has_more` 时才按游标翻页，
不猜测关键词遍历目录，也不在概览时自动读取规格。模型获得返回数量和后续动作提示。

聊天工具结果直接显示商品名称、价格、数量和是否还有下一页，整轮结束前即可查看。
失败显示可读说明，不把协议错误 JSON 或内部引用直接呈现给用户；完整购物卡片继续
保留在回复下方，连接后默认显示商品页。

## 服务页操作（连接后）

「Frontvia 服务」使用独立的 shadcn/ui 商城布局，不再嵌入聊天购物卡片。
商家列表支持按店名、域名和店铺标识搜索；展示服务类型、记录数量和最近更新时间，
仅同名同域商家展示额外标识帮助区分。已移除连接不展示，原历史记录不删除。
进入店铺后通过「全部店铺」返回选择；已有购物记录直接恢复，没有记录的购物店铺
一次点击即可开始浏览。列表加载完成前不覆盖保存的选择，切换账号重新按当前账号
的商家与记录解析。窄面板采用单列，店铺内的其他历史记录不重复列出当前记录。
先选择店铺，再通过商品、购物车和我的订单三个入口操作；结账从购物车进入。
商家按发现的 Company、店铺和当前公共身份隔离。
已连接但尚无记录的商家可通过 owner 专用 `open-store` 直接开始购物，无须先聊天；
每次进店动作使用幂等引用建立独立购物会话。已移除商家及其记录不在此页展示，
底层历史数据保留。页面只记住商家与流程引用，账号变化时卸载旧面板。

商品支持搜索、分页、详情与规格库存。购物车支持加购、增减数量、移除。
已提交订单的商品不再计入购物车，原订单快照保留；可从空购物车直接开始新的购物。
未提交但已准备结账时，修改/移除商品会先通过 revise 关闭草稿结算，再执行版本校验的购物车修改；关闭失败或结果不明时停止，不修改已提交订单。
结账分为地址、配送、订单核对、支付方式、支付五步；新结账先填写／确认并保存收货地址，空对象或不完整地址不会跳步；前后端复用相同的地址校验。地址更新只有本次业务回执明确成功才推进；失败或结果未明保留表单输入，即使原购物车已有有效地址也不进入配送。地址草稿保存在表单外的页面内存中，保存超时及随后刷新失败、表单卸载后仍可恢复；按账号修订、会话、购物流程和购物车隔离，成功保存或切换账号／退出时清除，不写入本地持久存储。进入配送步骤自动查询，并为每组商品选择已知费用最低的方式（相同费用保留商家顺序）。已有有效选择保留，顾客可手动更换；地址变更后重新查询。费用未知／预估、不满足地址要求或无选项时不自动选择。失败停止，提供手动重试。配送选择与报价分开，
常驻导航仅有商品、购物车和我的订单，结账从购物车的「去结账／继续结账」进入。
结账期间显示独立流程及返回入口；重新进入有草稿的店铺先显示购物车，支付确认完成
后转入当前订单详情，不自动重新提交或付款。
修改结账先通过原有 revise 规则关闭未提交的结算。报价或确认过期必须重新核对，
确认购买仍需本人明确点击。收货资料不进入模型。

支付方式以商家实际能力为准：协议暂无通用支付方式枚举/选择接口，页面选择商家
收银台，人民币订单在支持时显示支付宝二维码，其他渠道在商家付款页选择。
订单中心展示实际支付状态、履约进度及 shipments/tracking；未提供运单时显示空态。
人工交付订单显示交付进度与交付记录，不展示物流空态。人工交付购物车跳过收货地址；明确为零的报价跳过支付方式，但仍要求本人确认下单。
历史订单详情使用独立的 viewedOrder，不能改变当前订单的付款、取消对象。
「我的订单」默认显示紧凑列表，当前订单与历史引用去重；点击后单独显示详情，
支持返回列表、下一页及返回首页。未返回的商品、金额和状态明确显示待查看，
不会为补齐列表逐笔请求详情。已取消订单使用中性图标与标签，不显示成功勾选。

服务页通过 owner 专用 `frontvia-customer/shopping` 接口复用现有购物规则，
不发聊天消息、不调用模型，沿用流程锁、购物车版本检查和持久化幂等命令。
该接口不接受确认购买、付款或取消订单动作，也不接受客户端金额和身份覆盖。
这些操作仍分别走已有的 owner 确认、支付和取消接口。聊天卡片继续保留原有交互。

## 页面读取与刷新

owner view 支持 catalog/cart/checkout/order/order-detail 读取范围；同流程同时可见的
视图合并需求，不同范围不会共享不完整的在途结果。购买确认、付款和取消仍独立
执行原有最新状态校验，显示缓存不能授权交易。

购物车编辑返回明确的失败终态且存在部分变更时，先读回同一购物车，再结束本地等待，保留原回执并让顾客重新核对。结果未知、资源不匹配或读回失败继续等待；结算、付款与退款不适用该规则。

只有屏幕内的卡片参与后台刷新。普通浏览、草稿购物车和已结束订单不定时刷新；
待付款/结果未明每 15 秒核对，已付款待收货每 60 秒核对。窗口重新激活、切换页面、
用户点击刷新仍会读取当前页。用户操作期间暂停新增后台请求，失败后按需核对。

服务页订单列表只取一页订单引用，点击时读取详情；模型工具仍可取得完整订单列表。
后台不再重新遍历订单历史，也不重复读取已提交订单的购物车/报价快照。

本地同数据、能力缓存有效的前后请求量对比：10 笔订单列表 11 → 1，已有订单的
支付刷新 16 → 2，商品页刷新 16 → 0。此为请求数量，不代表生产接口耗时或吞吐。

商品列表、详情与规格按当前会话/店铺/连接版本/查询条件缓存 60 秒；显式刷新和写入失效。
页面返回时先显示短时快照，再刷新当前页；账户变化与读取失败清除快照。购物能力展示
缓存为 120 秒，购买前仍强制重验。实际测量与限制见 [性能记录](../../docs/performance.md)。

## 公共身份与购物批准

身份创建、发布、默认身份选择和域名接入授权在公共 Identity 中完成。Customer
只读取公共 PAP 的身份状态，不提供手机号注册、验证码或退出接口，也不读取
私钥、Token 或 PAP 私有数据库。更换身份后，旧购物车、订单与迟到响应不回填。

在提示词中提供店铺域名，使用 `frontvia_connection` 连接，或先调用公共
`pap_connect({domain})`。购物与咨询由同一域名发现；没有咨询助手不影响购物。
服务端按验证后的 PAP 稳定主体识别买方，不自动合并旧手机号账号或订单。

当前 Frontvia UCP 购买使用 `frontvia.ucp_purchase.v1`。Customer 卡片展示商品、数量、
报价和总价，由买家通过卡片或已配对的商家页面确认。公共 PAP 签署 Session 请求，
服务端校验原报价、金额、有效期、nonce 和幂等键。回执未知时先读取原 Checkout，
随后从「我的订单」打开商家返回的同一 Order。已有旧流程保留原协议及原回执核对方式。

购物卡片按当前 capabilities 控制加购入口，未开通时说明原因并禁止点击。
只有明确配置 `mockPayment: true` 才标注 Mock 支付；否则显示结算提示。

## 卡片扫码支付

已确认的 CNY 原订单可在卡片中点击「获取支付二维码」。owner 专用的
`frontvia-customer/payment-start` 只接受会话和 flow 引用；付款链接、金额、
收款方、订单及有效期由保存的结算和服务端回执确定，不接受模型或 UI 传入。
公共 PAP 调用发现的 `commerce.payments.hosted.start` 操作，沿用服务端身份、
订单、原确认及支付幂等约束。PAP 1.0 Session 由公共插件签名，卡片不持有协议凭据。

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

已提交订单后，商品页仍可加购：点击加入购物车会自动创建新的购物记录并加入所选规格，原订单保留在订单与历史记录中。购物车准备或加购失败不会自动重试写入；结果不确定时切换到对应的新购物车恢复操作。

商品规格支持填写购买数量（正整数，最多 100 件，已知库存更少时以库存为上限）。加购成功显示件数与“查看购物车”入口；新建购物车后的成功提醒跨购物记录切换保留。

客户页面的异常处理只显示一条简短提示。进入未完成的操作时自动查询一次结果；购物车操作提供“重试”，先查原回执，只有服务端返回操作不存在时才使用保存的原参数和幂等标识重试。重试重新检查授权与能力，并按购物记录串行执行。查询错误不触发重发，下单、取消订单和支付不走购物车重试。未知错误码不直接展示给顾客。

加购异常按普通购物体验处理：自动结束本地等待并刷新购物车，不常驻“待确认”提示、不再自动重发该加购。已有购物车的追加加购使用丢弃标记阻止旧请求重放，商家已经生效的商品以重新读取的购物车为准。首次建车尚未取得 cart ID 时仅结束界面等待，保留原命令与幂等标识；刷新或重启后通过只读回执查询找回购物车，不自动重发或建立替代购物车。回执暂不可查时显示简短的购物车刷新入口。该处理不适用于下单或支付。修改数量等其他购物车操作仍可显式重试。安装更新后须完全退出桌面应用再启动，关闭窗口不会重载插件后台。

购买确认的首次错误只保留安全的错误码、类型和 request_id，不保存原始错误消息或敏感详情。仅当商店明确返回未受理的拒绝（after_change 且无 operation_id）时，结束本地等待并要求重新核对后再次点击；网络错误、上游异常、已受理操作或仅查询不到记录仍保留原 pending，不自动重发购买。旧版本已经丢失首次错误的 pending 不会被此更新自动清除。

## PAP 1.0 / UCP candidate

When the public PAP client advertises UCP operations, Customer uses standard
Catalog POST requests and standard Cart/Checkout/Order paths. Conversion to the
existing card presentation occurs locally after the UCP response; the wire does
not use a Commerce JSON-RPC envelope. Product IDs and purchasable variant IDs
remain distinct. Cart edits send one complete PUT, carry the observed ETag in
`If-Match`, and persist the original replacement and a deterministic UUID
idempotency key in the existing encrypted command state for recovery.

Set `ucpPlatformProfileUrl` in the shared `@awiki/dsh-pap` plugin configuration
to the product's published HTTPS UCP platform Profile. Use the same Profile
URL for discovery and requests. Publish Shopping REST `2026-08-25` and the
desired parent capabilities. For Frontvia Store Context, Order History and
Checkout confirmation, publish `com.frontvia.shopping.store_context` (extends
Catalog search), `com.frontvia.shopping.order_history` (extends Order) and
`com.frontvia.shopping.checkout_confirmation` (extends Checkout) at the same
version. Publish Fulfillment under Checkout for physical delivery.
Customer reads the store's market, binding and connection generation from the
negotiated Store Context and loads the original Order by ID from paginated
merchant history. A Catalog/Cart-only store supports browsing and cart editing.

For a hosted Checkout, collect the buyer email and any fulfillment the
Checkout requests. The card opens the merchant's `continue_url` when the
Checkout requires escalation. The buyer confirms and pays in the browser.
On return, Customer reads the original Checkout and displays its Order when
available. This path uses standard Checkout operations and works with an
empty UCP payment-handler map.

When the merchant and platform both negotiate Checkout confirmation, Customer offers purchase review
on the same Checkout. Preparation and browser pairing use the negotiated
Frontvia operations. The browser shows a code that the buyer approves in
Customer before reviewing and confirming the purchase. Eligible fixture orders
can also be confirmed directly through standard UCP Complete with the
quote-bound confirmation header. Customer checks the original Checkout before
replaying an uncertain Complete, and follows that same Checkout as it progresses
to the Order. The paired merchant browser provides the order's after-sales form.

Draft Checkout remains available when the merchant publishes the standard
Checkout operations. Customer uses the shared PAP Host for signing, session
handling and per-operation consent. Advertise the
`com.frontvia.payment.durable_mock` handler only in the isolated test Profile
backed by Frontvia's persistent Mock fixture. Model tools can query pending
purchase status. Only the buyer's card can authorize a retry of an eligible
original Complete request. If a draft expires while the result of Prepare is
unknown, the buyer can ask the merchant to reopen checkout on the original Cart.
Customer keeps the original Prepare pending until it verifies the merchant
canceled the old draft and returned the replacement. During a Store Context
upgrade, an older flow with a pending request can still read its original Cart,
Checkout and Order through the same PAP identity.

For isolated acceptance, `scripts/pap10-core-check.mjs` connects the real
awiki.me Identity custodian to the independent Python wire runner through
owner-only, temporary IPC. It signs only discovered operation targets and never
exports private keys. Select the built PAP and Identity candidates with
`FRONTVIA_PAP_TEST_PACKAGE_ROOT` and `FRONTVIA_IDENTITY_TEST_PACKAGE_ROOT`.
The candidate versions are PAP 0.2.1, Identity 0.1.18 and Customer
0.2.0, with the published Native Identity 0.2.6 binding. Set
`FRONTVIA_CORE_ROOT` to the isolated Core checkout for the Claude
Code/DeepSeek domain-browsing and DSH Web browser tests. Run
`node --import tsx scripts/pap10-core-check.mjs --preflight` from the plugin
checkout to verify which packages the bridge loads.
