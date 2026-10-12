# Changelog

All notable changes to ZFileSync are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-10-12

A reliability release for large folders, network shares and USB sticks, plus a redesigned interface.

### Fixed
- **App froze when creating a pair, and could stop opening afterwards.** The first sync of a large folder (for example a network share to a USB stick) ran on the UI thread, and on the next launch it ran again before the window appeared. The first sync now runs in the background, and pair commands no longer block the window.
- **Other actions hung during a sync.** The database was locked for the entire first sync, so the activity feed and settings hung. It is now locked per write.
- **Destination could be wiped if the source was unreachable.** If the source can't be read completely (share offline, half-mounted, empty mount point), deletions on the destination are skipped and reported as an error.
- **Slow restarts and high memory use on big files.** Files are now hashed in chunks instead of being loaded fully into memory. Copies keep the source's modified time, so unchanged files are skipped by size and timestamp on the next start (with a 2-second tolerance for FAT/exFAT USB sticks).
- **Paused status could flip back.** Pausing a pair could change its status back to "idle".
- **Custom scrollbars didn't apply on Windows.** The Windows webview ignored the custom scrollbar styling, so it showed default bars.

### Added
- **Live progress for the first sync.** A new *scanning* status with a progress bar shows scanning, comparing and copying, with file counts.
- **Network share support.** SMB/CIFS, NFS, sshfs, rclone and GNOME (gvfs) mounts on Linux, and UNC paths on Windows, are detected automatically and checked for changes every 3 seconds, because the OS doesn't report changes made on the server side.
- **Keyboard shortcuts:** `Ctrl+N` creates a new pair, `Ctrl+1` to `Ctrl+5` switch tabs, and `Esc` closes the dialog.
- **Copy paths** in the pair menu.
- **Release workflow** (`.github/workflows/release.yml`) that builds all Linux and Windows installers into a draft GitHub release.

### Changed
- **Redesigned interface:** Geist fonts, new pair cards with an animated source → destination line and status glow, a sliding sidebar highlight, quick page transitions, a reworked *New pair* dialog, and slim scrollbars.
- Removing a pair now needs a confirmation click.
- Error notifications moved to the bottom-right and no longer cover the *New pair* button.
- The QA Tester waits for a pair to finish its first sync before testing live changes.
- The app follows the system's reduced-motion setting.
- The About page reads the version from `package.json`.

## [0.1.0] - 2026-05-31

First public release.

### Added
- Real-time mirroring of files and folders using OS-native filesystem events.
- One-way and two-way sync for single files and whole folders, configured per pair.
- Startup check that brings both sides back in line using `blake3` content hashes.
- Two-way conflict prompts: keep source, keep destination, or keep both.
- Tombstones for deleted files, with a prompt when a deleted file reappears and an optional "always resume" per path.
- Per-pair glob ignore patterns with sensible defaults.
- SQLite activity log that survives restarts.
- System tray with Pause all / Resume all, close-to-tray, and optional autostart.
- Built-in QA Tester for end-to-end checks.
- Installers for Linux (`.deb`, `.AppImage`, `.rpm`) and Windows (`.msi`, NSIS `.exe`).

[0.1.1]: https://github.com/TheHolyOneZ/ZFileSync/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/TheHolyOneZ/ZFileSync/releases/tag/v0.1.0
