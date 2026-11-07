import React, { useId, useState } from "react";
import { ArrowRight, Store } from "lucide-react";
import {
  filterServiceMerchants,
  merchantCommerceSite,
  type Merchant,
} from "./service-merchants.js";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Empty,
  EmptyTitle,
  EmptyDescription,
  Field,
  FieldLabel,
  Input,
} from "./ui.js";

export function MerchantPicker({
  merchants,
  selectedKey,
  disabled,
  onSelect,
}: {
  merchants: Merchant[];
  selectedKey?: string;
  disabled: boolean;
  onSelect: (merchant: Merchant) => void;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const visible = filterServiceMerchants(merchants, query);
  return (
    <section aria-label="选择店铺" className="fv-store-directory">
      <div className="fv-directory-toolbar">
        <div className="fv-stack">
          <div className="fv-row">
            <h3>我的店铺</h3>
            <Badge>{merchants.length} 家</Badge>
          </div>
          <p className="fv-description">
            选择一家店铺，继续选购或查看服务记录。
          </p>
        </div>
        {merchants.length > 1 && (
          <Field className="fv-merchant-search">
            <FieldLabel htmlFor={searchId}>搜索店铺</FieldLabel>
            <Input
              id={searchId}
              type="search"
              placeholder="店名或域名"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
        )}
      </div>
      {query.trim() && (
        <p className="fv-muted" role="status">
          找到 {visible.length} 家店铺
        </p>
      )}
      {visible.length ? (
        <div className="fv-store-grid">
          {visible.map((merchant) => {
            const shopping = !!merchantCommerceSite(merchant);
            const consultation =
              merchant.sites.some((site) =>
                site.description?.methods?.some((method) =>
                  /^(consultation|knowledge)\./.test(method),
                ),
              ) || merchant.flows.some((flow) => flow.kind === "consultation");
            const ambiguous = merchants.some(
              (other) =>
                other.key !== merchant.key &&
                other.title === merchant.title &&
                other.domain === merchant.domain,
            );
            const latest = merchant.flows[0];
            const updated = latest ? new Date(latest.updatedAt) : undefined;
            return (
              <Card key={merchant.key} className="fv-store-card">
                <CardHeader>
                  <div className="fv-store-card-top">
                    <div className="fv-store-symbol" aria-hidden>
                      <Store />
                    </div>
                    {merchant.key === selectedKey && <Badge>上次访问</Badge>}
                  </div>
                  <CardTitle>{merchant.title}</CardTitle>
                  <CardDescription>
                    {merchant.domain ?? "已连接的商家服务"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="fv-row">
                    {shopping && <Badge>商品与购物</Badge>}
                    {consultation && <Badge>咨询服务</Badge>}
                    {!shopping && !consultation && <Badge>商家服务</Badge>}
                  </div>
                  {ambiguous && (
                    <p className="fv-muted fv-store-binding">
                      店铺标识：{merchant.storeId ?? merchant.sites[0]?.id}
                      {merchants.some(
                        (other) =>
                          other.key !== merchant.key &&
                          other.title === merchant.title &&
                          other.domain === merchant.domain &&
                          other.storeId === merchant.storeId,
                      )
                        ? ` · ${merchant.sites[0]?.issuer ?? merchant.sites[0]?.id}`
                        : ""}
                    </p>
                  )}
                  <p className="fv-muted">
                    {latest
                      ? `${merchant.flows.length} 条服务记录`
                      : "尚无服务记录"}
                    {updated && Number.isFinite(updated.getTime()) && (
                      <>
                        {" "}
                        · 最近更新{" "}
                        {updated.toLocaleDateString("zh-CN", {
                          month: "short",
                          day: "numeric",
                        })}
                      </>
                    )}
                  </p>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    aria-label={`${shopping ? "进入店铺" : "查看服务"}：${merchant.title}`}
                    onClick={() => onSelect(merchant)}
                  >
                    {shopping ? "进入店铺" : "查看服务"}
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      ) : (
        <Empty>
          <EmptyTitle>没有找到匹配的店铺</EmptyTitle>
          <EmptyDescription>
            试试其他店名或域名，也可以清除搜索查看全部店铺。
          </EmptyDescription>
          <Button variant="outline" onClick={() => setQuery("")}>
            清除搜索
          </Button>
        </Empty>
      )}
    </section>
  );
}
