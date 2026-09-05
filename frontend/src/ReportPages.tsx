import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
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
import { exportRebalanceCsv, type Asset, type Limits, type Portfolio, type Rebalance, type Risk } from "./types";

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

export function OverviewPage({ portfolio, risk, proposal, latestEvent, navigate }: { portfolio: Portfolio; risk: Risk; proposal?: Rebalance; latestEvent?: DecisionEvent; navigate: (page: PageKey) => void }) {
  const breaches = risk.controls.filter((control) => control.status === "BREACH").length;
  const optimizedRisk = proposal?.risk?.riskScore;
  const improvement = optimizedRisk == null ? null : (risk.riskScore - optimizedRisk) / risk.riskScore;
  const overall = breaches >= 3 || risk.riskLevel === "CRITICAL" ? "CRITICAL" : breaches || risk.riskLevel === "HIGH" ? "WARNING" : "STABLE";
  const mode = risk.operatingMode ?? (breaches ? "CAUTION" : "NORMAL");

  return (
    <div className="report-page">
      <div className="overview-hero">
        <PageHeader eyebrow="AEGIS" title="Capital, under control." description="Automated portfolio risk monitoring, optimization and stress-response controls." />
        <div className="hero-capital">
          <span>Total portfolio value</span>
          <strong>{money(portfolio.totalValue)}</strong>
          <small>{portfolio.assets.length} assets · {allocations(portfolio.assets).filter((row) => row.value > 0).length} allocation groups</small>
        </div>
      </div>
      <div className="report-metric-row four">
        {metricValue("Expected return", pct(risk.metrics.expectedReturn), "Historical allocation")}
        {metricValue("Portfolio risk", pct(risk.metrics.volatility), "Annualized volatility")}
        {metricValue("Operating mode", mode, `System health: ${mode}`)}
        {metricValue("Risk score", `${risk.riskScore.toFixed(1)} / 100`, risk.riskLevel)}
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
      <section className="report-section latest-intervention"><SectionHeader index="03" title="Latest intervention" note={latestEvent?.time ?? "No activity"} /><div><span>{latestEvent?.title ?? "Monitoring active"}</span><p>{latestEvent?.detail ?? "AEGIS is ready to analyze the next portfolio decision."}</p></div></section>
      <section className="report-section"><SectionHeader index="04" title="Portfolio allocation" note="Current capital by broad asset group" /><AllocationFigure portfolio={portfolio} /></section>
    </div>
  );
}

