import { assets, checks, metrics, type Limits } from './optimizer.ts';

type PlanReport = {
  weights: number[];
  target: number[];
  limits: Limits;
  hold: boolean;
  candidateCost: number;
  benefit: number;
  reasons: string[];
  generatedAt?: Date;
};

// A small, self-contained PDF writer: selectable text, built-in Helvetica,
// explicit A4 pages and ASCII currency labels supported by every PDF reader.
export function createPlanPdf(plan: PlanReport): Uint8Array {
  const { weights, target, limits } = plan;
  if (weights.length !== 6 || target.length !== 6 || plan.reasons.length !== 6 ||
      [...weights, ...target].some(v => !Number.isFinite(v) || v < 0) ||
      Math.abs(weights.reduce((s,v)=>s+v,0)-100)>1e-6 ||
      Math.abs(target.reduce((s,v)=>s+v,0)-100)>1e-6 ||
      !checks(target, limits).every(r=>r.ok)) {
    throw new Error('A valid, feasible portfolio is required for PDF export.');
  }
  const before=metrics(weights), after=metrics(target);
  const changes=target.map((v,i)=>v-weights[i]);
  const gross=changes.reduce((s,v)=>s+Math.abs(v),0);
  const costs=changes.map((v,i)=>Math.abs(v)*assets[i].cost/10000);
  const totalCost=costs.reduce((s,v)=>s+v,0);
  const breaches=checks(weights,limits).filter(r=>!r.ok);
  const cr=(v:number)=>`INR ${v.toFixed(2)} Cr`;
  const pct=(v:number)=>`${v.toFixed(2)}%`;
  const date=(plan.generatedAt??new Date()).toISOString().replace('T',' ').slice(0,16)+' UTC';
  const pages:string[]=[];
  let commands:string[]=[];
  const escape=(v:string)=>v.replace(/[^\x20-\x7E]/g,'-').replace(/([\\()])/g,'\\$1');
  function text(value:string,x:number,y:number,size=10,bold=false,color='0.16 0.24 0.27') {
    commands.push(`BT /${bold?'F2':'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x} ${842-y} Tm (${escape(value)}) Tj ET`);
  }
  function box(x:number,y:number,w:number,h:number,color:string) {
    commands.push(`${color} rg ${x} ${842-y-h} ${w} ${h} re f`);
  }
  function paragraph(value:string,x:number,y:number,width=98,size=10) {
    const words=value.split(/\s+/);let line='';
    for(const word of words){if(line && (line+' '+word).length>width){text(line,x,y,size);y+=15;line=word;}else line+=(line?' ':'')+word;}
    if(line){text(line,x,y,size);y+=15;}return y;
  }
  function header(subtitle:string,page:number) {
    commands=[];
    box(0,0,595,102,'0.08 0.25 0.21');
    text('capitalIQ',36,37,22,true,'1 1 1');
    text(subtitle,36,65,13,false,'0.77 0.89 0.83');
    text('PORTFOLIO OPTIMIZATION REPORT',36,87,8,false,'0.65 0.81 0.73');
    text('Demo data | No trades are executed',36,803,8);
    text(`Page ${page} of 2`,501,803,8);
    text(`Generated ${date}`,36,817,8);
  }
  header('Allocation and execution plan',1);
  text('Multi-Asset Growth Portfolio | INR 100.00 Cr',36,130,14,true);
  box(36,147,523,61,'0.93 0.97 0.95');
  text(plan.hold?'HOLD - retain current allocation':'REBALANCE - feasible target allocation',49,169,13,true);
  text(`${checks(target,limits).filter(r=>r.ok).length}/5 controls satisfied | One-way turnover: ${(gross/2).toFixed(1)}%`,49,190,10);
  text('Before / after analysis',36,237,13,true);
  box(36,250,523,24,'0.94 0.96 0.97');
  text('METRIC',46,266,9,true);text('CURRENT',333,266,9,true);text('RECOMMENDED',443,266,9,true);
  const rows=[['Safety score',before.score.toFixed(0)+'/100',after.score.toFixed(0)+'/100'],['Expected annual return',pct(before.ret),pct(after.ret)],['Annual volatility',pct(before.vol),pct(after.vol)],['Annual 95% CVaR',pct(before.cvar),pct(after.cvar)],['Annual 95% VaR',pct(before.var),pct(after.var)],['Liquidity',pct(before.liquidity),pct(after.liquidity)],['Sharpe ratio',before.sharpe.toFixed(2),after.sharpe.toFixed(2)]];
  rows.forEach((row,i)=>{const y=292+i*23;text(row[0],46,y);text(row[1],333,y);text(row[2],443,y,10,true);});
  text('BUY / SELL / HOLD plan',36,480,13,true);
  box(36,493,523,27,'0.94 0.96 0.97');
  ['ASSET','ACTION','FROM','TO','TRADE (Cr)','FEE (INR)'].forEach((v,i)=>text(v,[44,154,218,273,328,451][i],511,8,true));
  assets.forEach((asset,i)=>{const y=541+i*28;const d=changes[i];if(i%2===1)box(36,y-17,523,28,'0.98 0.99 0.99');text(asset.name,44,y,9);text(d>.001?'BUY':d<-.001?'SELL':'HOLD',154,y,9,true);text(weights[i].toFixed(1)+'%',218,y,9);text(target[i].toFixed(1)+'%',273,y,9);text(Math.abs(d).toFixed(2),328,y,9);text((costs[i]*10000000).toLocaleString('en-IN',{maximumFractionDigits:0}),451,y,9);});
  text(`Gross traded: ${cr(gross)}   |   Total cost: INR ${(totalCost*100).toFixed(2)} lakh`,36,722,11,true);
  paragraph('Trades balance before fees. Costs reduce portfolio NAV; target weights are gross of fees. 1 Cr = 10,000,000 INR. 1 lakh = 100,000 INR.',36,747,99,9);
  pages.push(commands.join('\n'));
  header('Decision rationale and risk mandate',2);
  text('Why this recommendation?',36,130,14,true);
  let y=paragraph((breaches.length?`Current policy breaches: ${breaches.map(r=>r.name).join(', ')}. `:'The current portfolio meets the configured mandate. ')+(plan.hold?'The candidate does not clear the cost hurdle. Retain current holdings with zero executable cost and turnover.':breaches.length?'Policy remediation takes priority over the cost-based HOLD check.':'Modeled risk benefit clears the configured cost hurdle.'),36,153,96);
  y+=8;
  y=paragraph(`Candidate risk benefit: ${cr(plan.benefit)}. Candidate cost: INR ${(plan.candidateCost*100).toFixed(2)} lakh. Hurdle: ${limits.hurdle}x. Cost x hurdle: ${cr(plan.candidateCost*limits.hurdle)}. Benefit is modeled annual CVaR reduction, not profit or realized savings.`,36,y,96);
  y+=15;text('Reasons for each asset',36,y,13,true);y+=23;
  assets.forEach((asset,i)=>{text(asset.name,36,y,10,true);y=paragraph(plan.reasons[i],150,y,73,9)+9;});
  y+=7;text('Configured risk controls',36,y,13,true);y+=23;
  const controlLines=[`Minimum cash: ${limits.cash}% | Maximum combined equity: ${limits.equity}%`,`Maximum annual 95% CVaR: ${limits.cvar}% | Maximum single asset: ${limits.concentration}%`,`Minimum liquid allocation: ${limits.liquidity}% | Benefit / cost hurdle: ${limits.hurdle}x`];
  controlLines.forEach(line=>{text(line,36,y,10);y+=19;});
  y+=14;text('Model assumptions',36,y,13,true);y+=22;
  paragraph('Illustrative annual return and factor covariance assumptions. VaR and CVaR use a normal model at 95% confidence over one year. Liquidity excludes real estate. Safety score is a demo heuristic; risk-free rate is 5%. Long-only pairwise search uses 1 percentage-point steps with no global optimality guarantee. Fees apply to buys and sells at asset-specific basis-point rates. Taxes, slippage, and market impact are not modeled. No live prices or real orders.',36,y,99,9);
  pages.push(commands.join('\n'));
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [5 0 R 7 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  pages.forEach((stream,i)=>{objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6+i*2} 0 R >>`);objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);});
  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset=>{pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;});
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
