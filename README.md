# AEGIS — Institutional Capital Compass & Risk Firewall

**AEGIS** is a high-performance portfolio risk management, stress testing, and capital allocation optimization platform. Designed for wealth managers, institutional portfolio managers, and risk compliance officers, AEGIS provides real-time risk control enforcement, factor-based market stress simulation, and two-phase constrained quadratic portfolio optimization.

---

## 🌟 Key Features & Capabilities

- **Institutional Risk Firewall**: Live monitoring of 7 core risk limits (Volatility, VaR, CVaR, Single Asset Caps, Asset Class Caps, Liquidity Floor, Cash Reserves, and Turnover Budgets) with dynamic status severity (`SAFE`, `WARNING`, `BREACH`).
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
- **High-Performance Architecture**: In-memory response caching (< 1ms cached latency) and Rollup code splitting (> 58% main bundle reduction).

---

## 🚀 Quickstart Guide

### Prerequisites
- **Python 3.9+**
- **Node.js 20+** (or 22+)

### 1. Start the Backend Server
```sh
cd /Users/aryatiwari/Desktop/Fintech
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```
*FastAPI Interactive API Documentation*: http://127.0.0.1:8000/docs

### 2. Start the Frontend Application
In a second terminal:
```sh
cd /Users/aryatiwari/Desktop/Fintech/frontend
npm install
npm run dev
```
Open **http://127.0.0.1:5173** in your browser.

---

## 🧪 Verification & Test Suite

### Run Backend Unit Tests (83 Tests)
```sh
cd /Users/aryatiwari/Desktop/Fintech
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
```
*Expected Output*: `83 passed in 22.56s`

### Run Live Endpoints Smoke Test
```sh
.venv/bin/python backend/tests/smoke_live.py
```

### Production Frontend Build Check
```sh
cd /Users/aryatiwari/Desktop/Fintech/frontend
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

## 📄 License & Attribution
AEGIS Capital Compass — Built for institutional portfolio risk management.
