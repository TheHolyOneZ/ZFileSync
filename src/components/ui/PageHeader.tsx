import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, icon, actions }: Props) {
  return (
    <header className="relative flex items-end justify-between gap-4 px-7 pt-7 pb-5">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-surface-2 ring-gradient text-accent flex-shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] leading-none text-gradient">{title}</h2>
          {subtitle && <div className="text-[13px] text-muted mt-1.5 truncate">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </header>
  );
}
