import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { consumePendingAuthDeepLink } from "@/services/auth/authRedirectService";
import "@/pages/auth/authFlow/AuthFlowPage.css";

function extractParams(rawUrl: string): URLSearchParams {
  const hashIndex = rawUrl.indexOf("#");
  if (hashIndex >= 0) {
    return new URLSearchParams(rawUrl.slice(hashIndex + 1));
  }
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex >= 0) {
    return new URLSearchParams(rawUrl.slice(queryIndex + 1));
  }
  return new URLSearchParams();
}

type CallbackState = {
  status: "loading" | "success" | "error";
  message: string;
};

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>({
    status: "loading",
    message: "Validation du lien en cours…",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const raw = consumePendingAuthDeepLink() ?? window.location.href;
        const params = extractParams(raw);
        const type = params.get("type");
        const code = params.get("code");
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            throw new Error(error.message);
          }
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            throw new Error(error.message);
          }
        } else {
          throw new Error("Lien invalide ou expiré.");
        }

        if (cancelled) {
          return;
        }
        if (type === "recovery") {
          navigate("/auth/reset-password", { replace: true });
          return;
        }
        setState({
          status: "success",
          message: "Email confirmé. Tu peux maintenant utiliser l'application.",
        });
        window.setTimeout(() => navigate("/", { replace: true }), 900);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Erreur de validation du lien.";
        setState({ status: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="auth-flow-page">
      <div className="auth-flow-card">
        <h1 className="auth-flow-title">Validation du compte</h1>
        <p
          className={
            state.status === "error"
              ? "auth-flow-error"
              : state.status === "success"
                ? "auth-flow-success"
                : "auth-flow-message"
          }
        >
          {state.message}
        </p>
        {state.status === "error" ? <Link to="/login">Retour connexion</Link> : null}
      </div>
    </div>
  );
}
