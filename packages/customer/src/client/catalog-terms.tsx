import React from "react";
const provinces: Record<string, string> = {
  "11": "北京",
  "12": "天津",
  "13": "河北",
  "14": "山西",
  "15": "内蒙古",
  "21": "辽宁",
  "22": "吉林",
  "23": "黑龙江",
  "31": "上海",
  "32": "江苏",
  "33": "浙江",
  "34": "安徽",
  "35": "福建",
  "36": "江西",
  "37": "山东",
  "41": "河南",
  "42": "湖北",
  "43": "湖南",
  "44": "广东",
  "45": "广西",
  "46": "海南",
  "50": "重庆",
  "51": "四川",
  "52": "贵州",
  "53": "云南",
  "54": "西藏",
  "61": "陕西",
  "62": "甘肃",
  "63": "青海",
  "64": "宁夏",
  "65": "新疆",
};
export function coverageText(coverage: any[]): string {
  return coverage
    .map((c) =>
      c.country_code === "CN"
        ? c.province_codes
            ?.map((code: string) => provinces[code] ?? code)
            .join("、") || "中国大陆"
        : c.country_code === "US"
          ? "美国"
          : c.country_code,
    )
    .join("；");
}

export function attributeText(attribute: any): string {
  const v = attribute?.value;
  if (!v) return "";
  if (v.type === "boolean")
    return v.value === true ? "是" : v.value === false ? "否" : "";
  if (v.type === "enum" || v.type === "multi_enum") {
    const ids = v.type === "enum" ? [v.value_id] : v.value_ids;
    return (ids ?? [])
      .map(
        (id: string) =>
          attribute.enum_labels?.find((x: any) => x.id === id)?.label ?? id,
      )
      .join("、");
  }
  return v.value == null
    ? ""
    : `${v.value}${attribute.unit_label ? ` ${attribute.unit_label}` : ""}`;
}

export function Attributes({ terms }: { terms: any }) {
  const attributes = terms?.effective_attributes ?? [];
  if (!attributes.length) return null;
  return (
    <dl className="fv-catalog-attributes">
      {attributes.map((a: any) => (
        <div key={a.definition.code}>
          <dt>{a.definition.label}</dt>
          <dd>{attributeText(a)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Public terms only; historical lines use their immutable snapshot, never a catalog lookup. */
export function CatalogTerms({
  terms,
  compact = false,
}: {
  terms: any;
  compact?: boolean;
}) {
  if (!terms) return null;
  const policy = terms.service_policy;
  const lead = terms.lead_time;
  const content = (
    <div className="fv-stack fv-catalog-terms">
      <dl className="fv-catalog-attributes">
        {terms.category && (
          <div>
            <dt>类目</dt>
            <dd>
              {[
                ...(terms.category.ancestors ?? []).map((c: any) => c.name),
                terms.category.name,
              ].join(" / ")}
            </dd>
          </div>
        )}
        {terms.brand?.state !== "missing" && terms.brand?.state && (
          <div>
            <dt>品牌</dt>
            <dd>
              {terms.brand.state === "unbranded" ? "无品牌" : terms.brand.name}
            </dd>
          </div>
        )}
        {terms.model && (
          <div>
            <dt>型号</dt>
            <dd>{terms.model}</dd>
          </div>
        )}
        {terms.fulfillment_kind && (
          <div>
            <dt>交付方式</dt>
            <dd>
              {terms.fulfillment_kind === "manual"
                ? "商家交付，无需收货地址"
                : "实物配送"}
            </dd>
          </div>
        )}
      </dl>
      <Attributes terms={terms} />
      {lead && (
        <p>
          交付时间：
          {lead.mode === "after_payment_hours"
            ? `订单生效后 ${lead.hours} 小时内`
            : "与商家约定"}
          {lead.note ? ` · ${lead.note}` : ""}
        </p>
      )}
      {terms.purchase_limits?.per_order_max != null && (
        <p>每单限购 {terms.purchase_limits.per_order_max} 件</p>
      )}
      {terms.purchase_limits?.lifetime_max != null && (
        <p>累计限购 {terms.purchase_limits.lifetime_max} 件</p>
      )}
      {terms.delivery_instructions && (
        <p>交付说明：{terms.delivery_instructions}</p>
      )}
      {terms.requirements_instruction && (
        <p>购买前须知：{terms.requirements_instruction}</p>
      )}
      {policy && (
        <details>
          <summary>退换、保修与服务</summary>
          <div className="fv-stack">
            <p>
              退换服务：
              {policy.returns?.offered === true
                ? "支持"
                : policy.returns?.offered === false
                  ? "不提供"
                  : "请与商家确认"}
              {policy.returns?.window_days
                ? `，${policy.returns.window_days} 天内`
                : ""}
            </p>
            {[
              policy.returns?.conditions,
              policy.returns?.return_cost,
              policy.returns?.instructions,
            ]
              .filter(Boolean)
              .map((v, i) => (
                <p key={`r${i}`}>{v}</p>
              ))}
            {policy.warranty?.months && (
              <p>保修 {policy.warranty.months} 个月</p>
            )}
            {[
              policy.warranty?.coverage,
              policy.warranty?.exclusions,
              policy.warranty?.instructions,
            ]
              .filter(Boolean)
              .map((v, i) => (
                <p key={`w${i}`}>{v}</p>
              ))}
            {policy.included_services?.map((s: any, i: number) => (
              <p key={i}>
                {s.name ?? (s.kind === "installation" ? "安装" : "组装")}
                （已含在价格中）：{s.description} {s.preparation}
                {s.coverage?.length > 0 && (
                  <span> · 服务地区：{coverageText(s.coverage)}</span>
                )}
              </p>
            ))}
            {policy.additional_notes && <p>{policy.additional_notes}</p>}
          </div>
        </details>
      )}
      {!!terms.public_documents?.length && (
        <div>
          <p>商品资料</p>
          <ul>
            {terms.public_documents.map((d: any) => (
              <li key={d.document_id}>
                {d.source?.kind === "link" &&
                /^https:\/\//.test(d.source.url) ? (
                  <a
                    href={d.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {d.title}
                  </a>
                ) : (
                  d.title
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
  return compact ? (
    <details className="fv-line-terms">
      <summary>本次商品约定</summary>
      {content}
    </details>
  ) : (
    content
  );
}
