'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {indexedDB}=require('fake-indexeddb'),html=fs.readFileSync('index.html','utf8');
function extract(name,isAsync=false){
 const marker=(isAsync?'async function ':'function ')+name+'(';const start=html.indexOf(marker);assert.ok(start>=0,'missing '+name);
 const brace=html.indexOf('{',start);let depth=0,q=null,esc=false,line=false,block=false;
 for(let i=brace;i<html.length;i++){const c=html[i],n=html[i+1];if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}if(q){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===q)q=null;continue;}if(c==='/'&&n==='/'){line=true;i++;continue;}if(c==='/'&&n==='*'){block=true;i++;continue;}if(c==="'"||c==='"'||c==='\x60'){q=c;continue;}if(c==='{')depth++;else if(c==='}'&&--depth===0)return html.slice(start,i+1);}
 throw new Error('unclosed '+name);
}
function install(ctx,name,isAsync=false){const src=extract(name,isAsync).replace(new RegExp('^(async )?function '+name+'\\('),'$1function(');ctx[name]=vm.runInNewContext('('+src+')',ctx);}
function open(name){return new Promise((ok,no)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('transaksi',{keyPath:'id'});d.createObjectStore('transaksi_arsip',{keyPath:'id'});d.createObjectStore('chart_accounts',{keyPath:'code'});d.createObjectStore('subledger_parties',{keyPath:'id'});const je=d.createObjectStore('journal_entries',{keyPath:'id'});je.createIndex('source_key','source_key',{unique:true});d.createObjectStore('journal_lines',{keyPath:'id'});d.createObjectStore('change_history',{keyPath:'id',autoIncrement:true});};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
function putRaw(db,store,value){return new Promise((ok,no)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>ok();tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);});}
function allRaw(db,store){return new Promise((ok,no)=>{const tx=db.transaction(store),r=tx.objectStore(store).getAll();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>no(r.error);});}
async function run(){
 const name='verified-party-journals-'+Date.now();let db=await open(name),seq=0,changes=0;
 const accounts=['1101','1104','1105','1106','1107','2101','4101','6101'].map(code=>({code,name:code,active:true,classification_status:'active'}));
 for(const a of accounts)await putRaw(db,'chart_accounts',a);
 const parties=[
 {id:'M1',type:'member',code:'MEMBER:001',verification_status:'verified',name:'Member Satu'},
 {id:'M2',type:'member',code:'MEMBER:736',verification_status:'verified',name:'Member Dua'},
 {id:'M3',type:'member',code:'MEMBER:12485',verification_status:'verified',name:'Member Tiga'},
 {id:'S1',type:'supplier',code:'SUPPLIER:CV-NUSRA-JAYA',verification_status:'verified',name:'CV Nusra Jaya'}
 ];
 for(const p of parties)await putRaw(db,'subledger_parties',p);
 const rows=[
 {id:'CREDIT-SALE',import_source:'F',import_batch_id:'B',status_data:'aktif',tanggal:'2026-01-01',jenis:'PENJUALAN',status:'KREDIT',nilai:68000,keterangan:'001 - Member Satu : Rp58.000\n736 - Member Dua : Rp10.000'},
 {id:'PAY-BON',import_source:'F',import_batch_id:'B',status_data:'aktif',tanggal:'2026-01-02',jenis:'PEMBAYARAN BON',status:'TUNAI',nilai:50000,keterangan:'Pembayaran Bon (12485 : Member Tiga)'},
 {id:'PURCHASE-CREDIT',import_source:'F',import_batch_id:'B',status_data:'aktif',tanggal:'2026-01-03',jenis:'PEMBELIAN BARANG',status:'KREDIT',nilai:700000,keterangan:'HUTANG BARANG :\nCV NUSRA JAYA = Rp700.000'},
 {id:'PAY-SUPPLIER',import_source:'F',import_batch_id:'B',status_data:'aktif',tanggal:'2026-01-04',jenis:'PELUNASAN BARANG',status:'TUNAI',nilai:300000,keterangan:'HUTANG BARANG :\nCV NUSRA JAYA = Rp300.000'},
 {id:'UNVERIFIED',import_source:'F',import_batch_id:'B',status_data:'aktif',tanggal:'2026-01-05',jenis:'PENJUALAN',status:'KREDIT',nilai:9000,keterangan:'999 - Belum Diverifikasi : Rp9.000'}
 ];
 for(const row of rows)await putRaw(db,'transaksi',row);
 const host={textContent:'',innerHTML:''},messages=[];
 const ctx={db,confirm:()=>true,accountingId:p=>p+'-'+(++seq),getAll:async s=>allRaw(ctx.db,s),put:async(s,v)=>putRaw(ctx.db,s,v),
  getAllBkRekening:async()=>[],ensureAccountingFoundation:async()=>{},markDataChanged:()=>{changes++;},loadAccountingWorkbench:async()=>{},
  toast:(message,type)=>messages.push({message,type}),document:{getElementById:id=>id==='legacyLedgerMigrationSummary'?host:null},postJournalEntry:()=>{throw new Error('must never post');}};
 for(const [n,a] of [['accountingIsValidDate',false],['normNba',false],['parseBkKeterangan',false],['normalizeLegacyPartyCode',false],['parseLegacyPartyAllocations',false],['accountingValidateJournalLines',false],['getAccountingTransactions',true],['buildLegacyTransactionJournalProposal',false],['createJournalDraft',true],['prepareLegacyTransactionLedgerDrafts',true]])install(ctx,n,a);
 const before=JSON.stringify((await allRaw(db,'transaksi')).sort((a,b)=>a.id.localeCompare(b.id)));
 await ctx.prepareLegacyTransactionLedgerDrafts();
 let entries=await allRaw(db,'journal_entries'),lines=await allRaw(db,'journal_lines'),history=await allRaw(db,'change_history');
 assert.equal(entries.length,4);assert.ok(entries.every(e=>e.status==='draft'));
 assert.equal(lines.length,9);
 assert.equal(history.filter(h=>h.action==='LEGACY_LEDGER_DRAFT_CREATED').length,4);
 assert.equal(history.filter(h=>h.action==='LEGACY_LEDGER_HELD').length,1);
 const bySource=new Map(entries.map(e=>[e.source_id,e]));
 const lineFor=id=>lines.filter(l=>l.journal_id===bySource.get(id).id);
 assert.deepEqual(lineFor('CREDIT-SALE').filter(l=>l.account_code==='1104').map(l=>l.party_id).sort(),['M1','M2']);
 assert.equal(lineFor('PAY-BON').find(l=>l.account_code==='1104').party_id,'M3');
 assert.equal(lineFor('PURCHASE-CREDIT').find(l=>l.account_code==='2101').party_id,'S1');
 assert.equal(lineFor('PAY-SUPPLIER').find(l=>l.account_code==='2101').party_id,'S1');
 assert.ok(!lines.some(l=>l.account_code==='5101'),'POS profit must not be posted as HPP');
 for(const entry of entries){const own=lines.filter(l=>l.journal_id===entry.id);assert.equal(own.reduce((n,l)=>n+l.debit,0),own.reduce((n,l)=>n+l.credit,0));}
 assert.equal(JSON.stringify((await allRaw(db,'transaksi')).sort((a,b)=>a.id.localeCompare(b.id))),before,'source transactions must remain unchanged');
 await ctx.prepareLegacyTransactionLedgerDrafts();
 entries=await allRaw(db,'journal_entries');history=await allRaw(db,'change_history');
 assert.equal(entries.length,4);assert.equal(history.length,5,'rerun must not duplicate draft/hold audit');
 assert.equal(changes,1);assert.ok(messages.some(m=>String(m.message).includes('4 draft baru')));
 db.close();db=await open(name);ctx.db=db;
 await ctx.prepareLegacyTransactionLedgerDrafts();
 assert.equal((await allRaw(db,'journal_entries')).length,4,'reopen/resume must preserve one draft per source');
 assert.equal((await allRaw(db,'change_history')).length,5);
 db.close();
 console.log('Verified subledger to journal runtime tests: member receivable, member payment, supplier payable, supplier settlement, hold, idempotency and resume passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
