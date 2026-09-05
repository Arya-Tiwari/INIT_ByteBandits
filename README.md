# CapitalGuard — Asset & Capital Optimization Control Engine

Local hackathon MVP: actual deterministic portfolio risk calculations, eight configurable controls, six market scenarios, custom asset-class shocks and capital withdrawals. React + Vite + TypeScript + Tailwind + a shadcn-style Radix button + Recharts + Lucide; Python + FastAPI + NumPy/Pandas. SciPy provides the constrained rebalance solver; NumPy/Pandas provide the existing risk calculations.

## Run locally

Python 3.9+ and Node 20.19+ (or 22.12+) are required. Dependencies are already installed in this checkout. Initial installation needs internet; running the application afterward does not.

From the project directory, start the backend:

```sh
cd /Users/aryatiwari/Desktop/Fintech
python3 -m venv .venv
.venv/bin/pip install --cache-dir .cache/pip -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
cd /Users/aryatiwari/Desktop/Fintech/frontend
npm ci --cache ../.cache/npm
npm run dev
```

Open http://127.0.0.1:5173. FastAPI interactive API documentation: http://127.0.0.1:8000/docs. The Vite development server proxies `/api` to port 8000. The built frontend can also be served locally with `npm run preview`; its API proxy uses the same Vite configuration. Keep the backend running. No hosting, live market feeds, database, authentication, telemetry, external fonts or remote assets are used.

## Verify

```sh
cd /Users/aryatiwari/Desktop/Fintech
.venv/bin/python -m pytest backend/tests -q
# With both servers running:
.venv/bin/python backend/tests/smoke_live.py
cd frontend
npm run build
```

Tests cover all APIs and predefined scenarios, independently known VaR/CVaR/drawdown values, covariance aggregation, limit updates, finite outputs, custom class shocks, full wipeout, successful/failed withdrawals, weight normalization, value conservation and unchanged source holdings/history. The live smoke test also checks the Vite API proxy. `backend/requirements-lock.txt` records the tested Python 3.9 environment; `frontend/package-lock.json` locks frontend packages.

## Files

- `backend/models.py`: Pydantic input/output models, defaults and validation.
- `backend/risk_engine.py`: the shared portfolio metrics, control checks and explainable risk score.
- `backend/simulation_engine.py`: immutable revaluation and withdrawal funding.
- `backend/scenarios.py`: centralized scenario definitions and pre-run per-holding assumptions.
- `backend/firewall.py`: shared policy checks, optimizer margins and breach transitions.
- `backend/optimization_engine.py`: capital-conserving constrained allocation proposals.
- `backend/main.py`: FastAPI endpoints and locked in-memory session limits.
- `backend/data/portfolio.json`: nine holdings worth ₹50 Cr, across seven asset classes.
- `backend/data/historical_returns.csv`: 756 deterministic synthetic daily return observations.
- `backend/data/generate_demo.py`: reproducible factor-based demo generator (seed 20260905); never downloads market data.
- `backend/tests/`: numerical/API regression tests and live smoke test.
- `frontend/src/App.tsx`, `types.ts`, `styles.css`, `main.tsx`: existing application shell and Risk overview.
- `frontend/src/RiskLab.tsx`, `risk-lab.css`, `api.ts`: embeddable Risk Lab page, assumption sheet, Firewall results, proposals and shared API client.
- `frontend/src/components/ui/button.tsx`: composable Radix/shadcn-style button primitive.
- Frontend Vite/TypeScript/package configuration, Python dependency manifests and `.gitignore`.

## Calculation conventions

All API return rates, weights, losses and limits are fractions (0.15 = 15%). **Custom shocks and `withdrawalPercent` are percentage points** (-15 = -15%). Values and `withdrawalAmount` are INR; 1 Cr = ₹10,000,000. Liquidity scores range from 0 to 100. Positive loss means a reduction; negative loss means a gain.

Weights are recomputed from current values. Expected return is the weighted annual expected-return assumption. Annualized volatility is `sqrt(252 * wᵀ Σ_daily w)` using sample covariance (`ddof=1`). Daily portfolio returns are `R @ w`. Historical 95% VaR is the nonnegative 95th percentile of daily losses; CVaR is mean loss at or beyond that quantile, floored at VaR. Maximum drawdown is the greatest decline from the running peak of compounded daily portfolio returns, including an initial wealth of 1. These historical calculations assume constant portfolio weights (daily rebalancing), not buy-and-hold drift.

Liquidity is value-weighted. Concentration is HHI (`sum(w²)`). Largest asset and asset-class weights, cash allocation and one-way turnover are also returned. Eight controls check annual volatility, daily VaR/CVaR, single-asset exposure, class exposure, minimum liquidity, minimum cash and maximum turnover. A breach means outside the limit; WARNING means within 10% of a boundary (numerical policy tolerance 1e-8); otherwise PASS. Explanations and severity come from the backend. Limits use full replacement on POST; send the complete GET response with desired edits. They are shared across the current single-process demo session and reset when the backend restarts. Use one worker.

