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
function open(name){return new Promise((ok,no)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('transaksi',{keyPath:'id'});d.createObjectStore('transaksi_arsip',{keyPath:'id'});d.createObjectStore('subledger_parties',{keyPath:'id'});d.createObjectStore('change_history',{keyPath:'id',autoIncrement:true});};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
function putRaw(db,store,value){return new Promise((ok,no)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>ok();tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);});}
function allRaw(db,store){return new Promise((ok,no)=>{const tx=db.transaction(store),r=tx.objectStore(store).getAll();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>no(r.error);});}
async function run(){
 const name='party-review-'+Date.now();let db=await open(name),seq=0,changed=0;
 const rows=[
 {id:'SALE-CREDIT',import_source:'F',status_data:'aktif',tanggal:'2026-01-01',jenis:'PENJUALAN',status:'KREDIT',nilai:68000,keterangan:'001 - Member Satu : Rp58.000\n736 - Member Dua : Rp10.000',import_source_row:10,import_batch_id:'B1'},
 {id:'PAY-BON',import_source:'F',status_data:'aktif',tanggal:'2026-01-02',jenis:'PEMBAYARAN BON',status:'TUNAI',nilai:50000,keterangan:'Pembayaran Bon (12485 : Member Tiga)',import_source_row:11,import_batch_id:'B1'},
 {id:'PURCHASE-CREDIT',import_source:'F',status_data:'aktif',tanggal:'2026-01-03',jenis:'PEMBELIAN BARANG',status:'KREDIT',nilai:700000,keterangan:'HUTANG BARANG :\nCV NUSRA JAYA = Rp700.000',import_source_row:12,import_batch_id:'B1'},
 {id:'PAY-SUPPLIER',import_source:'F',status_data:'aktif',tanggal:'2026-01-04',jenis:'PELUNASAN BARANG',status:'TUNAI',nilai:300000,keterangan:'HUTANG BARANG :\nCV NUSRA JAYA = Rp300.000',import_source_row:13,import_batch_id:'B1'},
 {id:'MISMATCH',import_source:'F',status_data:'aktif',tanggal:'2026-01-05',jenis:'PENJUALAN',status:'KREDIT',nilai:69000,keterangan:'001 - Member Satu : Rp58.000\n736 - Member Dua : Rp10.000',import_source_row:14,import_batch_id:'B1'}
 ];
 for(const row of rows)await putRaw(db,'transaksi',row);
 const ctx={db,confirm:()=>true,accountingId:p=>p+'-'+(++seq),getAll:async s=>allRaw(ctx.db,s),put:async(s,v)=>putRaw(ctx.db,s,v),markDataChanged:()=>{changed++;},_subledgerPartyAccounts:[],refreshJournalPartyOptions:()=>{},loadLegacySubledgerPartyReview:async()=>{},loadLegacyLedgerMigrationStatus:async()=>{},toast:()=>{}};
 install(ctx,'getAccountingTransactions',true);install(ctx,'normalizeLegacyPartyCode');install(ctx,'parseLegacyPartyAllocations');install(ctx,'stageLegacySubledgerPartyCandidates',true);install(ctx,'verifyLegacySubledgerParty',true);
 const before=JSON.stringify(await allRaw(db,'transaksi'));
 await ctx.stageLegacySubledgerPartyCandidates();
 let parties=await allRaw(db,'subledger_parties');
 assert.equal(parties.length,4);
 assert.ok(parties.every(p=>p.verification_status==='pending_review'));
 assert.equal(parties.find(p=>p.code==='MEMBER:001').source_refs.length,1);
 assert.equal(parties.find(p=>p.code==='SUPPLIER:CV-NUSRA-JAYA').source_refs.length,2);
 for(const p of parties){
  const values={name:p.name,evidence:'Dicocokkan dengan dokumen sumber fixture '+p.code};
  const form={elements:{namedItem:n=>({value:values[n]})}};
  await ctx.verifyLegacySubledgerParty({preventDefault(){},currentTarget:form},p.id);
 }
 parties=await allRaw(db,'subledger_parties');
 assert.ok(parties.every(p=>p.verification_status==='verified'&&p.verification_note));
 assert.equal((await allRaw(db,'change_history')).filter(h=>h.action==='VERIFY_SUBLEDGER_PARTY').length,4);
 await ctx.stageLegacySubledgerPartyCandidates();
 parties=await allRaw(db,'subledger_parties');
 assert.equal(parties.length,4,'re-extraction must not duplicate party master');
 assert.equal(parties.find(p=>p.code==='MEMBER:001').source_refs.length,1,'same source reference must not duplicate');
 const conflict={...rows[0],id:'NAME-CONFLICT',keterangan:'001 - Nama Berbeda : Rp68.000',nilai:68000,import_source_row:15};
 await putRaw(db,'transaksi',conflict);
 await ctx.stageLegacySubledgerPartyCandidates();
 parties=await allRaw(db,'subledger_parties');
 const member=parties.find(p=>p.code==='MEMBER:001');
 assert.equal(member.verification_status,'name_conflict');
 assert.equal(member.name_variants.length,2);
 const values={name:'Member Satu',evidence:'Nama dicocokkan dengan kartu anggota resmi'};
 await ctx.verifyLegacySubledgerParty({preventDefault(){},currentTarget:{elements:{namedItem:n=>({value:values[n]})}}},member.id);
 assert.equal((await allRaw(db,'subledger_parties')).find(p=>p.id===member.id).verification_status,'verified');
 const sourceAfter=(await allRaw(db,'transaksi')).sort((a,b)=>a.id.localeCompare(b.id)),sourceExpected=[...rows,conflict].sort((a,b)=>a.id.localeCompare(b.id));assert.equal(JSON.stringify(sourceAfter),JSON.stringify(sourceExpected),'party review must not mutate source transactions');
 assert.ok(changed>=7);
 db.close();console.log('Subledger party runtime tests: candidate extraction, verification evidence, conflict detection and idempotent re-extraction passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
