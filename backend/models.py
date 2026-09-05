from __future__ import annotations
from typing import Literal, Optional
import math
from pydantic import BaseModel, ConfigDict, Field, model_validator

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Asset(StrictModel):
    id: str
    name: str
    ticker: str
    assetClass: str
    currentValue: float = Field(ge=0)
    currentWeight: float = Field(ge=0, le=1)
    expectedReturn: float
    volatility: float = Field(ge=0)
    liquidityScore: float = Field(ge=0, le=100)
    duration: float = Field(default=0, ge=0)

class AddAssetRequest(StrictModel):
    name: str = Field(min_length=1)
    ticker: str = Field(min_length=1)
    assetClass: str = Field(min_length=1)
    currentValueCr: float = Field(gt=0)
    expectedReturnPercent: float = Field(ge=-100, le=1000)
    volatilityPercent: float = Field(ge=0, le=1000)
    liquidityScore: float = Field(ge=0, le=100)
    duration: float = Field(default=0, ge=0)

class RiskLimits(StrictModel):
    maxPortfolioVolatility: float = Field(default=.16, gt=0, le=1)
    maxVaR: float = Field(default=.018, gt=0, le=1)
    maxCVaR: float = Field(default=.025, gt=0, le=1)
    maxSingleAssetWeight: float = Field(default=.25, gt=0, le=1)
    maxAssetClassWeight: float = Field(default=.55, gt=0, le=1)
    minimumLiquidityScore: float = Field(default=70, ge=0, le=100)
    minimumCashWeight: float = Field(default=.05, ge=0, le=1)
    maximumTurnover: float = Field(default=.20, gt=0, le=1)
    riskAppetite: Optional[Literal['CONSERVATIVE', 'BALANCED', 'GROWTH']] = 'BALANCED'

class Control(StrictModel):
    controlName: str
    currentValue: float
    limit: float
    status: Literal['PASS','WARNING','BREACH']
    severity: Literal['NONE','MEDIUM','HIGH']
    explanation: str
    remediation: Optional[str] = None

class Metrics(StrictModel):
    expectedReturn: float
    volatility: float
    sharpeRatio: float
    var95: float
    cvar95: float
    maxDrawdown: float
    liquidityScore: float
    concentrationRisk: float
    largestAssetExposure: float
    largestAssetName: str
    largestAssetClassExposure: float
    largestAssetClass: str
    cashWeight: float
    turnover: float

class Component(StrictModel):
    name: str
    normalizedScore: float
    weight: float
    contribution: float

class RiskReport(StrictModel):
    metrics: Metrics
    controls: list[Control]
    riskScore: float
    riskLevel: Literal['LOW','MODERATE','HIGH','CRITICAL']
    operatingMode: Literal['NORMAL', 'CAUTION', 'DEFENSIVE'] = 'NORMAL'
    components: list[Component]
    explanations: list[str]
    portfolioScore: float
    scoreComponents: dict[str, float]

class Portfolio(StrictModel):
    assets: list[Asset]
    totalValue: float
    currency: str = 'INR'
    historyObservations: int

class RouteCapitalRequest(StrictModel):
    incomingCapital: float = Field(gt=0)

class RouteCapitalResponse(StrictModel):
    routedToLiquidity: float
    remainingCapital: float
    updatedAssets: list[Asset]
    totalValue: float
    liquidityBefore: float
    liquidityAfter: float
    liquidityTarget: float
    liquidityRepaired: bool

class AssetAssumptionUpdate(StrictModel):
    expectedReturn: Optional[float] = Field(default=None, ge=-1, le=10)
    volatility: Optional[float] = Field(default=None, ge=0, le=5)
    liquidityScore: Optional[float] = Field(default=None, ge=0, le=100)
    duration: Optional[float] = Field(default=None, ge=0, le=100)

    @model_validator(mode='after')
    def has_value(self):
        if all(getattr(self, field) is None for field in ('expectedReturn', 'volatility', 'liquidityScore', 'duration')):
            raise ValueError('Provide at least one holding assumption to update.')
        return self

class PortfolioAllocationRequest(StrictModel):
    allocations: Optional[dict[str, float]] = None
    totalValue: Optional[float] = Field(default=None, gt=0)
    assumptions: Optional[dict[str, AssetAssumptionUpdate]] = None
    @model_validator(mode='after')
    def valid_allocations(self):
        if not self.allocations and self.totalValue is None and not self.assumptions:
            raise ValueError('Provide allocation weights, a total portfolio value or holding assumptions.')
        if self.allocations is not None:
            if any(not math.isfinite(v) or v < 0 or v > 1 for v in self.allocations.values()):
                raise ValueError('Allocation weights must be finite fractions from 0 to 1.')
            if abs(sum(self.allocations.values()) - 1) > .001:
                raise ValueError('Portfolio allocations must total 100% (tolerance 0.10%).')
        return self

class Scenario(StrictModel):
    id: str
    name: str
    description: str
    assumptions: list["ShockAssumption"] = Field(default_factory=list)

class ScenarioRequest(StrictModel):
    scenarioId: Literal['market-crash','tech-selloff','interest-rate','liquidity-crisis','inflation-shock','global-recession','equity-rally','broad-market-stress']

