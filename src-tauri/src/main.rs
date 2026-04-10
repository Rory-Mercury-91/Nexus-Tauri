// Pas de console Windows en release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Header, Method, Response, Server, StatusCode};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingImportEnvelope {
    kind: String,
    mode: String,
    payload: Value,
    received_at: i64,
}

#[derive(Default)]
struct ImportState {
    pending: Option<PendingImportEnvelope>,
}

type SharedImportState = Arc<Mutex<ImportState>>;

#[tauri::command]
fn get_pending_import(state: State<SharedImportState>) -> Option<PendingImportEnvelope> {
    let guard = state.lock().ok()?;
    guard.pending.clone()
}

#[tauri::command]
fn clear_pending_import(state: State<SharedImportState>) -> bool {
    if let Ok(mut guard) = state.lock() {
        guard.pending = None;
        return true;
    }
    false
}

fn now_timestamp_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    now.as_millis() as i64
}

fn json_response(status: u16, body: Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let bytes = serde_json::to_vec(&body).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
    let mut response = Response::from_data(bytes).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes("Content-Type", "application/json; charset=utf-8") {
        response.add_header(header);
    }
    if let Ok(header) = Header::from_bytes("Access-Control-Allow-Origin", "*") {
        response.add_header(header);
    }
    if let Ok(header) = Header::from_bytes("Access-Control-Allow-Headers", "Content-Type") {
        response.add_header(header);
    }
    if let Ok(header) = Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS") {
        response.add_header(header);
    }
    response
}

fn image_response(
    status: u16,
    data: Vec<u8>,
    content_type: &str,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_data(data).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes("Content-Type", content_type) {
        response.add_header(header);
    }
    if let Ok(header) = Header::from_bytes("Access-Control-Allow-Origin", "*") {
        response.add_header(header);
    }
    if let Ok(header) = Header::from_bytes("Cache-Control", "public, max-age=2592000") {
        response.add_header(header);
    }
    response
}

fn get_cache_dir() -> Option<PathBuf> {
    let data_dir = dirs::data_dir()?;
    let cache_dir = data_dir.join("Nexus-Tauri").join("image-cache");
    fs::create_dir_all(&cache_dir).ok()?;
    Some(cache_dir)
}

fn get_cache_path(url: &str) -> Option<PathBuf> {
    let cache_dir = get_cache_dir()?;
    let hash = format!("{:x}", md5::compute(url.as_bytes()));
    Some(cache_dir.join(hash))
}

fn is_cache_valid(path: &PathBuf, max_age_days: u64) -> bool {
    if let Ok(metadata) = fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = SystemTime::now().duration_since(modified) {
                return elapsed.as_secs() < max_age_days * 24 * 3600;
            }
        }
    }
    false
}

