export const assets=[
 {name:'Indian Equity',short:'IN',color:'#6282ca',ret:13,vol:22,beta:.85,cost:15},
 {name:'US Equity',short:'US',color:'#8d7ac7',ret:11,vol:19,beta:.8,cost:20},
 {name:'Bonds',short:'BD',color:'#4b9baf',ret:7,vol:6,beta:.1,cost:5},
 {name:'Gold',short:'AU',color:'#c69d43',ret:8,vol:15,beta:-.15,cost:12},
 {name:'Real Estate',short:'RE',color:'#b67d67',ret:9,vol:14,beta:.45,cost:80},
 {name:'Cash',short:'CA',color:'#5d9c7d',ret:5,vol:.3,beta:0,cost:0},
];
export type Limits={cash:number,equity:number,cvar:number,concentration:number,liquidity:number,hurdle:number};
export const defaults:Limits={cash:8,equity:50,cvar:14,concentration:40,liquidity:90,hurdle:2};
export function metrics(w:number[]){const ret=w.reduce((s,v,i)=>s+v/100*assets[i].ret,0);let variance=0;for(let i=0;i<6;i++)for(let j=0;j<6;j++)variance+=w[i]*w[j]/10000*assets[i].vol*assets[j].vol*(i===j?1:assets[i].beta*assets[j].beta);const vol=Math.sqrt(variance);const cvar=Math.max(0,2.062713*vol-ret);return {ret,vol,cvar,var:Math.max(0,1.644854*vol-ret),sharpe:vol?(ret-5)/vol:0,liquidity:100-w[4],score:Math.max(0,Math.min(100,100-cvar*1.7-Math.max(0,Math.max(...w)-35)*.4-Math.max(0,8-w[5])*1.5))}}
export function checks(w:number[],l:Limits){const m=metrics(w);return [{name:'Cash reserve',ok:w[5]>=l.cash-1e-6},{name:'Equity exposure',ok:w[0]+w[1]<=l.equity+1e-6},{name:'CVaR limit',ok:m.cvar<=l.cvar+1e-6},{name:'Concentration',ok:Math.max(...w)<=l.concentration+1e-6},{name:'Liquidity',ok:m.liquidity>=l.liquidity-1e-6}]}
function violation(w:number[],l:Limits){return Math.max(0,l.cash-w[5])+Math.max(0,w[0]+w[1]-l.equity)+Math.max(0,metrics(w).cvar-l.cvar)+w.reduce((s,v)=>s+Math.max(0,v-l.concentration),0)+Math.max(0,l.liquidity-(100-w[4]))}
export function optimize(original:number[],l:Limits){
 const cost=(w:number[])=>w.reduce((s,v,i)=>s+Math.abs(v-original[i])*assets[i].cost/10000,0);
 const objective=(w:number[])=>{const m=metrics(w);return violation(w,l)*10000+m.cvar*.55-m.ret*.45+cost(w)*l.hurdle+w.reduce((s,v,i)=>s+Math.abs(v-original[i]),0)*.015};
 let w=[...original],score=objective(w);for(let n=0;n<350;n++){let best=w,next=score;for(let i=0;i<6;i++)for(let j=0;j<6;j++){if(i===j||w[i]<1)continue;const v=[...w];v[i]-=1;v[j]+=1;const s=objective(v);if(s<next-1e-8){best=v;next=s}}if(best===w)break;w=best;score=next}
 const feasible=checks(w,l).every(r=>r.ok); const benefit=Math.max(0,metrics(original).cvar-metrics(w).cvar);const hold=feasible&&checks(original,l).every(r=>r.ok)&&benefit<=cost(w)*l.hurdle+1e-8;
 return {target:!feasible||hold?[...original]:w,feasible,hold,cost:cost(w),benefit};
}
