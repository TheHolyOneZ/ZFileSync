import { motion } from "framer-motion";
import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

export function Button({ variant = "ghost", size = "md", className = "", children, ...rest }: Props) {
  const base =
    "relative inline-flex items-center justify-center gap-1.5 rounded-[10px] font-medium cursor-pointer select-none whitespace-nowrap transition-[background-color,color,box-shadow,border-color] duration-150 ease-[var(--ease-snap)] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none";
  const variants = {
    primary:
      "bg-accent text-accent-ink shadow-[0_0_0_1px_rgb(124_255_178/0.4),0_6px_20px_-6px_rgb(124_255_178/0.55),inset_0_1px_0_rgb(255_255_255/0.45)] hover:bg-[#9affc6] hover:shadow-[0_0_0_1px_rgb(124_255_178/0.6),0_8px_28px_-6px_rgb(124_255_178/0.7),inset_0_1px_0_rgb(255_255_255/0.5)]",
    secondary:
      "bg-surface-2 text-text border border-border-2 hover:bg-surface-3 hover:border-faint shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]",
    ghost: "text-muted hover:text-text hover:bg-white/[0.05]",
    danger: "text-danger hover:bg-danger/10",
  };
  const sizes = { sm: "h-7 px-2.5 text-xs", md: "h-9 px-3.5 text-[13px]" };
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 700, damping: 30 }}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...(rest as any)}
    >
      {children}
    </motion.button>
  );
}

export function IconButton({
  className = "",
  tone = "default",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "accent" | "danger" }) {
  const tones = {
    default: "hover:text-text",
    accent: "hover:text-accent",
    danger: "hover:text-danger",
  };
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 700, damping: 30 }}
      className={`grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer ${tones[tone]} ${className}`}
      {...(rest as any)}
    >
      {children}
    </motion.button>
  );
}
