# AEGIS — Institutional Capital Compass & Risk Firewall

**AEGIS** is a high-performance portfolio risk management, stress testing, and capital allocation optimization platform. Designed for wealth managers, institutional portfolio managers, and risk compliance officers, AEGIS provides real-time risk control enforcement, factor-based market stress simulation, and two-phase constrained quadratic portfolio optimization.

---

## 🌟 Key Features & Capabilities

- **Institutional Risk Firewall**: Monitoring of 8 core risk limits (Volatility, VaR, CVaR, Single Asset Caps, Asset Class Caps, Liquidity Floor, Cash Reserves, and Turnover Budgets) with dynamic status severity (`SAFE`, `WARNING`, `BREACH`).
- **Capital Safety Score (0–100)**: Multi-factor health score combining tail risk, volatility, concentration (HHI), illiquidity, and policy pressure.
- **Two-Phase Constrained Capital Optimizer**:
  - **Phase 1**: Linear Feasibility verification using the **HiGHS LP** solver.
  - **Phase 2**: SLSQP variance minimization under policy margins with transaction cost penalties.
  - **Trade Rationale**: Explainable `BUY`, `SELL`, and `HOLD` instructions with policy drivers for every trade.
- **Stress Testing Laboratory**: 8 predefined market stress scenarios (*Market Crash*, *Interest Rate Shock*, *Liquidity Crisis*, *Tech Selloff*, etc.), custom factor shock sliders, and sudden capital withdrawal simulators.
- **Dynamic Asset & Portfolio Management**:
  - **`+ Add Holding`**: Dynamically add new holdings with factor-based synthetic historical return generation.
  - **`Import Holdings`**: Bulk import portfolio datasets from `.csv` or `.json` files or text paste, complete with downloadable sample templates.
  - **`Route Capital`**: Smart capital routing engine that repairs liquidity deficits before purchasing risk assets.
- **Institutional Operating Modes**: Dynamic state transitions between `NORMAL`, `CAUTION`, and `DEFENSIVE` operating modes based on portfolio risk pressure.
- **High-Performance Architecture**: In-memory result caching and Rollup code splitting. See AUDIT.md for measured checks and performance limitations.

---

## 🚀 Quickstart Guide

### Prerequisites
- **Python 3.9+**
- **Node.js 20+** (or 22+)

---

### Windows (PowerShell / Command Prompt)

1. **Create Virtual Environment & Install Dependencies**:
   ```cmd
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r backend/requirements.txt
   npm install
   npm install --prefix frontend
   ```

2. **Start Application**:
   ```cmd
   npm run dev
   ```
   *Or run backend manually*: `.venv\Scripts\python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000`

---

### macOS / Linux (Bash / Zsh)

