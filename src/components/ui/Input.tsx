import type { InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = "", ...rest }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-medium text-muted">{label}</label>}
      <input className={`field h-9 px-3 text-[13px] ${className}`} {...rest} />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
