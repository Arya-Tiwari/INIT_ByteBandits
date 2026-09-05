/** Browser-only finance engine for the 48-feature hackathon plan. */

export const RISK_APPETITES = {
  CONSERVATIVE: { minimumLiquidity: 25, maximumEquityExposure: 35, maximumSectorConcentration: 25, maximumCVaR: 0.035, maximumDrawdown: 0.12, transactionCostBps: 15 },
  BALANCED: { minimumLiquidity: 20, maximumEquityExposure: 45, maximumSectorConcentration: 30, maximumCVaR: 0.05, maximumDrawdown: 0.18, transactionCostBps: 15 },
  GROWTH: { minimumLiquidity: 12, maximumEquityExposure: 65, maximumSectorConcentration: 40, maximumCVaR: 0.07, maximumDrawdown: 0.25, transactionCostBps: 15 },
};

export const PRESET_SCENARIOS = {
  MARKET_CRASH: { id: "MARKET_CRASH", name: "Market Crash", shocks: { Equity: -0.22, Bond: -0.04, Gold: 0.06, Cash: 0, "Real Estate": -0.12 } },
  INTEREST_RATE_SHOCK: { id: "INTEREST_RATE_SHOCK", name: "Interest Rate Shock", shocks: { Equity: -0.08, Bond: -0.12, Gold: 0.02, Cash: 0, "Real Estate": -0.09 } },
  LIQUIDITY_CRISIS: { id: "LIQUIDITY_CRISIS", name: "Liquidity Crisis", shocks: { Equity: -0.12, Bond: -0.06, Gold: -0.03, Cash: 0, "Real Estate": -0.18 }, withdrawalPercent: 8 },
};

export const FINANCE_TOOLTIPS = {
  liquidity: "The percentage of capital that can be accessed quickly, such as cash or Treasury Bills.",
  volatility: "How sharply portfolio value can move up and down. Higher means less predictable.",
  valueAtRisk: "Estimated loss threshold in a normal bad period at the selected confidence level.",
  conditionalVaR: "Average loss during the worst periods beyond Value at Risk.",
  turnover: "The percentage of the portfolio that must be traded to reach the new allocation.",
  safetyScore: "A 0-100 health score combining liquidity, concentration, tail risk, and drawdown controls.",
};

const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const clone = (value) => structuredClone(value);
const sum = (items) => items.reduce((total, item) => total + item, 0);
const isEquity = (asset) => asset.assetClass?.toLowerCase() === "equity";
const isLiquid = (asset) => asset.isLiquid ?? asset.assetClass === "Cash";

export function createDemoPortfolio() {
  return {
    portfolioValue: 1_000_000_000,
    riskAppetite: "BALANCED",
    humanMode: "APPROVAL_REQUIRED",
    assets: [
      { id: "india-equity", name: "Indian Equity Fund", assetClass: "Equity", sector: "Diversified", weight: 30, expectedReturn: 0.13, volatility: 0.22, liquidityScore: 85 },
      { id: "us-equity", name: "US Equity Fund", assetClass: "Equity", sector: "Technology", weight: 18, expectedReturn: 0.12, volatility: 0.24, liquidityScore: 85 },
      { id: "govt-bonds", name: "Government Bonds", assetClass: "Bond", sector: "Government", weight: 22, expectedReturn: 0.07, volatility: 0.08, liquidityScore: 85, isLiquid: true },
      { id: "gold", name: "Gold Reserve", assetClass: "Gold", sector: "Commodities", weight: 10, expectedReturn: 0.07, volatility: 0.15, liquidityScore: 65 },
      { id: "real-estate", name: "Real Estate Fund", assetClass: "Real Estate", sector: "Real Estate", weight: 8, expectedReturn: 0.09, volatility: 0.12, liquidityScore: 20 },
      { id: "cash", name: "Cash Reserve", assetClass: "Cash", sector: "Cash", weight: 12, expectedReturn: 0.04, volatility: 0.01, liquidityScore: 100, isLiquid: true },
    ],
  };
}

