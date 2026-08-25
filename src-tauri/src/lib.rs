use tauri::Manager;

#[tauri::command]
fn smoke_read_file(path: String) -> Result<Vec<u8>, String> {
    if std::env::var("FRAME_EXPORTER_SMOKE_DIR").is_err() {
        return Err("smoke commands disabled".into());
    }
    std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))
}

#[tauri::command]
fn smoke_write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    if std::env::var("FRAME_EXPORTER_SMOKE_OUT").is_err() {
        return Err("smoke commands disabled".into());
    }
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, contents).map_err(|e| format!("write {path}: {e}"))
}

fn inject_smoke(window: &tauri::WebviewWindow, dir: &str, out: &str) {
    let dir_js = serde_json::to_string(dir).unwrap_or_else(|_| "\"\"".into());
    let out_js = serde_json::to_string(out).unwrap_or_else(|_| "\"\"".into());
    let script = format!(
        r#"(async function(){{
  window.__FRAME_EXPORTER_SMOKE_DIR__ = {dir_js};
  window.__FRAME_EXPORTER_SMOKE_OUT__ = {out_js};
  window.__FRAME_EXPORTER_SMOKE_TICK__ = (window.__FRAME_EXPORTER_SMOKE_TICK__ || 0) + 1;
  window.dispatchEvent(new Event('frame-exporter-smoke'));
  try {{
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
      const enc = new TextEncoder();
      const msg = enc.encode('tick=' + window.__FRAME_EXPORTER_SMOKE_TICK__ + ' seen=' + (window.__FRAME_EXPORTER_SMOKE_SEEN__||0));
      await window.__TAURI_INTERNALS__.invoke('smoke_write_file', {{
        path: {out_js} + '.from-eval',
        contents: Array.from(msg)
      }});
    }} else {{
      window.__FRAME_EXPORTER_NO_TAURI__ = true;
    }}
  }} catch (e) {{
    window.__FRAME_EXPORTER_SMOKE_EVAL_ERR__ = String(e);
  }}
}})()"#
    );
    let _ = window.eval(&script);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![smoke_read_file, smoke_write_file])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if let (Ok(dir), Ok(out)) = (
                std::env::var("FRAME_EXPORTER_SMOKE_DIR"),
                std::env::var("FRAME_EXPORTER_SMOKE_OUT"),
            ) {
                let _ = std::fs::write(format!("{out}.rust-started"), format!("dir={dir}\nout={out}\n"));
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    for attempt in 1..=60 {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        if let Some(w) = handle.get_webview_window("main") {
                            inject_smoke(&w, &dir, &out);
                            let _ = std::fs::write(
                                format!("{out}.rust-log"),
                                format!("attempt {attempt}: inject\n"),
                            );
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
