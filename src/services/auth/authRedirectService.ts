const AUTH_DEEP_LINK_SCHEME = "nexus";
const PENDING_AUTH_DEEP_LINK_KEY = "nexus:auth:pending-deep-link";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getAuthRedirectUrl(): string {
  if (isTauriRuntime()) {
    return `${AUTH_DEEP_LINK_SCHEME}://auth-callback`;
  }
  return `${window.location.origin}/#/auth/callback`;
}

export function storePendingAuthDeepLink(url: string): void {
  try {
    sessionStorage.setItem(PENDING_AUTH_DEEP_LINK_KEY, url);
  } catch {
    // Ignore if storage is unavailable.
  }
}

export function consumePendingAuthDeepLink(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_AUTH_DEEP_LINK_KEY);
    sessionStorage.removeItem(PENDING_AUTH_DEEP_LINK_KEY);
    return raw;
  } catch {
    return null;
  }
}

export async function initTauriAuthDeepLinks(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");

    const processUrls = (urls: unknown[]) => {
      const first = urls[0];
      if (!first) {
        return;
      }
      const normalized =
        typeof first === "string"
          ? first
          : first && typeof first === "object" && "href" in first
            ? String((first as { href: string }).href)
            : String(first);
      storePendingAuthDeepLink(normalized);
      window.location.hash = "/auth/callback";
    };

    const initial = await getCurrent();
    if (initial?.length) {
      processUrls(initial);
    }

    await onOpenUrl((urls) => processUrls(urls));
  } catch {
    // Deep link plugin unavailable outside bundle Tauri.
  }
}
