"""Run against the frontend proxy and live backend: python backend/tests/smoke_live.py."""
import json
from urllib.request import Request, urlopen

BASE = 'http://127.0.0.1:8000/api'


def request(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else (b'{}' if method == 'POST' else None)
    req = Request(BASE + path, data=data, headers={'Content-Type': 'application/json'}, method=method)
    with urlopen(req) as response:
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

# Reset demo
reset_res = request('/reset', method='POST')
assert reset_res['status'] == 'RESET'
assert request('/portfolio') == baseline
assert request('/risk/limits') == limits

print('All live endpoints passed through the frontend proxy; portfolio and limits reset to baseline.')