export function validatePortfolio(portfolio) {
  const totalWeight = sum(portfolio.assets.map((asset) => Number(asset.weight)));
  if (Math.abs(totalWeight - 100) > 0.01) throw new Error(`Asset weights must total 100%. Current total: ${round(totalWeight, 2)}%.`);
  if (portfolio.assets.some((asset) => !asset.id || Number(asset.weight) < 0)) throw new Error("Every asset needs an id and non-negative weight.");
  if (!portfolio.assets.some(isLiquid)) throw new Error("Mark at least one asset as liquid.");
  return true;
}

export function resolveControls(portfolio) {
  return { ...RISK_APPETITES[portfolio.riskAppetite ?? "BALANCED"], ...(portfolio.constraints ?? {}) };
}

function generatedReturns(asset, periods = 120) {
  if (Array.isArray(asset.returnSeries) && asset.returnSeries.length >= 20) return asset.returnSeries.map(Number);
  const pattern = [-1.3, -0.8, -0.4, 0, 0.3, 0.7, 1.1, 0.5, -0.6, 0.2];
  return Array.from({ length: periods }, (_, index) => asset.expectedReturn / 252 + asset.volatility / Math.sqrt(252) * pattern[index % pattern.length]);
}

function percentile(values, p) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.min(ordered.length - 1, Math.floor((1 - p) * ordered.length)))];
}

function maxDrawdown(returns) {
  let value = 1; let peak = 1; let drawdown = 0;
  returns.forEach((change) => { value *= 1 + change; peak = Math.max(peak, value); drawdown = Math.min(drawdown, value / peak - 1); });
  return Math.abs(drawdown);
}

export function analyzePortfolio(portfolio) {
  validatePortfolio(portfolio);
  const controls = resolveControls(portfolio);
  const assets = portfolio.assets;
  const weights = assets.map((asset) => asset.weight / 100);
  const expectedReturn = sum(assets.map((asset, index) => weights[index] * asset.expectedReturn));
  const volatility = Math.sqrt(sum(assets.map((asset, index) => (weights[index] * asset.volatility) ** 2)));
  const combinedReturns = Array.from({ length: 120 }, (_, day) => sum(assets.map((asset, index) => weights[index] * generatedReturns(asset)[day])));
  const valueAtRisk95 = Math.abs(percentile(combinedReturns, 0.95));
  const tail = combinedReturns.filter((value) => value <= -valueAtRisk95);
  const conditionalVaR95 = Math.abs(tail.length ? sum(tail) / tail.length : -valueAtRisk95);
  const liquidityRatio = sum(assets.filter(isLiquid).map((asset) => asset.weight));
  const equityExposure = sum(assets.filter(isEquity).map((asset) => asset.weight));
  const sectors = Object.values(assets.filter(isEquity).reduce((output, asset) => ({ ...output, [asset.sector]: (output[asset.sector] ?? 0) + asset.weight }), {}));
  const maximumSectorConcentration = Math.max(0, ...sectors);
  const maximumDrawdown = maxDrawdown(combinedReturns);
  const sharpeRatio = volatility ? (expectedReturn - 0.06) / volatility : 0;
  const riskContribution = assets.map((asset, index) => ({ asset: asset.name, value: volatility ? round(weights[index] * asset.volatility / volatility) : 0 }));
  const metrics = { expectedReturn: round(expectedReturn), volatility: round(volatility), sharpeRatio: round(sharpeRatio), liquidityRatio: round(liquidityRatio, 2), equityExposure: round(equityExposure, 2), maximumSectorConcentration: round(maximumSectorConcentration, 2), valueAtRisk95: round(valueAtRisk95), conditionalVaR95: round(conditionalVaR95), maximumDrawdown: round(maximumDrawdown), riskContribution };
  const checks = [
    ["Liquidity", liquidityRatio >= controls.minimumLiquidity, liquidityRatio, controls.minimumLiquidity, "minimum"],
    ["Equity exposure", equityExposure <= controls.maximumEquityExposure, equityExposure, controls.maximumEquityExposure, "maximum"],
    ["Sector concentration", maximumSectorConcentration <= controls.maximumSectorConcentration, maximumSectorConcentration, controls.maximumSectorConcentration, "maximum"],
    ["CVaR", conditionalVaR95 <= controls.maximumCVaR, conditionalVaR95, controls.maximumCVaR, "maximum"],
    ["Maximum drawdown", maximumDrawdown <= controls.maximumDrawdown, maximumDrawdown, controls.maximumDrawdown, "maximum"],
  ].map(([control, passed, value, limit, direction]) => ({ control, passed, value: round(value), limit, direction, severity: passed ? "SAFE" : Math.abs(value - limit) / Math.max(limit, 0.01) > 0.25 ? "CRITICAL" : "WARNING" }));
  const safetyScore = Math.max(0, round(100 - checks.reduce((penalty, check) => penalty + (check.passed ? 0 : check.severity === "CRITICAL" ? 18 : 10), 0) - volatility * 40, 2));
  return { ...metrics, safetyScore, controls, checks, alerts: checks.filter((check) => !check.passed), riskTrend: combinedReturns.map((value, index) => ({ day: index + 1, return: round(value), safetyScore: round(Math.max(0, safetyScore - Math.abs(value) * 50)) })), lastAnalysisAt: new Date().toISOString(), monitoring: { active: true, controlsMonitored: checks.length } };
}

