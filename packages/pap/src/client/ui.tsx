// Adapted from shadcn/ui (MIT), new-york-v4 registry. See THIRD_PARTY_NOTICES.md.
// Scoped CSS replaces Tailwind utilities so the DSH host keeps its own theme/reset.
import React, { forwardRef } from "react";
import { LoaderCircle } from "lucide-react";
export const cn = (...values: (string | false | undefined)[]) =>
  values.filter(Boolean).join(" ");
type DivProps = React.ComponentProps<"div">;
export function Card({ className, ...props }: DivProps) {
  return (
    <div data-slot="card" className={cn("frontvia-pap-card", className)} {...props} />
  );
}
export function CardHeader({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-header"
      className={cn("frontvia-pap-card-header", className)}
      {...props}
    />
  );
}
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("frontvia-pap-card-title", className)}
      {...props}
    />
  );
}
export function CardDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("frontvia-pap-description", className)}
      {...props}
    />
  );
}
export function CardContent({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-content"
      className={cn("frontvia-pap-card-content", className)}
      {...props}
    />
  );
}
export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-footer"
      className={cn("frontvia-pap-card-footer", className)}
      {...props}
    />
  );
}
export const Button = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    variant?: "default" | "outline" | "ghost";
    size?: "default" | "sm" | "icon";
  }
>(function Button(
  {
    className,
    variant = "default",
    size = "default",
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn("frontvia-pap-button", className)}
      {...props}
    />
  );
});
export const Input = forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      data-slot="input"
      className={cn("frontvia-pap-input", className)}
      {...props}
    />
  );
});
export function FieldGroup({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="field-group"
      className={cn("frontvia-pap-field-group", className)}
      {...props}
    />
  );
}
export function Field({ className, ...props }: DivProps) {
  return (
    <div
      role="group"
      data-slot="field"
      className={cn("frontvia-pap-field", className)}
      {...props}
    />
  );
}
export function FieldLabel({
  className,
  ...props
}: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="field-label"
      className={cn("frontvia-pap-field-label", className)}
      {...props}
    />
  );
}
export function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      role="alert"
      data-slot="field-error"
      className={cn("frontvia-pap-field-error", className)}
      {...props}
    />
  );
}
export function Badge({
  className,
  variant = "secondary",
  ...props
}: React.ComponentProps<"span"> & {
  variant?: "secondary" | "success" | "warning";
}) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn("frontvia-pap-badge", className)}
      {...props}
    />
  );
}
export function Alert({
  className,
  variant = "default",
  ...props
}: DivProps & { variant?: "default" | "destructive" | "warning" }) {
  return (
    <div
      role="alert"
      data-slot="alert"
      data-variant={variant}
      className={cn("frontvia-pap-alert", className)}
      {...props}
    />
  );
}
export function AlertDescription({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="alert-description"
      className={cn("frontvia-pap-alert-description", className)}
      {...props}
    />
  );
}
export function Skeleton({ className, ...props }: DivProps) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn("frontvia-pap-skeleton", className)}
      {...props}
    />
  );
}
export function Empty({ className, ...props }: DivProps) {
  return (
    <div data-slot="empty" className={cn("frontvia-pap-empty", className)} {...props} />
  );
}
export function EmptyTitle(props: React.ComponentProps<"h4">) {
  return <h4 data-slot="empty-title" {...props} />;
}
export function EmptyDescription(props: React.ComponentProps<"p">) {
  return <p data-slot="empty-description" {...props} />;
}
export function Separator() {
  return (
    <div data-slot="separator" className="frontvia-pap-separator" role="separator" />
  );
}
export function Spinner() {
  return (
    <LoaderCircle
      data-icon="inline-start"
      className="frontvia-pap-spinner"
      aria-hidden
    />
  );
}
