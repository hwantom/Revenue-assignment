// 실행: node source/clean_data.mjs (Node.js 기본 라이브러리만 사용)
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=async n=>JSON.parse(await fs.readFile(path.join(root,'data',n),'utf8'));
const [raw,profiles,products,maps]=await Promise.all(['raw_receipts.json','source_profiles.json','product_master.json','value_mappings.json'].map(read));
const receipts=[],lines=[],log=[];let seq=0;
function record(id,line,field,before,after,rule){if(String(before??'')!==String(after??''))log.push({change_id:`C${String(++seq).padStart(5,'0')}`,receipt_id:id,line_no:line,field,raw_value:before??'',cleaned_value:after??'',rule_id:rule});}
function num(s){const n=Number(String(s).replace(/KRW|₩|원|개|,|\s/g,''));if(!Number.isFinite(n)||String(s).trim()==='')throw Error(`Invalid numeric value: ${s}`);return n;}
function parseDate(s,f){let y,m,d;if(f==='MM/DD/YYYY'){[m,d,y]=s.split('/');}else if(f==='D Sep YYYY'){[d,,y]=s.split(' ');m='09';}else{[y,m,d]=s.match(/\d+/g);}const v=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;if(new Date(v).toISOString().slice(0,10)!==v)throw Error('Invalid date');return v;}
function parseTime(s,f){if(!s)return null;let h,m;if(f==='hh:mm AM/PM'){const a=s.match(/(\d+):(\d+) (AM|PM)/);h=Number(a[1])%12+(a[3]==='PM'?12:0);m=a[2];}else if(f==='HHmm'){h=s.slice(0,2);m=s.slice(2);}else{[h,m]=s.match(/\d+/g);}return `${String(h).padStart(2,'0')}:${m}`;}
for(const src of raw){
 const p=profiles.find(x=>x.profile_id===src.profile_id),k=p.fields,r=src.data,id=r[k.receipt_id],source_file=`receipts/${id}.pdf`;
 const date=parseDate(r[k.date],p.date_format),time=parseTime(r[k.time],p.time_format),payment_method=Object.entries(maps.payments).find(([key,v])=>v.includes(r[k.payment]))?.[0]??'미확인',store=maps.stores[r[k.store]];
 record(id,null,'date',r[k.date],date,'DATE');record(id,null,'time',r[k.time],time,'TIME');record(id,null,'store',r[k.store],store,'STORE');record(id,null,'payment_method',r[k.payment],payment_method,r[k.payment]?'PAYMENT':'MISSING_PAYMENT');
 if(!r[k.time])log.push({change_id:`C${String(++seq).padStart(5,'0')}`,receipt_id:id,line_no:null,field:'time',raw_value:'',cleaned_value:'',rule_id:'MISSING_TIME'});
 const total=num(r[k.total]);record(id,null,'receipt_amount',r[k.total],total,'MONEY');
 for(const item of r[k.items]){
  const n=item.line_no,prod=products.find(x=>x.aliases.includes(item[k.product]));if(!prod)throw Error('Unknown product');
  const line={line_id:`${id}-L${String(n).padStart(2,'0')}`,receipt_id:id,line_no:n,product_id:prod.product_id,product_name:prod.product_name,category:prod.category,quantity:num(item[k.quantity]),unit_price:num(item[k.unit_price]),gross_amount:num(item[k.quantity])*num(item[k.unit_price]),discount:num(item[k.discount]),line_amount:num(item[k.amount])};
  if(line.gross_amount-line.discount!==line.line_amount)throw Error('Line mismatch');
  record(id,n,'product_name',item[k.product],line.product_name,'PRODUCT');record(id,n,'category',item[k.category],line.category,item[k.category]?'CATEGORY':'CATEGORY_FILL');
  for(const field of ['quantity','unit_price','discount'])record(id,n,field,item[k[field]],line[field],field==='quantity'?'QUANTITY':'MONEY');
  record(id,n,'line_amount',item[k.amount],line.line_amount,'MONEY');lines.push(line);
 }
 const own=lines.filter(x=>x.receipt_id===id),gross=own.reduce((s,x)=>s+x.gross_amount,0),discount=own.reduce((s,x)=>s+x.discount,0);if(gross-discount!==total)throw Error('Receipt mismatch');
 receipts.push({receipt_id:id,date,time,store,payment_method,line_count:own.length,item_quantity:own.reduce((s,x)=>s+x.quantity,0),gross_amount:gross,discount,receipt_amount:total,profile_id:p.profile_id,source_file,cleaning_status:!time||payment_method==='미확인'?'정제완료_일부정보미확인':'정제완료',issue_codes:[...(!time?['MISSING_TIME']:[]),...(payment_method==='미확인'?['MISSING_PAYMENT']:[])].join(';')});
}
const changesByRule=Object.fromEntries([...new Set(log.map(x=>x.rule_id))].map(rule=>[rule,{changed_fields:log.filter(x=>x.rule_id===rule).length,affected_receipts:new Set(log.filter(x=>x.rule_id===rule).map(x=>x.receipt_id)).size}]));
const summary={data_type:'교육용 가상 데이터',author:'민승환',student_id:'2021308',period_start:'2026-09-01',period_end:'2026-09-30',timezone:'Asia/Seoul',currency:'KRW',receipts:receipts.length,lines:lines.length,products:products.length,gross_amount:receipts.reduce((s,x)=>s+x.gross_amount,0),discount:receipts.reduce((s,x)=>s+x.discount,0),revenue:receipts.reduce((s,x)=>s+x.receipt_amount,0),quantity:lines.reduce((s,x)=>s+x.quantity,0),missing_time:receipts.filter(x=>!x.time).length,missing_payment:receipts.filter(x=>x.payment_method==='미확인').length,changes_by_rule:changesByRule};summary.average_ticket=summary.revenue/summary.receipts;
for(const [name,data] of Object.entries({clean_receipts:receipts,clean_lines:lines,cleaning_log:log,summary}))await fs.writeFile(path.join(root,'data',`${name}.json`),JSON.stringify(data,null,2));
const csv=rows=>{const keys=Object.keys(rows[0]);return '\uFEFF'+[keys,...rows.map(x=>keys.map(k=>x[k]??''))].map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\r\n');};
for(const [name,data] of Object.entries({clean_receipts:receipts,clean_lines:lines,cleaning_log:log}))await fs.writeFile(path.join(root,'data',`${name}.csv`),csv(data));
console.log(JSON.stringify(summary));
