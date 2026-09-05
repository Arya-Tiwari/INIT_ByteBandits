"""Run against the frontend proxy and live backend: python backend/tests/smoke_live.py."""
import json
from urllib.request import Request, urlopen
BASE='http://127.0.0.1:5173/api'
def request(path,body=None):
    req=Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    with urlopen(req) as response:
        assert response.status==200
        data=json.load(response)
    json.dumps(data,allow_nan=False)
    return data
baseline=request('/portfolio')
for path in ['/risk','/risk/limits','/simulations']: request(path)
limits=request('/risk/limits'); assert request('/risk/limits',limits)==limits
for s in [s for s in request('/simulations') if s['id'] not in ('withdrawal','custom')]:
    result=request('/simulate',{'scenarioId':s['id']})
    print(f"{s['name']}: {result['percentageLoss']:.2%} capital loss")
request('/simulate/custom',{'shocks':{'Equity':-20,'Gold':10},'assetShocks':{'eq-large':0,'eq-mid':12}})
crash=request('/simulate',{'scenarioId':'market-crash'})
assert request('/simulate/'+crash['simulationId']+'/rebalance',{})['status']=='FEASIBLE'
crisis=request('/simulate',{'scenarioId':'liquidity-crisis'})
assert request('/simulate/'+crisis['simulationId']+'/rebalance',{})['status']=='INFEASIBLE'
request('/simulate/withdrawal',{'withdrawalPercent':10})
assert baseline==request('/portfolio')
print('All live endpoints passed through the frontend proxy; portfolio unchanged.')
