import React from "react";
import { Skeleton, Spinner } from "./ui.js";

export function StorefrontLoading() {
  return (
    <div className="fv-store-loading" role="status" aria-label="正在加载店铺">
      <div className="fv-store-loading-toolbar">
        <Skeleton className="fv-store-loading-nav" />
        <span className="fv-store-loading-label">
          <Spinner />
          正在加载…
        </span>
      </div>
      <div className="fv-store-loading-grid" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div className="fv-store-loading-item" key={index}>
            <Skeleton className="fv-store-loading-photo" />
            <div className="fv-store-loading-copy">
              <Skeleton className="fv-store-loading-title" />
              <Skeleton className="fv-store-loading-price" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
