export const FINANCE_TOOLTIPS = {
  liquidity: "The capital-weighted holding liquidity score from 0 to 100; it is not a percentage of immediately redeemable capital.",
  volatility: "How sharply portfolio value can move up and down. Higher means less predictable.",
  valueAtRisk: "Estimated loss threshold in a normal bad period at the selected confidence level.",
  conditionalVaR: "Average loss during the worst periods beyond Value at Risk.",
  turnover: "The percentage of the portfolio that must be traded to reach the new allocation.",
  concentration: "Herfindahl index: the sum of squared portfolio weights. A higher value means more concentrated capital.",
  safetyScore: "A 0-100 health score combining liquidity, concentration, tail risk, and drawdown controls.",
};

export type Asset = {
  id: string;
  name: string;
  ticker: string;
  assetClass: string;
  currentValue: number;
  currentWeight: number;
  expectedReturn: number;
  volatility: number;
  liquidityScore: number;
  duration: number;
};
export type AssetAssumptionUpdate = Pick<Asset, "expectedReturn" | "volatility" | "liquidityScore" | "duration">;
export type PortfolioUpdate = {
  allocations?: Record<string, number>;
  totalValue?: number;
  assumptions?: Record<string, AssetAssumptionUpdate>;
};
export type Limits = Record<string, any>;
export type Control = {
  controlName: string;
  currentValue: number;
  limit: number;
  status: "PASS" | "WARNING" | "BREACH";
  severity: string;
  explanation: string;
  remediation?: string;
};
export type Metrics = {
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
  var95: number;
  cvar95: number;
  maxDrawdown: number;
  liquidityScore: number;
  concentrationRisk: number;
  largestAssetExposure: number;
  largestAssetName: string;
  largestAssetClassExposure: number;
  largestAssetClass: string;
  cashWeight: number;
  turnover: number;
};
export type Risk = {
  metrics: Metrics;
  controls: Control[];
  riskScore: number;
  riskLevel: string;
  operatingMode?: "NORMAL" | "CAUTION" | "DEFENSIVE";
  components: {
    name: string;
    normalizedScore: number;
    weight: number;
    contribution: number;
  }[];
  explanations: string[];
  portfolioScore: number;
  scoreComponents: Record<string, number>;
};
export type Portfolio = {
  assets: Asset[];
  totalValue: number;
  historyObservations: number;
  currency: string;
};
export type Scenario = {
  id: string;
  name: string;
  description: string;
  assumptions: Assumption[];
};
export type Impact = {
  name: string;
  assetClass: string;
  originalValue: number;
  stressedValue: number;
  absoluteLoss: number;
  percentageLoss: number;
  originalWeight: number;
  stressedWeight: number;
};
export type Simulation = {
  simulationId: string;
  stressedAssets: Asset[];
  assumptions: Assumption[];
  firewallChanges: BreachChange[];
  limits: Limits;
  scenarioName: string;
  originalPortfolioValue: number;
  stressedPortfolioValue: number;
  absoluteLoss: number;
  percentageLoss: number;
  marketLoss: number;
  withdrawalAmount: number;
  withdrawalFulfilled: boolean;
  assetImpacts: Impact[];
  assetClassImpacts: Impact[];
  riskBefore: Risk;
  riskAfter: Risk;
  breachedControls: Control[];
  newBreaches: Control[];
  liquidityImpact: {
    before: number;
    after: number;
    liquidCapitalBefore: number;
    liquidCapitalAfter: number;
    sufficientLiquidCapital: boolean | null;
  };
  largestLossContributor: string;
  explanation: string;
};

export type Assumption = {
  assetId: string;
  name: string;
  assetClass: string;
  shockPercent: number;
  liquidityBefore: number;
  liquidityAfter: number;
  basis: string;
};
export type BreachChange = {
  controlName: string;
  change: "CLEAR" | "EXISTING" | "NEW" | "WORSENED" | "RESOLVED";
  before: Control;
  after: Control;
};

export type CostBenefit = {
  transactionCostBps: number;
  transactionCost: number;
  turnoverValue: number;
  safetyScoreChange: number;
  expectedReturnChange: number;
  volatilityChange: number;
};

export type Rebalance = {
  minimumTradeAmount: number;
  objective: string;
  status: "FEASIBLE" | "INFEASIBLE" | "NOT_FOUND";
  explanation: string;
  conflicts: string[];
  trades: {
    assetId: string;
    name: string;
    action: "BUY" | "SELL" | "HOLD";
    amount: number;
    stressedWeight: number;
    targetWeight: number;
    targetValue: number;
    liquidityScore: number;
    locked: boolean;
    weightChange: number;
    reason: string;
    triggeredConstraint: string;
    riskImpact: string;
  }[];
  assets: Asset[];
  risk: Risk | null;
  firewallChanges: BreachChange[];
  turnover: number;
  cumulativeTurnover: number;
  totalValue: number;
  externalCapital: number;
  limits: Limits;
  costBenefit?: CostBenefit;
  changeSummary: string[];
  decisionTrail: DecisionStep[];
  scenarioComparison?: {
    currentLoss: number;
    optimizedLoss: number;
    capitalProtected: number;
    currentLossPercent: number;
    optimizedLossPercent: number;
    currentBreaches: number;
    optimizedBreaches: number;
  };
};

export type DecisionStep = { stage: string; message: string };

export type SimulationStatistics = {
  expectedReturn: number;
  expectedLoss: number;
  volatility: number;
  downside5: number;
  var95: number;
  worstLoss: number;
  maxDrawdown: number;
  probabilityAnyBreach: number;
  averageBreaches: number;
  controlBreachProbabilities: Record<string, number>;
};

export type MarketSimulation = {
  mode: "HISTORICAL" | "MONTE_CARLO" | "HYBRID";
  modelLabel: string;
  dataSource: string;
  periodStart: string;
  periodEnd: string;
  runs: number;
  horizonDays: number;
  stressOverlay: string | null;
  original: SimulationStatistics;
  optimized: SimulationStatistics | null;
  optimizedAvailable: boolean;
  resilienceImprovement: number;
  explanation: string;
  decisionTrail: DecisionStep[];
};

export function exportRebalanceCsv(rebalance: Rebalance): string {
  return [
    "assetId,assetName,action,amount,targetWeight,liquidityScore,locked",
    ...rebalance.trades.map((t) =>
      [
        t.assetId,
        `"${t.name.replaceAll('"', '""')}"`,
        t.action,
        t.amount.toFixed(2),
        (t.targetWeight * 100).toFixed(2),
        t.liquidityScore,
        t.locked,
      ].join(",")
    ),
  ].join("\n");
}
