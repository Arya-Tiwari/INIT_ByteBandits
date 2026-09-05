import { useEffect, useState } from "react";
import {
  Activity,
  BriefcaseBusiness,
  FlaskConical,
  ListChecks,
  Menu,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api } from "./api";
import { Button } from "./components/ui/button";
import {
  OptimizationPage,
  OverviewPage,
  PortfolioPage,
  RecommendationsPage,
  RiskPage,
  type DecisionEvent,
  type PageKey,
} from "./ReportPages";
import RiskLab from "./RiskLab";
import type { Limits, Portfolio, PortfolioUpdate, Rebalance, Risk, Scenario, Simulation } from "./types";

const money = (value: number) => `₹${(value / 1e7).toFixed(2)} Cr`;

const pageNames: Record<PageKey, string> = {
  home: "",
  portfolio: "Portfolio",
  risk: "Risk Firewall",
  optimize: "Portfolio Optimization",
  simulation: "Simulation",
  rebalance: "Rebalance",
};

const navigation: { page: PageKey; label: string; icon: typeof Activity }[] = [
  { page: "home", label: "Home", icon: Activity },
  { page: "portfolio", label: "Portfolio", icon: BriefcaseBusiness },
  { page: "risk", label: "Risk", icon: ShieldAlert },
  { page: "optimize", label: "Optimize", icon: SlidersHorizontal },
  { page: "simulation", label: "Simulation", icon: FlaskConical },
  { page: "rebalance", label: "Rebalance", icon: ListChecks },
];

function AegisMark({ size = 30 }: { size?: number }) {
  return <svg className="aegis-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true"><path d="M7 31 18.2 7h3.6L33 31h-6.1l-2.2-5.4h-9.8L12.7 31H7Z" /><path d="M17.1 20.2h5.8L20 12.8l-2.9 7.4Z" /><path d="M12.8 33.5h14.4" /></svg>;
}

function getIstTimeStr(date = new Date()) {
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

function getIstDateStr(date = new Date()) {
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).toUpperCase();
}

