export const FINANCE_TOOLTIPS = {
  liquidity: "The percentage of capital that can be accessed quickly, such as cash or Treasury Bills.",
  volatility: "How sharply portfolio value can move up and down. Higher means less predictable.",
  valueAtRisk: "Estimated loss threshold in a normal bad period at the selected confidence level.",
  conditionalVaR: "Average loss during the worst periods beyond Value at Risk.",
  turnover: "The percentage of the portfolio that must be traded to reach the new allocation.",
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
export type Limits = Record<string, any>;
export type Control = {
  controlName: string;
  currentValue: number;
  limit: number;
  status: "PASS" | "WARNING" | "BREACH";
  severity: string;
  explanation: string;
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
  estimatedBenefit: number;
  benefitCostRatio: number;
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
};

export function exportRebalanceCsv(rebalance: Rebalance): string {
  return [
    "assetId,assetName,action,amount,targetWeight,liquidityScore,locked",
    ...rebalance.trades.map((t) =>
      [
        t.assetId,
        `"${t.name}"`,
        t.action,
        t.amount.toFixed(2),
        (t.targetWeight * 100).toFixed(2),
        t.liquidityScore,
        t.locked,
      ].join(",")
    ),
  ].join("\n");
}