export function PortfolioPage({ portfolio, proposal, busy, save }: { portfolio: Portfolio; proposal?: Rebalance; busy: boolean; save: (payload: { allocations?: Record<string, number>; totalValue?: number }) => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [totalCapCr, setTotalCapCr] = useState<number>(portfolio.totalValue / 1e7);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const init: Record<string, number> = {};
    portfolio.assets.forEach((asset) => { init[asset.id] = asset.currentWeight; });
    setDraft(init);
    setTotalCapCr(portfolio.totalValue / 1e7);
  }, [portfolio]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return portfolio.assets.filter((a) => a.name.toLowerCase().includes(term) || a.ticker.toLowerCase().includes(term) || a.assetClass.toLowerCase().includes(term));
  }, [portfolio, search]);

  const totalWeight = Object.values(draft).reduce((s, w) => s + w, 0);

  async function handleSave() {
    const totalValue = totalCapCr * 1e7;
    await save({ allocations: draft, totalValue });
  }

  return (
    <div className="report-page">
      <PageHeader eyebrow="PORTFOLIO HOLDINGS" title="Current asset inventory & capital setup" description="Configure total portfolio capital and manage individual holding allocation weights." />
      
      <section className="report-section" style={{ marginBottom: "1.5rem" }}>
        <SectionHeader index="00" title="Portfolio Total Capital Setup" note="Set custom portfolio value in ₹ Crores (1 Cr = ₹10,000,000)" />
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", marginTop: "0.5rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.85rem", color: "#666" }}>Total Portfolio Capital (₹ Cr)</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={totalCapCr}
                onChange={(e) => setTotalCapCr(Number(e.target.value))}
                style={{ width: "140px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #ccc", fontWeight: "600", fontSize: "1rem" }}
              />
              <span style={{ fontWeight: "600" }}>Cr (₹{(totalCapCr * 1e7).toLocaleString("en-IN")})</span>
            </div>
          </label>
        </div>
      </section>

      <div className="report-section-head">
        <div><span>01</span><h2>Holdings ({portfolio.assets.length})</h2></div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <div className="search-box"><Search size={15} /><input type="text" placeholder="Search holdings…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="financial-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Class</th>
              <th>Current Value</th>
              <th>Current Weight</th>
              <th>Edit Target Weight</th>
              <th>Vol.</th>
              <th>Liq.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((asset) => (
              <tr key={asset.id}>
                <td><strong>{asset.name}</strong><small>{asset.ticker}</small></td>
                <td>{asset.assetClass}</td>
                <td>{money(asset.currentValue)}</td>
                <td>{pct(asset.currentWeight)}</td>
                <td>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={((draft[asset.id] ?? asset.currentWeight) * 100).toFixed(1)}
                    onChange={(e) => setDraft({ ...draft, [asset.id]: Number(e.target.value) / 100 })}
                    style={{ width: "80px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc" }}
                  /> %
                </td>
                <td>{pct(asset.volatility)}</td>
                <td>{asset.liquidityScore.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sticky-form-actions">
        <div><span>Total allocation: <strong>{pct(totalWeight, 1)}</strong> · Total Capital: <strong>₹{totalCapCr.toFixed(2)} Cr</strong></span></div>
        <Button disabled={busy || Math.abs(totalWeight - 1) > 0.002 || totalCapCr <= 0} onClick={() => void handleSave()}>
          {busy ? "Saving…" : "Save Portfolio & Recalculate"}
        </Button>
      </div>
    </div>
  );
}

export function RiskPage({ risk, limits, busy, save }: { risk: Risk; limits: Limits; busy: boolean; save: (limits: Limits) => Promise<void> }) {
  const mode = risk.operatingMode ?? "NORMAL";
  return (
    <div className="report-page">
      <PageHeader eyebrow="RISK ANALYSIS" title="Where capital is exposed" description="Historical allocation risk, policy limits and the drivers behind the current score." />
      <div className="risk-score-hero">
        <div>
          <span>Portfolio risk score</span>
          <strong>{risk.riskScore.toFixed(1)} <small>/ 100</small></strong>
          <StatusIndicator status={mode === "NORMAL" ? "safe" : mode === "CAUTION" ? "warning" : "breach"}>{risk.riskLevel} · {mode} MODE</StatusIndicator>
        </div>
        <p>{risk.explanations[0]}</p>
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
            <thead><tr><th>Metric</th><th>Current</th><th>Limit</th><th>Status</th></tr></thead>
            <tbody>
              {risk.controls.map((control) => (
                <tr key={control.controlName}>
                  <td><strong>{controlNames[control.controlName]}</strong><small>{control.explanation}</small></td>
                  <td>{control.controlName === "minimumLiquidityScore" ? control.currentValue.toFixed(1) : pct(control.currentValue)}</td>
                  <td>{control.controlName.startsWith("minimum") ? "≥ " : "≤ "}{control.controlName === "minimumLiquidityScore" ? control.limit.toFixed(1) : pct(control.limit)}</td>
                  <td><StatusIndicator status={control.status === "BREACH" ? "breach" : control.status === "WARNING" ? "warning" : "safe"}>{control.status}</StatusIndicator></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="report-two-column risk-detail-grid">
        <section className="report-section"><SectionHeader index="02" title="Risk contribution" /><div className="risk-bars">{risk.components.map((component) => <div key={component.name}><span>{component.name}</span><div><i style={{ width: `${component.normalizedScore}%` }} /></div><b>{component.contribution.toFixed(1)} pts</b></div>)}</div></section>
        <section className="report-section explanation-report"><SectionHeader index="03" title="Why the risk is high" />{risk.explanations.map((explanation, index) => <p key={index}><span>{String(index + 1).padStart(2, "0")}</span>{explanation}</p>)}</section>
      </div>
      <ControlsPage limits={limits} busy={busy} save={save} embedded />
    </div>
  );
}

function planMetrics(portfolio: Portfolio, risk: Risk, proposal?: Rebalance) {
  const target = targetAssets(portfolio, proposal);
  const expectedReturn = target.reduce((sum, asset) => sum + asset.currentWeight * asset.expectedReturn, 0);
  const traded = proposal?.trades.reduce((sum, trade) => sum + (trade.action === "HOLD" ? 0 : trade.amount), 0) ?? 0;
  return { target, expectedReturn, cost: traded * REPORT_ASSUMPTIONS.transactionCostRate };
}

export function OptimizationPage({ portfolio, risk, proposal, busy, run, navigate }: { portfolio: Portfolio; risk: Risk; proposal?: Rebalance; busy: boolean; run: () => void; navigate: (page: PageKey) => void }) {
  const plan = planMetrics(portfolio, risk, proposal);
  const current = allocations(portfolio.assets);
  const target = allocations(plan.target);
  const comparison = current.map((row) => ({ name: row.name, Current: row.weight * 100, Target: (target.find((item) => item.name === row.name)?.weight ?? row.weight) * 100 }));
  const cb = proposal?.costBenefit;

  return (
    <div className="report-page">
      <PageHeader eyebrow="CAPITAL OPTIMIZATION" title="Recommended allocation" description="A funded comparison of the current portfolio and the optimizer's policy-compliant target." />
      <div className="optimization-strip six">
        <div><span>Risk score</span><strong>{risk.riskScore.toFixed(1)} <ArrowRight /> {proposal?.risk?.riskScore.toFixed(1) ?? "—"}</strong></div>
        <div><span>Expected return</span><strong>{pct(risk.metrics.expectedReturn)} <ArrowRight /> {proposal?.risk ? pct(plan.expectedReturn) : "—"}</strong></div>
        <div><span>Volatility</span><strong>{pct(risk.metrics.volatility)} <ArrowRight /> {proposal?.risk ? pct(proposal.risk.metrics.volatility) : "—"}</strong></div>
        <div><span>Sharpe ratio</span><strong>{risk.metrics.sharpeRatio.toFixed(2)} <ArrowRight /> {proposal?.risk ? proposal.risk.metrics.sharpeRatio.toFixed(2) : "—"}</strong></div>
        <div><span>Liquidity</span><strong>{risk.metrics.liquidityScore.toFixed(1)} <ArrowRight /> {proposal?.risk?.metrics.liquidityScore.toFixed(1) ?? "—"}</strong></div>
        <div><span>Estimated transaction cost</span><strong>{proposal ? money(cb?.transactionCost ?? plan.cost) : "—"}</strong><small>{cb ? `15 bps (${pct(proposal.turnover)} turnover)` : REPORT_ASSUMPTIONS.transactionCostLabel}</small></div>
      </div>
      {cb && (
        <section className="report-section cost-benefit-card">
          <SectionHeader index="00" title="Cost / Benefit & Trade-off Analysis" note="Quantified rebalance efficiency" />
          <div className="report-metric-row four">
            {metricValue("Est. Transaction Cost", money(cb.transactionCost), `15 bps on ${money(cb.turnoverValue)}`)}
            {metricValue("Est. Rebalance Benefit", money(cb.estimatedBenefit), "Capital protection + yield delta")}
            {metricValue("Benefit / Cost Ratio", cb.benefitCostRatio.toFixed(2), cb.benefitCostRatio >= 1 ? "Efficient (B/C ≥ 1.0)" : "Caution (Low B/C)")}
            {metricValue("Risk Score Delta", `${cb.safetyScoreChange > 0 ? "−" : "+"}${Math.abs(cb.safetyScoreChange).toFixed(1)} pts`, "Lower score = safer")}
          </div>
        </section>
      )}
      {proposal && proposal.status !== "FEASIBLE" && <div className="optimizer-message"><CircleAlert size={19} /><div><strong>{proposal.status === "INFEASIBLE" ? "No feasible allocation" : "No verified solution"}</strong><p>{proposal.explanation}</p>{proposal.conflicts.map((conflict) => <small key={conflict}>{conflict}</small>)}</div></div>}
      <section className="report-section"><SectionHeader index="01" title="Allocation shift" note="Current → target" /><div className="table-wrap"><table className="financial-table"><thead><tr><th>Asset class</th><th>Current</th><th>Target</th><th>Difference</th><th>Action</th></tr></thead><tbody>{comparison.map((row) => { const diff = (row.Target - row.Current) / 100; const action = Math.abs(diff) < .0001 ? "HOLD" : diff > 0 ? "BUY" : "SELL"; return <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.Current.toFixed(2)}%</td><td>{row.Target.toFixed(2)}%</td><td className={diff < 0 ? "negative" : diff > 0 ? "positive" : ""}>{diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${pct(diff)}`}</td><td><span className={`trade-action ${action.toLowerCase()}`}>{action}</span></td></tr>; })}</tbody></table></div></section>
      <section className="report-section"><SectionHeader index="02" title="Current → target" note="Allocation percentage by broad asset group" /><div className="comparison-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={comparison} layout="vertical" margin={{ left: 18, right: 24 }}><CartesianGrid horizontal={false} stroke="#d7cdbf" /><XAxis type="number" unit="%" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} /><Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} /><Bar dataKey="Current" fill="#b9aa99" /><Bar dataKey="Target" fill="#4a342a" /></BarChart></ResponsiveContainer></div></section>
      <section className="report-section objective-report"><SectionHeader index="03" title="Optimization objective" /><p>{proposal?.objective ?? "Run the optimizer to generate a verified allocation."}</p><div className="constraint-list">{["Risk Firewall limits", `Minimum liquidity ${limitsValue(proposal?.limits.minimumLiquidityScore, false)}`, `Maximum turnover ${limitsValue(proposal?.limits.maximumTurnover, true)}`, "Capital conserved · no external funding"].map((item) => <span key={item}><Check size={14} />{item}</span>)}</div><div className="report-actions"><Button disabled={busy} onClick={run}><SlidersHorizontal size={16} />{busy ? "Running optimizer…" : "Run optimization"}</Button><Button variant="outline" onClick={() => navigate("rebalance")}>View rebalance plan</Button></div></section>
    </div>
  );
}

function limitsValue(value: number | undefined, percentage: boolean) {
  if (value == null) return "—";
  return percentage ? pct(value) : value.toFixed(0);
}

export function RecommendationsPage({ portfolio, risk, proposal, navigate }: { portfolio: Portfolio; risk: Risk; proposal?: Rebalance; navigate: (page: PageKey) => void }) {
  const trades = proposal?.trades ?? [];
  const actions = trades.filter((trade) => trade.action !== "HOLD");
  const reduction = proposal?.risk ? (risk.riskScore - proposal.risk.riskScore) / risk.riskScore : 0;
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
      <PageHeader eyebrow="REBALANCE" title="AEGIS intervention plan" description="BUY, SELL and HOLD instructions generated from the funded optimizer target and verified by the Risk Firewall." />
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
            <p>AEGIS recommends {actions.length} capital movements. Portfolio volatility moves from <b>{pct(risk.metrics.volatility)}</b> to <b>{pct(proposal.risk?.metrics.volatility ?? risk.metrics.volatility)}</b>, and active breaches move from <b>{risk.controls.filter((control) => control.status === "BREACH").length}</b> to <b>{proposal.risk?.controls.filter((control) => control.status === "BREACH").length ?? 0}</b>.</p>
          </section>
          <section className="report-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <SectionHeader index="02" title="BUY / SELL / HOLD plan" note="Proposal only · no orders have been placed" />
              <Button variant="outline" onClick={downloadCsv}><Download size={15} />Export Trades (CSV)</Button>
            </div>
            <div className="recommendation-list">
              {trades.map((trade, index) => {
                const asset = portfolio.assets.find((item) => item.id === trade.assetId);
                const reason = trade.action === "SELL" ? `${trade.name} is reduced to repair concentration or risk pressure within the configured limits.` : trade.action === "BUY" ? `${trade.name} receives funded capital to improve diversification, liquidity or portfolio stability.` : `${trade.name} remains unchanged because no trade is required under the optimized allocation.`;
                return (
                  <article key={trade.assetId}>
                    <div className="recommendation-index">{String(index + 1).padStart(2, "0")}</div>
                    <div className="recommendation-action"><span className={`trade-action ${trade.action.toLowerCase()}`}>{trade.action}</span><h2>{trade.name}</h2><small>{asset?.assetClass}</small></div>
                    <div className="recommendation-numbers">
                      <span>Current <b>{pct(trade.stressedWeight)}</b></span><ArrowRight size={16} /><span>Target <b>{pct(trade.targetWeight)}</b></span>
                      <span>Difference <b>{trade.action === "HOLD" ? "—" : `${trade.action === "SELL" ? "−" : "+"}${pct(Math.abs(trade.targetWeight - trade.stressedWeight))}`}</b></span>
                      <span>Amount <b>{money(trade.amount)}</b></span>
                    </div>
                    <div className="recommendation-reason"><span>Reason</span><p>{reason}</p><small>Deterministic rule explanation · Risk Firewall verified.</small></div>
                  </article>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
              <Button variant="outline" onClick={downloadCsv}><Download size={16} />Download Rebalance Plan (CSV)</Button>
              <Button variant="outline" onClick={() => navigate("simulation")}>Apply to Simulation <ArrowRight size={16} /></Button>
            </div>
          </section>
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

export function ControlsPage({ limits, busy, save, embedded = false }: { limits: Limits; busy: boolean; save: (limits: Limits) => Promise<void>; embedded?: boolean }) {
  const [draft, setDraft] = useState<Limits>(limits);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(limits), [limits]);

  async function applyAppetite(appetiteKey: string) {
    const preset = RISK_APPETITES[appetiteKey];
    if (preset) {
      const next = { ...draft, ...preset };
      setDraft(next);
      setSaved(false);
      await save(next);
      setSaved(true);
    }
  }

  async function submit() { setSaved(false); await save(draft); setSaved(true); }

  return (
    <div className={embedded ? "embedded-controls report-section" : "report-page"}>
      {embedded ? <SectionHeader index="04" title="Configure risk controls" note="Shared by Risk, Optimize and Simulation" /> : <PageHeader eyebrow="RISK CONTROLS" title="Portfolio guardrails" description="Configure the shared limits used by risk analysis, simulation and optimization." />}
      
      <div className="report-section" style={{ marginBottom: "1.5rem" }}>
        <SectionHeader index="P" title="Risk Appetite Presets" note="Select a pre-configured risk profile" />
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
          {["CONSERVATIVE", "BALANCED", "GROWTH"].map((appetite) => (
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
      <div className="control-groups">{limitGroups.map((group, groupIndex) => <section className="control-group" key={group.title}><SectionHeader index={String(groupIndex + 1).padStart(2, "0")} title={group.title} />{group.keys.map((key) => { const score = key === "minimumLiquidityScore"; const value = draft[key] ?? 0; return <label className="control-form-row" key={key}><div><strong>{controlNames[key]}</strong><p>{controlHelp[key]}</p></div><div><span>Current limit</span><div><input type="number" min="0" max="100" step="any" value={Number((value * (score ? 1 : 100)).toFixed(4))} onChange={(event) => { setSaved(false); setDraft({ ...draft, [key]: Number(event.target.value) / (score ? 1 : 100) }); }} /><small>{score ? "/ 100" : "%"}</small></div></div></label>; })}</section>)}</div>
      <div className="sticky-form-actions"><div>{saved && <span><Check size={15} />Controls saved and risk recalculated</span>}</div><Button variant="outline" type="button" onClick={() => { setSaved(false); setDraft({ ...DEFAULT_LIMITS }); }}>Reset defaults</Button><Button disabled={busy} type="button" onClick={() => void submit()}>{busy ? "Saving…" : "Save controls"}</Button></div>
    </div>
  );
}
