# AEGIS — Product Requirements Document (PRD)

## 1. Executive Summary & Vision

**AEGIS (The Capital Compass & Risk Firewall)** is an institutional-grade portfolio risk engine, stress simulator, and capital optimization platform designed for wealth managers, institutional portfolio managers, and risk compliance officers.

### Problem Statement
Traditional wealth management tools rely on static asset allocation models that fail during market regime shifts, liquidity freezes, and black swan events. Asset managers lack real-time visibility into complex risk policy breaches, tail-risk metrics (VaR/CVaR), and cost-aware rebalancing strategies under strict institutional constraints.

### Solution
AEGIS provides an institutional "Risk Firewall" that continuously monitors portfolio health, simulates extreme market shocks, and uses mathematical optimization solvers (HiGHS LP + SciPy SLSQP) to propose capital-conserving, policy-compliant rebalance plans with human-explainable trade rationale.

---

## 2. Target User Personas

1. **Institutional Portfolio Manager (PM)**
   - Needs real-time visibility into asset exposures, risk contributions, and portfolio turnover.
   - Requires cost-aware trade plans that minimize transaction costs while respecting investment mandates.

2. **Risk Compliance Officer (CRO)**
   - Requires dynamic enforcement of institutional risk policies (single asset caps, liquidity floors, cash reserves, VaR/CVaR limits).
   - Needs verifiable decision audit trails and clear breach severity alerts (SAFE, WARNING, BREACH).

3. **Investment Committee / Wealth Manager**
   - Wants to test portfolio resilience under severe stress scenarios (Market Crash, Rate Shocks, Liquidity Freezes).
   - Needs clear explainability on why trades are recommended and what capital protection is achieved.

---

## 3. MVP Scope & Delivered Requirements (48-Feature Matrix)

The Minimum Viable Product (MVP) encompasses the core 48 features fully implemented, tested, and delivered:

### MVP Module 1: Dashboard, Risk Engine & Policy Firewall
- **FR-01 (Executive Dashboard)**: Provide a centralized overview of total capital, safety score, active breaches, and recommended interventions.
- **FR-02 (Portfolio Allocation View)**: Display capital distribution across broad asset classes (Equity, Bonds, Gold, Cash, REITs, etc.) via interactive charts and tables.
- **FR-03 (Core Portfolio Metrics)**: Compute expected return, annualized volatility, Sharpe ratio, and weighted liquidity score.
- **FR-04 (VaR & CVaR Tail Risk Metrics)**: Calculate 95% 1-Day Value at Risk (VaR) and Conditional VaR (Expected Shortfall).
- **FR-05 (Capital Safety Score)**: Compute a 0–100 normalized portfolio health score across volatility, tail risk, concentration (HHI), illiquidity, and policy pressure.
- **FR-06 (Portfolio Allocation Editor)**: Allow instant editing of asset target weights with 100% allocation validation.
- **FR-07 (Default Demo Portfolio)**: Provide a baseline ₹50 Cr / ₹100 Cr institutional portfolio.
- **FR-08 (Risk Control Center)**: Enable interactive configuration of institutional policy limits.
- **FR-09 (Risk-Control Engine)**: Run policy checks against all configured rules.
- **FR-10 (Risk Alerts)**: Render visual status indicators (`SAFE`, `WARNING`, `BREACH`).

### MVP Module 2: Constrained Optimization & Rebalancing Engine
- **FR-11 (Constrained Capital Optimizer)**: Run HiGHS LP feasibility checks and SLSQP variance minimization under risk limits.
- **FR-12 (Current vs Optimized Allocation)**: Present side-by-side comparison tables and stacked allocation charts.
- **FR-13 (BUY / SELL / HOLD Intervention Plan)**: Generate actionable trade instructions with exact trade values and weight changes.
- **FR-14 (Explainable Trade Reasons)**: Provide clear policy triggers (e.g., *Single asset cap breach*, *Minimum liquidity floor*) for every trade action.
- **FR-15 (Portfolio Turnover Budget)**: Calculate turnover percentage and enforce maximum turnover limits.
- **FR-16 (Transaction Cost Model)**: Calculate estimated transaction costs (15 bps default) and net trade-off.
- **FR-17 (Cost-Aware Rebalancing)**: Incorporate transaction cost penalties into the optimization objective to prevent churn.
- **FR-18 (Before vs After Analysis)**: Compare risk score, return, volatility, VaR, and breach count before and after optimization.
- **FR-19 (Optimization Trade-Off Panel)**: Display metrics gained vs. sacrificed.
- **FR-20 (Explainable Decision Engine)**: Generate a step-by-step audit log of solver stages.

