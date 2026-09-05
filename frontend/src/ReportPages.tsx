import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "./components/ui/button";
import { DEFAULT_LIMITS, REPORT_ASSUMPTIONS } from "./reportData";
import { exportRebalanceCsv, type Asset, type AssetAssumptionUpdate, type Limits, type Portfolio, type PortfolioUpdate, type Rebalance, type Risk, type Simulation } from "./types";

export type PageKey =
  | "home"
  | "portfolio"
  | "risk"
  | "optimize"
  | "simulation"
  | "rebalance";

export type DecisionEvent = { title: string; detail: string; time: string };

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const money = (value: number) => `₹${(value / 1e7).toFixed(2)} Cr`;
const numberStyle = { fontVariantNumeric: "tabular-nums" };
const palette = ["#4a342a", "#8a624d", "#b17a27", "#a99175", "#725b4d", "#cbbba4"];

const controlNames: Record<string, string> = {
  maxPortfolioVolatility: "Portfolio volatility",
  maxVaR: "One-day VaR",
  maxCVaR: "One-day expected shortfall",
  maxSingleAssetWeight: "Single asset exposure",
  maxAssetClassWeight: "Asset class exposure",
  minimumLiquidityScore: "Portfolio liquidity",
  minimumCashWeight: "Cash reserve",
  maximumTurnover: "Turnover budget",
};

const controlHelp: Record<string, string> = {
  maxPortfolioVolatility: "Caps annualized volatility under historical assumptions.",
  maxVaR: "Limits the estimated one-day loss at 95% confidence.",
  maxCVaR: "Limits average losses beyond the one-day VaR threshold.",
  maxSingleAssetWeight: "Prevents one holding from dominating portfolio capital.",
  maxAssetClassWeight: "Constrains concentration within one asset class.",
  minimumLiquidityScore: "Maintains a minimum weighted liquidity quality score.",
  minimumCashWeight: "Preserves readily available capital in cash.",
  maximumTurnover: "Restricts the capital that a rebalance may trade.",
};

const RISK_APPETITES: Record<string, Limits> = {
  CONSERVATIVE: { maxPortfolioVolatility: 0.12, maxVaR: 0.012, maxCVaR: 0.018, maxSingleAssetWeight: 0.20, maxAssetClassWeight: 0.40, minimumLiquidityScore: 75, minimumCashWeight: 0.08, maximumTurnover: 0.15, riskAppetite: "CONSERVATIVE" },
  BALANCED: { maxPortfolioVolatility: 0.16, maxVaR: 0.018, maxCVaR: 0.025, maxSingleAssetWeight: 0.25, maxAssetClassWeight: 0.55, minimumLiquidityScore: 70, minimumCashWeight: 0.05, maximumTurnover: 0.20, riskAppetite: "BALANCED" },
  GROWTH: { maxPortfolioVolatility: 0.22, maxVaR: 0.030, maxCVaR: 0.040, maxSingleAssetWeight: 0.35, maxAssetClassWeight: 0.65, minimumLiquidityScore: 60, minimumCashWeight: 0.03, maximumTurnover: 0.30, riskAppetite: "GROWTH" },
};

function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="report-page-header">
      <span className="report-eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}

function SectionHeader({ index, title, note }: { index?: string; title: string; note?: string }) {
  return (
    <div className="report-section-head">
      <div>
        {index && <span>{index}</span>}
        <h2>{title}</h2>
      </div>
      {note && <p>{note}</p>}
    </div>
  );
}

function StatusIndicator({ status, children }: { status: "safe" | "warning" | "breach"; children: React.ReactNode }) {
  return <span className={`report-status ${status}`}>{children}</span>;
}

function targetAssets(portfolio: Portfolio, proposal?: Rebalance) {
  return proposal?.status === "FEASIBLE" && proposal.assets.length ? proposal.assets : portfolio.assets;
}

function category(assetClass: string) {
  if (assetClass.includes("Equity")) return "Equity";
  if (assetClass.includes("Bonds")) return "Bonds";
  if (assetClass === "Gold") return "Commodities";
  if (assetClass === "REIT") return "Real Estate";
  if (assetClass === "Cash") return "Cash";
  return "Alternative Assets";
}

function allocations(assets: Asset[]) {
  const total = assets.reduce((sum, asset) => sum + asset.currentValue, 0);
  const map: Record<string, number> = {};
  assets.forEach((asset) => {
    const group = category(asset.assetClass);
    map[group] = (map[group] ?? 0) + asset.currentValue;
  });
  return Object.entries(map).map(([name, val]) => ({ name, value: val, weight: total ? val / total : 0 }));
}