fn download_image(url: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let client = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(10))
        .build();

    let response = client
        .get(url)
        .set("Referer", "https://www.nautiljon.com/")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .call()?;

    let mut bytes = Vec::new();
    response.into_reader().read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn clean_expired_cache(max_age_days: u64) {
    if let Some(cache_dir) = get_cache_dir() {
        if let Ok(entries) = fs::read_dir(&cache_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !is_cache_valid(&path, max_age_days) {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
}

fn read_json_body(request: &mut tiny_http::Request) -> Value {
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);
    serde_json::from_str::<Value>(&body).unwrap_or_else(|_| json!({}))
}

fn emit_progress(app: &AppHandle, status: &str, message: &str) {
    let _ = app.emit(
        "nautiljon-import-progress",
        json!({
            "status": status,
            "message": message,
            "at": now_timestamp_ms(),
        }),
    );
}

fn start_local_import_server(app: AppHandle, state: SharedImportState) {
    thread::spawn(move || {
        let server = match Server::http("127.0.0.1:40000") {
            Ok(s) => s,
            Err(_) => {
                let _ = app.emit(
                    "nautiljon-import-progress",
                    json!({
                        "status": "error",
                        "message": "Impossible de démarrer le serveur local d'import (port 40000)."
                    }),
                );
                return;
            }
        };

        for mut request in server.incoming_requests() {
            let url = request.url().to_string();
            let method = request.method().clone();

            if method == Method::Options {
                let _ = request.respond(json_response(200, json!({ "ok": true })));
                continue;
            }

            // Route GET pour proxy d'images
            if method == Method::Get && url.starts_with("/api/proxy-image") {
                if let Some(query_start) = url.find('?') {
                    let query = &url[query_start + 1..];
                    let params: HashMap<String, String> = query
                        .split('&')
                        .filter_map(|pair| {
                            let mut parts = pair.splitn(2, '=');
                            Some((parts.next()?.to_string(), parts.next()?.to_string()))
                        })
                        .collect();

                    if let Some(image_url) = params.get("url") {
                        let decoded_url = urlencoding::decode(image_url).unwrap_or_default();

                        // Vérifier le cache
                        if let Some(cache_path) = get_cache_path(&decoded_url) {
                            if is_cache_valid(&cache_path, 30) {
                                if let Ok(cached_data) = fs::read(&cache_path) {
                                    let content_type = if decoded_url.ends_with(".webp") {
                                        "image/webp"
                                    } else if decoded_url.ends_with(".jpg")
                                        || decoded_url.ends_with(".jpeg")
                                    {
                                        "image/jpeg"
                                    } else if decoded_url.ends_with(".png") {
                                        "image/png"
                                    } else {
                                        "image/webp"
                                    };
                                    let _ = request.respond(image_response(
                                        200,
                                        cached_data,
                                        content_type,
                                    ));
                                    continue;
                                }
                            }
                        }

                        // Télécharger depuis Nautiljon
                        match download_image(&decoded_url) {
                            Ok(image_data) => {
                                // Sauvegarder en cache
                                if let Some(cache_path) = get_cache_path(&decoded_url) {
                                    let _ = fs::write(&cache_path, &image_data);
                                }

                                let content_type = if decoded_url.ends_with(".webp") {
                                    "image/webp"
                                } else if decoded_url.ends_with(".jpg")
                                    || decoded_url.ends_with(".jpeg")
                                {
                                    "image/jpeg"
                                } else if decoded_url.ends_with(".png") {
                                    "image/png"
                                } else {
                                    "image/webp"
                                };

                                let _ =
                                    request.respond(image_response(200, image_data, content_type));
                            }
                            Err(e) => {
                                eprintln!("Erreur téléchargement image: {}", e);
                                let _ = request.respond(json_response(
                                    500,
                                    json!({ "ok": false, "error": format!("Download failed: {}", e) }),
                                ));
                            }
                        }
                        continue;
                    }
                }

                let _ = request.respond(json_response(
                    400,
                    json!({ "ok": false, "error": "Missing url parameter" }),
                ));
                continue;
            }

            if method != Method::Post {
                let _ = request.respond(json_response(
                    405,
                    json!({ "ok": false, "error": "Method not allowed" }),
                ));
                continue;
            }

            match url.as_str() {
                "/api/import-start" => {
                    emit_progress(&app, "receiving", "Réception des données Nautiljon en cours…");
                    let _ = request.respond(json_response(200, json!({ "ok": true })));
                }
                "/api/import-cancel" => {
                    if let Ok(mut guard) = state.lock() {
                        guard.pending = None;
                    }
                    emit_progress(&app, "cancelled", "Import Nautiljon annulé.");
                    let _ = request.respond(json_response(200, json!({ "ok": true })));
                }
                "/api/import-manga" | "/api/import-tomes-only" => {
                    let body = read_json_body(&mut request);
                    let mode = if url == "/api/import-tomes-only" {
                        "tomes_only"
                    } else {
                        "full"
                    };
                    let envelope = PendingImportEnvelope {
                        kind: "reading".to_string(),
                        mode: mode.to_string(),
                        payload: body.clone(),
                        received_at: now_timestamp_ms(),
                    };
                    if let Ok(mut guard) = state.lock() {
                        guard.pending = Some(envelope.clone());
                    }
                    let title = body
                        .get("titre")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Entrée inconnue");
                    emit_progress(
                        &app,
                        "awaiting_selection",
                        &format!("Données reçues pour \"{}\". Sélectionne la fiche cible dans l'application.", title),
                    );
                    let _ = app.emit("nautiljon-import-pending", envelope);
                    let _ = request.respond(json_response(
                        200,
                        json!({
                            "ok": true,
                            "queued": true,
                            "message": "Données reçues. Validation requise dans l'application."
                        }),
                    ));
                }
                "/api/import-anime" => {
                    let _ = request.respond(json_response(
                        200,
                        json!({
                            "ok": true,
                            "queued": false,
                            "message": "Import anime ignoré dans cette version (mode lectures uniquement)."
                        }),
                    ));
                }
                _ => {
                    let _ = request.respond(json_response(
                        404,
                        json!({ "ok": false, "error": "Route inconnue" }),
                    ));
                }
            }
        }
    });
}

fn main() {
    // Nettoyer le cache au démarrage (supprimer images > 30 jours)
    clean_expired_cache(30);

    let import_state: SharedImportState = Arc::new(Mutex::new(ImportState::default()));
    tauri::Builder::default()
        .manage(import_state.clone())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_pending_import, clear_pending_import])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            start_local_import_server(app_handle, import_state.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de Tauri");
}
