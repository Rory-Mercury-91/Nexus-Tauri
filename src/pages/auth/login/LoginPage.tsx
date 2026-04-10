import { useNavigate } from "react-router-dom";
import { AuthPanel } from "@/features/auth/AuthPanel/AuthPanel";
import "./LoginPage.css";

/**
 * Route plein écran : même panneau que la modale.
 */
export function LoginPage() {
  const navigate = useNavigate();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <AuthPanel
          initialTab="login"
          onSuccess={() => navigate("/", { replace: true })}
        />
      </div>
    </div>
  );
}