### MVP Module 3: Stress Testing, Capital Routing & Portfolio Utilities
- **FR-21 (Market Shock Simulator)**: Re-evaluate portfolio holdings under severe market shocks.
- **FR-22 (Preset Stress Scenarios)**: Include 8 pre-configured scenarios (*Market Crash*, *Tech Selloff*, *Interest Rate Shock*, *Liquidity Crisis*, *Inflation Shock*, *Global Recession*, *Equity Rally*, *Broad Market Stress*).
- **FR-23 (Stress Loss Comparison)**: Prove capital protection by running current vs. optimized portfolios under stress.
- **FR-24 (Capital Protected Metric)**: Prominently display ₹ Cr capital loss reduction.
- **FR-25 (Decision Trace Audit Log)**: Maintain an immutable event timeline.
- **FR-26 (Custom Stress Scenario)**: Allow custom asset-class and holding-level percentage shock inputs.
- **FR-27 (Capital Withdrawal Simulator)**: Test portfolio liquidity under sudden cash redemption requests.
- **FR-28 (Risk Appetite Presets)**: Provide *Conservative*, *Balanced*, and *Growth* limit presets.
- **FR-29 (Operating Modes)**: Dynamically switch portfolio operating state (`NORMAL`, `CAUTION`, `DEFENSIVE`).
- **FR-30 (Circuit Breaker)**: Automatically trigger defensive guardrails when risk limits are breached.
- **FR-31 (Human-in-the-Loop Workflow)**: Provide proposal-only workflow prior to order placement.
- **FR-32 (Approve / Reject Action)**: Enable decision recording in audit log.
- **FR-33 (Capital Routing Engine)**: Automatically route incoming capital to repair liquidity deficits before purchasing risk assets.
- **FR-34 (Asset Liquidity Scores)**: Assign T+0 to T+30 tradability scores (0–100).
- **FR-35 (Loss Contribution Breakdown)**: Identify exact loss contribution per asset under shock.
- **FR-36 (Worst Affected Asset Identification)**: Highlight the single largest loss contributor.
- **FR-37 (Risk Contribution Analysis)**: Estimate marginal volatility contribution per asset.
- **FR-38 (CSV / JSON Portfolio Import)**: Enable file upload (`.csv`, `.json`) and text paste for importing portfolio holdings.
- **FR-39 (Live Control Status Indicator)**: Show real-time `CONTROL ENGINE · ACTIVE` status.
- **FR-40 (Live Analysis Clock)**: Display continuous IST timestamps for analysis runs.

### MVP Module 4: Analytics, Exports & UX
- **FR-41 (Financial Tooltips)**: Provide definitions for complex financial terms (VaR, CVaR, Turnover, HHI).
- **FR-42 (Export Rebalance Report)**: Download trade recommendations as a `.csv` file.
- **FR-43 (Export Decision Log)**: Export audit trails for compliance reporting.
- **FR-44 (Risk Trend Chart)**: Visualize historical component score breakdowns.
- **FR-45 (Maximum Drawdown)**: Calculate peak-to-trough drawdown risk.
- **FR-46 (Scenario History)**: Persist previously executed stress test results in local session storage.
- **FR-47 (Interactive Recharts Visualization)**: Render interactive responsive charts.
- **FR-48 (Scroll Reveal & Micro-Interactions)**: Apply hardware-accelerated scroll lift-up animations and hover states.

---

## 4. Post-MVP Scope & Out-of-Scope (Future Release Roadmap)

The following features were intentionally excluded from the initial local MVP to maintain deterministic speed, security, and offline reliability, and are scheduled for Phase 2/3:

- **Live Market APIs**: Real-time ticker feeds via WebSocket / Bloomberg / Refinitiv APIs (MVP uses 756-day synthetic factor returns).
- **Broker APIs & Real-Money Order Routing**: Direct execution integration with broker APIs (e.g., FIX protocol / Interactive Brokers API).
- **Multi-Currency Valuation**: FX conversion engine for multi-currency portfolios (USD, EUR, GBP).
- **Sector & Regional Exposure Decomposition**: Sector-level breakdown beyond broad asset classes.
- **Automated PDF Compliance Reporting**: Formal PDF export of investment committee risk certificates.
- **Multi-Tenant Authentication & Cloud Database**: OAuth2 / SAML authentication and PostgreSQL persistent database storage.
- **Reinforcement Learning / Machine Learning Solvers**: Deep RL portfolio rebalancing models.

---

## 5. Non-Functional Requirements (NFRs)

### Performance & Latency
- **Cached Response Time**: Backend response times for cached `/api/risk` and `/api/optimize` endpoints must execute in **< 5ms**.
- **Page Load Speed**: Initial page load render time must complete in **< 100ms**.
- **Bundle Optimization**: Frontend JavaScript chunks must be split to keep main entry chunks **< 350 kB**.

### Usability & Design
- **Theme**: Premium editorial financial aesthetic (vanilla CSS, curated warm paper color palette, typography).
- **Accessibility**: Smooth scroll animations with reduced-motion media query support.

### Data Integrity & Safety
- **Immutability**: Analytical queries must never mutate underlying baseline datasets.
- **Deterministic Evaluation**: Calculations must yield 100% reproducible results given identical portfolio inputs.