function transfer(assets, sourceIndex, destinationIndex, amount) {
  const moved = Math.min(amount, assets[sourceIndex].weight, 100 - assets[destinationIndex].weight);
  assets[sourceIndex].weight = round(assets[sourceIndex].weight - moved, 2);
  assets[destinationIndex].weight = round(assets[destinationIndex].weight + moved, 2);
  return moved;
}

function recipientIndex(assets, sourceIndex, filter, preferSafety = false) {
  const candidates = assets.map((asset, index) => ({ asset, index })).filter(({ asset, index }) => index !== sourceIndex && filter(asset));
  if (!candidates.length) throw new Error("No suitable asset can receive the rebalance.");
  return candidates.sort((first, second) => preferSafety ? first.asset.volatility - second.asset.volatility || second.asset.expectedReturn - first.asset.expectedReturn : second.asset.expectedReturn - first.asset.expectedReturn || first.asset.volatility - second.asset.volatility)[0].index;
}

export function optimizeCapital(portfolio) {
  const current = clone(portfolio); const controls = resolveControls(current); const before = analyzePortfolio(current); const target = clone(current); const reasons = [];
  if (before.liquidityRatio < controls.minimumLiquidity) {
    const source = target.assets.map((asset, index) => ({ asset, index })).filter(({ asset }) => !isLiquid(asset)).sort((a, b) => b.asset.volatility - a.asset.volatility)[0].index;
    const destination = recipientIndex(target.assets, source, isLiquid); const gap = controls.minimumLiquidity - before.liquidityRatio;
    transfer(target.assets, source, destination, gap); reasons.push(`Liquidity is ${before.liquidityRatio}%, below the required ${controls.minimumLiquidity}% limit.`);
  }
  const sectorWeights = target.assets.filter(isEquity).reduce((output, asset) => ({ ...output, [asset.sector]: (output[asset.sector] ?? 0) + asset.weight }), {});
  Object.entries(sectorWeights).forEach(([sector, weight]) => { if (weight > controls.maximumSectorConcentration) { const source = target.assets.map((asset, index) => ({ asset, index })).filter(({ asset }) => isEquity(asset) && asset.sector === sector).sort((a, b) => b.asset.volatility - a.asset.volatility)[0].index; const destination = recipientIndex(target.assets, source, (asset) => asset.sector !== sector, true); transfer(target.assets, source, destination, weight - controls.maximumSectorConcentration); reasons.push(`${sector} concentration is ${round(weight, 2)}%, above the ${controls.maximumSectorConcentration}% limit.`); } });
  const targetEquity = sum(target.assets.filter(isEquity).map((asset) => asset.weight));
  if (targetEquity > controls.maximumEquityExposure) { const source = target.assets.map((asset, index) => ({ asset, index })).filter(({ asset }) => isEquity(asset)).sort((a, b) => b.asset.volatility - a.asset.volatility)[0].index; const destination = recipientIndex(target.assets, source, (asset) => !isEquity(asset), true); transfer(target.assets, source, destination, targetEquity - controls.maximumEquityExposure); reasons.push(`Equity exposure is ${round(targetEquity, 2)}%, above the ${controls.maximumEquityExposure}% limit.`); }
  const after = analyzePortfolio(target); const trades = target.assets.flatMap((asset) => { const currentAsset = current.assets.find((item) => item.id === asset.id); const difference = round(asset.weight - currentAsset.weight, 2); return Math.abs(difference) < 0.01 ? [] : [{ assetId: asset.id, asset: asset.name, action: difference > 0 ? "BUY" : "SELL", weightChange: Math.abs(difference), amount: round(Math.abs(difference) / 100 * current.portfolioValue, 2), reason: difference > 0 && isLiquid(asset) ? "Restore liquidity buffer." : difference < 0 && isEquity(asset) ? "Reduce downside and concentration risk." : "Move capital toward the target allocation." }]; });
  const turnoverPercent = round(sum(trades.filter((trade) => trade.action === "SELL").map((trade) => trade.weightChange)), 2); const turnoverValue = round(turnoverPercent / 100 * current.portfolioValue, 2); const transactionCost = round(turnoverValue * controls.transactionCostBps / 10_000, 2); const estimatedBenefit = round(Math.max(0, after.safetyScore - before.safetyScore) / 100 * current.portfolioValue * 0.05 + Math.max(0, after.expectedReturn - before.expectedReturn) * current.portfolioValue, 2); const benefitCostRatio = transactionCost ? round(estimatedBenefit / transactionCost, 2) : null;
  const decision = !trades.length || (benefitCostRatio !== null && benefitCostRatio < 1) ? "HOLD" : "REBALANCE";
  return { decision, summary: decision === "HOLD" ? "No cost-efficient rebalance is required." : "Rebalance is recommended to restore portfolio safety limits.", currentAllocation: current.assets, optimizedAllocation: decision === "HOLD" ? current.assets : target.assets, beforeMetrics: before, afterMetrics: decision === "HOLD" ? before : after, violations: before.alerts.map((alert) => alert.control), trades: decision === "HOLD" ? [] : trades, turnoverPercent: decision === "HOLD" ? 0 : turnoverPercent, turnoverValue: decision === "HOLD" ? 0 : turnoverValue, transactionCost: decision === "HOLD" ? 0 : transactionCost, costBenefit: { estimatedBenefit, benefitCostRatio }, tradeoff: { safetyScoreChange: round(after.safetyScore - before.safetyScore, 2), expectedReturnChange: round(after.expectedReturn - before.expectedReturn), volatilityChange: round(after.volatility - before.volatility), liquidityChange: round(after.liquidityRatio - before.liquidityRatio, 2), transactionCost }, explanation: { headline: reasons[0] ?? "Portfolio is within controls.", reasons: reasons.length ? reasons : ["All monitored controls are within limits."], decisionTrace: `Decision: ${decision}. Safety Score ${before.safetyScore} to ${after.safetyScore}; estimated cost ${transactionCost}.` } };
}