Risk score sums five clipped 0–100 components: volatility relative to 30% (25% weight), mean of VaR/4% and CVaR/6% (25%), HHI (20%), illiquidity `1 - liquidity/100` (15%), and control pressure (15%). Control pressure counts each breach as 1 and warning as 0.5, divided by eight. Levels: LOW <25, MODERATE <50, HIGH <75, CRITICAL ≥75. These transparent demo scales are configurable in `risk_engine.py`, not calibrated investment advice or a predictive model.

## Simulations and assumptions

Every run deep-copies the CURRENT portfolio. Resulting asset weights are normalized, and the same risk engine evaluates both snapshots against one limits snapshot. Market shocks do not count as trading turnover. Historical returns, covariance and expected-return assumptions are held fixed after stress; therefore a crash can lower the remaining portfolio's volatility and risk score as risky holdings shrink. The shock loss is separately reported and is not inserted as a fake historical observation.

- **Market Crash:** Equity -25%, international equity -22%, REIT -18%, corporate bonds -5%, government bonds +3%, gold +8%, cash unchanged. Demo loss: ₹8.25 Cr / 16.50%.
- **Interest Rate Shock:** parallel +200 bps move; bond return approximately `-modified duration * 0.02`. Government duration 7.2, corporate duration 4.5. Equity -8%, international -6%, REIT -12%, gold -4%, cash unchanged. No convexity adjustment.
- **Liquidity Crisis:** non-cash liquidity scores fall 40%. Non-cash loss fraction is `0.03 + 0.22*(1-original liquidity/100)`; cash is unchanged. This makes less-liquid assets lose more and causes a minimum-liquidity breach.
- **Global Recession:** Equity -15%, international -17%, REIT -12%, corporate bonds -4%, government bonds +4%, gold +5%, cash unchanged.
- **Capital Withdrawal:** specify percent or absolute INR, exactly one. Cash is used first, then assets with liquidity score ≥70 in descending liquidity order. Fractional sales at current value; no fees, taxes, lot sizes or slippage. The funding test is all-or-nothing: insufficient eligible capital returns an unchanged simulated portfolio and `withdrawalFulfilled=false`. Executed withdrawal/original capital is demo one-way turnover (including cash use). Capital withdrawn is explicitly separate from market loss.
- **Custom:** -100% to +10000% shocks (explicit demo safety cap) by known asset class or holding ID. `shocks` supplies class defaults; `assetShocks` supplies holding overrides. Omitted classes receive zero shock; blank UI overrides inherit defaults, while explicit 0 takes precedence. Each applicable asset is shocked. Unknown classes, empty shocks, invalid withdrawals and non-finite inputs are rejected. Total wipeout returns zero weights/exposures/return metrics, while minimum liquidity and cash controls still apply.

The demo is deliberately overweight domestic equity (58%) with a 30% single position and 4% cash, so baseline breaches are visible. Synthetic histories are realistic illustrations, not actual security performance. Asset metadata volatility is a generator target; measured sample volatility is used by the engine.

## APIs

`GET /api/portfolio`, `GET /api/risk`, `GET /api/risk/limits`, `POST /api/risk/limits`, `GET /api/simulations`, `POST /api/simulate`, `POST /api/simulate/custom`, `POST /api/simulate/withdrawal`.

```sh
curl -X POST http://127.0.0.1:8000/api/simulate \
  -H 'Content-Type: application/json' -d '{"scenarioId":"market-crash"}'
curl -X POST http://127.0.0.1:8000/api/simulate/custom \
  -H 'Content-Type: application/json' -d '{"name":"Custom Shock","shocks":{"Equity":-20,"Gold":10}}'
curl -X POST http://127.0.0.1:8000/api/simulate/withdrawal \
  -H 'Content-Type: application/json' -d '{"withdrawalPercent":10}'
```


## Risk Lab enhancements

The Risk Lab is a page component inside the existing application shell, not a separate site. It receives portfolio/catalog props and calls the shared API client. The risk overview and configuration remain available. A reference-inspired glass theme uses horizontal navigation, scenario pills and compact assumption cards. Holding-level assumptions, Firewall explanations and the impact ledger use native expandable sections; custom overrides remain directly accessible. Predefined scenario assumptions come directly from the same backend resolver used to execute the shock.

Two new editable definitions in `backend/scenarios.py`:

- Equity Rally: Equity +18%, International Equity +14%, REIT +8%, Corporate Bonds +2%, Government Bonds -2%, Gold -4%, Cash 0%.
- Broad Market Stress: Equity -18%, International Equity -16%, REIT -20%, Corporate Bonds -9%, Government Bonds -6%, Gold -7%, Cash 0%.

Class shocks and explicit per-holding overrides can be combined:

