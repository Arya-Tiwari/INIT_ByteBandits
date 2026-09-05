# Person 3: React optimizer and rebalancing tutorial

This project implements the frontend in React and TypeScript. Start with the working demo, then connect your team's analytics and optimizer endpoints. The current engine uses illustrative assumptions, not historical market data or production investment logic.

## 1. Establish the scope
Paste this prompt into your coding assistant:

> Build a responsive React + TypeScript capital-management dashboard for a hackathon. Focus on Person 3: constrained optimization, risk limits, BUY/SELL/HOLD generation, turnover, transaction costs, cost-benefit HOLD checks, and explainable recommendations. Use a ₹100Cr portfolio with Indian Equity, US Equity, Bonds, Gold, Real Estate, and Cash. Use an institutional light theme with emerald accents, a sidebar, clear metric cards, and accessible controls. Keep the calculation engine separate from React components. Every visible action should work. Label demo assumptions explicitly.

Verify: a working page opens without uploads or setup.

## 2. Define a shared data contract
> Create types for asset assumptions, portfolio weights, annual analytics, risk constraints, trade recommendations, and optimizer results. Use decimal weights in the API contract, INR for monetary amounts, annualized return and volatility, and explicitly named risk confidence and horizon. Add a frontend adapter because this demo stores percentage-point weights. Agree on this contract with Person 1 and Person 2 before connecting their endpoints. Include solver status, feasibility, breached rules, binding constraints, stale state, and per-trade reasons.

Verify: everyone agrees whether 35% is 35 or 0.35; avoid mixing crore, lakh, and INR.

## 3. Add the portfolio editor and analytics
> Add editable allocations defaulting to 35%, 25%, 20%, 10%, 7%, and 3%. Reject negative, non-finite, or over-100% values and totals other than 100%. Recalculate current return, volatility, Sharpe, VaR, CVaR, liquidity, concentration, and a labeled demo safety score. Never invent historical performance. Invalidate old recommendations when inputs change.

Verify: invalid totals cannot be applied; changing inputs marks the plan stale.

## 4. Build risk controls
> Add minimum cash, combined equity maximum, individual asset maximum, annual 95% CVaR maximum, and minimum liquid allocation. Show critical breaches, near-limit warnings, and safe rules using text plus color. Keep risk evaluation in pure functions. Make the confidence level, horizon, and liquidity definition visible.

Verify: tighten each rule independently and confirm the breach changes.

## 5. Implement constrained optimization
> Implement a deterministic demo search that balances modeled risk, expected return, and turnover while satisfying long-only weights, 100% total allocation, and all selected limits. Do not hard-code target weights. Verify feasibility after solving; if no feasible candidate is found, show an explicit failure state and suppress actionable trades. Document search resolution and the absence of a global optimality guarantee. Later replace this engine with the backend solver using the shared contract.

Verify: targets total 100%, remain non-negative, satisfy every limit, and change when constraints change. A 10% maximum for each of six assets is infeasible.

## 6. Generate trades and costs
> For each asset, delta = target weight minus current weight. Positive delta means BUY, negative means SELL, and zero means HOLD. Trade INR = absolute decimal delta × portfolio INR. One-way turnover = 0.5 × sum of absolute decimal deltas. Gross traded value counts both buys and sells. Estimated cost = sum of absolute trade INR × per-asset basis points / 10,000. Show current/target percentages, trade amount, fee, and reason. Export the displayed plan as a readable PDF. State whether weights are gross or net of costs.

Verify: a 10 percentage-point shift from one asset to another means 10% turnover and ₹20Cr gross traded on a ₹100Cr portfolio. At 10 bps per side, total fees are ₹2 lakh. Buys equal sells before fees.

## 7. Add cost-aware HOLD decisions
> Compare the candidate's modeled annual CVaR reduction in INR with transaction costs multiplied by a configurable hurdle. Label CVaR reduction a risk proxy, not cash profit or expected savings. When the current portfolio is compliant and benefit does not exceed the hurdle, recommend HOLD with zero executable turnover and cost. A hard policy breach must trigger feasible remediation or an explicit failure, never an unjustified cost-based HOLD. Display candidate benefit, cost, hurdle, and decision separately.

Verify: an already optimized portfolio returns HOLD; an infeasible case does not masquerade as HOLD.

## 8. Explain the recommendation
> Add current-versus-target allocation bars, a before/after table, a trade-off panel, and an investment committee paragraph. Base reasons on actual breached or binding constraints and marginal effects, not generic claims. Show both risk improvements and return sacrifices. Report fee impact on post-trade NAV and disclose unmodeled taxes, slippage, and market impact.

Verify: each explanation matches the numbers and current inputs.

## 9. Connect and test
> Integrate the analytics and optimizer endpoints behind typed adapters. Add loading, timeout, network error, infeasible, stale, and HOLD states. Preserve the default demo when the backend is unavailable and clearly label fallback data. Test conservation of capital, buy/sell balance, cost units, feasible constraints, already-optimal HOLD, fractional weights, and impossible limits. Check the layout at mobile, tablet, and desktop widths and keyboard navigation.

## Project map
- `app/dashboard.tsx`: interactive React dashboard and editor.
- `app/globals.css`: responsive visual design.
- `lib/optimizer.ts`: demo metrics, rules, and optimizer.
- `lib/optimizer.test.ts`: calculation invariant checks.

## Demo walkthrough
1. Review the ₹100Cr default portfolio and breach banner.
2. Compare the current and optimized allocation.
3. Inspect BUY/SELL/HOLD trades, turnover, and estimated costs.
4. Change a risk slider and run optimization again.
5. Set maximum single asset to 10% to demonstrate infeasibility.
6. Restore 40%, rerun, and export the PDF report.
7. Explain the before/after trade-off and model assumptions.
