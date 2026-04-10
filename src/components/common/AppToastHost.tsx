import { useEffect, useState } from "react";
import { NEXUS_TOAST_EVENT, type NexusToastPayload } from "@/lib/toastEvents";
import "./AppToastHost.css";

type ToastState = Required<NexusToastPayload> & { id: number };

export function AppToastHost() {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  useEffect(() => {
    function onToast(event: Event) {
      const custom = event as CustomEvent<NexusToastPayload>;
      const payload = custom.detail;
      if (!payload?.message?.trim()) {
        return;
      }
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const next: ToastState = {
        id,
        message: payload.message.trim(),
        kind: payload.kind ?? "info",
        durationMs: payload.durationMs ?? 3200,
      };
      setToasts((prev) => [...prev, next]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, next.durationMs);
    }
    window.addEventListener(NEXUS_TOAST_EVENT, onToast as EventListener);
    return () => window.removeEventListener(NEXUS_TOAST_EVENT, onToast as EventListener);
  }, []);

  return (
    <div className="app-toast-host" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`app-toast app-toast-${toast.kind}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
