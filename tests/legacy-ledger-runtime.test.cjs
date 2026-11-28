'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {indexedDB}=require('fake-indexeddb');
const html=fs.readFileSync('index.html','utf8');
function extract(name,isAsync=false){
 const marker=(isAsync?'async function ':'function ')+name+'(';
 const start=html.indexOf(marker);assert.ok(start>=0,'missing function '+name);
 const brace=html.indexOf('{',start);let depth=0,quote=null,escaped=false,line=false,block=false;
 for(let i=brace;i<html.length;i++){const c=html[i],n=html[i+1];
  if(line){if(c==='\n')line=false;continue;}
  if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
  if(quote){if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c===quote)quote=null;continue;}
  if(c==='/'&&n==='/'){line=true;i++;continue;}if(c==='/'&&n==='*'){block=true;i++;continue;}
  if(c==="'"||c==='"'||c==='\x60'){quote=c;continue;}
  if(c==='{')depth++;else if(c==='}'&&--depth===0)return html.slice(start,i+1);
 }
 throw new Error('unclosed function '+name);
}
function install(ctx,name,isAsync=false){const src=extract(name,isAsync).replace(new RegExp('^(async )?function '+name+'\\('),'$1function(');ctx[name]=vm.runInNewContext('('+src+')',ctx);}
function open(name){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('transaksi',{keyPath:'id'});d.createObjectStore('transaksi_arsip',{keyPath:'id'});d.createObjectStore('chart_accounts',{keyPath:'code'});d.createObjectStore('bk_rekening',{keyPath:'id'});const je=d.createObjectStore('journal_entries',{keyPath:'id'});je.createIndex('source_key','source_key',{unique:true});d.createObjectStore('journal_lines',{keyPath:'id'});d.createObjectStore('change_history',{keyPath:'id',autoIncrement:true});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function putRaw(db,store,value){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function allRaw(db,store){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
async function run(){
 const name='legacy-migration-runtime-'+Date.now();let db=await open(name);
 const accounts=['1101','1105','1106','1107','4101','6101'].map(code=>({code,name:code,active:true,classification_status:'active'}));
 for(const a of accounts)await putRaw(db,'chart_accounts',a);
 const bk={id:'BK-MASTER-1',nba:'13.208',nama:'Pemegang Uji'};await putRaw(db,'bk_rekening',bk);
 const txRows=[
  {id:'SALE-1',import_source:'FILE-HASH',import_batch_id:'BATCH-1',status_data:'aktif',tanggal:'2026-01-01',jenis:'PENJUALAN',status:'TUNAI',nilai:1000,laba:200,keterangan:''},
  {id:'CREDIT-1',import_source:'FILE-HASH',import_batch_id:'BATCH-1',status_data:'aktif',tanggal:'2026-01-02',jenis:'PENJUALAN',status:'KREDIT',nilai:2000,laba:300,keterangan:'Rincian piutang anggota'},
  {id:'BK-1',import_source:'FILE-HASH',import_batch_id:'BATCH-1',status_data:'aktif',tanggal:'2026-01-03',jenis:'BON KAS',status:'TUNAI',nilai:500,laba:0,bk_rekening_id:'BK-MASTER-1',keterangan:'[13.208: Pemegang Uji]'},
  {id:'TITIP-1',import_source:'FILE-HASH',import_batch_id:'BATCH-1',status_data:'aktif',tanggal:'2026-01-04',jenis:'TITIPAN KAS',status:'TUNAI',nilai:700,laba:0,keterangan:''},
  {id:'BAD-1',import_source:'FILE-HASH',import_batch_id:'BATCH-1',status_data:'aktif',tanggal:'2026-01-05',jenis:'BIAYA',status:'TUNAI',nilai:1.5,laba:0,keterangan:'nilai pecahan'}
 ];
 for(const row of txRows)await putRaw(db,'transaksi',row);
 const host={textContent:'',innerHTML:''},messages=[];let ids=0,changes=0;
 const ctx={db,confirm:()=>true,accountingId:p=>p+'-TEST-'+(++ids),getAll:async store=>allRaw(ctx.db,store),
  put:async(store,value)=>putRaw(ctx.db,store,value),getAllBkRekening:async()=>[bk],ensureAccountingFoundation:async()=>{},
  markDataChanged:()=>{changes++;},loadAccountingWorkbench:async()=>{},toast:(message,type)=>messages.push({message,type}),
  document:{getElementById:id=>id==='legacyLedgerMigrationSummary'?host:null},postJournalEntry:()=>{throw new Error('must never post');}};
 for(const [n,a] of [['accountingIsValidDate',false],['normNba',false],['parseBkKeterangan',false],['accountingValidateJournalLines',false],['getAccountingTransactions',true],['buildLegacyTransactionJournalProposal',false],['createJournalDraft',true],['prepareLegacyTransactionLedgerDrafts',true]])install(ctx,n,a);
 const before=JSON.stringify(await allRaw(db,'transaksi'));
 await ctx.prepareLegacyTransactionLedgerDrafts();
 let journals=await allRaw(db,'journal_entries'),lines=await allRaw(db,'journal_lines'),history=await allRaw(db,'change_history');
 assert.equal(journals.length,2);assert.ok(journals.every(j=>j.status==='draft'));assert.equal(lines.length,4);
 assert.deepEqual(journals.map(j=>j.source_key).sort(),['LEGACY-TRX:BK-1','LEGACY-TRX:SALE-1']);
 assert.equal(history.filter(h=>h.action==='LEGACY_LEDGER_DRAFT_CREATED').length,2);
 assert.equal(history.filter(h=>h.action==='LEGACY_LEDGER_HELD').length,3);
 assert.equal(JSON.stringify(await allRaw(db,'transaksi')),before,'legacy transaction source must remain unchanged');
 assert.equal(changes,1);assert.ok(messages.some(m=>String(m.message).includes('2 draft baru')));
 assert.ok(journals.every(j=>j.status!=='posted'));
 const duplicate=await ctx.createJournalDraft({tanggal:'2026-01-01',description:'Should not duplicate',source_type:'legacy_transaction',source_id:'OTHER',source_key:'LEGACY-TRX:SALE-1',lines:[{account_code:'1101',debit:1000,credit:0},{account_code:'4101',debit:0,credit:1000}]});
 assert.equal(duplicate.duplicate,true);assert.equal((await allRaw(db,'journal_entries')).length,2);
 await ctx.prepareLegacyTransactionLedgerDrafts();
 journals=await allRaw(db,'journal_entries');history=await allRaw(db,'change_history');
 assert.equal(journals.length,2,'second run must not create duplicate journals');
 assert.equal(history.length,5,'second run must not duplicate hold/audit history');
 assert.equal(changes,1,'idempotent rerun must not mark data changed');
 db.close();db=await open(name);ctx.db=db;
 await ctx.prepareLegacyTransactionLedgerDrafts();
 assert.equal((await allRaw(db,'journal_entries')).length,2,'reopen/resume must retain prior drafts');
 assert.equal((await allRaw(db,'change_history')).length,5,'reopen/resume must retain migration decisions');
 assert.equal(JSON.stringify(await allRaw(db,'transaksi')),before,'reopen/resume must not mutate source transactions');
 db.close();
 console.log('Legacy ledger IndexedDB migration tests: idempotency, draft-only, hold audit, rollback-safe source and reopen/resume passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