export default function App({ initialPage = "home" }: { initialPage?: PageKey }) {
  const [page, setPage] = useState<PageKey>(initialPage);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  function navigate(target: PageKey) {
    setPage(target);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    const targetFile = target === "home" ? "index.html" : `${target}.html`;
    const curPath = window.location.pathname.toLowerCase();
    if (!curPath.endsWith(targetFile) && !curPath.endsWith(`/${target}`)) {
      window.location.href = `/${targetFile}`;
    }
  }

  const currentDateStr = getIstDateStr(now);
  const currentIstTimeStr = getIstTimeStr(now);

  const [portfolio, setPortfolio] = useState<Portfolio>();
  const [risk, setRisk] = useState<Risk>();
  const [limits, setLimits] = useState<Limits>();
  const [appetites, setAppetites] = useState<Record<string, Limits>>({});
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [proposal, setProposal] = useState<Rebalance>();
  const [activeSimulation, setActiveSimulation] = useState<Simulation | undefined>(() => {
    try {
      const raw = sessionStorage.getItem("aegis_active_simulation");
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  });
  const [stressProposal, setStressProposal] = useState<Rebalance>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<string>(() => getIstTimeStr());
  const [events, setEvents] = useState<DecisionEvent[]>(() => {
    try {
      const raw = sessionStorage.getItem("aegis_events");
      return raw ? JSON.parse(raw) : [{ title: "Baseline portfolio reviewed", detail: "Risk Firewall identified the current policy breaches.", time: getIstTimeStr() }];
    } catch {
      return [{ title: "Baseline portfolio reviewed", detail: "Risk Firewall identified the current policy breaches.", time: getIstTimeStr() }];
    }
  });

  useEffect(() => {
    try {
      if (activeSimulation) {
        sessionStorage.setItem("aegis_active_simulation", JSON.stringify(activeSimulation));
      } else {
        sessionStorage.removeItem("aegis_active_simulation");
      }
    } catch {}
  }, [activeSimulation]);

  useEffect(() => {
    try {
      sessionStorage.setItem("aegis_events", JSON.stringify(events));
    } catch {}
  }, [events]);

  function recordEvent(title: string, detail: string) {
    const time = getIstTimeStr();
    setLastAnalysis(time);
    setEvents((current) => [{ title, detail, time }, ...current].slice(0, 8));
  }

  async function runOptimization() {
    setOptimizing(true);
    try {
      if (activeSimulation) {
        const next = await api<Rebalance>(`/simulate/${activeSimulation.simulationId}/rebalance`, {});
        setStressProposal(next);
        recordEvent("Stress optimization completed", `${activeSimulation.scenarioName} was rebalanced from its stressed holdings and rechecked by the Risk Firewall.`);
      } else {
        setProposal(await api<Rebalance>("/optimize", {}));
        recordEvent("Optimization completed", "A funded target allocation was rechecked by the Risk Firewall.");
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setOptimizing(false);
    }
  }

  async function resetDemo() {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ status: string; message: string; portfolio: Portfolio; limits: Limits }>("/reset", {});
      setPortfolio(res.portfolio);
      setActiveSimulation(undefined);
      setStressProposal(undefined);
      setLimits(res.limits);
      setRisk(await api<Risk>("/risk"));
      setScenarios(await api<Scenario[]>("/simulations"));
      try {
        setProposal(await api<Rebalance>("/optimize", {}));
      } catch {
        setProposal(undefined);
      }
      recordEvent("Demo reset", "Portfolio, controls and simulation state were restored to the original AEGIS baseline.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    setBusy(true);
    setError("");
    try {
      const [nextPortfolio, nextRisk, nextLimits, nextScenarios, nextAppetites] = await Promise.all([
        api<Portfolio>("/portfolio"),
        api<Risk>("/risk"),
        api<Limits>("/risk/limits"),
        api<Scenario[]>("/simulations"),
        api<Record<string, Limits>>("/risk/appetites").catch(() => ({})),
      ]);
      setPortfolio(nextPortfolio);
      setRisk(nextRisk);
      setLimits(nextLimits);
      setScenarios(nextScenarios);
      setAppetites(nextAppetites);
      setActiveSimulation(undefined);
      setStressProposal(undefined);
      setLastAnalysis(new Date().toLocaleTimeString("en-IN", { hour12: false }));
      try {
        setProposal(await api<Rebalance>("/optimize", {}));
      } catch {
        setProposal(undefined);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);

  async function saveLimits(nextLimits: Limits) {
    setBusy(true);
    setError("");
    try {
      const saved = await api<Limits>("/risk/limits", nextLimits);
      setLimits(saved);
      setActiveSimulation(undefined);
      setStressProposal(undefined);
      setRisk(await api<Risk>("/risk"));
      setProposal(await api<Rebalance>("/optimize", {}));
      recordEvent("Risk controls updated", "Portfolio metrics and the optimizer were recalculated under the new limits.");
    } catch (cause) {
      setError((cause as Error).message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function savePortfolio(payload: PortfolioUpdate) {
    setBusy(true);
    setError("");
    try {
      const updated = await api<Portfolio>("/portfolio", payload);
      setPortfolio(updated);
      setActiveSimulation(undefined);
      setStressProposal(undefined);
      const [nextRisk, nextScenarios, nextProposal] = await Promise.all([
        api<Risk>("/risk"),
        api<Scenario[]>("/simulations"),
        api<Rebalance>("/optimize", {}),
      ]);
      setRisk(nextRisk);
      setScenarios(nextScenarios);
      setProposal(nextProposal);
      recordEvent("Portfolio updated", "AEGIS recalculated risk, scenarios and the funded target allocation.");
    } catch (cause) {
      setError((cause as Error).message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  const breachCount = risk?.controls.filter((control) => control.status === "BREACH").length ?? 0;

  return (
    <div className="app">
      <button className={`sidebar-toggle ${sidebarOpen ? "is-open" : ""}`} aria-label="Open navigation" aria-expanded={sidebarOpen} aria-controls="primary-navigation" onClick={() => setSidebarOpen(true)}>
        <Menu size={23} />
      </button>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside id="primary-navigation" className={sidebarOpen ? "open" : ""} aria-hidden={!sidebarOpen}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate("home"); }}>
          <AegisMark />
          <span>AEGIS<small>The Capital Compass</small></span>
        </a>
        <button className="sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={21} /></button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navigation.map(({ page: item, label, icon: Icon }) => (
            <button key={item} className={page === item ? "active" : ""} onClick={() => navigate(item)}><Icon size={19} />{label}</button>
          ))}
        </nav>
        <div className="sidebar-foot"><span className="dot" />ENGINE STATUS · ACTIVE<p>LAST ANALYSIS · {lastAnalysis}</p></div>
      </aside>

      <main>
        <header>
          <div className="header-context"><strong>{pageNames[page]}</strong><span>PORTFOLIO / AEG-001</span></div>
          <div className="header-actions"><span className="as-of">AS OF {currentDateStr} · {currentIstTimeStr} IST</span><Button className="run-analysis" disabled={busy} onClick={() => void load()}><RefreshCw size={15} />Run analysis</Button></div>
        </header>
        <div className="control-status">
          <span><i className="status-led safe" /> HISTORICAL DATA · {portfolio?.historyObservations ?? 756} OBS</span>
          <span><i className="status-led safe" /> CONTROL ENGINE · ACTIVE</span>
          <span><i className={`status-led ${breachCount ? "breach" : "safe"}`} /> {breachCount} BREACHES DETECTED</span>
        </div>

        <div className="content">
          {error && <div role="alert" className="error">{error} <Button variant="outline" onClick={() => void load()}><RefreshCw size={16} />Retry connection</Button></div>}
          {!portfolio || !risk || !limits ? (
            <section className="loading-report">{error ? "Start the local backend on port 8000, then retry." : "Loading portfolio and risk calculations…"}</section>
          ) : (
            <>
              <div hidden={page !== "home"}><OverviewPage portfolio={portfolio} risk={risk} proposal={proposal} events={events} navigate={navigate} /></div>
              <div hidden={page !== "portfolio"}><PortfolioPage portfolio={portfolio} proposal={proposal} busy={busy} save={savePortfolio} onReset={resetDemo} onRecordEvent={recordEvent} onReload={load} /></div>
              <div hidden={page !== "risk"}><RiskPage risk={risk} limits={limits} appetites={appetites} busy={busy} save={saveLimits} /></div>
              <div hidden={page !== "optimize"}><OptimizationPage portfolio={portfolio} risk={risk} proposal={activeSimulation ? stressProposal : proposal} simulation={activeSimulation} busy={optimizing} run={() => void runOptimization()} navigate={navigate} /></div>
              <div hidden={page !== "rebalance"}><RecommendationsPage portfolio={portfolio} risk={risk} proposal={activeSimulation ? stressProposal : proposal} simulation={activeSimulation} navigate={navigate} /></div>
              <div hidden={page !== "simulation"}>
                  <div className="page-title simulation-title">
                    <div><h1>Scenario &amp; Optimisation Review</h1><p>Shock the holdings. Trace the breaches. Test a funded response.</p></div>
                    <div className="capital"><span>Current portfolio value</span><strong>{money(portfolio.totalValue)}</strong><small>{portfolio.assets.length} assets · {new Set(portfolio.assets.map((asset) => asset.assetClass)).size} asset classes</small></div>
                  </div>
                  <div id="stress-lab"><RiskLab portfolio={portfolio} scenarios={scenarios} onEvent={recordEvent} onSimulation={(result) => { setActiveSimulation(result); setStressProposal(undefined); }} onProposal={setStressProposal} /></div>
              </div>
            </>
          )}
          <footer>AEGIS · Capital Compass<span>{portfolio?.historyObservations ?? 756} daily observations</span></footer>
        </div>
      </main>
    </div>
  );
}
