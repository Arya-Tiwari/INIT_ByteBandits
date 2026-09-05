/**
 * Assumptions used only where the demo backend has no corresponding market feed.
 * Portfolio, risk, limits and optimization values always come from the API.
 */
export const REPORT_ASSUMPTIONS = {
  transactionCostRate: 0.0015,
  transactionCostLabel: "15 bps illustrative rate",
  dailyChange: null as number | null,
};

export const DEFAULT_LIMITS: Record<string, number> = {
  maxPortfolioVolatility: 0.16,
  maxVaR: 0.018,
  maxCVaR: 0.025,
  maxSingleAssetWeight: 0.25,
  maxAssetClassWeight: 0.55,
  minimumLiquidityScore: 70,
  minimumCashWeight: 0.05,
  maximumTurnover: 0.2,
};