export function runScenario(portfolio, scenario) {
  const shocks = { ...(scenario.shocks ?? {}), ...(scenario.customShocks ?? {}) }; const lossContribution = portfolio.assets.map((asset) => { const shock = Number(shocks[asset.id] ?? shocks[asset.assetClass] ?? 0); return { asset: asset.name, shock, loss: round(portfolio.portfolioValue * asset.weight / 100 * Math.max(0, -shock), 2) }; }); const loss = round(sum(lossContribution.map((item) => item.loss)), 2); const withdrawal = round(portfolio.portfolioValue * Number(scenario.withdrawalPercent ?? 0) / 100, 2); const liquidCapital = round(portfolio.portfolioValue * sum(portfolio.assets.filter(isLiquid).map((asset) => asset.weight)) / 100, 2);
  return { id: crypto.randomUUID(), timestamp: new Date().toISOString(), scenario: scenario.name ?? "Custom Scenario", loss, withdrawal, withdrawalCovered: liquidCapital >= withdrawal, lossContribution, worstAffectedAsset: [...lossContribution].sort((a, b) => b.loss - a.loss)[0]?.asset ?? null };
}

export function compareStress(portfolio, scenario) { const current = runScenario(portfolio, scenario); const recommendation = optimizeCapital(portfolio); const optimized = runScenario({ ...portfolio, assets: recommendation.optimizedAllocation }, scenario); return { current, optimized, capitalProtected: round(current.loss - optimized.loss, 2), recommendation }; }
export function routeIncomingCapital(portfolio, incomingCapital) { const result = clone(portfolio); const controls = resolveControls(result); const cash = result.assets.find(isLiquid); const needed = Math.max(0, controls.minimumLiquidity - analyzePortfolio(result).liquidityRatio) / 100 * result.portfolioValue; const routed = Math.min(Number(incomingCapital), needed); cash.weight = round(cash.weight + routed / result.portfolioValue * 100, 2); const remaining = Number(incomingCapital) - routed; return { portfolio: result, routedToLiquidity: routed, remainingCapital: remaining }; }
export function parsePortfolioCsv(text) { const [header, ...rows] = text.trim().split(/\r?\n/); const keys = header.split(",").map((key) => key.trim()); return rows.filter(Boolean).map((row) => Object.fromEntries(row.split(",").map((value, index) => [keys[index], value.trim()]))).map((asset) => ({ ...asset, weight: Number(asset.weight), expectedReturn: Number(asset.expectedReturn), volatility: Number(asset.volatility), isLiquid: asset.isLiquid === "true" })); }
export function exportRebalanceCsv(recommendation) { return ["asset,action,weightChange,amount,reason", ...recommendation.trades.map((trade) => [trade.asset, trade.action, trade.weightChange, trade.amount, `"${trade.reason}"`].join(","))].join("\n"); }
export function exportDecisionLog(entries, format = "json") { if (format === "json") return JSON.stringify(entries, null, 2); return ["id,timestamp,action,decision,summary", ...entries.map((entry) => [entry.id, entry.timestamp, entry.action, entry.decision, `"${entry.summary}"`].join(","))].join("\n"); }
export class DecisionLog { constructor(entries = []) { this.entries = entries; } record(recommendation) { const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), action: "RECOMMENDED", decision: recommendation.decision, summary: recommendation.summary, trades: recommendation.trades }; this.entries.unshift(entry); return entry; } update(id, action) { const entry = this.entries.find((item) => item.id === id); if (!entry) throw new Error("Decision log entry was not found."); entry.action = action; return entry; } }
export function saveScenarioHistory(history) { localStorage.setItem("aegis-scenario-history", JSON.stringify(history)); }
export function loadScenarioHistory() { try { return JSON.parse(localStorage.getItem("aegis-scenario-history") ?? "[]"); } catch { return []; } }
export function operatingMode(analysis) { if (analysis.conditionalVaR95 > analysis.controls.maximumCVaR || analysis.maximumDrawdown > analysis.controls.maximumDrawdown) return "DEFENSIVE"; if (analysis.alerts.length) return "CAUTION"; return "NORMAL"; }
