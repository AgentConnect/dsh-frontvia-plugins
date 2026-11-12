import React, { useEffect, useId, useRef, useState } from "react";
import { Button, Field, FieldLabel, Input } from "./ui.js";

/** A manual US order needs a receipt contact, without a delivery address. */
export function ManualContact({ email, disabled, save }: {
  email?: string;
  disabled: boolean;
  save: (email: string) => Promise<boolean>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(email ?? "");
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setDraft(email ?? ""); }, [email]);
  return <form onSubmit={async event => {
    event.preventDefault();
    if (!disabled && await save(draft.trim())) dirty.current = false;
  }}>
    <Field>
      <FieldLabel htmlFor={id}>联系邮箱</FieldLabel>
      <Input id={id} type="email" required maxLength={254} autoComplete="email"
        value={draft} disabled={disabled} onChange={event => { dirty.current = true; setDraft(event.target.value); }} />
    </Field>
    <p className="fv-muted">邮箱仅用于订单联系，不会发送给 AI 模型。</p>
    <Button type="submit" disabled={disabled || draft.trim() === email}>
      {draft.trim() === email ? "联系邮箱已保存" : "保存联系邮箱"}
    </Button>
  </form>;
}
