<div align="center">
  <img src="src-tauri/icons/icon.png" alt="ZFileSync Logo" width="120" height="120" style="border-radius: 24px;" />

  <h1>ZFileSync</h1>

  <p><strong>Real-time file &amp; folder mirroring for Linux and Windows.</strong><br/>
  Zero cloud. Zero latency. Just your files, instantly synced.</p>

  <p>
    <a href="https://zsync.eu/zfilesync/"><img alt="Website" src="https://img.shields.io/badge/website-zsync.eu%2Fzfilesync-7CFFB2?style=flat-square&labelColor=0B0D10"></a>
    <a href="https://github.com/TheHolyOneZ/ZFileSync"><img alt="GitHub" src="https://img.shields.io/badge/source-GitHub-7CFFB2?style=flat-square&logo=github&labelColor=0B0D10"></a>
    <a href="https://zsync.eu/zfilesync/"><img alt="Downloads" src="https://img.shields.io/badge/Download here-7CFFB2?style=flat-square&labelColor=0B0D10"></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-GPL--3.0-7CFFB2?style=flat-square&labelColor=0B0D10"></a>
    <img alt="Platform" src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows-7CFFB2?style=flat-square&labelColor=0B0D10">
  </p>
</div>

---

## What is ZFileSync?

ZFileSync is a lightweight desktop utility that mirrors files and folders between two locations in real time. The primary use case is syncing files that live in inconvenient places — game logs, app output, config files — straight into your workspace, automatically.

It runs silently in the system tray, continues syncing after the window is closed, and keeps a full history of everything that happened.

> [!IMPORTANT]
> ZFileSync syncs locally between two paths on the **same machine** (or network-mounted drives). It is **not** a cloud backup tool.

---

## Download

<div align="center">

