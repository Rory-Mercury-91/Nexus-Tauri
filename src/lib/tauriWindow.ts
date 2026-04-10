/**
 * Actions fenêtre Tauri (no-op dans le navigateur pur).
 */
export async function minimizeMainWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  } catch {
    /* hors bundle Tauri */
  }
}

export async function closeMainWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } catch {
    /* hors bundle Tauri */
  }
}

/**
 * Ouvre une URL dans le navigateur système (Tauri shell plugin).
 * Retourne false si indisponible hors contexte Tauri.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("plugin:shell|open", { path: url });
    return true;
  } catch {
    return false;
  }
}
