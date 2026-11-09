mod commands;
mod db;
mod events;
mod sync;

use std::sync::{Arc, Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

use commands::{DbState, ManagerState};
use sync::SyncManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            let db_path = app_dir.join("zfilesync.db");
            let conn = db::open(db_path).expect("failed to open database");
            let db_state: DbState = Arc::new(Mutex::new(conn));

            let manager = SyncManager::new(Arc::clone(&db_state), app.handle().clone());
            let manager_state: ManagerState = Arc::new(Mutex::new(manager));

            {
                let pairs = {
                    let conn = db_state.lock().unwrap();
                    db::load_all_pairs(&conn).unwrap_or_default()
                };
                let mut mgr = manager_state.lock().unwrap();
                mgr.load_and_start_all(pairs);
            }

            app.manage(db_state);
            app.manage(manager_state);

            build_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_pairs,
            commands::add_pair,
            commands::remove_pair,
            commands::pause_pair,
            commands::resume_pair,
            commands::get_activity,
            commands::get_tombstones,
            commands::respond_respawn,
            commands::resolve_conflict,
            commands::get_settings,
            commands::set_settings,
            commands::pick_path,
            commands::qa_create_workspace,
            commands::qa_write_file,
            commands::qa_read_file,
            commands::qa_delete_path,
            commands::qa_path_exists,
            commands::qa_list_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "Open ZFileSync").build(app)?;
    let pause_all = MenuItemBuilder::with_id("pause_all", "Pause All").build(app)?;
    let resume_all = MenuItemBuilder::with_id("resume_all", "Resume All").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &pause_all, &resume_all, &quit])
        .build()?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .menu(&menu)
        .tooltip("ZFileSync")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "pause_all" => {
                if let Some(mgr_state) = app.try_state::<ManagerState>() {
                    let pairs: Vec<uuid::Uuid> = {
                        let mgr = mgr_state.lock().unwrap();
                        mgr.list_pairs().iter().map(|p| p.id).collect()
                    };
                    let mut mgr = mgr_state.lock().unwrap();
                    for id in pairs {
                        mgr.pause_pair(id);
                    }
                }
            }
            "resume_all" => {
                if let Some(mgr_state) = app.try_state::<ManagerState>() {
                    let pairs: Vec<uuid::Uuid> = {
                        let mgr = mgr_state.lock().unwrap();
                        mgr.list_pairs().iter().map(|p| p.id).collect()
                    };
                    let mut mgr = mgr_state.lock().unwrap();
                    for id in pairs {
                        mgr.resume_pair(id);
                    }
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
