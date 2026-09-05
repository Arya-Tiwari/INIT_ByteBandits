"""Regenerate the checked-in synthetic dataset using only the standard library."""
import csv, json, math, random
from datetime import date, timedelta
from pathlib import Path
p = Path(__file__).parent
specs = [
('eq-large','India Large Cap','NIFTY50','Equity',.30,.12,.21,92,0),
('eq-mid','India Mid Cap','MIDCAP','Equity',.18,.14,.27,80,0),
('eq-bank','Banking Basket','BANKS','Equity',.10,.13,.25,88,0),
('gov','Government Securities','GSEC10Y','Government Bonds',.12,.065,.065,95,7.2),
('corp','AAA Corporate Bonds','AAA-BOND','Corporate Bonds',.08,.078,.085,65,4.5),
('cash','Treasury Cash','CASH','Cash',.04,.04,.002,100,0),
('gold','Physical Gold ETF','GOLD','Gold',.06,.075,.16,90,0),
('reit','Commercial Realty Trust','REIT','REIT',.05,.09,.20,45,0),
('intl','Global Equity Index','WORLD','International Equity',.07,.10,.19,85,0)]
assets = [dict(id=i,name=n,ticker=t,assetClass=c,currentValue=w*500_000_000,currentWeight=w,expectedReturn=r,volatility=v,liquidityScore=l,duration=d) for i,n,t,c,w,r,v,l,d in specs]
(p/'portfolio.json').write_text(json.dumps(assets,indent=2)+'\n')
rng = random.Random(20260905)
with (p/'historical_returns.csv').open('w',newline='') as f:
    writer = csv.writer(f); writer.writerow(['date']+[s[0] for s in specs])
    day = date(2023,1,2)
    for k in range(756):
        while day.weekday() >= 5: day += timedelta(days=1)
        market, rates, commodity = [rng.gauss(0,1) for _ in range(3)]
        if k in (130,131,400,401,610): market -= 3.5
        row=[]
        for _,_,_,c,_,r,v,_,_ in specs:
            loading = {'Equity':(.82,.05,0),'International Equity':(.65,0,0),'REIT':(.6,-.35,0),'Corporate Bonds':(.2,-.65,0),'Government Bonds':(-.15,-.8,0),'Gold':(-.15,0,.8),'Cash':(0,0,0)}[c]
            factor = sum(x*y for x,y in zip(loading,(market,rates,commodity))) + math.sqrt(1-sum(x*x for x in loading))*rng.gauss(0,1)
            row.append(round(r/252+v/math.sqrt(252)*factor,9))
        writer.writerow([day.isoformat()]+row); day += timedelta(days=1)