function metricValue(label: string, value: string | number, note?: string) {
  return (
    <div className="report-metric" key={label}>
      <span>{label}</span>
      <strong style={numberStyle}>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function AllocationFigure({ portfolio }: { portfolio: Portfolio }) {
  const data = allocations(portfolio.assets);
  return (
    <div className="allocation-grid">
      <div className="pie-wrap">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={palette[index % palette.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(val) => money(Number(val))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="table-wrap">
        <table className="financial-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Current value</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr key={row.name}>
                <td>
                  <span className="dot-indicator" style={{ backgroundColor: palette[index % palette.length] }} />
                  <strong>{row.name}</strong>
                </td>
                <td>{money(row.value)}</td>
                <td>{pct(row.weight)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OverviewPage({ portfolio, risk, proposal, events, navigate }: { portfolio: Portfolio; risk: Risk; proposal?: Rebalance; events: DecisionEvent[]; navigate: (page: PageKey) => void }) {
  const breaches = risk.controls.filter((control) => control.status === "BREACH").length;
  const optimizedRisk = proposal?.risk?.riskScore;
  const improvement = optimizedRisk == null ? null : (risk.riskScore - optimizedRisk) / risk.riskScore;
  const overall = breaches >= 3 || risk.riskLevel === "CRITICAL" ? "CRITICAL" : breaches || risk.riskLevel === "HIGH" ? "WARNING" : "STABLE";
  const mode = risk.operatingMode ?? (breaches ? "CAUTION" : "NORMAL");

  return (
    <div className="report-page home-page-container">
      <div className="overview-hero">
        <div className="home-brand-hero">
          <span className="home-eyebrow">THE CAPITAL COMPASS</span>
          <h1 className="home-aegis-title">AEGIS</h1>
          <p className="home-subtitle">Asset &amp; Capital Optimization Control Engine</p>
        </div>
        <div className="hero-capital">
          <span>Total portfolio value</span>
          <strong>{money(portfolio.totalValue)}</strong>
          <small>{portfolio.assets.length} assets · {allocations(portfolio.assets).filter((row) => row.value > 0).length} allocation groups</small>
        </div>
      </div>
      <div className="report-metric-row four">
        {metricValue("Expected return", pct(risk.metrics.expectedReturn), "Historical allocation")}
        {metricValue("Portfolio risk", pct(risk.metrics.volatility), "Annualized volatility")}
        {metricValue("Operating mode", mode, `Control posture: ${mode}`)}
        {metricValue("Portfolio health", `${risk.portfolioScore.toFixed(1)} / 100`, "Explainable control score")}
      </div>
      <div className="report-two-column">
        <section className="report-section">
          <SectionHeader index="01" title="Portfolio control status" note={`${breaches} limits currently breached`} />
          <div className="status-report">
            <div><span>Current status</span><StatusIndicator status={overall === "STABLE" ? "safe" : overall === "WARNING" ? "warning" : "breach"}>{overall}</StatusIndicator></div>
            <div><span>Operating mode</span><StatusIndicator status={mode === "NORMAL" ? "safe" : mode === "CAUTION" ? "warning" : "breach"}>{mode}</StatusIndicator></div>
            {risk.controls.slice(0, 4).map((control) => <div key={control.controlName}><span>{controlNames[control.controlName]}</span><StatusIndicator status={control.status === "PASS" ? "safe" : control.status === "WARNING" ? "warning" : "breach"}>{control.status}</StatusIndicator></div>)}
          </div>
        </section>
        <section className="report-section recommendation-callout">
          <SectionHeader index="02" title="Current → recommended" />
          <div className="home-comparison"><div><span>Current risk</span><strong>{risk.riskScore.toFixed(1)}</strong><small>{pct(risk.metrics.volatility)} volatility</small></div><ArrowRight size={20} /><div><span>Optimized risk</span><strong>{proposal?.risk?.riskScore.toFixed(1) ?? "—"}</strong><small>{proposal?.risk ? `${pct(proposal.risk.metrics.volatility)} volatility` : "Run optimizer"}</small></div></div>
          {improvement != null && <strong>Potential risk-score reduction: {pct(improvement, 1)}</strong>}
          <div className="report-actions"><Button variant="outline" onClick={() => navigate("simulation")}>Run stress test</Button><Button onClick={() => navigate("optimize")}>Optimize portfolio <ArrowRight size={16} /></Button></div>
        </section>
      </div>
      <section className="report-section latest-intervention"><SectionHeader index="03" title="Decision trace" note={`${events.length} session event${events.length === 1 ? "" : "s"}`} />{events.map((event) => <div key={`${event.time}-${event.title}`}><span>{event.time} · {event.title}</span><p>{event.detail}</p></div>)}</section>
      <section className="report-section"><SectionHeader index="04" title="Portfolio allocation" note="Current capital by broad asset group" /><AllocationFigure portfolio={portfolio} /></section>
    </div>
  );
}

export function PortfolioPage({
  portfolio,
  proposal,
  busy,
  save,
  onReset,
  onRecordEvent,
  onReload,
}: {
  portfolio: Portfolio;
  proposal?: Rebalance;
  busy: boolean;
  save: (payload: PortfolioUpdate) => Promise<void>;
  onReset?: () => Promise<void>;
  onRecordEvent?: (title: string, detail: string) => void;
  onReload?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [assumptions, setAssumptions] = useState<Record<string, AssetAssumptionUpdate>>({});
  const [totalCapCr, setTotalCapCr] = useState<number>(portfolio.totalValue / 1e7);
  const [incomingCapCr, setIncomingCapCr] = useState<number>(1.0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [routeResult, setRouteResult] = useState<{
    incomingCapital: number;
    routedToLiquidity: number;
    remainingCapital: number;
    totalValue: number;
    liquidityBefore: number;
    liquidityAfter: number;
    liquidityTarget: number;
    liquidityRepaired: boolean;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [validation, setValidation] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const init: Record<string, number> = {};
    const nextAssumptions: Record<string, AssetAssumptionUpdate> = {};
    portfolio.assets.forEach((asset) => { init[asset.id] = asset.currentWeight; });
    portfolio.assets.forEach((asset) => {
      nextAssumptions[asset.id] = {
        expectedReturn: asset.expectedReturn,
        volatility: asset.volatility,
        liquidityScore: asset.liquidityScore,
        duration: asset.duration,
      };
    });
    setDraft(init);
    setAssumptions(nextAssumptions);
    setTotalCapCr(portfolio.totalValue / 1e7);
    setValidation("");
  }, [portfolio]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return portfolio.assets.filter((a) => a.name.toLowerCase().includes(term) || a.ticker.toLowerCase().includes(term) || a.assetClass.toLowerCase().includes(term));
  }, [portfolio, search]);

  // Sum non-cash target weights (as fraction 0..1)
  const nonCashSum = useMemo(() => {
    return portfolio.assets
      .filter((a) => a.id !== "cash")
      .reduce((s, a) => s + (draft[a.id] ?? a.currentWeight), 0);
  }, [portfolio.assets, draft]);

  // Cash reserve weight automatically calculated
  const cashReserveWeight = Math.max(0, 1 - nonCashSum);

  // Non-cash & Cash percentages
  const nonCashAllocatedPct = nonCashSum * 100;
  const cashReservePct = cashReserveWeight * 100;

  // Values in Cr
  const totalCapValCr = Number.isFinite(totalCapCr) && totalCapCr > 0 ? totalCapCr : 0;
  const investedCapCr = totalCapValCr * nonCashSum;
  const cashReserveCapCr = totalCapValCr * cashReserveWeight;

  const isOverAllocated = nonCashSum > 1.0001;
  const invalidAssumptions = Object.values(assumptions).some((value) =>
    !Number.isFinite(value.expectedReturn) || value.expectedReturn < -1 || value.expectedReturn > 10 ||
    !Number.isFinite(value.volatility) || value.volatility < 0 || value.volatility > 5 ||
    !Number.isFinite(value.liquidityScore) || value.liquidityScore < 0 || value.liquidityScore > 100 ||
    !Number.isFinite(value.duration) || value.duration < 0 || value.duration > 100
  );
  const portfolioInvalid = !Number.isFinite(totalCapCr) || totalCapCr <= 0 || isOverAllocated || invalidAssumptions;

  function updateAssumption(assetId: string, key: keyof AssetAssumptionUpdate, value: number) {
    setSaved(false);
    setValidation("");
    setAssumptions((current) => ({ ...current, [assetId]: { ...current[assetId], [key]: value } }));
  }

  function handleTargetWeightChange(assetId: string, weightFrac: number) {
    setSaved(false);
    setValidation("");
    setDraft((prev) => ({ ...prev, [assetId]: weightFrac }));
  }

  function handleTargetValueCrChange(assetId: string, valCr: number) {
    if (!Number.isFinite(totalCapCr) || totalCapCr <= 0) return;
    handleTargetWeightChange(assetId, valCr / totalCapCr);
  }

  async function handleSave() {
    if (portfolioInvalid) {
      if (isOverAllocated) {
        setValidation(`Target allocation (${nonCashAllocatedPct.toFixed(1)}%) exceeds 100% of total capital. Lower asset target weights before saving.`);
      } else {
        setValidation("Enter valid values for total capital and holding assumptions before saving.");
      }
      return;
    }
    const finalAllocations: Record<string, number> = { ...draft };
    finalAllocations["cash"] = Math.max(0, 1 - nonCashSum);

    const totalValue = totalCapCr * 1e7;
    setValidation("");
    try {
      await save({ allocations: finalAllocations, totalValue, assumptions });
      setSaved(true);
    } catch (cause) {
      setValidation((cause as Error).message);
    }
  }

  async function handleRouteCapital() {
    if (incomingCapCr <= 0) return;
    const incVal = incomingCapCr * 1e7;
    try {
      const res = await api<{
        routedToLiquidity: number;
        remainingCapital: number;
        totalValue: number;
        updatedAssets: Asset[];
        liquidityBefore: number;
        liquidityAfter: number;
        liquidityTarget: number;
        liquidityRepaired: boolean;
      }>("/portfolio/route-capital", { incomingCapital: incVal });

      setRouteResult({
        incomingCapital: incVal,
        routedToLiquidity: res.routedToLiquidity,
        remainingCapital: res.remainingCapital,
        totalValue: res.totalValue,
        liquidityBefore: res.liquidityBefore,
        liquidityAfter: res.liquidityAfter,
        liquidityTarget: res.liquidityTarget,
        liquidityRepaired: res.liquidityRepaired,
      });

      if (onReload) await onReload();
      if (onRecordEvent) {
        onRecordEvent(
          "New capital routed",
          `AEGIS evaluated liquidity before allocating ₹${incomingCapCr.toFixed(2)} Cr of incoming capital.`
        );
      }
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="report-page">
      <PageHeader eyebrow="PORTFOLIO HOLDINGS" title="Current asset inventory & capital setup" description="Configure total portfolio capital, route new incoming funds, and manage target allocations." />

      {/* Redesigned Top Summary Card */}
      <div className="portfolio-summary-card" style={{ background: "var(--paper-deep)", padding: "20px 24px", borderRadius: "3px", border: "1px solid var(--rule)", marginBottom: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "20px" }}>
          <div>
            <span style={{ fontSize: "11.5px", fontFamily: "var(--mono)", color: "var(--ochre)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: "4px" }}>01 HOLDINGS & CAPITAL SUMMARY</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={totalCapCr}
                onChange={(e) => { setSaved(false); setValidation(""); setTotalCapCr(e.target.value === "" ? Number.NaN : Number(e.target.value)); }}
                style={{ width: "110px", padding: "4px 8px", fontSize: "24px", fontWeight: "700", fontFamily: "var(--mono)", color: "var(--brown)", border: "1px solid var(--rule)", borderRadius: "3px", background: "white" }}
              />
              <span style={{ fontSize: "24px", fontWeight: "700", fontFamily: "var(--mono)", color: "var(--brown)" }}>Cr</span>
              <span style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "var(--mono)", textTransform: "uppercase", marginLeft: "6px" }}>TOTAL CAPITAL</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "32px", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: "11.5px", color: "var(--muted)", textTransform: "uppercase", fontFamily: "var(--mono)", display: "block" }}>INVESTED ASSETS</span>
              <strong style={{ fontSize: "20px", fontFamily: "var(--mono)", color: "var(--ink)" }}>
                ₹{investedCapCr.toFixed(2)} Cr <small style={{ fontSize: "12.5px", color: "var(--muted)" }}>({nonCashAllocatedPct.toFixed(1)}%)</small>
              </strong>
            </div>
            <div style={{ borderLeft: "1px solid var(--rule)", paddingLeft: "32px" }}>
              <span style={{ fontSize: "11.5px", color: "var(--muted)", textTransform: "uppercase", fontFamily: "var(--mono)", display: "block" }}>CASH RESERVE</span>
              <strong style={{ fontSize: "20px", fontFamily: "var(--mono)", color: isOverAllocated ? "var(--rust)" : "var(--brown)" }}>
                ₹{cashReserveCapCr.toFixed(2)} Cr <small style={{ fontSize: "12.5px", color: "var(--muted)" }}>({cashReservePct.toFixed(1)}%)</small>
              </strong>
            </div>
          </div>
        </div>

        {/* Live Allocation Progress Indicator Bar */}
        <div style={{ marginTop: "20px" }}>
          <div style={{ height: "8px", background: "var(--rule)", borderRadius: "2px", overflow: "hidden", display: "flex" }}>
            <div style={{ width: `${Math.min(100, nonCashAllocatedPct)}%`, background: isOverAllocated ? "var(--rust)" : "var(--brown)", transition: "width 0.2s" }} />
            <div style={{ width: `${Math.max(0, Math.min(cashReservePct, 100))}%`, background: "#c4d1a7", transition: "width 0.2s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", fontFamily: "var(--mono)", marginTop: "8px", color: isOverAllocated ? "var(--rust)" : "var(--muted)" }}>
            <span>
              {isOverAllocated
                ? `⚠️ Exceeds 100% total capital by ${(nonCashAllocatedPct - 100).toFixed(1)}%`
                : `${nonCashAllocatedPct.toFixed(1)}% allocated · ${cashReservePct.toFixed(1)}% remains as cash reserve`}
            </span>
            <span>{isOverAllocated ? "BLOCKED" : nonCashAllocatedPct === 100 ? "100% FULLY ALLOCATED" : "ALLOWED"}</span>
          </div>
        </div>
      </div>

      {/* Route New Capital Section */}
      <div className="report-section" style={{ marginBottom: "28px" }}>
        <SectionHeader index="RC" title="Route New Capital" note="AEGIS checks liquidity requirements before allocating newly available capital." />
        <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", marginTop: "0.75rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "12.5px", fontFamily: "var(--mono)", color: "var(--muted)" }}>Incoming Capital (₹ Cr)</span>
            <input
              type="number"
              step="0.5"
              min="0.01"
              value={incomingCapCr}
              onChange={(e) => setIncomingCapCr(Number(e.target.value))}
              style={{ width: "130px", padding: "6px 12px", borderRadius: "3px", border: "1px solid var(--rule)", fontFamily: "var(--mono)", fontWeight: "600" }}
            />
          </label>
          <Button disabled={busy || incomingCapCr <= 0} onClick={() => void handleRouteCapital()}>
            {busy ? "Routing…" : "Route Capital"}
          </Button>
        </div>

        {routeResult && (
          <div className="report-metric-row four compact" style={{ marginTop: "1rem" }}>
            {metricValue("Incoming Capital", money(routeResult.incomingCapital), "Newly available funds")}
            {metricValue("Routed to Liquidity", money(routeResult.routedToLiquidity), "Deficit repair to Cash")}
            {metricValue("Remaining Capital", money(routeResult.remainingCapital), "Proportionally allocated")}
            {metricValue("New Portfolio Value", money(routeResult.totalValue), "Updated total")}
          </div>
        )}
        {routeResult && (
          <p className={routeResult.liquidityRepaired ? "positive" : "negative"} style={{ fontFamily: "var(--mono)", fontSize: "12.5px", marginTop: "8px" }}>
            Liquidity moved from {routeResult.liquidityBefore.toFixed(1)} to {routeResult.liquidityAfter.toFixed(1)} / 100. Required floor: {routeResult.liquidityTarget.toFixed(1)}. {routeResult.liquidityRepaired ? "The floor is now satisfied." : "The available capital was insufficient to restore the floor."}
          </p>
        )}
      </div>

      {/* Main Holdings Header */}
      <div className="report-section-head">
        <div><span>01</span><h2>Holdings ({portfolio.assets.length})</h2></div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <Button variant="outline" type="button" onClick={() => setShowAdvanced(!showAdvanced)} style={{ fontSize: "13px", padding: "4px 12px" }}>
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showAdvanced ? "Hide advanced assumptions" : "Advanced assumptions"}
          </Button>
          <div className="search-box"><Search size={15} /><input type="text" placeholder="Search holdings…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        </div>
      </div>

      {/* Main Table */}
      <div className="table-wrap">
        <table className="financial-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Class</th>
              <th>Value (₹ Cr)</th>
              <th>Current %</th>
              <th>Target %</th>
              {showAdvanced && <th>Expected Return</th>}
              {showAdvanced && <th>Volatility</th>}
              {showAdvanced && <th>Liquidity</th>}
              {showAdvanced && <th>Duration</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((asset) => {
              const isCash = asset.id === "cash";
              const targetWeightFrac = isCash ? cashReserveWeight : (draft[asset.id] ?? asset.currentWeight);
              const targetValCr = totalCapValCr * targetWeightFrac;

              return (
                <tr key={asset.id} style={isCash ? { background: "var(--paper-deep)", fontWeight: "600" } : {}}>
                  <td>
                    <strong>{asset.name}</strong>
                    <small>{asset.ticker}</small>
                  </td>
                  <td>{asset.assetClass}</td>
                  <td>
                    {isCash ? (
                      <span style={{ fontFamily: "var(--mono)", fontWeight: "600" }}>₹{targetValCr.toFixed(2)} Cr</span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span>₹</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={Number.isFinite(targetValCr) ? Number(targetValCr.toFixed(2)) : ""}
                          onChange={(e) => {
                            const valCr = e.target.value === "" ? Number.NaN : Number(e.target.value);
                            handleTargetValueCrChange(asset.id, valCr);
                          }}
                          style={{ width: "85px", padding: "4px 8px", borderRadius: "3px", border: "1px solid var(--rule)", fontFamily: "var(--mono)", textAlign: "right" }}
                        />
                        <span>Cr</span>
                      </div>
                    )}
                  </td>
                  <td style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>
                    {pct(asset.currentWeight)}
                  </td>
                  <td>
                    {isCash ? (
                      <span style={{ fontFamily: "var(--mono)", fontWeight: "600", color: isOverAllocated ? "var(--rust)" : "var(--brown)" }}>
                        {cashReservePct.toFixed(1)}% <small style={{ fontSize: "11px", color: "var(--muted)" }}>(auto)</small>
                      </span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={Number.isFinite(targetWeightFrac) ? Number((targetWeightFrac * 100).toFixed(1)) : ""}
                          onChange={(e) => {
                            const weightPct = e.target.value === "" ? Number.NaN : Number(e.target.value);
                            handleTargetWeightChange(asset.id, weightPct / 100);
                          }}
                          style={{ width: "75px", padding: "4px 8px", borderRadius: "3px", border: "1px solid var(--rule)", fontFamily: "var(--mono)", textAlign: "right" }}
                        />
                        <span>%</span>
                      </div>
                    )}
                  </td>

                  {showAdvanced && (
                    <>
                      <td><input aria-label={`${asset.name} expected return`} type="number" min="-100" max="1000" step="0.1" value={Number.isFinite(assumptions[asset.id]?.expectedReturn) ? Number((assumptions[asset.id].expectedReturn * 100).toFixed(2)) : ""} onChange={(e) => updateAssumption(asset.id, "expectedReturn", e.target.value === "" ? Number.NaN : Number(e.target.value) / 100)} style={{ width: "76px", padding: "4px 8px", borderRadius: "3px", border: "1px solid var(--rule)", fontFamily: "var(--mono)" }} /> %</td>
                      <td><input aria-label={`${asset.name} volatility`} type="number" min="0" max="500" step="0.1" value={Number.isFinite(assumptions[asset.id]?.volatility) ? Number((assumptions[asset.id].volatility * 100).toFixed(2)) : ""} onChange={(e) => updateAssumption(asset.id, "volatility", e.target.value === "" ? Number.NaN : Number(e.target.value) / 100)} style={{ width: "70px", padding: "4px 8px", borderRadius: "3px", border: "1px solid var(--rule)", fontFamily: "var(--mono)" }} /> %</td>
                      <td><input aria-label={`${asset.name} liquidity score`} type="number" min="0" max="100" step="1" value={Number.isFinite(assumptions[asset.id]?.liquidityScore) ? assumptions[asset.id].liquidityScore : ""} onChange={(e) => updateAssumption(asset.id, "liquidityScore", e.target.value === "" ? Number.NaN : Number(e.target.value))} style={{ width: "62px", padding: "4px 8px", borderRadius: "3px", border: "1px solid var(--rule)", fontFamily: "var(--mono)" }} /> /100</td>
                      <td><input aria-label={`${asset.name} duration`} type="number" min="0" max="100" step="0.1" value={Number.isFinite(assumptions[asset.id]?.duration) ? assumptions[asset.id].duration : ""} onChange={(e) => updateAssumption(asset.id, "duration", e.target.value === "" ? Number.NaN : Number(e.target.value))} style={{ width: "62px", padding: "4px 8px", borderRadius: "3px", border: "1px solid var(--rule)", fontFamily: "var(--mono)" }} /> yr</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--paper-deep)", fontWeight: "700", borderTop: "2px solid var(--rule)" }}>
              <td colSpan={2}>Target Allocation Total</td>
              <td style={{ fontFamily: "var(--mono)" }}>₹{investedCapCr.toFixed(2)} Cr</td>
              <td style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>—</td>
              <td style={{ fontFamily: "var(--mono)", color: "var(--ink)" }}>{nonCashAllocatedPct.toFixed(1)}%</td>
              {showAdvanced && <td colSpan={4} />}
            </tr>
            <tr style={{ background: "var(--paper-deep)", fontWeight: "700" }}>
              <td colSpan={2}>Cash Reserve / Unallocated Capital</td>
              <td style={{ fontFamily: "var(--mono)" }}>₹{cashReserveCapCr.toFixed(2)} Cr</td>
              <td style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>—</td>
              <td style={{ fontFamily: "var(--mono)", color: isOverAllocated ? "var(--rust)" : "var(--brown)" }}>{cashReservePct.toFixed(1)}%</td>
              {showAdvanced && <td colSpan={4} />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Sticky Bottom Actions Bar */}
      <div className="sticky-form-actions">
        <div>
          <span>
            Target allocated: <strong>{nonCashAllocatedPct.toFixed(1)}%</strong> · Cash reserve: <strong>{cashReservePct.toFixed(1)}%</strong> · Total Capital: <strong>₹{totalCapValCr.toFixed(2)} Cr</strong>
          </span>
          {validation && <small className="negative" style={{ display: "block", marginTop: "4px" }}>{validation}</small>}
          {saved && <small className="positive" style={{ display: "block", marginTop: "4px" }}><Check size={14} />Portfolio saved and canonical engine recalculated across all pages</small>}
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {onReset && (
            <Button variant="outline" type="button" disabled={busy} onClick={() => void onReset()}>
              Reset Demo
            </Button>
          )}
          <Button disabled={busy || portfolioInvalid} onClick={() => void handleSave()}>
            {busy ? "Saving…" : "Save & Recalculate"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RiskPage({
  risk,
  limits,
  appetites,
  busy,
  save,
}: {
  risk: Risk;
  limits: Limits;
  appetites?: Record<string, Limits>;
  busy: boolean;
  save: (limits: Limits) => Promise<void>;
}) {
  const mode = risk.operatingMode ?? "NORMAL";
  return (
    <div className="report-page">
      <PageHeader eyebrow="RISK ANALYSIS" title="Where capital is exposed" description="Historical allocation risk, policy limits and the drivers behind the current score." />
      <div className="risk-score-hero">
        <div>
          <span>Aegis portfolio health score</span>
          <strong>{risk.portfolioScore.toFixed(1)} <small>/ 100</small></strong>
          <StatusIndicator status={mode === "NORMAL" ? "safe" : mode === "CAUTION" ? "warning" : "breach"}>{risk.riskLevel} · {mode} MODE</StatusIndicator>
        </div>
        <p>A transparent portfolio control score. It is not a credit rating, forecast or investment guarantee. Current risk score: {risk.riskScore.toFixed(1)} / 100.</p>
      </div>
      <div className="report-metric-row six">
        {metricValue("Expected return", pct(risk.metrics.expectedReturn), "Historical assumption")}
        {metricValue("Volatility", pct(risk.metrics.volatility), "Annualized")}
        {metricValue("Sharpe ratio", risk.metrics.sharpeRatio.toFixed(2), "4% risk-free rate")}
        {metricValue("Concentration", pct(risk.metrics.concentrationRisk), "Herfindahl index")}
        {metricValue("Liquidity", risk.metrics.liquidityScore.toFixed(1), "Weighted score / 100")}
        {metricValue("Maximum exposure", pct(risk.metrics.largestAssetExposure), risk.metrics.largestAssetName)}
      </div>
      <section className="report-section">
        <SectionHeader index="01" title="Risk limits" note="Actual values checked by the shared Risk Firewall" />
        <div className="table-wrap">
          <table className="financial-table">
            <thead><tr><th>Metric</th><th>Current</th><th>Limit</th><th>Gap</th><th>Status</th></tr></thead>
            <tbody>
              {risk.controls.map((control) => (
                <tr key={control.controlName}>
                  <td><strong>{controlNames[control.controlName]}</strong><small>{control.explanation}</small></td>
                  <td>{control.controlName === "minimumLiquidityScore" ? control.currentValue.toFixed(1) : pct(control.currentValue)}</td>
                  <td>{control.controlName.startsWith("minimum") ? "≥ " : "≤ "}{control.controlName === "minimumLiquidityScore" ? control.limit.toFixed(1) : pct(control.limit)}</td>
                  <td>{control.controlName === "minimumLiquidityScore" ? `${Math.abs(control.currentValue-control.limit).toFixed(1)} ${control.currentValue < control.limit ? "shortfall" : "buffer"}` : `${pct(Math.abs(control.currentValue-control.limit))} ${control.currentValue < control.limit === control.controlName.startsWith("minimum") ? "breach" : "buffer"}`}</td>
                  <td><StatusIndicator status={control.status === "BREACH" ? "breach" : control.status === "WARNING" ? "warning" : "safe"}>{control.status === "PASS" ? "SAFE" : control.status === "BREACH" ? "BREACHED" : "WARNING"}</StatusIndicator></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="report-two-column risk-detail-grid">
        <section className="report-section"><SectionHeader index="02" title="Portfolio health score" note={`${risk.portfolioScore.toFixed(1)} / 100`} /><div className="risk-bars">{Object.entries(risk.scoreComponents).map(([name, points]) => <div key={name}><span>{name}</span><div><i style={{ width: `${Math.min(100, points / ({"Risk compliance":30,"Diversification":20,"Liquidity":15,"Volatility / risk":20,"Historical resilience":15}[name] ?? 20) * 100)}%` }} /></div><b>{points.toFixed(1)} pts</b></div>)}</div></section>
        <section className="report-section explanation-report"><SectionHeader index="03" title="Why the risk is high" />{risk.explanations.map((explanation, index) => <p key={index}><span>{String(index + 1).padStart(2, "0")}</span>{explanation}</p>)}</section>
      </div>
      <ControlsPage limits={limits} appetites={appetites} busy={busy} save={save} embedded />
    </div>
  );
}

function planMetrics(portfolio: Portfolio, risk: Risk, proposal?: Rebalance) {
  const target = targetAssets(portfolio, proposal);
  const expectedReturn = target.reduce((sum, asset) => sum + asset.currentWeight * asset.expectedReturn, 0);
  const traded = proposal?.trades.reduce((sum, trade) => sum + (trade.action === "HOLD" ? 0 : trade.amount), 0) ?? 0;
  return { target, expectedReturn, cost: traded * REPORT_ASSUMPTIONS.transactionCostRate };
}

export function OptimizationPage({ portfolio, risk, proposal, simulation, busy, run, navigate }: { portfolio: Portfolio; risk: Risk; proposal?: Rebalance; simulation?: Simulation; busy: boolean; run: () => void; navigate: (page: PageKey) => void }) {
  const sourcePortfolio = simulation ? { ...portfolio, assets: simulation.stressedAssets, totalValue: simulation.stressedPortfolioValue } : portfolio;
  const sourceRisk = simulation?.riskAfter ?? risk;
  const plan = planMetrics(sourcePortfolio, sourceRisk, proposal);
  const current = allocations(sourcePortfolio.assets);
  const target = allocations(plan.target);
  const comparison = current.map((row) => ({ name: row.name, Current: row.weight * 100, Target: (target.find((item) => item.name === row.name)?.weight ?? row.weight) * 100 }));
  const cb = proposal?.costBenefit;

  return (
    <div className="report-page">
      <PageHeader eyebrow={simulation ? `STRESSED PORTFOLIO · ${simulation.scenarioName}` : "CAPITAL OPTIMIZATION"} title="Recommended allocation" description={simulation ? "A funded target generated from the saved stressed holdings and rechecked against the same Risk Firewall limits." : "A funded comparison of the current portfolio and the optimizer's policy-compliant target."} />
      <div className="optimization-strip six">
        <div><span>Risk score</span><strong>{sourceRisk.riskScore.toFixed(1)} <ArrowRight /> {proposal?.risk?.riskScore.toFixed(1) ?? "—"}</strong></div>
        <div><span>Expected return</span><strong>{pct(sourceRisk.metrics.expectedReturn)} <ArrowRight /> {proposal?.risk ? pct(plan.expectedReturn) : "—"}</strong></div>
        <div><span>Volatility</span><strong>{pct(sourceRisk.metrics.volatility)} <ArrowRight /> {proposal?.risk ? pct(proposal.risk.metrics.volatility) : "—"}</strong></div>
        <div><span>One-day VaR</span><strong>{pct(sourceRisk.metrics.var95)} <ArrowRight /> {proposal?.risk ? pct(proposal.risk.metrics.var95) : "—"}</strong></div>
        <div><span>Liquidity</span><strong>{sourceRisk.metrics.liquidityScore.toFixed(1)} <ArrowRight /> {proposal?.risk?.metrics.liquidityScore.toFixed(1) ?? "—"}</strong></div>
        <div><span>Active breaches</span><strong>{sourceRisk.controls.filter(c => c.status === "BREACH").length} <ArrowRight /> {proposal?.risk ? proposal.risk.controls.filter(c => c.status === "BREACH").length : "—"}</strong></div>
      </div>
      {cb && (
        <section className="report-section cost-benefit-card">
          <SectionHeader index="00" title="Cost & trade-off analysis" note="Measured changes from the input allocation" />
          <div className="report-metric-row four">
            {metricValue("Est. Transaction Cost", money(cb.transactionCost), `${cb.transactionCostBps} bps on ${money(cb.turnoverValue)}`)}
            {metricValue("Expected Return Delta", `${cb.expectedReturnChange >= 0 ? "+" : ""}${pct(cb.expectedReturnChange)}`, "Historical weighted return")}
            {metricValue("Volatility Delta", `${cb.volatilityChange >= 0 ? "+" : ""}${pct(cb.volatilityChange)}`, "Historical annualized volatility")}
            {metricValue("Risk Score Delta", `${cb.safetyScoreChange > 0 ? "−" : "+"}${Math.abs(cb.safetyScoreChange).toFixed(1)} pts`, "Lower score = safer")}
          </div>
        </section>
      )}
      {proposal && proposal.status !== "FEASIBLE" && <div className="optimizer-message"><CircleAlert size={19} /><div><strong>{proposal.status === "INFEASIBLE" ? "No feasible allocation" : "No verified solution"}</strong><p>{proposal.explanation}</p>{proposal.conflicts.map((conflict) => <small key={conflict}>{conflict}</small>)}</div></div>}
      {proposal?.status === "FEASIBLE" && proposal.changeSummary.length > 0 && <section className="report-section"><SectionHeader index="01" title="What changed" note={`${proposal.trades.filter(t => t.action !== "HOLD").length} holding actions · ${pct(proposal.cumulativeTurnover)} cumulative turnover`} /><div className="constraint-list">{proposal.changeSummary.map(item => <span key={item}><ArrowRight size={14} />{item}</span>)}</div></section>}
      <section className="report-section"><SectionHeader index="02" title="Allocation shift" note="Current → target" /><div className="table-wrap"><table className="financial-table"><thead><tr><th>Asset class</th><th>Current</th><th>Target</th><th>Difference</th><th>Action</th></tr></thead><tbody>{comparison.map((row) => { const diff = (row.Target - row.Current) / 100; const action = Math.abs(diff) < .0001 ? "HOLD" : diff > 0 ? "BUY" : "SELL"; return <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.Current.toFixed(2)}%</td><td>{row.Target.toFixed(2)}%</td><td className={diff < 0 ? "negative" : diff > 0 ? "positive" : ""}>{diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${pct(diff)}`}</td><td><span className={`trade-action ${action.toLowerCase()}`}>{action}</span></td></tr>; })}</tbody></table></div></section>
      <section className="report-section"><SectionHeader index="02" title="Current → target" note="Allocation percentage by broad asset group" /><div className="comparison-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={comparison} layout="vertical" margin={{ left: 18, right: 24 }}><CartesianGrid horizontal={false} stroke="#d7cdbf" /><XAxis type="number" unit="%" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} /><Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} /><Bar dataKey="Current" fill="#b9aa99" /><Bar dataKey="Target" fill="#4a342a" /></BarChart></ResponsiveContainer></div></section>
      <section className="report-section objective-report"><SectionHeader index="03" title="Optimization objective" /><p>{proposal?.objective ?? "Run the optimizer to generate a verified allocation."}</p><div className="constraint-list">{["Risk Firewall limits", `Minimum liquidity ${limitsValue(proposal?.limits.minimumLiquidityScore, false)}`, `Maximum turnover ${limitsValue(proposal?.limits.maximumTurnover, true)}`, "Capital conserved · no external funding"].map((item) => <span key={item}><Check size={14} />{item}</span>)}</div><div className="report-actions"><Button disabled={busy} onClick={run}><SlidersHorizontal size={16} />{busy ? "Running optimizer…" : "Run optimization"}</Button><Button variant="outline" onClick={() => navigate("rebalance")}>View rebalance plan</Button></div></section>
    </div>
  );
}

function limitsValue(value: number | undefined, percentage: boolean) {
  if (value == null) return "—";
  return percentage ? pct(value) : value.toFixed(0);
}

export function RecommendationsPage({ portfolio, risk, proposal, simulation, navigate }: { portfolio: Portfolio; risk: Risk; proposal?: Rebalance; simulation?: Simulation; navigate: (page: PageKey) => void }) {
  const sourcePortfolio = simulation ? { ...portfolio, assets: simulation.stressedAssets, totalValue: simulation.stressedPortfolioValue } : portfolio;
  const sourceRisk = simulation?.riskAfter ?? risk;
  const trades = proposal?.trades ?? [];
  const actions = trades.filter((trade) => trade.action !== "HOLD");
  const reduction = proposal?.risk && sourceRisk.riskScore ? (sourceRisk.riskScore - proposal.risk.riskScore) / sourceRisk.riskScore : 0;
  const cb = proposal?.costBenefit;
  const cost = cb?.transactionCost ?? (actions.reduce((sum, trade) => sum + trade.amount, 0) * REPORT_ASSUMPTIONS.transactionCostRate);

  function downloadCsv() {
    if (!proposal) return;
    const csvContent = exportRebalanceCsv(proposal);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "rebalance-trades.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="report-page">
      <PageHeader eyebrow={simulation ? `STRESSED PORTFOLIO · ${simulation.scenarioName}` : "REBALANCE"} title="AEGIS intervention plan" description="BUY, SELL and HOLD instructions generated from the funded optimizer target and verified by the Risk Firewall." />
      <div className="recommendation-summary">
        <div><strong>{actions.length}</strong><span>portfolio actions</span></div>
        <div><strong>{pct(reduction, 1)}</strong><span>risk-score improvement</span></div>
        <div><strong>{proposal ? pct(proposal.turnover, 1) : "—"}</strong><span>estimated turnover</span></div>
        <div><strong>{proposal ? money(cost) : "—"}</strong><span>illustrative transaction cost</span></div>
      </div>
      {!proposal || proposal.status !== "FEASIBLE" ? (
        <section className="empty-report"><ShieldCheck size={24} /><h2>No verified rebalance plan</h2><p>Run Optimize to request a funded proposal under the current controls.</p><Button onClick={() => navigate("optimize")}>Open optimizer <ArrowRight size={16} /></Button></section>
      ) : (
        <>
          <section className="report-section intervention-summary">
            <SectionHeader index="01" title="Intervention summary" />
            <p>AEGIS recommends {actions.length} capital movements. Portfolio volatility moves from <b>{pct(sourceRisk.metrics.volatility)}</b> to <b>{pct(proposal.risk?.metrics.volatility ?? sourceRisk.metrics.volatility)}</b>, and active breaches move from <b>{sourceRisk.controls.filter((control) => control.status === "BREACH").length}</b> to <b>{proposal.risk?.controls.filter((control) => control.status === "BREACH").length ?? 0}</b>.</p>
          </section>
          <section className="report-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <SectionHeader index="02" title="BUY / SELL / HOLD plan" note="Proposal only · no orders have been placed" />
              <Button variant="outline" onClick={downloadCsv}><Download size={15} />Export Trades (CSV)</Button>
            </div>
            <div className="recommendation-list">
              {trades.map((trade, index) => {
                const asset = sourcePortfolio.assets.find((item) => item.id === trade.assetId);
                const reason = trade.reason;
                return (
                  <article key={trade.assetId}>
                    <div className="recommendation-index">{String(index + 1).padStart(2, "0")}</div>
                    <div className="recommendation-action"><span className={`trade-action ${trade.action.toLowerCase()}`}>{trade.action}</span><h2>{trade.name}</h2><small>{asset?.assetClass}</small></div>
                    <div className="recommendation-numbers">
                      <span>Current <b>{pct(trade.stressedWeight)}</b></span><ArrowRight size={16} /><span>Target <b>{pct(trade.targetWeight)}</b></span>
                      <span>Difference <b>{trade.action === "HOLD" ? "—" : `${trade.action === "SELL" ? "−" : "+"}${pct(Math.abs(trade.targetWeight - trade.stressedWeight))}`}</b></span>
                      <span>Amount <b>{money(trade.amount)}</b></span>
                    </div>
                    <div className="recommendation-reason"><span>{trade.triggeredConstraint}</span><p>{reason}</p><small>{trade.riskImpact}</small></div>
                  </article>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
              <Button variant="outline" onClick={() => navigate("simulation")}>Open Simulation <ArrowRight size={16} /></Button>
            </div>
          </section>
          <section className="report-section"><SectionHeader index="03" title="Decision trail" note="Deterministic engine trace · no orders executed" /><div className="status-report">{proposal.decisionTrail.map((step, index) => <div key={`${step.stage}-${index}`}><span>{String(index + 1).padStart(2, "0")} · {step.stage.replaceAll("_", " ")}</span><p>{step.message}</p></div>)}</div></section>
        </>
      )}
    </div>
  );
}

const limitGroups = [
  { title: "Asset limits", keys: ["maxAssetClassWeight", "maxSingleAssetWeight"] },
  { title: "Liquidity", keys: ["minimumCashWeight", "minimumLiquidityScore"] },
  { title: "Risk", keys: ["maxPortfolioVolatility", "maxVaR", "maxCVaR"] },
  { title: "Optimization", keys: ["maximumTurnover"] },
];

export function ControlsPage({
  limits,
  appetites,
  busy,
  save,
  embedded = false,
}: {
  limits: Limits;
  appetites?: Record<string, Limits>;
  busy: boolean;
  save: (limits: Limits) => Promise<void>;
  embedded?: boolean;
}) {
  const [draft, setDraft] = useState<Limits>(limits);
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState("");
  useEffect(() => { setDraft(limits); setValidation(""); }, [limits]);

  const activeAppetites = appetites && Object.keys(appetites).length ? appetites : RISK_APPETITES;
  const positiveLimits = new Set(["maxPortfolioVolatility", "maxVaR", "maxCVaR", "maxSingleAssetWeight", "maxAssetClassWeight", "maximumTurnover"]);
  const invalidLimits = limitGroups.flatMap((group) => group.keys).some((key) => {
    const value = Number(draft[key]);
    const ceiling = key === "minimumLiquidityScore" ? 100 : 1;
    return !Number.isFinite(value) || value < 0 || value > ceiling || (positiveLimits.has(key) && value <= 0);
  });

  async function applyAppetite(appetiteKey: string) {
    const preset = activeAppetites[appetiteKey];
    if (preset) {
      const next = { ...draft, ...preset };
      setDraft(next);
      setSaved(false);
      setValidation("");
      await save(next);
      setSaved(true);
    }
  }

  async function submit() {
    setSaved(false);
    if (invalidLimits) {
      setValidation("Enter valid limits between 0 and 100. Maximum limits and turnover must be greater than zero.");
      return;
    }
    setValidation("");
    try {
      await save(draft);
      setSaved(true);
    } catch (cause) {
      setValidation((cause as Error).message);
    }
  }

  return (
    <div className={embedded ? "embedded-controls report-section" : "report-page"}>
      {embedded ? <SectionHeader index="04" title="Configure risk controls" note="Shared by Risk, Optimize and Simulation" /> : <PageHeader eyebrow="RISK CONTROLS" title="Portfolio guardrails" description="Configure the shared limits used by risk analysis, simulation and optimization." />}
      
      <div className="report-section" style={{ marginBottom: "1.5rem" }}>
        <SectionHeader index="P" title="Risk Appetite Presets" note="Select a pre-configured risk profile" />
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
          {Object.keys(activeAppetites).map((appetite) => (
            <Button
              key={appetite}
              type="button"
              variant={draft.riskAppetite === appetite ? "default" : "outline"}
              onClick={() => void applyAppetite(appetite)}
              disabled={busy}
            >
              {appetite} Preset
            </Button>
          ))}
        </div>
      </div>

      <div className="controls-intro"><ShieldCheck size={23} /><p>Changes apply to this local session. Every proposal is rechecked against these controls before it is shown.</p></div>
      <div className="control-groups">{limitGroups.map((group, groupIndex) => <section className="control-group" key={group.title}><SectionHeader index={String(groupIndex + 1).padStart(2, "0")} title={group.title} />{group.keys.map((key) => { const score = key === "minimumLiquidityScore"; const value = draft[key] ?? 0; return <label className="control-form-row" key={key}><div><strong>{controlNames[key]}</strong><p>{controlHelp[key]}</p></div><div><span>Current limit</span><div><input type="number" min="0" max="100" step="any" value={Number.isFinite(Number(value)) ? Number((value * (score ? 1 : 100)).toFixed(4)) : ""} onChange={(event) => { setSaved(false); setValidation(""); setDraft({ ...draft, [key]: event.target.value === "" ? Number.NaN : Number(event.target.value) / (score ? 1 : 100) }); }} /><small>{score ? "/ 100" : "%"}</small></div></div></label>; })}</section>)}</div>
      <div className="sticky-form-actions"><div>{saved && <span><Check size={15} />Controls saved and risk recalculated</span>}{validation && <small className="negative">{validation}</small>}</div><Button variant="outline" type="button" onClick={() => { setSaved(false); setValidation(""); setDraft({ ...DEFAULT_LIMITS }); }}>Reset defaults</Button><Button disabled={busy || invalidLimits} type="button" onClick={() => void submit()}>{busy ? "Applying…" : "Apply controls"}</Button></div>
    </div>
  );
}
