/** Parse and validate every row before any holding is sent to the backend. */
export function parseHoldingsImport(text: string, existingTickers: string[]) {
  const trimmed = text.trim();
  let records: Record<string, unknown>[];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const value = JSON.parse(trimmed);
    records = Array.isArray(value) ? value : [value];
  } else {
    const rows: string[][] = [];
    let row: string[] = [], field = "", quoted = false;
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (char === '"') {
        if (quoted && trimmed[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (!quoted && (char === "," || char === "\n")) {
        row.push(field.trim()); field = "";
        if (char === "\n") { rows.push(row); row = []; }
      } else field += char;
    }
    if (quoted) throw new Error("CSV has an unclosed quoted field.");
    row.push(field.trim()); rows.push(row);
    const header = rows.shift()?.map((name) => name.toLowerCase());
    if (!header || !["name", "ticker", "assetclass", "valuecr"].every((name) => header.includes(name))) {
      throw new Error("CSV requires Name,Ticker,AssetClass,ValueCr headers. Use the sample template.");
    }
    records = rows.filter((fields) => fields.some(Boolean)).map((fields) => {
      if (fields.length !== header.length) throw new Error("CSV row does not match its header.");
      const values = Object.fromEntries(header.map((key, i) => [key, fields[i]]));
      return { name: values.name, ticker: values.ticker, assetClass: values.assetclass,
        currentValueCr: values.valuecr, expectedReturnPercent: values.expectedreturnpercent,
        volatilityPercent: values.volatilitypercent, liquidityScore: values.liquidityscore, duration: values.duration };
    });
  }
  if (!records.length) throw new Error("No holding records found.");
  const tickers = new Set(existingTickers.map((ticker) => ticker.toUpperCase()));
  return records.map((item, index) => {
    const fail = (message: string): never => { throw new Error(`Row ${index + 1}: ${message}`); };
    if (!item || typeof item !== "object") fail("Expected a holding object.");
    if (("expectedReturn" in item && item.expectedReturnPercent == null) || ("volatility" in item && item.volatilityPercent == null)) {
      fail("Use expectedReturnPercent and volatilityPercent with explicit percentage units.");
    }
    const requiredText = (value: unknown, name: string) => {
      if (typeof value !== "string" || !value.trim()) return fail(`${name} is required.`);
      return value.trim();
    };
    const numeric = (value: unknown, name: string, min: number, max: number, fallback?: number) => {
      const missing = value == null || value === "";
      const number = missing ? fallback : (typeof value === "number" || typeof value === "string" ? Number(value) : NaN);
      if (number == null || !Number.isFinite(number) || number < min || number > max) return fail(`${name} is invalid.`);
      return number;
    };
    const ticker = requiredText(item.ticker, "Ticker").toUpperCase();
    if (tickers.has(ticker)) fail(`Ticker ${ticker} already exists or is repeated.`);
    tickers.add(ticker);
    const currentValueCr = numeric(item.currentValueCr ?? item.valueCr, "ValueCr", Number.MIN_VALUE, Number.MAX_VALUE / 1e7);
    return { name: requiredText(item.name, "Name"), ticker,
      assetClass: requiredText(item.assetClass, "AssetClass"), currentValueCr,
      expectedReturnPercent: numeric(item.expectedReturnPercent, "ExpectedReturnPercent", -100, 1000, 12),
      volatilityPercent: numeric(item.volatilityPercent, "VolatilityPercent", 0, 1000, 18),
      liquidityScore: numeric(item.liquidityScore, "LiquidityScore", 0, 100, 80),
      duration: numeric(item.duration, "Duration", 0, 100, 0) };
  });
}