1. **Create Virtual Environment & Install Dependencies**:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r backend/requirements.txt
   npm install
   npm install --prefix frontend
   ```

2. **Start Application**:
   ```bash
   npm run dev
   ```
   *Or run backend manually*: `.venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000`

---

### Access Links & Endpoints
- **Frontend Application**: http://127.0.0.1:5173
- **FastAPI Interactive Documentation**: http://127.0.0.1:8000/docs
- Frontend requests use `/api` through the existing Vite proxy; no extra configuration is required.
- Ports 8000 and 5173 must be available. The demo holds one shared portfolio in memory; restarting the backend restores the baseline state.

---

## 🧪 Verification & Test Suite

### Run Backend Unit Tests

**Windows (CMD / PowerShell)**:
```cmd
.venv\Scripts\python -m pytest backend/tests -q
```

**macOS / Linux (Bash / Zsh)**:
```bash
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
# or via npm script:
npm test
```

### Run Live Endpoints Smoke Test

**Windows**:
```cmd
.venv\Scripts\python backend/tests/smoke_live.py
```

**macOS / Linux**:
```bash
.venv/bin/python backend/tests/smoke_live.py
```

### Production Frontend Build Check
```sh
cd frontend
npm run build
```

---

## 📁 Repository Structure

```text
├── ARCHITECTURE.md            # Technical Architecture & Subsystem Specification
├── PRD.md                     # Product Requirements Document & Feature Matrix
├── TASKS.md                   # Task Execution Log & Verification Records
├── README.md                  # Project Overview & Setup Instructions
├── backend/
│   ├── main.py                # FastAPI endpoints, LRU caching & session lock
│   ├── models.py              # Pydantic V2 input/output models & schemas
│   ├── firewall.py            # Policy inspector & breach transition logic
│   ├── risk_engine.py         # Safety score & portfolio metric calculations
│   ├── optimization_engine.py # HiGHS LP + SLSQP variance optimizer
│   ├── simulation_engine.py   # Immutable shock revaluation & withdrawal engine
│   ├── market_simulation.py   # Monte Carlo & Historical time-series simulator
│   ├── scenarios.py           # Centralized market shock scenario definitions
│   ├── data/                  # Baseline portfolio JSON & synthetic returns CSV
│   └── tests/                 # Automated pytest suite & live proxy smoke test
└── frontend/
    ├── vite.config.ts         # Vite configuration & Rollup manualChunks vendor splitting
    ├── index.html             # Executive Overview entry point
    ├── portfolio.html         # Portfolio Holdings & Import entry point
    ├── risk.html              # Risk Controls entry point
    ├── optimize.html          # Allocation Optimizer entry point
    ├── simulation.html        # Stress Lab entry point
    ├── rebalance.html         # Intervention Plan entry point
    └── src/
        ├── App.tsx            # Main Application shell & router
        ├── ReportPages.tsx    # Page views & interactive financial components
        ├── RiskLab.tsx        # Embedded Stress Testing Laboratory
        ├── design.css         # Warm editorial design system & scroll animations
        └── types.ts           # TypeScript interfaces & CSV export helpers
```

---

## Audit scope and demo assumptions

See [AUDIT.md](AUDIT.md) for the requirement-by-requirement checklist, fixes, verification evidence, remaining MVP gaps and demo walkthrough. The supplied hackathon problem statement (`readme_fintech.md`) is the submission reference: optimization with constraints, risk safeguards, an explanatory dashboard, and working/documented deliverables. The repository’s 48-feature matrix is an expanded internal target, not a mandatory hackathon checklist or a claim that every feature is complete.

- Prices/returns are synthetic, not live market data. Historical mode is an **in-sample rolling comparison**, not an out-of-sample backtest: the optimizer also sees the full reference history.
- `riskScore` is a five-component pressure score (lower is safer); `portfolioScore` is a separate health score using compliance, diversification, liquidity, volatility and historical drawdown (higher is healthier).
- Portfolio editing leaves uninvested capital in Treasury Cash. The API accepts a complete 100% allocation including cash; the UI calculates that residual automatically. Zero input capital is rejected; complete losses/withdrawals are handled by simulations.
- Expected return, liquidity and duration assumptions affect their corresponding calculations. The volatility field is metadata for existing holdings; historical covariance remains the risk source. Newly added holdings receive deterministic synthetic returns, capped at a 99% daily loss. Their new factors are illustrative, not calibrated market correlations.
- Transaction cost is an illustrative **15 bps on one-way turnover** (`0.5 × sum(abs(trades))`). It enters the objective and is reported separately; it is not deducted from target capital. No orders are executed.
- Backend state and caches are process-local. Requests are serialized for a consistent local demo. Slow optimization temporarily queues other requests. Missing/malformed historical data fails validation; there is no fabricated fallback.
- Import supports CSV and JSON with explicit `currentValueCr`/`ValueCr` and `expectedReturnPercent`/`volatilityPercent` units. Import rows are prevalidated, but network failures can leave a reported partial import; remove saved rows before retrying.

## 📄 License & Attribution
AEGIS Capital Compass — Built for institutional portfolio risk management.
