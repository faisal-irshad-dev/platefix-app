// Allow access to the dashboard without authentication.
// The app runs in guest mode — no sign-in required for pure Vercel deploy.
import type { ReactNode } from "react";

export function RequireAuth({ children }: { children: ReactNode }) {
  return children;
}
