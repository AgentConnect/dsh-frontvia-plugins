// Adapted from shadcn/ui (MIT), new-york-v4 registry. See THIRD_PARTY_NOTICES.md.
// Scoped CSS replaces Tailwind utilities so the DSH host keeps its own theme/reset.
import React, { forwardRef } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { LoaderCircle } from "lucide-react";
export const cn = (...values: (string | false | undefined)[]) =>
  values.filter(Boolean).join(" ");
type DivProps = React.ComponentProps<"div">;
export function Card({ className, ...props }: DivProps) {
  return (
    <div data-slot="card" className={cn("fv-card", className)} {...props} />
  );
}
export function CardHeader({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-header"
      className={cn("fv-card-header", className)}
      {...props}
    />
  );
}
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("fv-card-title", className)}
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
      className={cn("fv-description", className)}
      {...props}
    />
  );
}
export function CardContent({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-content"
      className={cn("fv-card-content", className)}
      {...props}
    />
  );
}
export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="card-footer"
      className={cn("fv-card-footer", className)}
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
      className={cn("fv-button", className)}
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
      className={cn("fv-input", className)}
      {...props}
    />
  );
});
export function FieldGroup({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="field-group"
      className={cn("fv-field-group", className)}
      {...props}
    />
  );
}
export function Field({ className, ...props }: DivProps) {
  return (
    <div
      role="group"
      data-slot="field"
      className={cn("fv-field", className)}
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
      className={cn("fv-field-label", className)}
      {...props}
    />
  );
}
export function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      role="alert"
      data-slot="field-error"
      className={cn("fv-field-error", className)}
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
      className={cn("fv-badge", className)}
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
      className={cn("fv-alert", className)}
      {...props}
    />
  );
}
export function AlertDescription({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="alert-description"
      className={cn("fv-alert-description", className)}
      {...props}
    />
  );
}
export function Skeleton({ className, ...props }: DivProps) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn("fv-skeleton", className)}
      {...props}
    />
  );
}
export function Empty({ className, ...props }: DivProps) {
  return (
    <div data-slot="empty" className={cn("fv-empty", className)} {...props} />
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
    <div data-slot="separator" className="fv-separator" role="separator" />
  );
}
export function Spinner() {
  return (
    <LoaderCircle data-icon="inline-start" className="fv-spinner" aria-hidden />
  );
}
export function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("fv-tabs", className)}
      {...props}
    />
  );
}
export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("fv-tabs-list", className)}
      {...props}
    />
  );
}
export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn("fv-tabs-trigger", className)}
      {...props}
    />
  );
}
export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("fv-tabs-content", className)}
      {...props}
    />
  );
}
