import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  CookingPot,
  Scale,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router";
import logo from "@/assets/logo.svg";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
};

const STEPS = [
  {
    icon: Users,
    title: "Describe your table",
    body: "Who eats from the shared pot — a father, a pregnant mother, a teenage daughter — and each person's share.",
  },
  {
    icon: CookingPot,
    title: "Show a usual day of cooking",
    body: "The pot as it is: rice-dominant, dal once a day, some vegetables and milk. Local prices included.",
  },
  {
    icon: Sparkles,
    title: "Get the smallest change",
    body: "A short list of add / increase / reduce changes that closes every member's gaps within budget — or an honest word if food alone can't.",
  },
];

export default function Landing() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="flex min-h-screen flex-col"
    >
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="PlateFix logo" className="size-8 text-primary" />
            <span className="text-xl font-bold tracking-tight">PlateFix</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#problem" className="transition-colors hover:text-foreground">The problem</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#honest" className="transition-colors hover:text-foreground">Honest math</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/dashboard">
                Fix my pot
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-2 lg:items-center lg:pb-24 lg:pt-20">
          <div>
            <Badge variant="outline" className="mb-4 gap-1.5 border-primary/40 bg-primary/5 text-primary">
              <Sparkles className="size-3" />
              EurekaDev · Problem in the Community
            </Badge>
            <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
              The smallest change that{" "}
              <span className="text-primary">fixes the family pot</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              PlateFix finds the cheapest, smallest change to a family&apos;s shared meals that
              covers what each member is missing — and says so plainly when food alone can&apos;t.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="gap-2">
                <Link to="/dashboard">
                  Try the demo household
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/auth">Create a free account</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Browser-only · free · built for real families on real budgets
            </p>
          </div>

          {/* Hero visual: gap → fix card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6 }}
            className="relative"
          >
            <Card className="border-border/70 shadow-lg shadow-primary/5">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Ananya · 14, girl</p>
                  <Badge variant="destructive" className="text-[10px]">3 gaps</Badge>
                </div>
                {[
                  { label: "Iron", got: 62, rda: 27, pct: 62 },
                  { label: "Folate", got: 71, rda: 300, pct: 71 },
                  { label: "Calcium", got: 78, rda: 850, pct: 78 },
                ].map((n) => (
                  <div key={n.label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{n.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {n.pct}% of RDA
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${n.pct >= 100 ? "bg-emerald-600" : n.pct >= 75 ? "bg-amber-500" : "bg-orange-500"}`}
                        style={{ width: `${n.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
                <div className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 p-3 text-xs leading-5">
                  <p className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="size-3.5" />
                    The fix: 3 changes, about ₹18 more per day
                  </p>
                  <p className="mt-1 text-emerald-800/80 dark:text-emerald-300/80">
                    +150 g spinach · +100 g curd · rice ↓ 100 g
                  </p>
                </div>
              </CardContent>
            </Card>
            <div className="absolute -right-4 -top-4 rotate-6 rounded-xl border border-border/70 bg-card px-3 py-1.5 text-xs font-semibold shadow-md">
              red → green in 25 seconds
            </div>
          </motion.div>
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className="border-y border-border/60 bg-secondary/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <motion.div {...fadeUp}>
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">
              The problem
            </p>
            <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight">
              The shared pot feeds the average — not the person with the highest need
            </h2>
          </motion.div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Scale,
                stat: "~2.7 billion",
                claim: "people — roughly 1 in 3 — can't afford a healthy diet (FAO SOFI 2026).",
              },
              {
                icon: ShieldAlert,
                stat: "Invisible at home",
                claim:
                  "the member with the highest need per calorie — often a teenage girl for iron — sets the floor for the whole pot, and averages hide her.",
              },
              {
                icon: CookingPot,
                stat: "Tools miss the point",
                claim:
                  "trackers list gaps but don't say what to change; cost optimizers produce diets nobody would actually eat.",
              },
            ].map((c) => (
              <motion.div key={c.stat} {...fadeUp}>
                <Card className="h-full border-border/70 shadow-none">
                  <CardContent className="p-5">
                    <c.icon className="size-5 text-primary" />
                    <p className="mt-3 text-xl font-bold tracking-tight">{c.stat}</p>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{c.claim}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
          <motion.p {...fadeUp} className="mt-6 text-xs text-muted-foreground">
            Statistics are stated only where verified against a primary source; see the README for
            citations. Anaemia figures are pending re-verification and deliberately not shown.
          </motion.p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <motion.div {...fadeUp}>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            How it works
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">
            From a usual day of cooking to a fix, in three steps
          </h2>
        </motion.div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.div key={s.title} {...fadeUp} transition={{ delay: i * 0.08 }}>
              <Card className="h-full border-border/70 shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
                      <s.icon className="size-5 text-primary" />
                    </span>
                    <span className="text-sm font-bold text-muted-foreground">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{s.body}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
        <motion.div {...fadeUp} className="mt-8 text-center">
          <Button asChild size="lg" className="gap-2">
            <Link to="/dashboard">
              See the minimum-change plan live
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </motion.div>
      </section>

      {/* Honest math */}
      <section id="honest" className="border-t border-border/60 bg-secondary/40">
        <div className="mx-auto w-full max-w-4xl px-4 py-16 text-center sm:px-6">
          <motion.div {...fadeUp}>
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">
              Honest math
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              If food alone can&apos;t close a gap, we say so
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              PlateFix runs a tested minimum-change solver (linear programming in the browser).
              When a gap can&apos;t be closed by food within budget, it reports the shortfall and
              the limiting member — instead of faking a fix with an unrecognizable diet.
            </p>
            <div className="mt-8">
              <Button asChild size="lg" className="gap-2">
                <Link to="/dashboard">
                  Open PlateFix
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p className="flex items-center gap-1.5">
            <img src={logo} alt="" className="size-4 text-primary" />
            PlateFix. Not medical advice.
          </p>
          <p>
            Data: ICMR-NIN IFCT 2017 · ICMR-NIN RDA 2020 · dated local market snapshot
          </p>
        </div>
      </footer>
    </motion.div>
  );
}
