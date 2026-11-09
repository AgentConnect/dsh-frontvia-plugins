import React, { useEffect, useState } from "react";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { Button, Empty, EmptyTitle, EmptyDescription } from "./ui.js";
import type { CardIntent } from "./card-message.js";
import { ProductGallery } from "./product-gallery.js";

const rows = (value: any): any[] =>
  Array.isArray(value)
    ? value
    : (value?.items ?? value?.products ?? value?.variants ?? []);
const availability: Record<string, string> = {
  in_stock: "有货",
  out_of_stock: "缺货",
  backorder: "可订货",
  preorder: "可预购",
  unavailable: "暂不可购买",
  unknown: "库存待核对",
};

/** The persisted result determines the screen, including older saved flows.
 * Going back changes only presentation; it never adds a line or starts a turn.
 */
export function ProductSelection({
  data,
  busy,
  canAsk,
  ask,
  formatPrice,
  onCart,
  children,
}: {
  data: any;
  busy: boolean;
  canAsk: boolean;
  ask: (intent: CardIntent) => Promise<void>;
  formatPrice: (value: any) => string;
  onCart: () => void;
  children: React.ReactNode;
}) {
  const [showList, setShowList] = useState(false);
  useEffect(
    () => setShowList(false),
    [data.flowId, data.variants, data.variantProductId],
  );
  const selecting = data.variants != null && !showList;
  const variants = rows(data.variants);
  const productId = data.variantProductId ?? variants[0]?.product_id;
  const product = rows(data.products).find(
    (p) => productId && p.id === productId,
  );
  return (
    <div className="fv-stack" aria-label={selecting ? "商品规格" : "商品列表"}>
      <div className="fv-section-heading">
        <div>
          <h4>{selecting ? (product?.title ?? "选择商品规格") : "商品"}</h4>
          {data.historicalCatalog && (
            <p className="fv-description">历史商品与价格，请以最新报价为准。</p>
          )}
        </div>
        {data.cart && (
          <Button variant="ghost" size="sm" onClick={onCart}>
            <ShoppingCart data-icon="inline-start" />
            购物车
          </Button>
        )}
      </div>
      {selecting ? (
        <>
          <div>
            <Button variant="ghost" size="sm" onClick={() => setShowList(true)}>
              <ArrowLeft data-icon="inline-start" />
              返回商品列表
            </Button>
          </div>
          <div className="fv-chat-product-detail" data-has-product={!!product}>
            {product && <ProductGallery product={product} />}
            {variants.length ? (
              <div className="fv-stack" aria-label="可购买规格">
                {variants.map((v: any) => {
                  const stock = v.availability;
                  const unavailable =
                    ["out_of_stock", "unavailable"].includes(stock?.status) ||
                    stock?.quantity_available === 0;
                  return (
                    <div className="fv-delivery" key={v.id}>
                      <div className="fv-delivery-copy">
                        <p>
                          {v.title === "Default"
                            ? "默认规格"
                            : (v.title ?? "商品规格")}
                        </p>
                        {v.selected_options?.length > 0 && (
                          <p>
                            {v.selected_options
                              .map((o: any) => `${o.name}：${o.value}`)
                              .join(" · ")}
                          </p>
                        )}
                        {v.sku && <p className="fv-muted">SKU：{v.sku}</p>}
                        <p className="fv-price">{formatPrice(v.unit_price)}</p>
                        <span>
                          {availability[stock?.status] ?? "库存待核对"}
                          {Number.isInteger(stock?.quantity_available) &&
                          stock.quantity_available >= 0
                            ? ` · 可购 ${stock.quantity_available} 件`
                            : ""}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        disabled={
                          busy || !canAsk || !data.cartReady || unavailable
                        }
                        onClick={() =>
                          ask({
                            action: "add",
                            variantId: v.id,
                            productName: product?.title ?? "所选商品",
                            variantName: v.title ?? "所选规格",
                            quantity: 1,
                          })
                        }
                      >
                        {unavailable || !data.cartReady
                          ? "暂不可加购"
                          : "加购 1 件"}
                        <ShoppingCart data-icon="inline-end" />
                      </Button>
                    </div>
                  );
                })}
                {data.variants?.page?.has_more && (
                  <p className="fv-muted">还有更多规格，可在对话中继续查看。</p>
                )}
              </div>
            ) : (
              <Empty>
                <EmptyTitle>暂无可购买规格</EmptyTitle>
                <EmptyDescription>
                  可以返回商品列表选择其他商品。
                </EmptyDescription>
              </Empty>
            )}
          </div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