```json
{"name":"Mixed equity shock","shocks":{"Equity":-20},"assetShocks":{"eq-large":0,"eq-mid":12}}
```

This leaves India Large Cap unchanged, raises India Mid Cap by 12%, and applies the -20% default to the other Equity holding. Unknown holding IDs, nonfinite numbers and values below -100% or above the documented safety cap receive HTTP 422.

### Shared Firewall

The existing risk engine remains the sole source of portfolio risk metrics. Its policy checks now live in `firewall.py`, called by current, stressed and rebalanced evaluations. The actual stressed holdings—including changed values, normalized weights and liquidity scores—are supplied to the Firewall. Responses include every policy's old/new values, threshold, explanation and transition: EXISTING (persistent, possibly improved), NEW, WORSENED, RESOLVED or CLEAR. Worsening is measured on the policy's aggregate metric, not a tracking system for individual issuers.

### Rebalance contract

No optimizer existed in this checkout, so `optimization_engine.py` is a separate documented implementation. It proposes allocations within the existing holdings; it does not place orders or change the source portfolio.

1. Each simulation is saved server-side under an opaque `simulationId` (most recent 128, memory only). `POST /api/simulate/{simulationId}/rebalance` passes that stored stressed portfolio to the optimizer. The browser cannot substitute fabricated holdings. Expired IDs return 404. If configured limits changed after simulation, 409 asks the user to rerun the scenario.
2. A HiGHS linear program checks capital conservation, long-only allocation, individual/class caps, minimum cash and liquidity, tradability locks and cumulative turnover. Holdings below liquidity 70 are fixed; zero-value securities are fixed because there is no price/recovery model. Zero cash remains available to receive sale proceeds.
3. SLSQP then seeks lower historical variance with a small allocation-change penalty, subject to ALL margins from the shared Firewall, including historical VaR/CVaR. Two deterministic initial allocations are tried. An independent Firewall recheck gates every returned proposal.
4. FEASIBLE means the exact proposal passes all controls within the stated numerical tolerance, not that a global optimum was proven. INFEASIBLE means the linear constraints are provably inconsistent, or no capital remains. NOT_FOUND means the nonlinear solver did not find a verified solution; this does not claim mathematical infeasibility. Failure returns conflict explanations and no trade proposal.
5. Rebalance turnover is `0.5 * sum(abs(targetWeight-stressedWeight))` of stressed capital. Cumulative turnover is prior withdrawal/original capital plus rebalance turnover times stressed/original capital. Thus the displayed rebalance percentage can exceed the configured percentage after a loss, while the cumulative percentage of original capital must still satisfy the configured budget. No external capital is introduced.

Trades include direction, amount, target value, target weight and lock status. Cash BUY/SELL represents changes to the cash balance. Sales fund purchases at stressed marks; fees, taxes, slippage, integer lots and real execution capacity are not modeled. A ₹1,000 minimum trade (editable as `MINIMUM_TRADE_AMOUNT` in `backend/optimization_engine.py`) applies to buys, sells and cash movements. Sub-threshold positions are held unchanged and the solver reruns with those additional locks. New negligible trades are frozen iteratively. Capital reconciliation and a fresh Firewall evaluation gate the final result; the UI never simply hides unfunded trade rows. If a threshold-compliant repair cannot be verified, no trades are proposed.

### Interpretation and verification

All stressed/rebalanced metrics are labeled **Post-shock allocation risk**: changed weights under unchanged synthetic historical assumptions, not forecasts of crisis volatility. Market gains are labeled gains; withdrawals are shown separately. Zero remaining capital returns zero weights and an explicit warning; it cannot fund a rebalance. A full withdrawal of the demo is rejected because some holdings are not eligible for liquidation; a fully liquid portfolio can be withdrawn completely, tested independently.

Regression tests cover zero/positive/mixed shocks, override precedence, nonfinite/invalid IDs, immutability, pre-run assumptions matching execution, Firewall transitions and exact stressed-input forwarding, full/failed withdrawals, zero capital, feasible funded trades, locked assets, cumulative turnover, infeasible and unverified solver outcomes, and stale simulation constraints. Use the test and build commands above. Reverse Stress Testing remains deferred.


### Optimizer objective and minimum trades

The optimizer minimizes `annualized historical variance + 0.001 * sum((targetWeight - stressedWeight)^2)`. The variance term dominates, so this is not a minimum-turnover or fewest-trades repair. The full turnover budget can be used if doing so lowers the objective. Candidate selection uses the same objective as the solver. The interface explains this before generating a proposal and alongside the result.

Minimum-trade filtering is an additional heuristic lock-and-resolve step, not a global mixed-integer optimization. It may report NOT_FOUND even when a different threshold-compliant solution exists. Funding and all risk controls are checked after filtering. Tests explicitly verify the crash's tiny gold/global-equity trades become HOLD, buys equal sells, target holdings match the trade ledger, and the original portfolio stays unchanged.
