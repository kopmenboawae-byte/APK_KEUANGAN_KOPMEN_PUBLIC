'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('function buildLegacyTransactionJournalProposal('),end=html.indexOf('async function loadLegacyLedgerMigrationStatus(',start);
assert.ok(start>=0&&end>start,'migration proposal helper missing');
const source=html.slice(start,end).trim().replace(/^function [^(]+\(/,'function(');
const ctx={
 accountingIsValidDate:v=>{const s=String(v||''),d=new Date(s+'T00:00:00Z');return s.length===10&&!Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;},
 normNba:v=>String(v||'').split('').filter(c=>c>='0'&&c<='9').join(''),
 parseBkKeterangan:v=>{const s=String(v||''),a=s.indexOf('['),b=s.indexOf(']',a);if(a<0||b<0)return null;const nba=s.slice(a+1,b).trim().split(':')[0].trim();return{nba,key:String(nba).split('').filter(c=>c>='0'&&c<='9').join('')||nba};}
};
const build=vm.runInNewContext('('+source+')',ctx);
const accounts=['1101','1105','1106','1107','4101','6101'].map(code=>({code,active:true,classification_status:'active'}));
const bk=[{id:'BK-1',nba:'13.208',nama:'Pemegang Uji'}],base={id:'TRX-1',tanggal:'2026-01-01',jenis:'PENJUALAN',status:'TUNAI',nilai:1000,keterangan:'',import_batch_id:'B-1'};
const proposal=(changes={},b=bk,a=accounts)=>build({...base,...changes},b,a);
const ready=(p,c)=>{assert.equal(p.status,'ready',p.reason);assert.equal(JSON.stringify(p.lines.map(x=>x.account_code)),JSON.stringify(c));};
const held=(p,t)=>{assert.equal(p.status,'hold');assert.ok(p.reason.includes(t),p.reason);};
ready(proposal(),['1101','4101']);assert.equal(proposal().source_key,'LEGACY-TRX:TRX-1');assert.ok(!proposal().lines.some(x=>x.account_code==='5101'));
held(proposal({status:'KREDIT'}),'alokasi piutang');
ready(proposal({jenis:'PEMBELIAN BARANG'}),['1105','1101']);held(proposal({jenis:'PEMBELIAN BARANG',status:'KREDIT'}),'pemasok dan faktur');
ready(proposal({jenis:'BIAYA'}),['6101','1101']);ready(proposal({jenis:'STOR SIBUHAR'}),['1107','1101']);ready(proposal({jenis:'TARIK SIBUHAR'}),['1101','1107']);
ready(proposal({jenis:'BON KAS',keterangan:'[13.208: Pemegang Uji]'}),['1106','1101']);
assert.equal(proposal({jenis:'BON KAS',keterangan:'[13.208: Pemegang Uji]'}).lines[0].bk_rekening_id,'BK-1');
held(proposal({jenis:'BON KAS',bk_rekening_id:'BK-1',keterangan:'[99:Nama Lain]'}),'tidak cocok');
held(proposal({jenis:'BON KAS',keterangan:'tanpa nomor rekening'}),'belum dipetakan');
ready(proposal({jenis:'PEMBAYARAN BK',bk_rekening_id:'BK-1'}),['1101','1106']);
held(proposal({jenis:'PEMBAYARAN BON'}),'alokasi piutang');held(proposal({jenis:'PELUNASAN BARANG'}),'pemasok');
held(proposal({jenis:'TITIPAN KAS'}),'titipan');held(proposal({jenis:'PENERIMAAN LAIN-LAIN'}),'Substansi');held(proposal({jenis:'PENGELUARAN LAIN-LAIN'}),'Substansi');
held(proposal({nilai:1000.5}),'rupiah bulat');held(proposal({tanggal:'2026-02-30'}),'Tanggal');
held(proposal({jenis:'BIAYA'},bk,[...accounts.filter(x=>x.code!=='6101'),{code:'6101',active:true,classification_status:'needs_review'}]),'terverifikasi');
console.log('Legacy ledger migration tests: 22 mapping/safety assertions passed.');
