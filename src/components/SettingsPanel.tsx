import { useEffect, useState } from "react";
import { ipc, type AppSettings } from "../lib/ipc";
import { Switch } from "./ui/Switch";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { PageHeader } from "./ui/PageHeader";
import { Settings as SettingsIcon, Check } from "lucide-react";

export function SettingsPanel() {
  const [settings, setSettings] = useState<AppSettings>({ autostart: false, defaultIgnores: [] });
  const [ignoreRaw, setIgnoreRaw] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    ipc.getSettings().then((s) => {
      setSettings(s);
      setIgnoreRaw(s.defaultIgnores.join(", "));
    });
  }, []);

  const save = async () => {
    const s: AppSettings = {
      ...settings,
      defaultIgnores: ignoreRaw.split(",").map((x) => x.trim()).filter(Boolean),
    };
    await ipc.setSettings(s);
    setSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Settings" icon={<SettingsIcon size={18} />} subtitle="Preferences apply to new pairs and the next launch." />
      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-7 pt-1 flex flex-col gap-6 max-w-2xl">
        <SettingsGroup title="General">
          <Switch
            checked={settings.autostart}
            onChange={(v) => setSettings((s) => ({ ...s, autostart: v }))}
            label="Launch on system startup"
            description="Starts minimized to the tray so syncing resumes after login."
          />
        </SettingsGroup>

        <SettingsGroup title="Default ignore patterns">
          <Input
            label="Patterns (comma-separated)"
            value={ignoreRaw}
            onChange={(e) => setIgnoreRaw(e.target.value)}
            placeholder="*.tmp, .cache, build"
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-faint">
            Applied in addition to built-in defaults: node_modules, .git, *.swp, *.lock
          </p>
        </SettingsGroup>

        <Button variant="primary" size="md" onClick={save} className="self-start min-w-36">
          {saved ? (
            <>
              <Check size={15} strokeWidth={2.5} /> Saved
            </>
          ) : (
            "Save settings"
          )}
        </Button>
      </div>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-[10px] font-mono uppercase tracking-[0.16em] text-faint">{title}</h3>
      <div className="flex flex-col gap-3 p-4 rounded-2xl bg-surface/70 ring-gradient">{children}</div>
    </section>
  );
}
