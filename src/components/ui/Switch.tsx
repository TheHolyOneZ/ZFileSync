import { motion } from "framer-motion";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  description?: string;
}

export function Switch({ checked, onChange, label, description }: Props) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
      {(label || description) && (
        <span className="flex flex-col gap-0.5">
          {label && <span className="text-[13px] text-text">{label}</span>}
          {description && <span className="text-xs text-muted">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-[background-color,box-shadow] duration-200 cursor-pointer ${
          checked
            ? "bg-accent shadow-[0_0_16px_-2px_rgb(124_255_178/0.6)]"
            : "bg-surface-3 shadow-[inset_0_0_0_1px_var(--color-border-2)]"
        }`}
      >
        <motion.span
          className={`absolute top-1 left-1 w-4 h-4 rounded-full shadow-md ${checked ? "bg-accent-ink" : "bg-muted"}`}
          animate={{ x: checked ? 16 : 0 }}
          transition={{ type: "spring", stiffness: 700, damping: 35 }}
        />
      </button>
    </label>
  );
}
