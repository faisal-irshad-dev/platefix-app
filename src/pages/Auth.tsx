// Simple landing page that redirects to the dashboard.
// The app runs in guest mode — no sign-in required for pure Vercel deploy.
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { CookingPot } from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.svg";

interface AuthProps {
  redirectAfterAuth?: string;
}

export default function AuthPage({ redirectAfterAuth }: AuthProps = {}) {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect immediately to the dashboard — no auth gate.
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <img
          src={logo}
          alt="PlateFix logo"
          width={64}
          height={64}
          className="text-primary"
        />
        <div className="flex items-center gap-2 text-primary">
          <CookingPot className="size-5" />
          <span className="text-xl font-bold">PlateFix</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Redirecting to your household&hellip;
        </p>
        <Button
          variant="outline"
          onClick={() => navigate("/dashboard")}
        >
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
