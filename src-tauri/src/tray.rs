use std::{
    sync::atomic::Ordering,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{image::Image, tray::TrayIcon, AppHandle, Manager};

use crate::{commands::ManagerState, events::LAST_ACTIVITY, sync::pair::PairStatus};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TrayState {
    Idle,
    Paused,
    Scanning,
    Syncing,
    Attention,
}

impl TrayState {
    fn tooltip(self) -> &'static str {
        match self {
            TrayState::Idle => "ZFileSync: up to date",
            TrayState::Paused => "ZFileSync: paused",
            TrayState::Scanning => "ZFileSync: scanning files…",
            TrayState::Syncing => "ZFileSync: syncing…",
            TrayState::Attention => "ZFileSync: needs attention",
        }
    }

    fn animated(self) -> bool {
        matches!(self, TrayState::Scanning | TrayState::Syncing)
    }

    fn color(self) -> [u8; 3] {
        match self {
            TrayState::Idle => [52, 211, 120],
            TrayState::Paused => [140, 146, 158],
            TrayState::Scanning => [70, 160, 255],
            TrayState::Syncing => [255, 170, 40],
            TrayState::Attention => [240, 70, 85],
        }
    }
}

const FRAMES: usize = 8;

pub fn compute_state(statuses: &[PairStatus], last_activity_ms: i64, now_ms: i64) -> TrayState {
    if statuses.is_empty() {
        return TrayState::Idle;
    }
    if statuses
        .iter()
        .any(|s| matches!(s, PairStatus::Error | PairStatus::Missing | PairStatus::Conflict))
    {
        return TrayState::Attention;
    }
    if statuses.contains(&PairStatus::Scanning) {
        return TrayState::Scanning;
    }
    if now_ms - last_activity_ms < 1500 {
        return TrayState::Syncing;
    }
    if statuses.iter().all(|s| *s == PairStatus::Paused) {
        return TrayState::Paused;
    }
    TrayState::Idle
}

fn blend(px: &mut [u8], color: [u8; 3], alpha: f32) {
    let a = alpha.clamp(0.0, 1.0);
    for i in 0..3 {
        px[i] = (px[i] as f32 * (1.0 - a) + color[i] as f32 * a) as u8;
    }
    px[3] = px[3].max((a * 255.0) as u8);
}

pub fn render_icon(base: &[u8], w: u32, h: u32, state: TrayState, frame: usize) -> Vec<u8> {
    let mut out = base.to_vec();
    let (wf, hf) = (w as f32, h as f32);
    let r = wf.min(hf) * 0.29;
    let (cx, cy) = (wf - r - 0.5, hf - r - 0.5);
    let color = state.color();
    let (dot_x, dot_y) = if state.animated() {
        let ang = frame as f32 / FRAMES as f32 * std::f32::consts::TAU;
        (cx + ang.cos() * (r * 0.55), cy + ang.sin() * (r * 0.55))
    } else {
        (f32::NAN, f32::NAN)
    };
    for y in 0..h {
        for x in 0..w {
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            let dist = ((px - cx).powi(2) + (py - cy).powi(2)).sqrt();
            let px_idx = ((y * w + x) * 4) as usize;
            let pix = &mut out[px_idx..px_idx + 4];
            blend(pix, [10, 12, 16], (r + 1.6 - dist).clamp(0.0, 1.0) * 0.85);
            blend(pix, color, (r + 0.5 - dist).clamp(0.0, 1.0));
            if state.animated() {
                let d = ((px - dot_x).powi(2) + (py - dot_y).powi(2)).sqrt();
                blend(pix, [255, 255, 255], (r * 0.28 + 0.5 - d).clamp(0.0, 1.0));
            } else if state == TrayState::Attention {
                let on_bar = (px - cx).abs() < r * 0.16 && py > cy - r * 0.6 && py < cy + r * 0.15;
                let on_dot = ((px - cx).powi(2) + (py - (cy + r * 0.5)).powi(2)).sqrt() < r * 0.19;
                if on_bar || on_dot {
                    blend(pix, [255, 255, 255], 1.0);
                }
            }
        }
    }
    out
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn spawn_animator(app: AppHandle, tray: TrayIcon) {
    let Some(base_icon) = app.default_window_icon().cloned() else { return };
    let (w, h) = (base_icon.width(), base_icon.height());
    let base = base_icon.rgba().to_vec();
    std::thread::spawn(move || {
        let mut counter = 0usize;
        let mut last: Option<(TrayState, usize)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(250));
            counter = counter.wrapping_add(1);
            let statuses: Vec<PairStatus> = match app.try_state::<ManagerState>() {
                Some(m) => m.lock().unwrap().list_pairs().into_iter().map(|p| p.status).collect(),
                None => continue,
            };
            let state = compute_state(&statuses, LAST_ACTIVITY.load(Ordering::Relaxed), now_ms());
            let frame = if state.animated() { counter % FRAMES } else { 0 };
            if last == Some((state, frame)) {
                continue;
            }
            let _ = tray.set_icon(Some(Image::new_owned(render_icon(&base, w, h, state, frame), w, h)));
            if last.map(|l| l.0) != Some(state) {
                let _ = tray.set_tooltip(Some(state.tooltip()));
            }
            last = Some((state, frame));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_priority() {
        use PairStatus::*;
        assert_eq!(compute_state(&[], 0, 10_000), TrayState::Idle);
        assert_eq!(compute_state(&[Syncing, Error], 0, 10_000), TrayState::Attention);
        assert_eq!(compute_state(&[Syncing, Scanning], 0, 10_000), TrayState::Scanning);
        assert_eq!(compute_state(&[Syncing], 9_500, 10_000), TrayState::Syncing);
        assert_eq!(compute_state(&[Syncing], 0, 10_000), TrayState::Idle);
        assert_eq!(compute_state(&[Paused, Paused], 0, 10_000), TrayState::Paused);
    }

    #[test]
    fn badge_changes_pixels_and_animates() {
        let base = vec![200u8; 32 * 32 * 4];
        let idle = render_icon(&base, 32, 32, TrayState::Idle, 0);
        let a = render_icon(&base, 32, 32, TrayState::Scanning, 0);
        let b = render_icon(&base, 32, 32, TrayState::Scanning, 3);
        assert_ne!(idle, base);
        assert_ne!(a, b);
        assert_eq!(idle.len(), base.len());
    }
}
