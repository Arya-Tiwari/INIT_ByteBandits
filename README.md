# CapitalIQ

React + TypeScript hackathon frontend focused on Person 3's optimizer and rebalancing responsibilities.

Includes a ₹100Cr demo portfolio, allocation editor, annual modeled metrics, risk limits and breaches, constrained allocation search, before/after bars, BUY/SELL/HOLD plan, per-asset fees, one-way turnover, PDF export, and decision explanations.

Read [PROMPTING-GUIDE.md](PROMPTING-GUIDE.md) for the step-by-step prompts and judge demo walkthrough.

## Development

With dependencies installed:

```sh
node node_modules/vinext/dist/cli.js dev
```

Build and verify:

```sh
node node_modules/vinext/dist/cli.js build
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types lib/optimizer.test.ts
```

Use the existing pnpm lockfile when installing dependencies. The starter includes shadcn components and uses vinext/Vite. Dependency lifecycle scripts require explicit package-manager approval according to your environment's policy.

## Calculation boundaries

The engine is a deterministic pairwise search, not a production solver. Return, volatility, correlation factors, liquidity classes, and fee rates are illustrative. VaR and CVaR use an annual normal model at 95% confidence. The safety score is a demo heuristic. The benefit/cost comparison uses modeled tail-risk reduction as a proxy, not expected profit. Constraints are checked after optimization. Failure to find a feasible candidate is reported without claiming mathematical infeasibility.

No orders are submitted. Allocations and constraints are held in React state for this session. Trades balance before fees; fees reduce NAV and target weights are gross of fees. Taxes, slippage, and execution impact are not modeled. Replace `lib/optimizer.ts` with adapters to the team's validated analytics and optimization APIs for production use.
