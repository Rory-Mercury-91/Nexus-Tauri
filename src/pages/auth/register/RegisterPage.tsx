import { useNavigate } from "react-router-dom";
import { AuthPanel } from "@/features/auth/AuthPanel/AuthPanel";
import "./RegisterPage.css";

/**
 * Route plein écran : même panneau que la modale.
 */
export function RegisterPage() {
  const navigate = useNavigate();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <AuthPanel
          initialTab="register"
          onSuccess={() => navigate("/", { replace: true })}
        />
      </div>
    </div>
  );
}
