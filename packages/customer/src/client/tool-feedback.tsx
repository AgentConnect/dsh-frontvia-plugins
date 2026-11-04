import React from "react";
import { summarizeToolResult } from "./tool-result.js";
// @ts-ignore esbuild loads CSS as text.
import styles from "./styles.css";

export function ToolFeedback({
  name,
  phase,
  block,
}: {
  name: string;
  phase: string;
  block: any;
}) {
  if (phase !== "result") return <p role="status">正在查询 Frontvia…</p>;
  const summary = summarizeToolResult(name, block);
  return (
    <section className="fv fv-tool-feedback" aria-label="Frontvia 工具结果">
      <style>{styles}</style>
      <p role={summary.error ? "alert" : "status"}>{summary.title}</p>
      {!!summary.products?.length && (
        <ul aria-label="本次查询结果">
          {summary.products.map((product, index) => (
            <li key={index}>
              <span>{product.title}</span>
              {product.price && (
                <span className="fv-tool-price">{product.price}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {summary.detail && <p className="fv-description">{summary.detail}</p>}
    </section>
  );
}
