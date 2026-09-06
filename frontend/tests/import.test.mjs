import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/holdingsImport.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } });
const { parseHoldingsImport } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const typesJs = ts.transpileModule(typesSource, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { exportRebalanceCsv } = await import(`data:text/javascript;base64,${Buffer.from(typesJs).toString('base64')}`);
const asset = { name: 'Audit', ticker: 'AUD', assetClass: 'Equity', currentValueCr: 1 };

test('quoted CSV preserves commas, explicit zero assumptions and duration', () => {
  const rows = parseHoldingsImport('Name,Ticker,AssetClass,ValueCr,ExpectedReturnPercent,VolatilityPercent,LiquidityScore,Duration\n"Fund, One",FUND,Equity,2,0,0,80,4', []);
  assert.equal(rows[0].name, 'Fund, One');
  assert.equal(rows[0].expectedReturnPercent, 0);
  assert.equal(rows[0].volatilityPercent, 0);
  assert.equal(rows[0].duration, 4);
  assert.ok(exportRebalanceCsv({ trades: [{ assetId: 'a', name: 'Fund "One", Ltd', action: 'HOLD', amount: 0, targetWeight: 1, liquidityScore: 80, locked: false }] }).includes('"Fund ""One"", Ltd"'));
});
test('invalid values never become invented capital', () => {
  for (const value of [0, -1, '', 'bad', null, 'Infinity']) {
    assert.throws(() => parseHoldingsImport(JSON.stringify([{ ...asset, currentValueCr: value }]), []));
  }
});
test('all rows validated and duplicate tickers rejected before requests', () => {
  assert.throws(() => parseHoldingsImport(JSON.stringify([asset, { ...asset, ticker: 'aud' }]), []));
  assert.throws(() => parseHoldingsImport(JSON.stringify([asset]), ['AUD']));
  assert.throws(() => parseHoldingsImport(JSON.stringify([asset, {}]), []));
});
test('JSON numeric units and optional defaults remain explicit', () => {
  assert.throws(() => parseHoldingsImport(JSON.stringify({ ...asset, expectedReturn: .12 }), []));
  assert.throws(() => parseHoldingsImport(JSON.stringify({ ...asset, volatility: .2 }), []));
  assert.deepEqual(parseHoldingsImport(JSON.stringify(asset), [])[0], {
    ...asset, expectedReturnPercent: 12, volatilityPercent: 18, liquidityScore: 80, duration: 0,
  });
});
