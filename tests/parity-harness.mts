/**
 * Runs the ORIGINAL Apps Script (docs/apps-script-v7.js) against a mocked
 * SpreadsheetApp built from an .xlsx export, then runs the TypeScript port on the
 * same workbook and compares the schedules row-by-row.
 * Usage: TZ=UTC npx tsx tests/parity-harness.mts path/to/sheet.xlsx
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { parseWorkbook, datasetToSchedulerInput } from '../lib/workbook';
import { runScheduler, formatTime, MONTH_NAMES, DAYS_SHORT } from '../lib/scheduler';

const file = process.argv[2];
const buf = readFileSync(file);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf as unknown as ArrayBuffer);

const unwrap = (v: any): any => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return unwrap(v.result);
    if ('richText' in v) return v.richText.map((t: any) => t.text).join('');
    if ('formula' in v || 'sharedFormula' in v) return '';
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v);
  return v ?? '';
};
const grid = (ws: ExcelJS.Worksheet) => {
  const out: any[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(unwrap(row.getCell(c).value));
    out.push(vals);
  }
  return out;
};
const outputs: Record<string, any[][]> = {};
const chain: any = new Proxy({}, { get: () => () => chain });
const mkSheet = (name: string, values: any[][] | null) => ({
  getDataRange: () => ({ getValues: () => values!.map(r => r.slice()) }),
  getLastRow: () => values!.length,
  getRange: (...a: any[]) => {
    if (typeof a[0] === 'string') return chain;
    const [r, c, n, w] = a;
    return {
      getValues: () => values!.slice(r - 1, r - 1 + n).map(row => { const x = row.slice(c - 1, c - 1 + w); while (x.length < w) x.push(''); return x; }),
      setValues: (v: any[][]) => { (outputs[name] ||= []).push(...v); return chain; },
    };
  },
  clear: () => {}, setFrozenRows: () => {}, autoResizeColumns: () => {},
});
const sheets: Record<string, any> = {};
wb.worksheets.forEach(ws => { if (!/^Schedul/.test(ws.name)) sheets[ws.name] = mkSheet(ws.name, grid(ws)); });
const alerts: string[] = [];
const ui = { Button: { YES: 'YES', NO: 'NO', CANCEL: 'CANCEL', CLOSE: 'CLOSE' }, ButtonSet: { YES_NO_CANCEL: 1 },
  alert: (...a: any[]) => { alerts.push(String(a[a.length > 1 ? 1 : 0])); return 'YES'; } };
const ss = { getSheetByName: (n: string) => sheets[n] || null, insertSheet: (n: string) => (sheets[n] = mkSheet(n, null)) };
const ctx = vm.createContext({ SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui }, console, Date, Math, Number, String, Set, Map, Object, Array, Infinity, isNaN });
vm.runInContext(readFileSync(new URL('../docs/apps-script-v7.js', import.meta.url), 'utf8') + '\ngenerateDynamicLivestreamSchedule();', ctx);

const original = (outputs['Schedule'] || []).slice(1).map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], String(r[7]).toLowerCase(), r[8], r[9]].join(' | '));
const ds = await parseWorkbook(buf);
const res = runScheduler(datasetToSchedulerInput(ds));
const label = (d: number) => d + ' ' + MONTH_NAMES[ds.month].slice(0, 3) + ' ' + ds.year;
const port = res.streams.map(s => [label(s.day), DAYS_SHORT[new Date(ds.year, ds.month, s.day).getDay()], formatTime(s.start), formatTime(s.end), s.host, s.brand, s.period, s.sale.toLowerCase(), s.platform, s.room].join(' | '));
console.log('original rows:', original.length, ' port rows:', port.length);
let diffs = 0;
for (let i = 0; i < Math.max(original.length, port.length); i++) {
  if (original[i] !== port[i]) { diffs++; if (diffs <= 15) console.log('#' + i + '\n  orig: ' + original[i] + '\n  port: ' + port[i]); }
}
console.log(diffs ? 'MISMATCH: ' + diffs + ' rows differ' : 'IDENTICAL: port reproduces the original script exactly');
console.log('port summary:', res.message);
process.exit(diffs ? 1 : 0);
