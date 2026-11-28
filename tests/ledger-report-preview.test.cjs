'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('async function calcLedgerFinancials('),end=html.indexOf('async function renderLedgerReportReadiness(',start);
assert.ok(start>=0&&end>start,'ledger report engine missing');
const source=html.slice(start,end).trim().replace(/^async function calcLedgerFinancials\(/,'async function(');
const accounts=[
 {code:'1101',name:'Kas Tunai',type:'asset',normal_balance:'debit'},
 {code:'1105',name:'Persediaan',type:'asset',normal_balance:'debit'},
 {code:'3401',name:'SHU Ditahan',type:'equity',normal_balance:'credit'},
 {code:'4101',name:'Penjualan',type:'revenue',normal_balance:'credit'},
 {code:'5101',name:'HPP',type:'expense',normal_balance:'debit'},
 {code:'6101',name:'Beban Operasional',type:'expense',normal_balance:'debit'}
];
const lines=[
 {id:'L1',journal_id:'OPEN',tanggal:'2026-01-01',account_code:'1101',debit:1000,credit:0,status:'posted'},
 {id:'L2',journal_id:'OPEN',tanggal:'2026-01-01',account_code:'3401',debit:0,credit:1000,status:'posted'},
 {id:'L3',journal_id:'SALE',tanggal:'2026-01-02',account_code:'1101',debit:1000,credit:0,status:'posted'},
 {id:'L4',journal_id:'SALE',tanggal:'2026-01-02',account_code:'4101',debit:0,credit:1000,status:'posted'},
 {id:'L5',journal_id:'COGS',tanggal:'2026-01-03',account_code:'5101',debit:400,credit:0,status:'posted'},
 {id:'L6',journal_id:'COGS',tanggal:'2026-01-03',account_code:'1105',debit:0,credit:400,status:'posted'},
 {id:'L7',journal_id:'EXP',tanggal:'2026-01-04',account_code:'6101',debit:200,credit:0,status:'posted'},
 {id:'L8',journal_id:'EXP',tanggal:'2026-01-04',account_code:'1101',debit:0,credit:200,status:'posted'},
 {id:'L9',journal_id:'DRAFT',tanggal:'2026-01-05',account_code:'1101',debit:999999,credit:0,status:'draft'},
 {id:'L10',journal_id:'DRAFT',tanggal:'2026-01-05',account_code:'4101',debit:0,credit:999999,status:'draft'}
];
const entries=[
 {id:'OPEN',source_type:'opening_balance',status:'posted',tanggal:'2026-01-01'},
 {id:'SALE',source_type:'legacy_transaction',source_id:'SALE-1',status:'posted',tanggal:'2026-01-02'},
 {id:'COGS',source_type:'inventory',status:'posted',tanggal:'2026-01-03'},
 {id:'EXP',source_type:'manual_adjustment',status:'posted',tanggal:'2026-01-04'},
 {id:'DRAFT',source_type:'legacy_transaction',source_id:'DRAFT-ONLY',status:'draft',tanggal:'2026-01-05'}
];
let legacy=[{id:'SALE-1',import_source:'FILE',tanggal:'2026-01-02'}];
const ctx={settings:{ledgerInventoryReconciled:true,ledgerSubledgerReconciled:true,ledgerReportsApproved:true},
 accountingIsValidDate:v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&!Number.isNaN(new Date(v+'T00:00:00Z').getTime()),
 getAll:async name=>({chart_accounts:accounts,journal_lines:lines,journal_entries:entries,opening_balance_versions:[{id:'OB',status:'posted',effective_date:'2026-01-01'}]})[name]||[],
 getAccountingTransactions:async()=>legacy};
const calc=vm.runInNewContext('('+source+')',ctx);
(async()=>{
 const result=await calc('2026-01-02','2026-01-31');
 assert.equal(result.posted_journal_count,4);assert.equal(result.draft_journal_count,1);
 assert.equal(result.income_statement.revenue,1000);assert.equal(result.income_statement.cogs,400);
 assert.equal(result.income_statement.operating_expenses,200);assert.equal(result.income_statement.gross_profit,600);
 assert.equal(result.income_statement.net_profit,400);
 assert.equal(result.cash_flow.inflow,1000);assert.equal(result.cash_flow.outflow,200);assert.equal(result.cash_flow.net,800);
 assert.equal(result.trial_balance.total_debit,2400);assert.equal(result.trial_balance.total_credit,2400);assert.equal(result.trial_balance.balanced,true);
 assert.equal(result.balance_sheet.assets,1400);assert.equal(result.balance_sheet.total_liabilities_equity,1400);assert.equal(result.balance_sheet.balanced,true);
 assert.equal(result.readiness.ready,true);
 legacy=[...legacy,{id:'UNPOSTED',import_source:'FILE',tanggal:'2026-01-06'}];
 const blocked=await calc('2026-01-02','2026-01-31');
 assert.equal(blocked.readiness.ready,false);assert.equal(blocked.readiness.legacy_posted_count,1);assert.equal(blocked.readiness.legacy_source_count,2);
 assert.ok(blocked.readiness.reasons.some(x=>x.includes('1/2')));
 assert.equal(blocked.income_statement.net_profit,400,'draft journals must not affect ledger report');
 const page=html.slice(html.indexOf('async function loadLaporan()'),html.indexOf('async function exportLaporanExcel()'));
 assert.ok(page.includes('renderLedgerReportReadiness(from,to,ledgerResult)')&&page.includes('calcFinancials(from, to)'),'legacy reports must remain alongside ledger preview');

 const builderStart=html.indexOf('function buildLedgerLaporanRows('),builderEnd=html.indexOf('async function loadLaporan(',builderStart);
 assert.ok(builderStart>=0&&builderEnd>builderStart,'ledger report row builder missing');
 const builderSource=html.slice(builderStart,builderEnd).trim().replace('function buildLedgerLaporanRows(','function(');
 const builder=vm.runInNewContext('('+builderSource+')',{});
 const pnlRows=builder(result,'labarugi').rows;
 assert.equal(pnlRows.find(x=>x.label==='Laba Bersih').value,400);
 const balanceRows=builder(result,'neraca').rows;
 assert.equal(balanceRows.find(x=>x.label==='Total Aset').value,1400);
 const cashRows=builder(result,'arus').rows;
 assert.equal(cashRows.find(x=>x.label==='Kenaikan / (Penurunan) Kas').value,800);
 const explanationRows=builder(result,'penjelasan').rows;
 assert.ok(explanationRows.some(x=>String(x.note||'').includes('Saldo pembuka posted: Ya')));
 const loadStart=html.indexOf('async function loadLaporan()'),loadEnd=html.indexOf('async function exportLaporanExcel()',loadStart);
 const loadSource=html.slice(loadStart,loadEnd);
 assert.ok(loadSource.includes('ledgerResult.readiness.ready')&&loadSource.includes('buildLedgerLaporanRows')&&loadSource.includes('buildLaporanRows'),'official report basis must switch only after readiness');
 assert.ok(loadSource.includes("reportBasis=ledgerActive?'ledger_posted_only':'legacy_transactions'"));
 assert.ok(html.includes('Basis: Ledger · Jurnal Posted')&&html.includes('Basis: Transaksi Legacy'),'basis must be visible in report');
 assert.ok(html.includes('const basisText=L.basis==='),'basis must be included in exports');

 console.log('Ledger report engine tests: posted-only P&L, balance sheet, cash flow, trial balance, draft exclusion and readiness gate passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
