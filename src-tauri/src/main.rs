// Smart Scanner - native shell (Tauri 2).
// Keeps the app resident in the tray after the first launch, so the next start is instant.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

use tauri::{
    ipc::{InvokeBody, Request},
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

struct Flags {
    /// closing the window hides it to the tray instead of quitting
    background: AtomicBool,
    /// started by "run with Windows": stay hidden until the user asks for the window
    hidden_start: bool,
    shown_once: AtomicBool,
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(windows)]
fn drive_dir() -> Option<PathBuf> {
    for d in ["E:\\", "D:\\"] {
        if std::path::Path::new(d).exists() {
            let dir = PathBuf::from(d).join("Scans");
            if fs::create_dir_all(&dir).is_ok() {
                return Some(dir);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn drive_dir() -> Option<PathBuf> {
    None
}

/// E:\Scans (or D:\Scans) when such a drive exists, otherwise Documents\Scans
fn default_dir(app: &AppHandle) -> PathBuf {
    drive_dir().unwrap_or_else(|| {
        app.path()
            .document_dir()
            .map(|d| d.join("Scans"))
            .unwrap_or_else(|_| PathBuf::from("Scans"))
    })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(v) = hex {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn unique_path(dir: &PathBuf, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let path = std::path::Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Scan");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("pdf");
    let mut n = 2;
    loop {
        let c = dir.join(format!("{stem} ({n}).{ext}"));
        if !c.exists() {
            return c;
        }
        n += 1;
    }
}

#[tauri::command]
fn app_ready(app: AppHandle) {
    let flags = app.state::<Flags>();
    if !flags.hidden_start && !flags.shown_once.swap(true, Ordering::SeqCst) {
        show_main(&app);
    }
}

#[tauri::command]
fn get_default_dir(app: AppHandle) -> String {
    default_dir(&app).to_string_lossy().into_owned()
}

#[tauri::command]
async fn choose_dir(app: AppHandle, current: Option<String>) -> Option<String> {
    let mut dlg = app.dialog().file();
    if let Some(c) = current.filter(|c| !c.is_empty()) {
        dlg = dlg.set_directory(c);
    }
    dlg.blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// The PDF arrives as the raw request body (no JSON / base64 overhead); folder and file name in headers.
#[tauri::command]
fn save_pdf(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let data = match request.body() {
        InvokeBody::Raw(d) => d,
        _ => return Err("PDF data missing".into()),
    };
    let header = |k: &str| -> String {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(percent_decode)
            .unwrap_or_default()
    };
    let dir_s = header("x-dir");
    let mut dir = if dir_s.is_empty() { default_dir(&app) } else { PathBuf::from(dir_s) };
    if fs::create_dir_all(&dir).is_err() {
        dir = default_dir(&app);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let mut name: String = header("x-filename")
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    if name.trim().is_empty() {
        name = "Scan.pdf".into();
    }
    let path = unique_path(&dir, &name);
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) {
    let _ = app.opener().open_path(path, None::<&str>);
}

#[tauri::command]
fn show_in_folder(app: AppHandle, path: String) {
    let _ = app.opener().reveal_item_in_dir(path);
}

#[tauri::command]
fn set_background_mode(app: AppHandle, enabled: bool) {
    app.state::<Flags>().background.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> bool {
    let m = app.autolaunch();
    let _ = if enabled { m.enable() } else { m.disable() };
    m.is_enabled().unwrap_or(false)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Queries the signed update feed.  None means that this installation is current.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let available = updater.check().await.map_err(|e| e.to_string())?;
    Ok(available.map(|release| release.version))
}

/// Re-checks and installs only a signed, newer release. The Windows NSIS updater
/// exits this application as part of the installation process.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(release) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    release
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

fn main() {
    let hidden_start = std::env::args().any(|a| a == "--hidden");

    tauri::Builder::default()
        // a second launch only brings the already running (resident) window to the front
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(Flags {
            background: AtomicBool::new(true),
            hidden_start,
            shown_once: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            get_default_dir,
            choose_dir,
            save_pdf,
            open_path,
            show_in_folder,
            set_background_mode,
            get_autostart,
            set_autostart,
            quit_app,
            check_update,
            install_update
        ])
        .setup(|app| {
            // First launch after installation: register a hidden "run with Windows"
            // entry so the app is already running (warm) whenever the icon is clicked.
            if let Ok(dir) = app.path().app_config_dir() {
                let marker = dir.join(".first-run-done");
                if !marker.exists() {
                    let _ = fs::create_dir_all(&dir);
                    let _ = app.autolaunch().enable();
                    let _ = fs::write(&marker, b"1");
                }
            }
            let show = MenuItem::with_id(app, "show", "باز کردن اسکنر", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "خروج کامل", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("اسکنر هوشمند - Smart Scanner")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let flags = window.app_handle().state::<Flags>();
                if flags.background.load(Ordering::SeqCst) {
                    // keep the process (and the warm WebView) alive in the tray
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Smart Scanner");
}