class CustomRequest(StrictModel):
    name: str = Field(default='Custom Shock', min_length=1, max_length=80)
    shocks: dict[str, float] = Field(default_factory=dict)
    assetShocks: dict[str, float] = Field(default_factory=dict)
    @model_validator(mode='after')
    def check_shocks(self):
        classes = {'Equity','International Equity','REIT','Corporate Bonds','Government Bonds','Gold','Cash'}
        if not (self.shocks or self.assetShocks) or set(self.shocks) - classes:
            raise ValueError('Provide class defaults or asset overrides using known classes/holding IDs.')
        if any(not math.isfinite(v) or v < -100 or v > 10000 for v in [*self.shocks.values(), *self.assetShocks.values()]):
            raise ValueError('Shocks must be finite percentages from -100% to +10000% (demo safety cap).')
        return self

class WithdrawalRequest(StrictModel):
    withdrawalPercent: Optional[float] = Field(default=None, gt=0, le=100)
    withdrawalAmount: Optional[float] = Field(default=None, gt=0)
    @model_validator(mode='after')
    def one_amount(self):
        if (self.withdrawalPercent is None) == (self.withdrawalAmount is None):
            raise ValueError('Provide exactly one of withdrawalPercent or withdrawalAmount (INR).')
        return self

class Impact(StrictModel):
    name: str
    assetClass: str
    originalValue: float
    stressedValue: float
    absoluteLoss: float
    percentageLoss: float
    originalWeight: float
    stressedWeight: float

class LiquidityImpact(StrictModel):
    before: float
    after: float
    liquidCapitalBefore: float
    liquidCapitalAfter: float
    sufficientLiquidCapital: Optional[bool] = None

class ShockAssumption(StrictModel):
    assetId: str
    name: str
    assetClass: str
    shockPercent: float
    liquidityBefore: float
    liquidityAfter: float
    basis: str

class BreachTransition(StrictModel):
    controlName: str
    change: Literal['CLEAR', 'EXISTING', 'NEW', 'WORSENED', 'RESOLVED']
    before: Control
    after: Control

class SimulationResult(StrictModel):
    simulationId: str = ''
    stressedAssets: list[Asset] = Field(default_factory=list)
    assumptions: list[ShockAssumption] = Field(default_factory=list)
    firewallChanges: list[BreachTransition] = Field(default_factory=list)
    limits: RiskLimits = Field(default_factory=RiskLimits)
    scenarioName: str
    originalPortfolioValue: float
    stressedPortfolioValue: float
    absoluteLoss: float
    percentageLoss: float
    marketLoss: float
    withdrawalAmount: float = 0
    withdrawalFulfilled: bool = True
    assetImpacts: list[Impact]
    assetClassImpacts: list[Impact]
    riskBefore: RiskReport
    riskAfter: RiskReport
    breachedControls: list[Control]
    newBreaches: list[Control]
    liquidityImpact: LiquidityImpact
    largestLossContributor: str
    explanation: str


class Trade(StrictModel):
    assetId: str
    name: str
    action: Literal['BUY', 'SELL', 'HOLD']
    amount: float
    stressedWeight: float
    targetWeight: float
    targetValue: float
    liquidityScore: float
    locked: bool
    weightChange: float = 0
    reason: str = ''
    triggeredConstraint: str = ''
    riskImpact: str = ''

class DecisionStep(StrictModel):
    stage: str
    message: str

class RebalanceResult(StrictModel):
    minimumTradeAmount: float = 1000
    objective: str = 'Repair every Risk Firewall breach, then minimize historical portfolio variance and trading cost while keeping expected return within two percentage points of the input portfolio. The optimizer may use the available turnover budget when the risk reduction justifies it.'

    status: Literal['FEASIBLE', 'INFEASIBLE', 'NOT_FOUND']
    explanation: str
    conflicts: list[str] = Field(default_factory=list)
    trades: list[Trade] = Field(default_factory=list)
    assets: list[Asset] = Field(default_factory=list)
    risk: Optional[RiskReport] = None
    firewallChanges: list[BreachTransition] = Field(default_factory=list)
    turnover: float = 0
    cumulativeTurnover: float = 0
    totalValue: float
    externalCapital: float = 0
    limits: RiskLimits
    costBenefit: Optional[dict[str, float]] = None
    changeSummary: list[str] = Field(default_factory=list)
    decisionTrail: list[DecisionStep] = Field(default_factory=list)
    scenarioComparison: Optional[dict[str, float]] = None

class MarketSimulationRequest(StrictModel):
    mode: Literal['HISTORICAL', 'MONTE_CARLO', 'HYBRID']
    runs: int = Field(default=1000, ge=100, le=2000)
    horizonDays: int = Field(default=21, ge=1, le=252)
    seed: int = Field(default=42, ge=0, le=2_147_483_647)
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    stressScenarioId: Optional[Literal['market-crash','tech-selloff','interest-rate','liquidity-crisis','inflation-shock','global-recession','equity-rally','broad-market-stress']] = 'market-crash'

class SimulationStatistics(StrictModel):
    expectedReturn: float
    expectedLoss: float
    volatility: float
    downside5: float
    var95: float
    worstLoss: float
    maxDrawdown: float
    probabilityAnyBreach: float
    averageBreaches: float
    controlBreachProbabilities: dict[str, float]

class MarketSimulationResult(StrictModel):
    mode: Literal['HISTORICAL', 'MONTE_CARLO', 'HYBRID']
    modelLabel: str
    dataSource: str
    periodStart: str
    periodEnd: str
    runs: int
    horizonDays: int
    stressOverlay: Optional[str] = None
    original: SimulationStatistics
    optimized: Optional[SimulationStatistics] = None
    optimizedAvailable: bool
    resilienceImprovement: float
    explanation: str
    decisionTrail: list[DecisionStep] = Field(default_factory=list)

Scenario.model_rebuild()
