'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('function normalizeLegacyPartyCode('),end=html.indexOf('async function loadLegacyLedgerMigrationStatus(',start);
assert.ok(start>=0&&end>start,'legacy party/migration helpers missing');
const helperSource=html.slice(start,end);
const ctx={
 accountingIsValidDate:v=>{const s=String(v||''),d=new Date(s+'T00:00:00Z');return s.length===10&&!Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;},
 normNba:v=>String(v||'').split('').filter(c=>c>='0'&&c<='9').join(''),
 parseBkKeterangan:v=>{const s=String(v||''),a=s.indexOf('['),b=s.indexOf(']',a);if(a<0||b<0)return null;const nba=s.slice(a+1,b).trim().split(':')[0].trim();return{nba,key:String(nba).split('').filter(c=>c>='0'&&c<='9').join('')||nba};}
};
vm.runInNewContext(helperSource+';this.build=buildLegacyTransactionJournalProposal;this.parse=parseLegacyPartyAllocations;',ctx);
const build=ctx.build,parse=ctx.parse;
const accounts=['1101','1104','1105','1106','1107','2101','4101','6101'].map(code=>({code,active:true,classification_status:'active'}));
const bk=[{id:'BK-1',nba:'13.208',nama:'Pemegang Uji'}],base={id:'TRX-1',tanggal:'2026-01-01',jenis:'PENJUALAN',status:'TUNAI',nilai:1000,keterangan:'',import_batch_id:'B-1'};
const proposal=(changes={},b=bk,a=accounts,p=[])=>build({...base,...changes},b,a,p);
const ready=(p,c)=>{assert.equal(p.status,'ready',p.reason);assert.equal(JSON.stringify(p.lines.map(x=>x.account_code)),JSON.stringify(c));};
const held=(p,t)=>{assert.equal(p.status,'hold');assert.ok(p.reason.includes(t),p.reason);};
ready(proposal(),['1101','4101']);assert.equal(proposal().source_key,'LEGACY-TRX:TRX-1');assert.ok(!proposal().lines.some(x=>x.account_code==='5101'));
held(proposal({status:'KREDIT'}),'Format alokasi');
ready(proposal({jenis:'PEMBELIAN BARANG'}),['1105','1101']);held(proposal({jenis:'PEMBELIAN BARANG',status:'KREDIT'}),'Rincian pemasok');
ready(proposal({jenis:'BIAYA'}),['6101','1101']);ready(proposal({jenis:'STOR SIBUHAR'}),['1107','1101']);ready(proposal({jenis:'TARIK SIBUHAR'}),['1101','1107']);
ready(proposal({jenis:'BON KAS',keterangan:'[13.208: Pemegang Uji]'}),['1106','1101']);
assert.equal(proposal({jenis:'BON KAS',keterangan:'[13.208: Pemegang Uji]'}).lines[0].bk_rekening_id,'BK-1');
held(proposal({jenis:'BON KAS',bk_rekening_id:'BK-1',keterangan:'[99:Nama Lain]'}),'tidak cocok');
held(proposal({jenis:'BON KAS',keterangan:'tanpa nomor rekening'}),'belum dipetakan');
ready(proposal({jenis:'PEMBAYARAN BK',bk_rekening_id:'BK-1'}),['1101','1106']);
held(proposal({jenis:'TITIPAN KAS'}),'titipan');held(proposal({jenis:'PENERIMAAN LAIN-LAIN'}),'Substansi');held(proposal({jenis:'PENGELUARAN LAIN-LAIN'}),'Substansi');
held(proposal({nilai:1000.5}),'rupiah bulat');held(proposal({tanggal:'2026-02-30'}),'Tanggal');
held(proposal({jenis:'BIAYA'},bk,[...accounts.filter(x=>x.code!=='6101'),{code:'6101',active:true,classification_status:'needs_review'}]),'terverifikasi');

const sales={...base,id:'CREDIT-SALE',jenis:'PENJUALAN',status:'KREDIT',nilai:68000,keterangan:'001 - Member Satu : Rp58.000\n736 - Member Dua : Rp10.000'};
const saleAlloc=parse(sales);assert.equal(saleAlloc.status,'ready');assert.equal(saleAlloc.allocations.length,2);assert.equal(saleAlloc.total,68000);
const payment={...base,id:'PAY-BON',jenis:'PEMBAYARAN BON',status:'TUNAI',nilai:50000,keterangan:'Pembayaran Bon (12485 : Anggota Tiga)'};
const paymentAlloc=parse(payment);assert.equal(paymentAlloc.status,'ready');assert.equal(paymentAlloc.allocations[0].amount,50000);
const supplier={...base,id:'PURCHASE-CREDIT',jenis:'PEMBELIAN BARANG',status:'KREDIT',nilai:700000,keterangan:'HUTANG BARANG :\nCV NUSRA JAYA = Rp700.000'};
assert.equal(parse(supplier).status,'ready');assert.equal(parse(supplier).allocations[0].party_type,'supplier');
const mismatch={...sales,nilai:69000};held({status:parse(mismatch).status,reason:parse(mismatch).reason},'tidak sama');
const conflicting={...sales,keterangan:'001 - Nama Satu : Rp30.000\n001 - Nama Berbeda : Rp38.000'};held({status:parse(conflicting).status,reason:parse(conflicting).reason},'nama berbeda');

const memberParties=[{id:'M1',type:'member',code:'MEMBER:001',verification_status:'verified'},{id:'M2',type:'member',code:'MEMBER:736',verification_status:'verified'}];
const creditProposal=build(sales,bk,accounts,memberParties);ready(creditProposal,['1104','1104','4101']);assert.equal(creditProposal.lines[0].party_id,'M1');
held(build(sales,bk,accounts,[]),'belum diverifikasi');
const paymentParty=[{id:'M3',type:'member',code:'MEMBER:12485',verification_status:'verified'}];
ready(build(payment,bk,accounts,paymentParty),['1101','1104']);
const supplierParty=[{id:'S1',type:'supplier',code:'SUPPLIER:CV-NUSRA-JAYA',verification_status:'verified'}];
ready(build(supplier,bk,accounts,supplierParty),['1105','2101']);assert.equal(build(supplier,bk,accounts,supplierParty).lines[1].party_id,'S1');
const settlement={...supplier,id:'PAY-SUPPLIER',jenis:'PELUNASAN BARANG',status:'TUNAI',nilai:300000,keterangan:'HUTANG BARANG :\nCV NUSRA JAYA = Rp300.000'};
ready(build(settlement,bk,accounts,supplierParty),['2101','1101']);
console.log('Legacy ledger mapping/subledger tests: 30 safety and allocation assertions passed.');
