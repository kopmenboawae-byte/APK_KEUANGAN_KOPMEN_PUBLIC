const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'Function ' + name + ' must exist in index.html');
  const brace = html.indexOf('{', start);
  assert.notEqual(brace, -1, 'Function body must exist: ' + name);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i], next = html[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('Unclosed function body: ' + name);
}

const validatorSource = extractFunction('accountingValidateJournalLines');
const dateValidatorSource = extractFunction('accountingIsValidDate');
const sandbox = { accountingId: (prefix) => prefix + '-TEST' };
vm.runInNewContext(validatorSource + '\nglobalThis.validate = accountingValidateJournalLines;', sandbox);
const validate = sandbox.validate;
vm.runInNewContext(dateValidatorSource + '\nglobalThis.isValidDate = accountingIsValidDate;', sandbox);
const isValidDate = sandbox.isValidDate;
assert.equal(isValidDate('2026-11-28'), true);
assert.equal(isValidDate('2026-02-30'), false);
assert.equal(isValidDate('2026-13-01'), false);
assert.equal(isValidDate('28-11-2026'), false);
assert.ok(html.includes("index('account_date').openCursor"), 'General Ledger query should use the compound index cursor');
assert.ok(html.includes("index('tanggal').openCursor"), 'Trial balance should aggregate through a cursor');
assert.ok(html.includes("index('bk_account_date').openCursor"), 'BK subledger should query by holder and date');
assert.ok(html.includes('saveBkAccountabilityDraft'), 'BK advance, return and accountability workflow must exist');
assert.ok(html.includes('bk_accountability_record'), 'BK journal and subledger record must be linked');
assert.ok(html.includes('amount>balance.ledger_balance'), 'BK returns/accountability must not exceed posted advance balance');
assert.ok(html.includes("current.source_type==='reversal'"), 'Journal reversal must update linked subledger status');
assert.ok(html.includes("status:'reversed'"), 'Reversed BK/opening records must be marked reversed');
assert.ok(html.includes('journalRefs.length||accountabilityRefs.length'), 'BK master with journal history must not be deletable');
assert.ok(html.includes("bk_rekening_id: row.querySelector('.journal-bk-holder').value || null"), 'Manual journals must capture BK holder subledger id');
assert.ok(html.includes('status:\'posted\',posted_at:now,journal_id:id'), 'Posting must update BK subledger status');

assert.ok(html.includes('id="accountingWorkbench"'), 'Journal workbench must remain under Transactions');
assert.ok(html.includes('id="bkMasterTable"'), 'BK administration table must exist');
assert.ok(html.includes('id="bkAdminSection"'), 'BK opening administration must have a direct section anchor');
assert.ok(html.includes("showPage('transaksi'); setTimeout(()=>document.getElementById('bkAdminSection')"), 'BK balance shortcut must route to Transactions');
assert.ok(html.includes('id="settings-stok"'), 'Stocktake administration must exist');
assert.ok(html.includes('id="tutupJurnalSection"'), 'Daily journal close must be under Transactions');
assert.ok(!html.includes('id="page-tutupjurnal"'), 'Daily close must not remain a separate operational page');
assert.ok(html.includes('SIMPAN_TUTUP_JURNAL'), 'Daily close must be audited');
assert.ok(html.includes("status: 'legacy_unposted'"), 'Opening balance snapshots must remain unposted');
const createDraftStart = html.indexOf('async function createJournalDraft(payload)');
const createDraftEnd = html.indexOf('async function getJournalEntryDetails', createDraftStart);
assert.ok(createDraftStart >= 0 && createDraftEnd > createDraftStart);
assert.ok(html.slice(createDraftStart, createDraftEnd).includes("stores.push('opening_balance_versions')"), 'Opening journal and version must be stored atomically');
assert.ok(html.slice(createDraftStart, createDraftEnd).includes('opening_balance_version'), 'Draft creation must accept the opening version record');
assert.ok(html.includes('saveOpeningJournalDraft()'), 'Opening journal draft action must be available in Transactions');
assert.ok(html.includes("status:'void'"), 'Draft cancellation must preserve a void status rather than deleting the journal');
assert.ok(html.includes('VERSI_SALDO_AWAL_BK'), 'BK opening changes must be audited');
assert.ok(!html.includes('id="setSaldoBkDetail"'), 'Duplicate BK opening input in Settings must stay removed');
assert.ok(!html.includes('settings.saldoAwalPiutang = total'), 'Receivable breakdown must not overwrite opening receivables');
const syncStart = html.indexOf('async function syncBkTotalToSettings');
const syncEnd = html.indexOf('async function seedBkFromDefault', syncStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart);
assert.ok(!html.slice(syncStart, syncEnd).includes("put('settings'"), 'BK total sync must not silently overwrite Settings');


const accounts = [
  { code: '1101', name: 'Kas Tunai', active: true, classification_status: 'active' },
  { code: '4101', name: 'Penjualan Barang', active: true, classification_status: 'active' },
  { code: '3101', name: 'Simpanan Pokok', active: true, classification_status: 'needs_review' },
  { code: '1102', name: 'Bank', active: false, classification_status: 'active' },
  { code: '1106', name: 'Uang Muka BK', active: true, classification_status: 'active' }
];

const valid = validate([
  { account_code: '1101', debit: 125000, credit: 0 },
  { account_code: '4101', debit: 0, credit: 125000 }
], accounts);
assert.equal(valid.debit_total, 125000);
assert.equal(valid.credit_total, 125000);
assert.equal(valid.lines.length, 2);
assert.equal(valid.lines[0].line_no, 1);

assert.throws(() => validate([
  { account_code: '1101', debit: 100, credit: 0 },
  { account_code: '4101', debit: 0, credit: 99 }
], accounts), /tidak seimbang/);

assert.throws(() => validate([
  { account_code: '1101', debit: 10.5, credit: 0 },
  { account_code: '4101', debit: 0, credit: 10.5 }
], accounts), /rupiah bulat/);

assert.throws(() => validate([
  { account_code: '1101', debit: 10, credit: 10 },
  { account_code: '4101', debit: 0, credit: 20 }
], accounts), /satu sisi/);

assert.throws(() => validate([
  { account_code: '1101', debit: 0, credit: 0 },
  { account_code: '4101', debit: 0, credit: 0 }
], accounts), /satu sisi/);

assert.throws(() => validate([
  { account_code: '9999', debit: 10, credit: 0 },
  { account_code: '4101', debit: 0, credit: 10 }
], accounts), /tidak ditemukan/);

assert.throws(() => validate([
  { account_code: '1102', debit: 10, credit: 0 },
  { account_code: '4101', debit: 0, credit: 10 }
], accounts), /nonaktif/);

assert.throws(() => validate([
  { account_code: '3101', debit: 10, credit: 0 },
  { account_code: '4101', debit: 0, credit: 10 }
], accounts), /belum diverifikasi/);

assert.throws(() => validate([], accounts), /sedikitnya dua baris/);
const bkValid = validate([
  { account_code: '1106', bk_rekening_id: 'BK-TEST-1', debit: 500, credit: 0 },
  { account_code: '1101', debit: 0, credit: 500 }
], accounts);
assert.equal(bkValid.lines[0].bk_rekening_id, 'BK-TEST-1');
assert.throws(() => validate([
  { account_code: '1106', debit: 500, credit: 0 },
  { account_code: '1101', debit: 0, credit: 500 }
], accounts), /Pilih pemegang Bon Kas/);

console.log('Ledger tests passed: 15 validator/date cases plus journal, BK subledger, reversal and safety guards.');
