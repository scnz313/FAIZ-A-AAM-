import type { ReactNode } from "react";

export type ButtonVariant = "primary" | "quiet" | "danger" | "small" | "saffron";

type ButtonProps = {
  href?: string;
  variant?: ButtonVariant;
  block?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
};

/**
 * The single button primitive. Renders an anchor when `href` is given,
 * otherwise a button. Variants map to `.button` + `.button--{variant}`.
 * Children may include literal arrow characters ("→") — styled naturally.
 */
export default function Button({
  href,
  variant,
  block,
  className,
  children,
  onClick,
  type = "button",
  disabled,
}: ButtonProps) {
  const classes = [
    "button",
    variant ? `button--${variant}` : "",
    block ? "button--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (href !== undefined) {
    return (
      <a
        href={href}
        className={classes}
        onClick={disabled ? undefined : onClick}
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
