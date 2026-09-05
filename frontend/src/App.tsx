import { api } from "./api";
import RiskLab from "./RiskLab";
import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Activity,
  FlaskConical,
  ArrowUpRight,
  SlidersHorizontal,
  Info,
  RefreshCw,
} from "lucide-react";
import { Button } from "./components/ui/button";
import type { Risk, Portfolio, Scenario, Limits, Control } from "./types";
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const money = (v: number) =>
  `${v < 0 ? "−" : ""}₹${(Math.abs(v) / 1e7).toFixed(2)} Cr`;
const labels: Record<string, string> = {
  maxPortfolioVolatility: "Portfolio volatility",
  maxVaR: "One-day VaR",
  maxCVaR: "One-day CVaR",
  maxSingleAssetWeight: "Single asset exposure",
  maxAssetClassWeight: "Asset class exposure",
  minimumLiquidityScore: "Minimum liquidity",
  minimumCashWeight: "Minimum cash",
  maximumTurnover: "Maximum turnover",
};

function Controls({ controls }: { controls: Control[] }) {
  return (
    <div className="controls">
      {controls.map((c) => (
        <div className="control" key={c.controlName}>
          <div>
            <strong>{labels[c.controlName]}</strong>
            <p>{c.explanation}</p>
          </div>
          <div className="control-values">
            <b>
              {c.controlName === "minimumLiquidityScore"
                ? c.currentValue.toFixed(1)
                : pct(c.currentValue)}
            </b>
            <small>
              limit{" "}
              {c.controlName === "minimumLiquidityScore"
                ? c.limit
                : pct(c.limit)}
            </small>
          </div>
          <span className={`status ${c.status.toLowerCase()}`}>{c.status}</span>
        </div>
      ))}
    </div>
  );
}
function Card({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
export default function App() {
  const [view, setView] = useState<"risk" | "stress">("stress"),
    [portfolio, setPortfolio] = useState<Portfolio>(),
    [risk, setRisk] = useState<Risk>(),
    [limits, setLimits] = useState<Limits>(),
    [scenarios, setScenarios] = useState<Scenario[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  async function load() {
    setError("");
    try {
      const [p, r, l, s] = await Promise.all([
        api<Portfolio>("/portfolio"),
        api<Risk>("/risk"),
        api<Limits>("/risk/limits"),
        api<Scenario[]>("/simulations"),
      ]);
      setPortfolio(p);
      setRisk(r);
      setLimits(l);
      setScenarios(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/risk/limits", limits);
      setRisk(await api<Risk>("/risk"));
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const classes = [
    ...new Set(portfolio?.assets.map((a) => a.assetClass) ?? []),
  ];
  const metrics = risk?.metrics;
  return (
    <div className="app">
      <aside>
        <a className="brand" href="#">
          <ShieldCheck size={30} />
          <span>
            CapitalGuard<small>CAPITAL CONTROL ENGINE</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <button
            className={view === "risk" ? "active" : ""}
            onClick={() => setView("risk")}
          >
            <Activity size={19} />
            Risk overview
          </button>
          <button
            className={view === "stress" ? "active" : ""}
            onClick={() => setView("stress")}
          >
            <FlaskConical size={19} />
            Stress Lab
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="dot" />
          Offline demo ready
          <p>
            Local portfolio · INR
            <br />
            No live market dependency
          </p>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Portfolio intelligence <span className="slash">/</span>{" "}
            {view === "risk" ? "Risk overview" : "Stress Lab"}
          </span>
          <span className="demo">DEMO PORTFOLIO</span>
        </header>
        <div className="content">
          <div className="page-title">
            <div>
              <div className="eyebrow">
                CAPITAL PROTECTION / {view === "risk" ? "01" : "02"}
              </div>
              <h1>
                {view === "risk" ? "Risk overview" : "Simulation / Risk Lab"}
              </h1>
              <p>
                {view === "risk"
                  ? "A clear view of risk, liquidity and the limits that protect your capital."
                  : "Shock the holdings. Trace the breaches. Test a funded response."}
              </p>
            </div>
            {portfolio && (
              <div className="capital">
                <span>Current portfolio value</span>
                <strong>{money(portfolio.totalValue)}</strong>
                <small>
                  {portfolio.assets.length} assets · {classes.length} asset
                  classes
                </small>
              </div>
            )}
          </div>
          {error && (
            <div role="alert" className="error">
              {error}{" "}
              <Button variant="outline" onClick={load}>
                <RefreshCw size={16} />
                Retry connection
              </Button>
            </div>
          )}
          {!risk || !portfolio || !metrics ? (
            <section className="panel">
              {error
                ? "Start the local backend on port 8000, then retry."
                : "Loading portfolio and risk calculations…"}
            </section>
          ) : view === "risk" ? (
            <>
              <div className="metric-grid">
                <Card
                  label="Overall risk score"
                  value={`${risk.riskScore.toFixed(1)} / 100`}
                  note={risk.riskLevel}
                />
                <Card
                  label="Portfolio volatility"
                  value={pct(metrics.volatility)}
                  note="Annualized · covariance based"
                />
                <Card
                  label="Value at Risk"
                  value={pct(metrics.var95)}
                  note="95% confidence · one day"
                />
                <Card
                  label="Expected shortfall"
                  value={pct(metrics.cvar95)}
                  note="95% CVaR · one day"
                />
                <Card
                  label="Liquidity score"
                  value={`${metrics.liquidityScore.toFixed(1)}`}
                  note="Weighted score / 100"
                />
              </div>
              <div className="risk-layout">
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h2>Risk controls</h2>
                      <p>
                        {
                          risk.controls.filter((c) => c.status === "BREACH")
                            .length
                        }{" "}
                        breaches require attention
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setLimits(
                          Object.fromEntries(
                            risk.controls.map((c) => [c.controlName, c.limit]),
                          ),
                        );
                        setEditing(!editing);
                      }}
                    >
                      <SlidersHorizontal size={16} />
                      {editing ? "Close" : "Configure limits"}
                    </Button>
                  </div>
                  {editing && (
                    <form
                      className="limit-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save();
                      }}
                    >
                      {Object.entries(limits ?? {}).map(([k, v]) => (
                        <label key={k}>
                          {labels[k]}{" "}
                          {k === "minimumLiquidityScore" ? "(score)" : "(%)"}
                          <input
                            disabled={busy}
                            type="number"
                            step="any"
                            min={k.startsWith("minimum") ? 0 : 0.001}
                            max="100"
                            required
                            value={Number(
                              (
                                v * (k === "minimumLiquidityScore" ? 1 : 100)
                              ).toFixed(6),
                            )}
                            onChange={(e) =>
                              setLimits({
                                ...limits,
                                [k]:
                                  Number(e.target.value) /
                                  (k === "minimumLiquidityScore" ? 1 : 100),
                              })
                            }
                          />
                        </label>
                      ))}
                      <Button disabled={busy} type="submit">
                        Save session limits
                      </Button>
                    </form>
                  )}
                  <Controls controls={risk.controls} />
                </section>
                <div className="right-column">
                  <section className="panel why">
                    <Info size={21} />
                    <h2>Why is this risky?</h2>
                    {risk.explanations.map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                    <Button onClick={() => setView("stress")}>
                      Explore a stress test <ArrowUpRight size={16} />
                    </Button>
                  </section>
                  <section className="panel">
                    <h2>Score breakdown</h2>
                    <p className="muted">
                      Weighted contributions to {risk.riskScore.toFixed(1)}{" "}
                      points
                    </p>
                    {risk.components.map((c) => (
                      <div className="component" key={c.name}>
                        <div>
                          <span>{c.name}</span>
                          <b>
                            {c.contribution.toFixed(1)}{" "}
                            <small>/ {c.weight * 100}</small>
                          </b>
                        </div>
                        <progress
                          aria-label={`${c.name} normalized score`}
                          value={c.normalizedScore}
                          max="100"
                        />
                      </div>
                    ))}
                  </section>
                </div>
              </div>
              <section className="panel">
                <div className="section-head">
                  <h2>Portfolio composition</h2>
                  <span className="muted">
                    Expected return {pct(metrics.expectedReturn)} · Historical
                    drawdown {pct(metrics.maxDrawdown)}
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Asset class</th>
                        <th>Value</th>
                        <th>Weight</th>
                        <th>Liquidity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.assets.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <strong>{a.name}</strong>
                            <small>{a.ticker}</small>
                          </td>
                          <td>{a.assetClass}</td>
                          <td>{money(a.currentValue)}</td>
                          <td>{pct(a.currentWeight)}</td>
                          <td>{a.liquidityScore}/100</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <RiskLab portfolio={portfolio} scenarios={scenarios} />
          )}

          <footer>
            CapitalGuard · Deterministic demo model{" "}
            <span>
              756 synthetic daily observations · Rates displayed as percentages
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
