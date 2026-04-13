export async function downloadImageToDownloads(
  imageUrl: string,
  fileName?: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const url = imageUrl.trim();
  if (!url) {
    return { ok: false, error: "URL d'image vide." };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string>("save_image_to_downloads", {
      url,
      fileName: fileName?.trim() || null,
    });
    return { ok: true, path };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Téléchargement indisponible hors environnement Tauri.",
    };
  }
}
