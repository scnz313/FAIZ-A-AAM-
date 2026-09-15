import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";

export type ButtonVariant = "primary" | "quiet" | "danger" | "saffron" | "accent" | "ghost";
export type ButtonSize = "sm" | "lg";

type ButtonProps = {
  href?: string;
  variant?: ButtonVariant;
  /** V15 sizes: sm (7px 13px), default (11px 20px), lg (14px 26px). */
  size?: ButtonSize;
  block?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
};

/** V15 variant → canonical .btn class. `saffron` is the legacy name for the
 *  V15 accent button (saffron ground); both map to `.btn-accent`. */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  quiet: "btn-quiet",
  danger: "btn-danger",
  saffron: "btn-accent",
  accent: "btn-accent",
  ghost: "btn-ghost",
};

/**
 * The single button primitive — V15 canonical. Emits `.btn` + variant/size
 * classes. Renders an anchor when `href` is given, otherwise a button.
 * Children may include literal arrow characters ("→") — styled naturally.
 */
export default function Button({
  href,
  variant = "primary",
  size,
  block,
  className,
  children,
  onClick,
  type = "button",
  disabled,
}: ButtonProps) {
  const classes = [
    "btn",
    VARIANT_CLASS[variant],
    size === "sm" ? "btn-sm" : "",
    size === "lg" ? "btn-lg" : "",
    block ? "button--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (href !== undefined) {
    /* A disabled anchor keeps its href for layout but must not navigate. */
    const handleClick = disabled
      ? (event: MouseEvent<HTMLAnchorElement>) => event.preventDefault()
      : onClick;
    if (href.startsWith("/")) {
      return (
        <Link
          href={href}
          className={classes}
          onClick={handleClick}
          aria-disabled={disabled || undefined}
        >
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        className={classes}
        onClick={handleClick}
        aria-disabled={disabled || undefined}
      >
        {children}
      </a>
    );
  }

  return (
    <button type={type} className={classes} onClick={disabled ? undefined : onClick} disabled={disabled}>
      {children}
    </button>
  );
}
