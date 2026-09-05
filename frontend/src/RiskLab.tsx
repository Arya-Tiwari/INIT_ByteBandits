import { useState } from "react";
import {
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  LockKeyhole,
} from "lucide-react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Button } from "./components/ui/button";
import { api } from "./api";
import type {
  Portfolio,
  Scenario,
  Simulation,
  Rebalance,
  BreachChange,
  Risk,
  Assumption,
} from "./types";
import "./risk-lab.css";
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const money = (v: number) =>
  Math.abs(v) > 0 && Math.abs(v) < 100000
    ? `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    : `₹${(Math.abs(v) / 1e7).toFixed(2)} Cr`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const names: Record<string, string> = {
  maxPortfolioVolatility: "Portfolio volatility",
  maxVaR: "One-day VaR",
  maxCVaR: "One-day CVaR",
  maxSingleAssetWeight: "Single holding",
  maxAssetClassWeight: "Asset class",
  minimumLiquidityScore: "Liquidity floor",
  minimumCashWeight: "Cash reserve",
  maximumTurnover: "Turnover budget",
};
function Firewall({
  changes,
  title,
}: {
  changes: BreachChange[];
  title: string;
}) {
  return (
    <details className="lab-section firewall-disclosure">
      <summary className="lab-section-title">
        <ShieldCheck size={18} />
        <h2>{title}</h2>
        <span>
          {changes.filter((c) => c.after.status === "BREACH").length} remaining
          breaches
        </span>
      </summary>
      <div className="breach-key">
        {["EXISTING", "NEW", "WORSENED", "RESOLVED"].map((k) => (
          <span key={k} className={`change ${k.toLowerCase()}`}>
            {k.toLowerCase()}{" "}
            <b>{changes.filter((c) => c.change === k).length}</b>
          </span>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Policy</th>
              <th>Before → after</th>
              <th>Threshold</th>
              <th>Transition</th>
              <th>Firewall explanation</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => {
              const format =
                c.controlName === "minimumLiquidityScore"
                  ? (v: number) => v.toFixed(1)
                  : pct;
              return (
                <tr key={c.controlName}>
                  <td>{names[c.controlName]}</td>
                  <td>
                    {format(c.before.currentValue)}{" "}
                    <span className="arrow">→</span>{" "}
                    <b>{format(c.after.currentValue)}</b>
                  </td>
                  <td>
                    {c.controlName.startsWith("minimum") ? "≥" : "≤"}{" "}
                    {format(c.after.limit)}
                  </td>
                  <td>
                    <span className={`change ${c.change.toLowerCase()}`}>
                      {c.change.toLowerCase()}
                    </span>
                  </td>
                  <td className="explanation-cell">{c.after.explanation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
function Comparison({ s, r }: { s: Simulation; r?: Rebalance }) {
  const reports: Risk[] = [
    s.riskBefore,
    s.riskAfter,
    ...(r?.risk ? [r.risk] : []),
  ];
  const rows = [
    [
      "Capital",
      ...[
        s.originalPortfolioValue,
        s.stressedPortfolioValue,
        ...(r?.risk ? [r.totalValue] : []),
      ].map(money),
    ],
    ["Risk score", ...reports.map((x) => x.riskScore.toFixed(1))],
    ["Annualized volatility", ...reports.map((x) => pct(x.metrics.volatility))],
    ["One-day VaR · 95%", ...reports.map((x) => pct(x.metrics.var95))],
    ["One-day CVaR · 95%", ...reports.map((x) => pct(x.metrics.cvar95))],
    [
      "Liquidity / 100",
      ...reports.map((x) => x.metrics.liquidityScore.toFixed(1)),
    ],
  ];
  return (
    <section className="lab-section">
      <div className="lab-section-title">
        <h2>Post-shock allocation risk</h2>
        <span>Same history · changed weights</span>
      </div>
      <p className="risk-interpretation">
        These metrics use unchanged historical returns. They describe the new
        allocation, not a forecast of crisis volatility. A lower score does not
        reverse the capital loss.
      </p>
      <div className="table-wrap">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Measure</th>
              <th>01 / Current</th>
              <th>02 / Stressed</th>
              {r?.risk && <th>03 / Rebalanced</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export default function RiskLab({
  portfolio,
  scenarios,
  onEvent,
}: {
  portfolio: Portfolio;
  scenarios: Scenario[];
  onEvent?: (title: string, detail: string) => void;
}) {
  const [selected, setSelected] = useState("market-crash"),
    [classShocks, setClassShocks] = useState<Record<string, string>>({
      Equity: "-15",
      Gold: "5",
    }),
    [assetShocks, setAssetShocks] = useState<Record<string, string>>({}),
    [withdrawal, setWithdrawal] = useState("10"),
    [unit, setUnit] = useState("percent"),
    [result, setResult] = useState<Simulation>(),
    [proposal, setProposal] = useState<Rebalance>(),
    [busy, setBusy] = useState<"run" | "rebalance" | null>(null),
    [error, setError] = useState("");
  const scenario = scenarios.find((s) => s.id === selected);
  const classes = [...new Set(portfolio.assets.map((a) => a.assetClass))];
  function invalidate() {
    setResult(undefined);
    setProposal(undefined);
    setError("");
  }
  function changeScenario(id: string) {
    setSelected(id);
    invalidate();
  }
  function number(raw: string, label: string) {
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n) || n < -100 || n > 10000)
      throw new Error(`${label}: enter a finite shock from −100% to +10000%.`);
    return n;
  }
  const preview: Assumption[] =
    selected === "custom"
      ? portfolio.assets.map((a) => ({
          assetId: a.id,
          name: a.name,
          assetClass: a.assetClass,
          shockPercent: Number(
            assetShocks[a.id]?.trim()
              ? assetShocks[a.id]
              : classShocks[a.assetClass] || "0",
          ),
          liquidityBefore: a.liquidityScore,
          liquidityAfter: a.liquidityScore,
          basis: assetShocks[a.id]?.trim() ? "Asset override" : "Class default",
        }))
      : (scenario?.assumptions ?? []);
  async function run() {
    setBusy("run");
    invalidate();
    try {
      let path = "/simulate",
        body: unknown = { scenarioId: selected };
      if (selected === "custom") {
        const shocks = Object.fromEntries(
          classes.map((c) => [c, number(classShocks[c] ?? "0", c)]),
        );
        const overrides = Object.fromEntries(
          Object.entries(assetShocks)
            .filter(([, v]) => v.trim() !== "")
            .map(([id, v]) => [
              id,
              number(v, portfolio.assets.find((a) => a.id === id)?.name ?? id),
            ]),
        );
        path += "/custom";
        body = { name: "Custom Scenario", shocks, assetShocks: overrides };
      }
      if (selected === "withdrawal") {
        const n = Number(withdrawal);
        if (
          !withdrawal.trim() ||
          !Number.isFinite(n) ||
          n <= 0 ||
          (unit === "percent" && n > 100)
        )
          throw new Error(
            "Enter a positive withdrawal; percentage withdrawals cannot exceed 100%.",
          );
        path += "/withdrawal";
        body =
          unit === "percent"
            ? { withdrawalPercent: n }
            : { withdrawalAmount: n * 1e7 };
      }
      const nextResult = await api<Simulation>(path, body);
      setResult(nextResult);
      onEvent?.(`${nextResult.scenarioName} simulated`, `${nextResult.marketLoss < 0 ? "Market gain" : "Market loss"} ${money(nextResult.marketLoss)}; ${nextResult.breachedControls.length} controls breached after shock.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function rebalance() {
    if (!result) return;
    setBusy("rebalance");
    setError("");
    setProposal(undefined);
    try {
      const nextProposal = await api<Rebalance>(`/simulate/${result.simulationId}/rebalance`, {});
      setProposal(nextProposal);
      onEvent?.("Stress intervention generated", nextProposal.status === "FEASIBLE" ? `AEGIS proposed ${nextProposal.trades.filter((trade) => trade.action !== "HOLD").length} funded trades and rechecked the stressed portfolio.` : nextProposal.explanation);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="risk-lab">
      <div className="lab-ribbon">
        <span>
          <i />
          SIMULATION ONLY
        </span>
        <span>
          01 Shock <ArrowRight size={13} /> 02 Firewall <ArrowRight size={13} />{" "}
          03 Rebalance
        </span>
        <span>Synthetic data / {portfolio.historyObservations} days</span>
      </div>
      <div className="lab-workbench">
        <div className="scenario-rail">
          <div className="rail-label">
            SCENARIO LIBRARY{" "}
            <span>{scenarios.length.toString().padStart(2, "0")}</span>
          </div>
          {scenarios.map((s) => (
            <button
              key={s.id}
              disabled={!!busy}
              onClick={() => changeScenario(s.id)}
              aria-pressed={selected === s.id}
              className={selected === s.id ? "chosen" : ""}
            >
              <b>{s.name}</b>
              {selected === s.id && <ArrowRight size={16} />}
            </button>
          ))}
          <div className="rail-note">
            <LockKeyhole size={16} />
            <p>
              Original holdings stay untouched. Every response is a temporary
              portfolio.
            </p>
          </div>
        </div>
        <section className="shock-sheet">
          <div className="sheet-heading">
            <div>
              <span className="lab-kicker">01 / DEFINE THE SHOCK</span>
              <h2>{scenario?.name}</h2>
              <p>{scenario?.description}</p>
            </div>
            <span className="sheet-code">CG—LAB</span>
          </div>
          {selected === "custom" && (
            <>
              <div className="defaults-heading">
                <SlidersHorizontal size={16} />
                <h3>Class defaults</h3>
                <span>Blank holding overrides inherit these values</span>
              </div>
              <div className="class-defaults">
                {classes.map((c) => (
                  <label key={c}>
                    {c}
                    <div>
                      <input
                        aria-label={`${c} class shock`}
                        disabled={!!busy}
                        type="number"
                        min="-100"
                        max="10000"
                        step="any"
                        value={classShocks[c] ?? "0"}
                        onChange={(e) => {
                          setClassShocks({
                            ...classShocks,
                            [c]: e.target.value,
                          });
                          invalidate();
                        }}
                      />
                      <span>%</span>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
          {selected === "withdrawal" ? (
            <div className="withdrawal-sheet">
              <label>
                Withdrawal amount
                <input
                  disabled={!!busy}
                  type="number"
                  min="0.01"
                  step="any"
                  value={withdrawal}
                  onChange={(e) => {
                    setWithdrawal(e.target.value);
                    invalidate();
                  }}
                />
              </label>
              <label>
                Unit
                <select
                  disabled={!!busy}
                  value={unit}
                  onChange={(e) => {
                    setUnit(e.target.value);
                    invalidate();
                  }}
                >
                  <option value="percent">% of current portfolio</option>
                  <option value="amount">₹ Crore</option>
                </select>
              </label>
              <p>
                Cash is used first, followed by holdings with liquidity scores
                ≥70. If eligible capital is insufficient, no sale is simulated.
                Withdrawals consume the turnover budget.
              </p>
            </div>
          ) : (
            <>
              {selected !== "custom" && (
                <div className="assumption-cards">
                  {classes.map((cls) => {
                    const rows = preview.filter((a) => a.assetClass === cls);
                    const low = Math.min(...rows.map((a) => a.shockPercent));
                    const high = Math.max(...rows.map((a) => a.shockPercent));
                    return (
                      <div className="assumption-card" key={cls}>
                        <span>{cls}</span>
                        <strong className={low < 0 ? "negative" : "positive"}>
                          {signed(low)}
                          {low !== high && ` to ${signed(high)}`}
                        </strong>
                        <div className="assumption-track">
                          <i
                            style={{
                              width: `${Math.min(Math.max(Math.abs(low), Math.abs(high)), 100)}%`,
                              background: low < 0 ? "#b65b60" : "#2b8d84",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <details
                className="disclosure"
                key={selected}
                open={selected === "custom"}
              >
                <summary>
                  {selected === "custom"
                    ? "Individual holding overrides"
                    : "View holding-level assumptions"}{" "}
                  <span>{preview.length} holdings</span>
                </summary>
                <div className="table-wrap">
                  <table className="shock-table">
                    <thead>
                      <tr>
                        <th>Holding</th>
                        <th>Class default / basis</th>
                        {selected === "custom" && <th>Holding override %</th>}
                        <th>Effective shock</th>
                        <th>Liquidity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((a) => (
                        <tr key={a.assetId}>
                          <td>
                            <strong>{a.name}</strong>
                            <small>{a.assetClass}</small>
                          </td>
                          <td>
                            {selected === "custom"
                              ? `${classShocks[a.assetClass] || 0}% default`
                              : a.basis}
                          </td>
                          {selected === "custom" && (
                            <td>
                              <input
                                aria-label={`${a.name} override`}
                                disabled={!!busy}
                                type="number"
                                min="-100"
                                max="10000"
                                step="any"
                                placeholder="Inherit"
                                value={assetShocks[a.assetId] ?? ""}
                                onChange={(e) => {
                                  setAssetShocks({
                                    ...assetShocks,
                                    [a.assetId]: e.target.value,
                                  });
                                  invalidate();
                                }}
                              />
                            </td>
                          )}
                          <td>
                            <div className="shock-meter">
                              <span
                                className={
                                  a.shockPercent < 0 ? "negative" : "positive"
                                }
                              >
                                {Number.isFinite(a.shockPercent)
                                  ? signed(a.shockPercent)
                                  : "Invalid"}
                              </span>
                              <div>
                                <i
                                  className={
                                    a.shockPercent < 0 ? "negative" : "positive"
                                  }
                                  style={{
                                    width: `${Number.isFinite(a.shockPercent) ? Math.min(Math.abs(a.shockPercent), 100) : 0}%`,
                                  }}
                                />
                              </div>
                            </div>
                            {selected === "custom" &&
                              a.basis === "Asset override" && (
                                <small>Override applied</small>
                              )}
                          </td>
                          <td>
                            {a.liquidityBefore.toFixed(0)}
                            {a.liquidityAfter !== a.liquidityBefore && (
                              <>
                                {" "}
                                → <b>{a.liquidityAfter.toFixed(1)}</b>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
          <div className="sheet-action">
            <p>
              {selected === "custom"
                ? "Explicit zero overrides the class shock. Range: −100% to +10000%."
                : "Assumptions shown above are applied to the current portfolio."}
            </p>
            <Button disabled={!!busy} onClick={run}>
              <Play size={15} />
              {busy === "run" ? "Applying shock…" : "Run simulation"}
            </Button>
          </div>
        </section>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="lab-results" aria-live="polite">
          <div className="result-heading">
            <span className="lab-kicker">02 / TRACE THE CONSEQUENCES</span>
            <h2>{result.scenarioName}</h2>
          </div>
          <div className="capital-bridge">
            <div>
              <span>Current capital</span>
              <strong>{money(result.originalPortfolioValue)}</strong>
            </div>
            <ArrowRight className="bridge-arrow" />
            <div className={result.marketLoss > 0 ? "negative" : "positive"}>
              <span>Market {result.marketLoss < 0 ? "gain" : "loss"}</span>
              <strong>
                {result.marketLoss < 0 ? <ArrowUpRight /> : <ArrowDownRight />}
                {money(result.marketLoss)}
              </strong>
            </div>
            <div>
              <span>Capital withdrawn</span>
              <strong>{money(result.withdrawalAmount)}</strong>
            </div>
            <ArrowRight className="bridge-arrow" />
            <div>
              <span>Remaining capital</span>
              <strong>{money(result.stressedPortfolioValue)}</strong>
            </div>
          </div>
          <p className="scenario-explanation">{result.explanation}</p>
          {result.stressedPortfolioValue === 0 && (
            <div role="status" className="zero-capital">
              No capital remains. All weights are zero; allocation risk metrics
              are not meaningful for investment decisions. A rebalance cannot
              add external funding.
            </div>
          )}
          <Comparison
            s={result}
            r={proposal?.status === "FEASIBLE" ? proposal : undefined}
          />
          <section className="lab-section">
            <div className="lab-section-title">
              <h2>Where capital moved</h2>
              <span>Asset-class values / ₹ Cr</span>
            </div>
            <div className="lab-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={result.assetClassImpacts.map((a) => ({
                    name: a.name,
                    Current: a.originalValue / 1e7,
                    Stressed: a.stressedValue / 1e7,
                    ...(proposal?.status === "FEASIBLE"
                      ? {
                          Rebalanced:
                            proposal.assets
                              .filter((x) => x.assetClass === a.assetClass)
                              .reduce((v, x) => v + x.currentValue, 0) / 1e7,
                        }
                      : {}),
                  }))}
                  margin={{ bottom: 42, right: 15 }}
                >
                  <CartesianGrid vertical={false} stroke="#d7cdbf" />
                  <XAxis
                    dataKey="name"
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(2)} Cr`} />
                  <Legend verticalAlign="top" />
                  <Bar dataKey="Current" fill="#b9aa99" />
                  <Bar dataKey="Stressed" fill="#4a342a" />
                  {proposal?.status === "FEASIBLE" && (
                    <Bar dataKey="Rebalanced" fill="#b17a27" />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <Firewall
            changes={result.firewallChanges}
            title="Risk Firewall · current → stressed"
          />
          <section className="rebalance-station" id="optimisation">
            <div>
              <span className="lab-kicker">03 / OPTIMISATION</span>
              <h2>Generate a safer allocation</h2>
              <p>
                Use the stressed holdings and their liquidity scores. Respect
                the same policy limits, remaining capital and cumulative
                turnover budget. The objective is lower historical variance, not
                minimum trading. It may use the full budget when additional
                trading reduces risk.
              </p>
            </div>
            <Button
              disabled={!!busy || result.breachedControls.length === 0}
              onClick={rebalance}
            >
              {busy === "rebalance"
                ? "Finding a funded allocation…"
                : "Generate safer rebalance"}
              <ArrowRight size={16} />
            </Button>
            {result.breachedControls.length === 0 && (
              <p>Every policy is satisfied. No repair is required.</p>
            )}
          </section>
          {proposal && (
            <section
              id="recommended-trades"
              className={`proposal ${proposal.status === "FEASIBLE" ? "feasible" : "infeasible"}`}
              role="status"
            >
              <span className="lab-kicker">04 / RECOMMENDED TRADES</span>
              <div className="lab-section-title">
                <h2>
                  {proposal.status === "FEASIBLE"
                    ? "Funded proposal · Firewall passed"
                    : proposal.status === "INFEASIBLE"
                      ? "No feasible rebalance"
                      : "No verified solution found"}
                </h2>
                <span>PROPOSAL ONLY</span>
              </div>
              <div className="objective-note">
                <strong>Objective: minimize historical risk</strong>
                <p>{proposal.objective}</p>
                <small>
                  Minimum trade: ₹
                  {proposal.minimumTradeAmount.toLocaleString("en-IN")}. Smaller
                  trades are frozen, then funding and constraints are rechecked.
                </small>
              </div>
              <p>{proposal.explanation}</p>
              {proposal.conflicts.length > 0 && (
                <ul>
                  {proposal.conflicts.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              {proposal.status === "FEASIBLE" && (
                <>
                  <div className="proposal-stats">
                    <span>
                      Rebalance turnover<b>{pct(proposal.turnover)}</b>
                      <small>of stressed capital</small>
                    </span>
                    <span>
                      Cumulative turnover
                      <b>
                        {pct(proposal.cumulativeTurnover)} /{" "}
                        {pct(proposal.limits.maximumTurnover)}
                      </b>
                      <small>of original capital, including withdrawal</small>
                    </span>
                    <span>
                      External capital<b>{money(proposal.externalCapital)}</b>
                      <small>Sales fund purchases</small>
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Holding</th>
                          <th>Proposed trade</th>
                          <th>Amount</th>
                          <th>Stressed → target</th>
                          <th>Target value</th>
                          <th>Tradability</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proposal.trades.map((t) => (
                          <tr key={t.assetId}>
                            <td>{t.name}</td>
                            <td
                              className={
                                t.action === "SELL" ? "negative" : "positive"
                              }
                            >
                              {t.action}
                            </td>
                            <td>{money(t.amount)}</td>
                            <td>
                              {pct(t.stressedWeight)} →{" "}
                              <b>{pct(t.targetWeight)}</b>
                            </td>
                            <td>{money(t.targetValue)}</td>
                            <td>
                              {t.locked ? "Locked" : "Eligible"} ·{" "}
                              {t.liquidityScore.toFixed(1)}/100
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Firewall
                    changes={proposal.firewallChanges}
                    title="Risk Firewall · stressed → rebalanced"
                  />
                </>
              )}
            </section>
          )}
          <details className="lab-section ledger-disclosure">
            <summary className="lab-section-title">
              <h2>Holding impact ledger</h2>
              <span>Positive changes are gains</span>
            </summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Holding</th>
                    <th>Current</th>
                    <th>Stressed</th>
                    <th>
                      {result.withdrawalAmount
                        ? "Capital removed"
                        : "Market change"}
                    </th>
                    <th>Weight before → after</th>
                  </tr>
                </thead>
                <tbody>
                  {result.assetImpacts.map((a) => (
                    <tr key={a.name}>
                      <td>{a.name}</td>
                      <td>{money(a.originalValue)}</td>
                      <td>{money(a.stressedValue)}</td>
                      <td
                        className={a.absoluteLoss > 0 ? "negative" : "positive"}
                      >
                        {a.absoluteLoss === 0
                          ? "Unchanged"
                          : `${money(a.absoluteLoss)} ${result.withdrawalAmount ? "withdrawn" : a.absoluteLoss < 0 ? "gain" : "loss"} (${pct(Math.abs(a.percentageLoss))})`}
                      </td>
                      <td>
                        {pct(a.originalWeight)} → {pct(a.stressedWeight)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
