import React, { createElement, memo, type ReactNode } from "react";
import { Lexer, type Token, type Tokens } from "marked";
import { decodeHTML } from "entities";
import { productImages } from "./product-image.js";

function webLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {
    /* Invalid links remain readable text. */
  }
}

/** Merchant prose is rendered as React nodes, never executable HTML. Images
 * must already belong to the public product gallery; no remote title lookup. */
export const ProductDescription = memo(function ProductDescription({
  product,
}: {
  product: any;
}) {
  const text = product?.description_markdown ?? product?.description;
  if (typeof text !== "string" || !text.trim()) return null;
  const images = new Set(productImages(product).map((image) => image.url));
  const lexer = new Lexer({ gfm: true, breaks: true });
  function inline(tokens: Token[], path: string): ReactNode {
    return tokens.map((token, index) => {
      const key = `${path}-${index}`;
      switch (token.type) {
        case "text":
          return token.tokens
            ? inline(token.tokens, key)
            : decodeHTML(token.text);
        case "escape":
          return token.text;
        case "strong":
          return <strong key={key}>{inline(token.tokens ?? [], key)}</strong>;
        case "em":
          return <em key={key}>{inline(token.tokens ?? [], key)}</em>;
        case "del":
          return <del key={key}>{inline(token.tokens ?? [], key)}</del>;
        case "codespan":
          return <code key={key}>{token.text}</code>;
        case "br":
          return <br key={key} />;
        case "link": {
          const link = token as Tokens.Link,
            href = webLink(decodeHTML(link.href));
          const label = inline(link.tokens, key);
          return href ? (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ) : (
            <React.Fragment key={key}>{label}</React.Fragment>
          );
        }
        case "image": {
          const image = token as Tokens.Image,
            href = webLink(decodeHTML(image.href));
          return href && images.has(href) ? (
            <img
              key={key}
              src={href}
              alt={decodeHTML(image.text)}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            decodeHTML(image.text)
          );
        }
        default:
          return token.raw;
      }
    });
  }
  function blocks(tokens: Token[], path: string): ReactNode {
    return tokens.map((token, index) => {
      const key = `${path}-${index}`;
      switch (token.type) {
        case "space":
        case "def":
          return null;
        case "text":
        case "paragraph":
          return (
            <p key={key}>
              {inline(token.tokens ?? lexer.inlineTokens(token.text), key)}
            </p>
          );
        case "heading":
          return createElement(
            `h${Math.max(4, Math.min(6, token.depth + 2))}`,
            { key },
            inline(token.tokens ?? [], key),
          );
        case "hr":
          return <hr key={key} />;
        case "code":
          return (
            <pre key={key}>
              <code>{token.text}</code>
            </pre>
          );
        case "blockquote":
          return (
            <blockquote key={key}>{blocks(token.tokens ?? [], key)}</blockquote>
          );
        case "list": {
          const list = token as Tokens.List;
          const children = list.items.map((item, i) => (
            <li key={i}>
              {item.task && (
                <input
                  type="checkbox"
                  checked={!!item.checked}
                  disabled
                  aria-label={item.checked ? "已完成" : "未完成"}
                />
              )}
              {blocks(item.tokens, `${key}-${i}`)}
            </li>
          ));
          return list.ordered ? (
            <ol
              key={key}
              start={typeof list.start === "number" ? list.start : undefined}
            >
              {children}
            </ol>
          ) : (
            <ul key={key}>{children}</ul>
          );
        }
        case "table": {
          const table = token as Tokens.Table;
          if (table.header.length > 20) return <pre key={key}>{token.raw}</pre>;
          return (
            <div
              className="fv-product-table"
              key={key}
              tabIndex={0}
              aria-label="商品参数表"
            >
              <table>
                <thead>
                  <tr>
                    {table.header.map((cell, i) => (
                      <th key={i} scope="col">
                        {inline(cell.tokens, `${key}-h-${i}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, r) => (
                    <tr key={r}>
                      {table.header.map((_, c) => (
                        <td key={c}>
                          {inline(row[c]?.tokens ?? [], `${key}-${r}-${c}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        default:
          return <p key={key}>{token.raw}</p>;
      }
    });
  }
  return (
    <div className="fv-product-markdown">
      {blocks(lexer.lex(text), "description")}
    </div>
  );
});