| Platform | Installer |
|----------|-----------|
| 🐧 **Linux** | `.AppImage` · `.deb` · `.rpm`  — [zsync.eu/zfilesync](https://zsync.eu/zfilesync/) · Flatpak via [FlatPark](https://flatpark.org/apps/dev.zfilesync.app/) (community-maintained) |
| 🪟 **Windows** | `.msi` · `.exe` — [zsync.eu/zfilesync](https://zsync.eu/zfilesync/) |

</div>

> [!NOTE]
> Pre-built installers for both platforms are published on the landing page. No additional runtime dependencies required — everything is bundled.

> [!TIP]
> New to ZFileSync? Read the [User Guide](docs/USER_GUIDE.md).

---

## Features

<table>
<tr>
<td>

**Sync modes**
- One-way file sync
- Two-way file sync
- One-way folder sync
- Two-way folder sync

</td>
<td>

**Smart handling**
- Conflict detection & resolution
- Tombstone tracking (deleted file log)
- Respawn detection (file re-created after delete)
- Ignore patterns (glob-based)

</td>
<td>

**App**
- Live activity feed
- System tray (syncs with window closed)
- Autostart on boot
- SQLite event log (persists across restarts)

</td>
</tr>
</table>

---

## How it works

```
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  React + TypeScript (UI)     │   IPC   │  Rust backend (Tauri)        │
│  · Pair list / add / edit    │ ◄─────► │  · SyncManager               │
│  · Activity feed             │  events │  · notify watcher            │
│  · Conflict / respawn prompts│         │  · Startup reconciler        │
│  · Settings / tray menu      │         │  · SQLite (rusqlite)         │
└──────────────────────────────┘         └──────────────────────────────┘
```

1. **Add a pair** — pick a source path and a destination path, choose direction and ignore patterns.
2. **Reconcile** — on startup ZFileSync diffs both sides and brings them into alignment immediately.
3. **Watch** — `notify` installs a filesystem watcher. Any create, modify, or delete event is debounced (~400 ms) then applied to the other side atomically.
4. **Conflict / Respawn** — two-way conflicts pause the pair and surface a resolution prompt. Deleted files that reappear trigger a respawn prompt (with a per-path "always resume" toggle).

> [!TIP]
> The perfect use case: a game writes logs to `C:\Users\You\AppData\Roaming\SomeGame\game.log`. Add a one-way file pair pointing that log at your workspace folder. Open your editor — the log is right there, updating live.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri v2](https://tauri.app) |
| Backend language | Rust |
| File watching | [`notify`](https://crates.io/crates/notify) + `notify-debouncer-full` |
| Directory walking | [`walkdir`](https://crates.io/crates/walkdir) |
| Content hashing | [`blake3`](https://crates.io/crates/blake3) |
| Database | SQLite via [`rusqlite`](https://crates.io/crates/rusqlite) (bundled) |
| Ignore patterns | [`globset`](https://crates.io/crates/globset) |
| UI framework | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Animations | [framer-motion](https://www.framer.com/motion/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Forms | react-hook-form + Zod |
| Icons | lucide-react |

---

## Building from source

### Prerequisites

- [Rust](https://rustup.rs/) (stable, 1.77+)
- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/)
- Linux: `libwebkit2gtk`, `libgtk-3`, `libayatana-appindicator3` (or distro equivalent)
- Windows: WebView2 (ships with Windows 11; installer available for Windows 10)

```bash
git clone https://github.com/TheHolyOneZ/ZFileSync.git
cd ZFileSync
pnpm install
pnpm tauri dev        # development (hot-reload)
pnpm tauri build      # production bundle
```

> [!NOTE]
> On Linux, the app bundles as `.AppImage` and `.deb`. On Windows it produces an `.msi` and NSIS `.exe` installer. Cross-compilation requires setting up the target toolchain — building natively on each platform is recommended.

---

## Supported pair combinations

| Mode | Description |
|------|-------------|
| **File · One-way** | Single file mirrored from source → destination. Perfect for log files. |
| **File · Two-way** | Both sides stay in sync; last-write wins. |
| **Folder · One-way** | Entire directory tree mirrored source → destination. Deletions propagate. |
| **Folder · Two-way** | Full bidirectional sync with conflict detection on simultaneous edits. |

> [!IMPORTANT]
> Two-way sync detects conflicts by comparing content hashes (blake3) against a last-known-state snapshot. When both sides change between watcher ticks the pair is **paused** and a resolution prompt appears — you choose: keep source, keep destination, or keep both (the loser is renamed `.conflict-<timestamp>`).

---

## Conflict & respawn behaviour

**Conflict (two-way only)**

When a file is modified on both sides before the watcher can sync, ZFileSync pauses the pair and shows an inline prompt:

- **Keep source** — overwrites destination, saves a `.conflict-<ts>` copy of the original dest
- **Keep destination** — discards the source change, saves a `.conflict-<ts>` copy of the original source  
- **Keep both** — copies source into `<file>.conflict-<ts>`, leaves destination untouched

**Respawn (deleted file reappears)**

If a synced file is deleted and later recreated at the same path:

- A prompt appears asking whether to resume syncing
- Choosing **Always resume this path** adds it to the auto-resume list — no more prompts for that path

---

## License

ZFileSync is free software released under the **GNU General Public License v3.0**.

```
Copyright (C) 2025 TheHolyOneZ

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
```

See [LICENSE](LICENSE) for the full text, or visit [gnu.org/licenses/gpl-3.0](https://www.gnu.org/licenses/gpl-3.0.html).

---

## Developer

<div align="center">

<img src="https://github.com/TheHolyOneZ.png" alt="TheHolyOneZ" width="80" height="80" style="border-radius: 50%;" />

**TheHolyOneZ**

[github.com/TheHolyOneZ](https://github.com/TheHolyOneZ) · [zsync.eu](https://zsync.eu) (more projects)

</div>

> [!NOTE]
> Issues, feature requests, and pull requests are welcome on [GitHub](https://github.com/TheHolyOneZ/ZFileSync). This project follows the GPL-3.0 license — derivative works must remain open source.
