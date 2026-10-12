interface Props {
  color?: "accent" | "warning" | "danger" | "muted";
  children: React.ReactNode;
}

export function Badge({ color = "muted", children }: Props) {
  const colors = {
    accent: "bg-accent/12 text-accent ring-accent/25",
    warning: "bg-warning/12 text-warning ring-warning/25",
    danger: "bg-danger/12 text-danger ring-danger/25",
    muted: "bg-white/[0.04] text-muted ring-border-2",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-mono font-medium ring-1 ring-inset ${colors[color]}`}
    >
      {children}
    </span>
  );
}
