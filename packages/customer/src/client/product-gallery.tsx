import React, { useState } from "react";
import { Package } from "lucide-react";
import { Button } from "./ui.js";
import { productImages } from "./product-image.js";

export function ProductGallery({ product }: { product: any }) {
  // A product switch must never reuse another product's image selection/errors.
  return <Gallery key={product?.id ?? "empty"} product={product} />;
}
function Gallery({ product }: { product: any }) {
  const images = productImages(product);
  const [selected, setSelected] = useState<string>();
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const current = images.find((image) => image.url === selected) ?? images[0];
  const index = images.findIndex((image) => image.url === current?.url);
  const unavailable = (url: string) =>
    setFailed((previous) => new Set([...previous, url]));
  return (
    <section className="fv-product-gallery" aria-label="商品图片">
      <div className="fv-detail-image">
        {current && !failed.has(current.url) ? (
          <img
            key={current.url}
            src={current.url}
            alt={current.alt || product?.title || "商品图片"}
            referrerPolicy="no-referrer"
            onError={() => unavailable(current.url)}
          />
        ) : (
          <div
            className="fv-image-placeholder"
            role="img"
            aria-label={current ? "图片暂不可用" : "暂无商品图片"}
          >
            <Package aria-hidden />
            <span>{current ? "图片暂不可用" : "暂无商品图片"}</span>
          </div>
        )}
      </div>
      {images.length > 1 && (
        <>
          <div
            className="fv-image-thumbnails"
            role="group"
            aria-label="切换商品图片"
          >
            {images.map((image, i) => (
              <Button
                key={image.url}
                variant="outline"
                className="fv-image-thumbnail"
                aria-label={`查看第 ${i + 1} 张商品图片`}
                aria-pressed={current?.url === image.url}
                onClick={() => setSelected(image.url)}
              >
                {failed.has(image.url) ? (
                  <Package aria-hidden />
                ) : (
                  <img
                    src={image.url}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => unavailable(image.url)}
                  />
                )}
              </Button>
            ))}
          </div>
          <span className="fv-image-count fv-muted" aria-live="polite">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </section>
  );
}
