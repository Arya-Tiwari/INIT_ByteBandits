"""Run against the frontend proxy and live backend: python backend/tests/smoke_live.py."""
import json
import os
from urllib.request import Request, urlopen

BASE = os.environ.get('AEGIS_SMOKE_URL', 'http://127.0.0.1:5173/api')


def request(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else (b'{}' if method == 'POST' else None)
    req = Request(BASE + path, data=data, headers={'Content-Type': 'application/json'}, method=method)
    with urlopen(req, timeout=60) as response:
        assert response.status == 200
        data = json.load(response)
    json.dumps(data, allow_nan=False)
    return data


baseline = request('/portfolio')
for path in ['/risk', '/risk/limits', '/risk/appetites', '/simulations']:
    request(path)

appetites = request('/risk/appetites')
assert 'CONSERVATIVE' in appetites and 'BALANCED' in appetites and 'GROWTH' in appetites

limits = request('/risk/limits')
try:
    assert request('/risk/limits', appetites['CONSERVATIVE']) == appetites['CONSERVATIVE']
    request('/risk/limits', limits)

    for s in [s for s in request('/simulations') if s['id'] not in ('withdrawal', 'custom')]:
        result = request('/simulate', {'scenarioId': s['id']})
        print(f"{s['name']}: {result['percentageLoss']:.2%} capital loss")

    request('/simulate/custom', {'shocks': {'Equity': -20, 'Gold': 10}, 'assetShocks': {'eq-large': 0, 'eq-mid': 12}})
    crash = request('/simulate', {'scenarioId': 'market-crash'})
    assert request('/simulate/' + crash['simulationId'] + '/rebalance', {})['status'] == 'FEASIBLE'
    crisis = request('/simulate', {'scenarioId': 'liquidity-crisis'})
    assert request('/simulate/' + crisis['simulationId'] + '/rebalance', {})['status'] == 'INFEASIBLE'
    request('/simulate/withdrawal', {'withdrawalPercent': 10})

    # Optimize baseline portfolio
    opt_baseline = request('/optimize', {})
    assert opt_baseline['status'] in ('FEASIBLE', 'INFEASIBLE', 'NOT_FOUND')

    # Route capital
    routed = request('/portfolio/route-capital', {'incomingCapital': 10_000_000})
    assert abs(routed['totalValue'] - (baseline['totalValue'] + 10_000_000)) < 1.0
    request('/risk')

finally:
    # Restore the caller's capital, allocations, assumptions and controls even on failure.
    request('/portfolio', {
        'totalValue': baseline['totalValue'],
        'allocations': {asset['id']: asset['currentWeight'] for asset in baseline['assets']},
        'assumptions': {asset['id']: {key: asset[key] for key in ('expectedReturn', 'volatility', 'liquidityScore', 'duration')} for asset in baseline['assets']},
    })
    request('/risk/limits', limits)
assert request('/portfolio') == baseline
assert request('/risk/limits') == limits
print('Live endpoints passed through the frontend proxy; original portfolio and limits restored.')
