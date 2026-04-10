import { User } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { createAvatarSignedUrl } from "@/services/storage/avatarStorage";
import "./ProfileAvatarImage.css";

type ProfileAvatarImageProps = {
  /** Chemin dans le bucket `avatars` (ex. uuid/avatar.webp). */
  storagePath: string | null | undefined;
  displayName: string;
  size?: number;
  className?: string;
  /** Incrémenter après un nouvel upload (même chemin) pour régénérer l’URL signée et éviter le cache. */
  revision?: number;
};

/**
 * Avatar avec URL signée (bucket privé + RLS famille).
 */
export function ProfileAvatarImage({
  storagePath,
  displayName,
  size = 48,
  className = "",
  revision = 0,
}: ProfileAvatarImageProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!storagePath?.trim()) {
      setSrc(null);
      return;
    }
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const r = await createAvatarSignedUrl(supabase, storagePath, 3600);
        if (!cancelled && r.ok) {
          setSrc(r.url);
        } else if (!cancelled) {
          setSrc(null);
        }
      } catch {
        if (!cancelled) {
          setSrc(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storagePath, revision]);

  const dim = { width: size, height: size };

  if (!src) {
    return (
      <div
        className={`profile-avatar-fallback ${className}`.trim()}
        style={dim}
        aria-hidden
      >
        <User size={Math.round(size * 0.55)} strokeWidth={1.75} />
      </div>
    );
  }

  return (
    <img
      key={`${storagePath}-${revision}`}
      className={`profile-avatar-img ${className}`.trim()}
      src={src}
      alt=""
      width={size}
      height={size}
      title={displayName}
      decoding="async"
    />
  );
}
