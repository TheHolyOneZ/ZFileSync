# ZFileSync User Guide

A plain-language guide to using ZFileSync. For a feature overview see the [README](../README.md).

## Contents

1. [Getting started](#1-getting-started)
2. [The interface](#2-the-interface)
3. [Creating a sync pair](#3-creating-a-sync-pair)
4. [Sync modes](#4-sync-modes)
5. [Real-time sync](#5-real-time-sync)
6. [Filters and exclusions](#6-filters-and-exclusions)
7. [Common use cases](#7-common-use-cases)
8. [FAQ and troubleshooting](#8-faq-and-troubleshooting)

---

## 1. Getting started

### Install

| Platform | Options |
|----------|---------|
| Linux | `.AppImage`, `.deb`, `.rpm` from [zsync.eu/zfilesync](https://zsync.eu/zfilesync/) or the GitHub Releases page. A community-maintained Flatpak is also available from [FlatPark](https://flatpark.org/apps/dev.zfilesync.app/). |
| Windows | `.msi` or `.exe` from [zsync.eu/zfilesync](https://zsync.eu/zfilesync/) |

Windows 10 needs the WebView2 runtime (it ships with Windows 11).

### First run

1. Open ZFileSync.
2. Press **New pair** (or `Ctrl+N`).
3. Choose what to sync, the direction, a source and a destination, then confirm.

ZFileSync runs a first sync right away, shows its progress on the pair card, and then keeps watching for changes. It stays in the system tray after you close the window. The tray menu also has *Pause all*, *Resume all* and *Quit*; quit from there to stop syncing.

> ZFileSync syncs between two paths on the same machine (or network-mounted drives). It is not a cloud service.

## 2. The interface

The sidebar switches between five tabs (`Ctrl+1` to `Ctrl+5`):

| Tab | What it does |
|-----|--------------|
| **Pairs** | Your sync pairs. Each card shows source → destination, mode and live status. Each card has a pause/resume button, a menu to copy paths, and removal (removal needs a second click to confirm). |
| **Activity** | A history of everything that happened: files copied, deleted, conflicts. |
| **QA Tester** | Built-in self-test that creates temporary pairs and checks that sync behaves correctly. Useful for bug reports. |
| **Settings** | Launch on system startup and the global ignore patterns. |
| **About** | Version and project links. |

### Pair status

| Status | Meaning |
|--------|---------|
| Scanning / Syncing | The first sync or a catch-up is running. A progress bar shows counts. |
| Idle | Everything is in sync and the pair is being watched. |
| Paused | You paused the pair. Nothing is copied until you resume. |
| Conflict | Two-way only: the same file changed on both sides. See [Conflicts](#conflicts). |
| Missing | The source or destination can't be found (drive unplugged, share offline). |
| Error | Something failed. The error toast and the Activity tab give details. |

## 3. Creating a sync pair

Open **New pair** and fill in:

1. **What to sync**: *Single File* (one file, e.g. a log) or *Folder* (a whole directory tree).
2. **Direction**: *One-way* or *Two-way* (see [Sync modes](#4-sync-modes)).
3. **Source** and **Destination**: type a path or use the folder button. The destination folder is created if it doesn't exist.
4. **Ignore patterns** (folders only, optional): see [Filters](#6-filters-and-exclusions).
5. For one-way folder pairs, optionally tick **Keep files deleted from the source** (see below).

## 4. Sync modes

| | Source → Destination | Destination → Source | Deletions |
|-|----------------------|----------------------|-----------|
| **One-way** | yes | never | Mirrored to the destination by default, can be turned off |
| **Two-way** | yes | yes | Mirrored in both directions |

### One-way

The destination is made to match the source. New and changed files are copied. Changes you make in the destination are not copied back.

**Keep files deleted from the source** (one-way folders): when ticked, files you delete from the source stay in the destination. New and changed files are still copied. This behaves like `rsync` without `--delete` and is handy for staging folders and backups, for example a phone-upload folder that you clean up while the destination keeps everything. Without it, deleting a file in the source also deletes it in the destination.

> Safety net: if the source can't be read completely (share offline, empty mount point), ZFileSync skips deletions and reports an error instead of wiping the destination.

### Two-way

Changes on either side are copied to the other, including deletions.

#### Conflicts

If the same file changed on both sides, ZFileSync asks what to do:

- **Keep source**: source wins, the other copy is renamed `name.conflict-<timestamp>`.
- **Keep dest**: destination wins, the source copy is renamed `name.conflict-<timestamp>`.
- **Keep both**: both versions are kept.

## 5. Real-time sync

ZFileSync uses your operating system's file-watching to notice changes. After a change it waits about 400 ms (so a burst of writes becomes one sync) and then copies the file atomically, so a half-written file never appears in the destination.

- **At startup**: every pair is checked again, so changes made while ZFileSync wasn't running are caught up. Unchanged files are skipped by size and modified time (2-second tolerance for FAT/exFAT).
- **Network shares** (SMB/CIFS, NFS, sshfs, rclone, GNOME gvfs, Windows UNC paths): the OS doesn't report changes made on the server, so these are re-checked every 3 seconds.
- **Pause**: pause a pair from its card (or use *Pause all* in the tray) to stop syncing without removing it.

## 6. Filters and exclusions

Patterns are comma-separated globs, entered per pair when creating it (folders only):

| Pattern | Matches |
|---------|---------|
| `*.log` | every `.log` file |
| `cache` | any file or folder named `cache` at any depth |
| `build/*` | everything directly inside `build` |
| `*.tmp, *.bak` | several patterns at once |

These are always ignored: `node_modules`, `.git`, `*.tmp`, `*.swp`, `*.lock`, `~*`.

## 7. Common use cases

- **Game logs or app output into your workspace**: single-file, one-way pair from the log to a project folder.
- **Back up photos from a phone-sync folder**: folder, one-way, with *Keep files deleted from the source* ticked. The staging folder can be cleaned freely while the destination keeps every photo.
- **Mirror a project to a USB stick**: folder, one-way, default settings. The stick always matches the project.
- **Keep two machines' folders aligned over a share**: folder, two-way. Resolve conflict prompts when they appear.
- **Share configs between two apps**: single-file, two-way.

## 8. FAQ and troubleshooting

**The window closed, is syncing still running?** Yes. ZFileSync lives in the system tray. Use the tray menu to quit.

**A pair shows "Missing".** The source or destination isn't reachable. Reconnect the drive or share, then pause and resume the pair if it doesn't recover on its own.

**Files were not deleted in the destination.** Check whether the pair has *Keep files deleted from the source* enabled, or whether the source could not be fully read (an error is shown in that case).

**My files are not syncing.** Make sure the pair isn't paused and the file doesn't match an ignore pattern. Open the Activity tab to see what ZFileSync last did.

**Changes on a network share appear late.** Shares are checked every 3 seconds, so expect a short delay.

**How do I report a bug?** Run the **QA Tester** and open an issue at <https://github.com/TheHolyOneZ/ZFileSync/issues> with the result and what you did.
