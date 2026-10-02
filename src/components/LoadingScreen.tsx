import { AnimatePresence, motion } from "framer-motion";
import { CookingPot } from "lucide-react";
import { useEffect, useState } from "react";

// Immersive loading screen — PlateFix design system: Basil/Saffron/Flour,
// Manrope display, and motion that (this once) is ambient, because a waiting
// user needs proof something is happening: a steaming pot, gaps filling one
// nutrient at a time, and a status line that speaks in the product's voice.

const DEFAULT_LABELS = [
  "reading your household…",
  "recomputing every gap…",
  "solving for the smallest change…",
];

const BARS = [
  { label: "Iron", delay: 0 },
  { label: "Calcium", delay: 0.35 },
  { label: "Folate", delay: 0.7 },
];

export function LoadingScreen({
  label,
  labels = DEFAULT_LABELS,
}: {
  /** Fixed status line. Omit to cycle through the product-voice labels. */
  label?: string;
  labels?: string[];
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (label) return;
    const t = setInterval(() => setI((v) => (v + 1) % labels.length), 1800);
    return () => clearInterval(t);
  }, [label, labels]);

  return (
    <main
      role="status"
      aria-busy="true"
      className="flex min-h-screen flex-col items-center justify-center gap-7 px-6 text-center"
    >
      <span className="sr-only">PlateFix is loading</span>

      {/* Steaming pot */}
      <div className="relative">
        {[0, 1, 2].map((n) => (
          <motion.span
            key={n}
            aria-hidden
            className="absolute -top-5 left-1/2 h-5 w-1 -translate-x-1/2 rounded-full bg-primary/40"
            style={{ marginLeft: (n - 1) * 14 }}
            animate={{ opacity: [0.15, 0.7, 0.15], y: [0, -8, 0], scaleY: [0.8, 1.25, 0.8] }}
            transition={{ duration: 2.2, repeat: Infinity, delay: n * 0.5, ease: "easeInOut" }}
          />
        ))}
        <motion.div
          className="flex size-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10"
          animate={{ rotate: [0, -3, 3, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <CookingPot className="size-8 text-primary" />
        </motion.div>
      </div>

      {/* Wordmark */}
      <div className="space-y-1">
        <p className="font-display text-xl font-extrabold tracking-tight">PlateFix</p>
        <p className="text-sm text-muted-foreground">
          finding the smallest fix for your plate
        </p>
      </div>

      {/* Gaps filling, one nutrient at a time */}
      <div className="w-56 space-y-2.5">
        {BARS.map((b) => (
          <div key={b.label} className="space-y-1">
            <p className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {b.label}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: "0%" }}
                animate={{ width: ["0%", "100%"] }}
                transition={{
                  duration: 1.3,
                  repeat: Infinity,
                  repeatDelay: 2.1,
                  delay: b.delay,
                  ease: "easeOut",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Cycling status line, in the product's voice */}
      <div className="h-5 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.p
            key={label ?? i}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="text-xs text-muted-foreground"
          >
            {label ?? labels[i]}
          </motion.p>
        </AnimatePresence>
      </div>
    </main>
  );
}
