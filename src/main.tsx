import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { LoadingScreen } from "@/components/LoadingScreen";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// ---- Vly-provided integrations are for the Freebuff preview host only. ----
// On a standalone deploy (Vercel, Netlify, …) these env vars are absent and
// the toolbar overlay is unavailable. The app still works fully there.
//
// VlyToolbar is kept in the tree unconditionally because the file is bundled
// and the component itself gates all of its behaviour behind runtime host
// checks (it only activates on the Freebuff preview host). When those checks
// fail it renders a no-op, so nothing crashes on a direct deploy.
const VLY_INTEGRATIONS_ENABLED =
  !!import.meta.env.VITE_VLY_APP_ID &&
  !!import.meta.env.VITE_VLY_MONITORING_URL;

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Route-level loading: the immersive branded screen while lazy chunks arrive.
function RouteLoading() {
  return <LoadingScreen />;
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Fades out and removes the first-paint boot overlay (index.html) once
 *  React has actually mounted. Runs first in the tree so the overlay never
 *  outlives the app — even if the root later renders an error boundary. */
function DismissBoot() {
  useEffect(() => {
    const boot = document.getElementById("boot");
    if (!boot) return;
    boot.classList.add("boot-fade");
    const t = setTimeout(() => boot.remove(), 500);
    return () => clearTimeout(t);
  }, []);
  return null;
}



function RouteSyncer() {
  const location = useLocation();

  useEffect(() => {
    // Only talk to a parent frame when we are actually embedded (Freebuff
    // preview). On a straight Vercel deploy window.parent === window, so
    // this is a no-op and never throws.
    try {
      if (window.parent === window) return;
      window.parent.postMessage(
        { type: "iframe-route-change", path: location.pathname },
        "*",
      );
    } catch {
      // Cross-origin restriction on the parent: not our problem.
    }
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DismissBoot />
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <BrowserRouter>
        <RouteSyncer />
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route
              path="/auth"
              element={<AuthPage redirectAfterAuth="/dashboard" />}
            />
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <Dashboard />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <Toaster />
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
);
