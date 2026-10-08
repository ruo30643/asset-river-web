'use strict';
const $=id=>document.getElementById(id), money=v=>v==null?'—':Number(v).toLocaleString('zh-TW',{maximumFractionDigits:0}), safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const collections=['accounts','trades','loans','payments','schedules','prices','fx','cash','imports','dividends'];
const key='asset-river-local-v1';
const empty=()=>Object.fromEntries(collections.map(x=>[x,[]]));
let db=empty(), dirty=false, chartPoints=[],cut=0;
const today=()=>new Date().toLocaleDateString('en-CA');
function notice(msg,bad=false){$('notice').innerHTML=`<div class="${bad?'warning':'panel'}">${safe(msg)}</div>`;setTimeout(()=>$('notice').replaceChildren(),6500)}
function store(){localStorage.setItem(key,JSON.stringify(db));dirty=true;status()}
function status(){const el=$('backupStatus');if(el)el.textContent=dirty?'資料已修改，尚未備份至 iCloud。':'已載入資料；請定期備份至 iCloud。'}
try{let obj=JSON.parse(localStorage.getItem(key)||'null');if(obj&&typeof obj==='object'){db=empty();for(const c of collections)if(Array.isArray(obj[c]))db[c]=obj[c]}}catch(e){console.warn('Local data unreadable',e)}
const number=x=>Number(x)||0;
function formData(f){return Object.fromEntries([...new FormData(f)].filter(([,v])=>v!==''))}
function nextId(entity){return Math.max(0,...db[entity].map(x=>number(x.id)))+1}
function add(entity,row){row={...row,id:nextId(entity)};db[entity].push(row);store();return row}
function bindForm(id,entity,transform=x=>x){$(id).addEventListener('submit',e=>{e.preventDefault();try{const d=transform(formData(e.target));if(entity==='trades'&&d.side==='SELL'){const owned=holdings(d.trade_date).find(p=>p.account_id==d.account_id&&p.symbol===d.symbol&&p.market===d.market);if(number(d.quantity)>(owned?.quantity||0)+1e-8)throw Error('賣出股數超過目前持有量')}add(entity,d);notice('已儲存到此裝置，請記得備份到 iCloud');refresh()}catch(err){notice(err.message,true)}})}
function fx(day){return [...db.fx].filter(x=>x.rate_date<=day).sort((a,b)=>b.rate_date.localeCompare(a.rate_date))[0]?.rate}
function twd(v,c,day,warnings){if(c==='TWD')return number(v);const rate=number(fx(day));if(!rate){if(warnings)warnings.add('尚未設定美元兌台幣匯率');return 0}return number(v)*rate}
function price(symbol,market,day){return [...db.prices].filter(x=>x.symbol===symbol&&x.market===market&&x.price_date<=day).sort((a,b)=>b.price_date.localeCompare(a.price_date))[0]}
function holdings(day){const positions=new Map();for(const t of [...db.trades].filter(t=>t.trade_date<=day).sort((a,b)=>a.trade_date.localeCompare(b.trade_date)||number(a.id)-number(b.id))){const k=[t.account_id,t.symbol,t.market,t.currency].join('|');if(!positions.has(k))positions.set(k,{account_id:t.account_id,symbol:t.symbol,market:t.market,currency:t.currency,lots:[]});let p=positions.get(k),q=number(t.quantity);if(t.side==='BUY')p.lots.push({date:t.trade_date,quantity:q,price:number(t.price),cost:q*number(t.price)+number(t.fee), unknown:t.unknown_cost==='1'});else{for(const lot of p.lots){const used=Math.min(q,lot.quantity);if(used>0){lot.cost-=lot.cost/lot.quantity*used;lot.quantity-=used;q-=used}if(q<=1e-8)break}p.lots=p.lots.filter(x=>x.quantity>1e-8)}}return [...positions.values()].map(p=>{const account=db.accounts.find(a=>a.id==p.account_id)||{};const quantity=p.lots.reduce((s,l)=>s+l.quantity,0),cost=p.lots.reduce((s,l)=>s+l.cost,0);return {...p,broker:account.broker||'—',account_name:account.name||'—',quantity,average_cost:quantity?cost/quantity:0,unknown_cost:p.lots.some(l=>l.unknown)}}).filter(x=>x.quantity>1e-8)}
const dateUTC=s=>new Date(s+'T00:00:00Z');
function dayDiff(a,b){return Math.round((dateUTC(b)-dateUTC(a))/86400000)}
function addDays(s,n){const d=dateUTC(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function monthAdd(s,n,day){const d=dateUTC(s);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day||5,last));return d.toISOString().slice(0,10)}
function loanState(loan,day){
 let principal=number(loan.principal);if(day<loan.start_date)return {principal:0,interest:0,total:0};
 const rate=number(loan.annual_rate)/1200, type=loan.loan_type||'legacy';
 const extras=db.payments.filter(x=>x.loan_id==loan.id&&x.paid_on<=day&&x.paid_on>=loan.start_date).sort((a,b)=>a.paid_on.localeCompare(b.paid_on));
 if(type==='legacy'){let interest=0,last=loan.start_date;for(const p of [...extras,{paid_on:day,amount:0}]){interest+=principal*number(loan.annual_rate)/100*Math.max(0,dayDiff(last,p.paid_on))/number(loan.day_basis||365);let amt=number(p.amount),paid=Math.min(amt,interest);interest-=paid;principal=Math.max(0,principal-(amt-paid));last=p.paid_on}return {principal,interest,total:principal+interest}}
 let remaining=number(loan.remaining_months), amort=number(loan.amort_months),paid=0;const start=loan.start_date, payDay=number(loan.payment_day)||5;
 // scheduled payments are modeled on month anniversaries after loan's start month
 const events=[];for(let n=1;n<=600;n++){let date=monthAdd(start,n,payDay);if(date>day)break;events.push({date,kind:'scheduled'});}
 for(const x of extras)events.push({date:x.paid_on,kind:'extra',amount:number(x.amount)});
 events.sort((a,b)=>a.date.localeCompare(b.date)||(a.kind==='extra'?-1:1));
 for(const e of events){if(principal<=0)break;if(e.kind==='extra'){principal=Math.max(0,principal-e.amount);continue}
 if(type==='pledge'||type==='other')continue;
 if(type==='mortgage'&&loan.grace_end&&e.date<=loan.grace_end)continue;
 const m=type==='mortgage'?Math.max(1,amort||240):Math.max(1,remaining||84);
 const payment=type==='mortgage'?(rate?principal*rate/(1-Math.pow(1+rate,-Math.max(1,m-paid))):principal/Math.max(1,m-paid)):(number(loan.monthly_payment)|| (rate?principal*rate/(1-Math.pow(1+rate,-Math.max(1,m-paid))):principal/Math.max(1,m-paid)));
 const interest=principal*rate;principal=Math.max(0,principal-Math.max(0,payment-interest));paid++;
 }
 return {principal,interest:0,total:principal};
}
function snapshot(day,forecast=false){const warnings=new Set(),positions=holdings(day);let assets=0;for(const p of positions){let q=price(p.symbol,p.market,day);if(!q)warnings.add(`${p.symbol} 缺少股價`);p.market_value_twd=q?twd(p.quantity*number(q.price),q.currency,day,warnings):null;assets+=p.market_value_twd||0}if(forecast){for(const s of db.schedules){if(s.start_date>day||(s.end_date&&s.end_date<day))continue;const start=$('asof').value;for(let d=addDays(start,1);d<=day;d=addDays(d,1)){const date=dateUTC(d);const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();if(date.getUTCDate()===Math.min(number(s.day_of_month),lastDay))assets+=twd(number(s.amount)*(s.kind==='income'?1:-1),s.currency,day,warnings)}}}const loans=db.loans.map(l=>({...l,...loanState(l,day)}));const debts=loans.reduce((v,l)=>v+twd(l.total,l.currency,day,warnings),0);return {date:day,assets_twd:assets,debts_twd:debts,net_worth_twd:assets-debts,positions,loans,warnings:[...warnings]}}
function refresh(){for(const id of ['tradeAccount','importAccount','openingAccount','openingImportAccount','dividendAccount'])$(id).innerHTML=''+db.accounts.map(a=>`<option value="${a.id}">${safe(a.broker)} — ${safe(a.name)}</option>`).join('');$('paymentLoan').innerHTML=db.loans.map(l=>`<option value="${l.id}">${safe(l.name)} (${safe(l.currency)})</option>`).join('');const day=$('asof').value,d=snapshot(day);$('assets').textContent=money(d.assets_twd);$('debts').textContent=money(d.debts_twd);$('net').textContent=money(d.net_worth_twd);$('warnings').innerHTML=d.warnings.length?`<div class="warning">估值不完整：${safe(d.warnings.join('；'))}</div>`:'';$('positions').innerHTML=d.positions.map(p=>`<tr><td>${safe(p.broker)}<br><small>${safe(p.account_name)}</small></td><td>${safe(p.symbol)}</td><td>${money(p.quantity)}</td><td>${p.unknown_cost?'未提供':money(p.average_cost)+' '+safe(p.currency)}</td><td>${money(p.market_value_twd)}</td><td>${p.lots.map(l=>`${safe(l.date)}：${money(l.quantity)} 股`).join('<br>')}</td></tr>`).join('')||'<tr><td colspan="6">尚無持股</td></tr>';$('loanList').innerHTML=d.loans.map(l=>`<p><b>${safe(l.name)}</b>（${safe(({personal:'信貸',mortgage:'房貸',pledge:'質押'})[l.loan_type]||'其他')}）：剩餘本金 ${money(l.principal)} ${safe(l.currency)}；年利率 ${safe(l.annual_rate)}%</p>`).join('')||'尚無借款';$('tradeHistory').innerHTML=[...db.trades].sort((a,b)=>b.trade_date.localeCompare(a.trade_date)).map(t=>`<tr><td>${safe(t.trade_date)}</td><td>${safe(db.accounts.find(a=>a.id==t.account_id)?.name||t.account_id)}</td><td>${safe(t.symbol)}</td><td>${safe(t.side)}</td><td>${money(t.quantity)}</td><td>${money(t.price)} <button class="editBtn" data-edit="trades" data-id="${t.id}">修改</button><button class="editBtn" data-delete="trades" data-id="${t.id}">刪除</button></td></tr>`).join('');drawRiver(day)}
function poly(points){return points.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ')}
function drawRiver(day){let count=number($('days').value);let raw=[];for(let i=-Math.min(90,count);i<=count;i+=Math.max(1,Math.ceil((count+90)/250)))raw.push(snapshot(addDays(day,i),i>0));if(!raw.some(p=>p.date===day))raw.push(snapshot(day));raw.sort((a,b)=>a.date.localeCompare(b.date));chartPoints=raw;cut=chartPoints.findIndex(p=>p.date===day);let max=Math.max(1,...raw.flatMap(p=>[p.assets_twd,p.debts_twd])),w=860,h=145,mid=169,x=i=>20+i*w/Math.max(1,raw.length-1),a=p=>mid-p.assets_twd/max*h,b=p=>mid+p.debts_twd/max*h;let ap=raw.map((p,i)=>[x(i),a(p)]),bp=raw.map((p,i)=>[x(i),b(p)]);const area=points=>poly(points)+` L ${points.at(-1)[0]} ${mid} L ${points[0][0]} ${mid} Z`,cutoff=x(cut);$('river').innerHTML=`<defs><linearGradient id="ag" x2="0" y2="1"><stop stop-color="#0f9480" stop-opacity=".6"/><stop offset="1" stop-color="#0f9480" stop-opacity=".08"/></linearGradient><linearGradient id="dg" x2="0" y2="1"><stop stop-color="#d16c62" stop-opacity=".07"/><stop offset="1" stop-color="#d16c62" stop-opacity=".55"/></linearGradient></defs><line x1="10" y1="${mid}" x2="890" y2="${mid}" stroke="#74858b"/><path d="${area(ap)}" fill="url(#ag)"/><path d="${area(bp)}" fill="url(#dg)"/><path d="${poly(ap)}" fill="none" stroke="#0f9480" stroke-width="2.5"/><path d="${poly(bp)}" fill="none" stroke="#d16c62" stroke-width="2.5"/><rect x="${cutoff}" y="16" width="${Math.max(0,880-cutoff)}" height="307" fill="#7b8490" fill-opacity=".07"/><line x1="${cutoff}" x2="${cutoff}" y1="16" y2="323" stroke="#657987" stroke-dasharray="5 4"/><text x="24" y="18" fill="#147e76" font-size="13">資產 ↑</text><text x="24" y="329" fill="#c45d55" font-size="13">負債 ↓</text><text x="${Math.min(820,cutoff+8)}" y="30" font-size="12" fill="#607480">預測 →</text><text x="20" y="337" font-size="11" fill="#607480">${raw[0].date}</text><text x="800" y="337" font-size="11" fill="#607480">${raw.at(-1).date}</text><line id="cursor" x1="${cutoff}" x2="${cutoff}" y1="20" y2="315" stroke="#17394a" stroke-dasharray="3 3"/>`;function select(e){let rect=$('river').getBoundingClientRect(),sx=(e.clientX-rect.left)/rect.width*900,i=Math.max(0,Math.min(raw.length-1,Math.round((sx-20)/w*(raw.length-1)))),p=raw[i];$('cursor').setAttribute('x1',x(i));$('cursor').setAttribute('x2',x(i));$('tip').textContent=`${p.date}｜${i>cut?'預測':'歷史'}｜資產 NT$ ${money(p.assets_twd)}｜負債 NT$ ${money(p.debts_twd)}｜淨資產 NT$ ${money(p.net_worth_twd)}`};$('river').onpointerdown=e=>{$('river').setPointerCapture(e.pointerId);select(e)};$('river').onpointermove=e=>{if(e.buttons)select(e)};let p=raw[cut];$('tip').textContent=`${p.date}｜資產 NT$ ${money(p.assets_twd)}｜負債 NT$ ${money(p.debts_twd)}｜淨資產 NT$ ${money(p.net_worth_twd)}`}
$('nav').addEventListener('click',e=>{let b=e.target.closest('[data-page]');if(!b)return;document.querySelectorAll('.page').forEach(p=>p.classList.toggle('hidden',p.id!==b.dataset.page));document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x===b))});
bindForm('accountForm','accounts');bindForm('tradeForm','trades',d=>({...d,symbol:d.symbol.toUpperCase(),account_id:number(d.account_id)}));bindForm('loanForm','loans');bindForm('paymentForm','payments',d=>({...d,loan_id:number(d.loan_id)}));bindForm('priceForm','prices',d=>({...d,symbol:d.symbol.toUpperCase()}));bindForm('fxForm','fx',d=>({...d,base:'USD',quote:'TWD'}));
$('tradeHistory').addEventListener('click',e=>{const btn=e.target.closest('[data-edit],[data-delete]');if(!btn)return;const entity=btn.dataset.edit||btn.dataset.delete,id=number(btn.dataset.id),row=db[entity].find(x=>x.id===id);if(!row)return;if(btn.dataset.delete){if(!confirm('確定刪除此筆交易？'))return;db[entity]=db[entity].filter(x=>x.id!==id)}else{const fields=[['trade_date','成交日期'],['symbol','股票代號'],['side','買賣 BUY/SELL'],['quantity','股數'],['price','價格'],['fee','手續費']];const update={...row};for(const [k,label] of fields){let value=prompt(label,update[k]??'');if(value===null)return;update[k]=value.trim()}if(!/^\d{4}-\d\d-\d\d$/.test(update.trade_date)||!['BUY','SELL'].includes(update.side)||!(number(update.quantity)>0)||!(number(update.price)>0))return notice('日期、買賣、股數或價格格式錯誤',true);Object.assign(row,update)}store();refresh();notice('已修改本機資料，請記得備份到 iCloud')});
$('asof').value=today();$('openingDate').value=today();document.querySelectorAll('input[type=date]').forEach(x=>{if(!x.value)x.value=today()});$('asof').onchange=refresh;$('days').onchange=refresh;
function parseCSV(text){const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);const headers=lines.shift().split(',').map(x=>x.trim());const required=['date','symbol','market','side','quantity','price','currency'];if(required.some(x=>!headers.includes(x)))throw Error('CSV 缺少必要欄位');return lines.filter(Boolean).map(line=>Object.fromEntries(line.split(',').map((v,i)=>[headers[i],v.trim()]))) }
$('importBtn').onclick=()=>{try{let file=$('csvFile').files[0];if(!file)throw Error('請選擇 CSV');file.text().then(text=>{const rows=parseCSV(text),account_id=number($('importAccount').value);if(!account_id)throw Error('請先建立券商帳戶');let added=0,skipped=0;for(const r of rows){if(!['BUY','SELL'].includes(r.side)||!(number(r.quantity)>0)||!(number(r.price)>0))throw Error('CSV 存在不正確的交易');if(r.external_id&&db.trades.some(t=>t.account_id===account_id&&t.external_id===r.external_id)){skipped++;continue}add('trades',{account_id,symbol:r.symbol.toUpperCase(),market:r.market,side:r.side,trade_date:r.date,quantity:r.quantity,price:r.price,currency:r.currency,fee:r.fee||'0',external_id:r.external_id||''});added++}refresh();notice(`新增 ${added} 筆，略過 ${skipped} 筆；記得備份到 iCloud`)}).catch(e=>notice(e.message,true))}catch(e){notice(e.message,true)}};
const encoder=new TextEncoder(),decoder=new TextDecoder();
function b64(buf){let bytes=new Uint8Array(buf),out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out)}
function unb64(s){const b=atob(s),out=new Uint8Array(b.length);for(let i=0;i<b.length;i++)out[i]=b.charCodeAt(i);return out}
async function derive(pass,salt){const material=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function encryptData(pass){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),k=await derive(pass,salt);const plain=encoder.encode(JSON.stringify({version:1,savedAt:new Date().toISOString(),data:db}));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,plain);return JSON.stringify({format:'asset-river-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations:310000,cipher:'AES-256-GCM',savedAt:new Date().toISOString(),salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)},null,2)}
async function decryptData(text,pass){const blob=JSON.parse(text);if(blob.format!=='asset-river-encrypted'||blob.version!==1||blob.iterations!==310000)throw Error('備份格式不相容');const key=await derive(pass,unb64(blob.salt)),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(blob.iv)},key,unb64(blob.ciphertext));const doc=JSON.parse(decoder.decode(plain));if(doc.version!==1||!doc.data||!['accounts','trades','loans','payments','prices','fx'].every(c=>Array.isArray(doc.data[c])))throw Error('備份資料不完整');for(const c of collections)if(!Array.isArray(doc.data[c]))doc.data[c]=[];for(const c of collections){if(doc.data[c].length>100000)throw Error('備份資料超過上限')}return doc}
$('saveBackup').onclick=async()=>{try{const pass=$('backupPassword').value;if(pass.length<12)throw Error('請輸入至少 12 字元的備份密碼');const text=await encryptData(pass),name='資產河流-加密備份.json',blob=new Blob([text],{type:'application/json'});if(navigator.canShare&&navigator.share){try{const file=new File([blob],name,{type:'application/json'});if(navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'資產河流加密備份'});dirty=false;status();notice('已交給 iOS 分享功能；請確認檔案已儲存到 iCloud Drive');return}}catch(e){if(e.name==='AbortError')return}}const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),30000);dirty=false;status();notice('已下載加密備份；請到「檔案」App 將它移至 iCloud Drive')}catch(e){notice(e.message,true)}};
$('loadBackup').onclick=async()=>{try{const file=$('backupFile').files[0],pass=$('backupPassword').value;if(!file)throw Error('請先從「選擇檔案」選取 iCloud Drive 備份');if(!pass)throw Error('請輸入備份密碼');if(file.size>15*1024*1024)throw Error('檔案過大');const doc=await decryptData(await file.text(),pass);if(!confirm(`備份日期：${doc.savedAt}\n\n還原會覆蓋目前裝置的所有資產資料，確定嗎？`))return;db=doc.data;store();dirty=false;status();refresh();manageRefresh();refreshDividends();notice('已成功載入 iCloud 加密備份')}catch(e){notice('無法還原：密碼錯誤、檔案損毀或格式不相容。'+e.message,true)}};
const names={accounts:'券商帳戶',trades:'交易',loans:'借款',payments:'還款',schedules:'固定收支',prices:'股價',fx:'匯率',cash:'現金',dividends:'股息'};
function manageRefresh(){const entity=$('manageEntity').value;const rows=db[entity]||[];$('manageRows').innerHTML=rows.map(row=>`<tr><td>${safe(Object.entries(row).filter(([k])=>k!=='id').slice(0,4).map(([k,v])=>k+': '+v).join(' / '))}</td><td><button class="editBtn" data-manage-edit="${row.id}">修改</button><button class="editBtn" data-manage-delete="${row.id}">刪除</button></td></tr>`).join('')||'<tr><td>尚無資料</td></tr>'}
$('manageEntity').onchange=manageRefresh;
$('manageRows').addEventListener('click',e=>{const b=e.target.closest('[data-manage-edit],[data-manage-delete]');if(!b)return;const entity=$('manageEntity').value,id=number(b.dataset.manageEdit||b.dataset.manageDelete),row=db[entity].find(x=>x.id===id);if(!row)return;if(b.dataset.manageDelete){if(entity==='accounts'&&db.trades.some(x=>x.account_id===id))return notice('此帳戶仍有交易，請先處理相關交易',true);if(entity==='loans'&&db.payments.some(x=>x.loan_id===id))return notice('此借款仍有還款紀錄，請先處理相關還款',true);if(!confirm('確定刪除這筆'+names[entity]+'資料？'))return;db[entity]=db[entity].filter(x=>x.id!==id)}else{const copy={...row};for(const [k,v] of Object.entries(row)){if(k==='id')continue;const value=prompt('修改 '+k, v??'');if(value===null)return;copy[k]=typeof v==='number'?number(value):value.trim()}if(entity==='trades'&&(!['BUY','SELL'].includes(copy.side)||!(number(copy.quantity)>0)||!(number(copy.price)>0)))return notice('交易欄位不正確',true);Object.assign(row,copy)}store();refresh();manageRefresh();notice('已更新本機資料，記得備份到 iCloud')});
$('deleteAll').onclick=()=>{if(!confirm('確定清除這台裝置上的所有資料？請先確認已備份到 iCloud。'))return;if(!confirm('再次確認：清除後無法復原，除非你有備份。'))return;db=empty();store();refresh();notice('已清除本機資料')};
status();refresh();manageRefresh();refreshDividends();


// V2: Stock opening balances, dividends, scenarios and best-effort public closing prices.
$('openingForm').addEventListener('submit',e=>{e.preventDefault();try{let d=formData(e.target),account_id=number(d.account_id);if(!account_id)throw Error('先新增券商帳戶');d.symbol=d.symbol.trim().toUpperCase();if(!d.symbol||number(d.quantity)<=0)throw Error('請輸入代號與股數');if(db.trades.some(t=>t.account_id==account_id&&t.symbol===d.symbol&&t.market===d.market))throw Error('這個帳戶已有同一檔股票的交易，請先確認是否會重複計算');add('trades',{...d,account_id,side:'BUY',price:d.price||'0',fee:0,unknown_cost:d.price===''?'1':'0',opening:'1'});e.target.reset();e.target.elements.trade_date.value=today();notice('已建立期初持股');refresh()}catch(err){notice(err.message,true)}});
$('openingImportBtn').onclick=async()=>{
 const output=$('openingImportStatus'),button=$('openingImportBtn');
 const feedback=(msg,error=false)=>{output.textContent=msg;output.style.color=error?'#a33':'';output.style.fontWeight=error?'bold':'normal'};
 try{
  feedback('正在檢查 CSV，請稍候…');button.disabled=true;
  const file=$('openingFile').files[0],id=number($('openingImportAccount').value),date=$('openingDate').value;
  if(!db.accounts.length)throw Error('尚未建立券商帳戶：請先到「交易批次」新增 Firstrade 帳戶。');
  if(!id||!db.accounts.some(a=>a.id===id))throw Error('請先選擇有效的券商帳戶。');
  if(!file)throw Error('請先選擇 Firstrade 持股 CSV 檔案。');
  if(!date)throw Error('請填入記帳起始日。');
  const raw=await file.text(),lines=raw.replace(/^\uFEFF/,'').trim().split(/\r?\n/),head=lines.shift().split(',').map(x=>x.trim());
  if(['symbol','market','quantity','average_cost','currency'].some(x=>!head.includes(x)))throw Error('CSV 欄位不符合「期初持股」格式：需要 symbol,market,quantity,average_cost,currency。');
  const rows=lines.filter(x=>x.trim()).map(l=>Object.fromEntries(l.split(',').map((x,i)=>[head[i],x.trim()])));
  if(!rows.length)throw Error('CSV 檔案沒有持股資料。');
  for(const r of rows){
   r.symbol=(r.symbol||'').toUpperCase();
   if(!r.symbol||!['TW','US'].includes(r.market)||!Number.isFinite(Number(r.quantity))||Number(r.quantity)<=0||!['TWD','USD'].includes(r.currency)||(r.average_cost!==''&&(!Number.isFinite(Number(r.average_cost))||Number(r.average_cost)<0)))throw Error('持股資料不正確，請檢查：'+(r.symbol||'未知股票'));
   if(db.trades.some(t=>t.account_id==id&&t.symbol===r.symbol&&t.market===r.market))throw Error(r.symbol+' 已有交易，為避免重複匯入已停止。');
  }
  if(new Set(rows.map(r=>r.symbol+'|'+r.market)).size!==rows.length)throw Error('匯入檔內有重複股票代號。');
  const account=db.accounts.find(a=>a.id===id);
  feedback('檢查完成：共 '+rows.length+' 檔股票，帳戶為 '+account.broker+' — '+account.name+'。等待你的確認。');
  if(!confirm('準備匯入 '+rows.length+' 檔股票至 '+account.broker+' — '+account.name+'（起始日 '+date+'）。確認嗎？')){feedback('你已取消匯入，未更改資料。');return;}
  // Persist all rows together so the transaction is not partially imported.
  const startId=nextId('trades');
  const next=rows.map((r,i)=>({id:startId+i,account_id:id,symbol:r.symbol,market:r.market,currency:r.currency,trade_date:date,side:'BUY',quantity:r.quantity,price:r.average_cost||'0',fee:'0',opening:'1',unknown_cost:r.average_cost===''?'1':'0'}));
  db.trades.push(...next);
  try{store()}catch(e){db.trades.splice(db.trades.length-next.length,next.length);throw e}
  refresh();manageRefresh();
  feedback('✅ 成功匯入 '+rows.length+' 檔股票到 '+account.broker+' — '+account.name+'。請到「資產河流」查看，並記得備份到 iCloud。');
 }catch(e){feedback('❌ 匯入失敗：'+e.message,true)}finally{button.disabled=false}
};
$('dividendForm').addEventListener('submit',e=>{e.preventDefault();const d=formData(e.target);if(d.status==='received'&&(!d.received_date||d.received_amount===''))return notice('確認已入帳時需填實際日期與淨額',true);add('dividends',{...d,account_id:number(d.account_id),symbol:d.symbol.toUpperCase()});refreshDividends();manageRefresh();notice('股息已記錄（不自動加到現金）')});
function refreshDividends(){$('dividendRows').innerHTML=db.dividends.map(d=>`<tr><td>${safe(d.symbol)}</td><td>${safe(db.accounts.find(a=>a.id==d.account_id)?.name||'—')}</td><td>${safe(d.pay_date||'—')}</td><td>${safe(d.received_date||'—')}</td><td>${d.received_amount==null?'—':money(d.received_amount)} ${safe(d.currency)}</td><td>${d.status==='received'?'已入帳':'待確認'}</td></tr>`).join('')||'<tr><td colspan="6">尚無股息</td></tr>'}
function forecastView(){const day=$('asof').value,base=snapshot(day),years=number($('forecastYears').value),rates=['rBear','rBase','rBull'].map(x=>number($(x).value)),rows=[];for(let y=0;y<=years;y++){let d=addDays(day,Math.round(y*365.25)),loans=db.loans.reduce((s,l)=>s+twd(loanState(l,d).principal,l.currency,day),0);let v=rates.map(r=>base.assets_twd*Math.pow(1+r/100,y)-loans);rows.push({year:y,loans,values:v})}let last=rows.at(-1);$('forecastSummary').innerHTML=['保守','中性','樂觀'].map((n,i)=>`<div class="card"><span class="muted">${n}｜${years} 年後</span><b>${money(last.values[i])}</b><small>新台幣（試算）</small></div>`).join('');$('forecastRows').innerHTML=rows.map(r=>`<tr><td>${r.year===0?'現在':r.year+' 年後'}</td>${r.values.map(v=>`<td>${money(v)}</td>`).join('')}<td>${money(r.loans)}</td></tr>`).join('')}
$('forecastBtn').onclick=forecastView;$('forecastYears').onchange=forecastView;['rBear','rBase','rBull'].forEach(id=>$(id).onchange=forecastView);
const oldRefresh=refresh;refresh=function(){oldRefresh();refreshDividends();forecastView()};
// 價格資料從 GitHub Pages 同源的 data/quotes.json 取得，不直接向 Yahoo 跨網域請求。
async function updateQuotes(){
 const status=$('quoteStatus'),button=$('quoteRefresh');
 const positions=holdings(today()),symbols=[...new Map(positions.map(p=>[p.market+'|'+p.symbol,p])).values()];
 if(!symbols.length){status.textContent='尚無持股；請先建立股票庫存。';return}
 status.textContent='正在讀取每日行情檔…';button.disabled=true;
 try{
  const url=new URL('./data/quotes.json',location.href);
  url.searchParams.set('t',String(Date.now()));
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok)throw Error('找不到行情檔 (HTTP '+res.status+')');
  const feed=await res.json();
  if(!feed||!Array.isArray(feed.quotes))throw Error('行情檔格式錯誤');
  const available=new Map(feed.quotes.filter(q=>q&&q.market&&q.symbol).map(q=>[q.market+'|'+q.symbol.toUpperCase(),q]));
  let added=0,unchanged=0,failed=[];
  for(const position of symbols){
   const q=available.get(position.market+'|'+position.symbol.toUpperCase());
   if(!q||!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||!Number.isFinite(Number(q.close))||Number(q.close)<=0||q.date>today()){
    failed.push(position.symbol);continue;
   }
   const existing=db.prices.find(x=>x.symbol===position.symbol&&x.market===position.market&&x.price_date===q.date);
   if(existing){unchanged++;continue}
   add('prices',{symbol:position.symbol,market:position.market,currency:position.market==='TW'?'TWD':'USD',price_date:q.date,price:String(q.close),auto:'1'});
   added++;
  }
  if(feed.fx&&/^\d{4}-\d{2}-\d{2}$/.test(feed.fx.date)&&Number.isFinite(Number(feed.fx.usdtwd))&&Number(feed.fx.usdtwd)>0&&feed.fx.date<=today()){
   if(!db.fx.some(x=>x.rate_date===feed.fx.date)){add('fx',{rate_date:feed.fx.date,rate:String(feed.fx.usdtwd)});}
  }
  const missingFX=symbols.some(x=>x.market==='US')&&!number(fx(today()));
  status.textContent='行情資料日期：'+(feed.generated_at||'未註明')+'；新增 '+added+' 檔，已有價格 '+unchanged+' 檔。'+
   (failed.length?' 未取得：'+failed.join('、')+'。':'')+(missingFX?' 尚缺 USD/TWD 匯率，請手動設定。':'')+
   '（注意：行情可能延遲，以個別股票報價日期為準）';
  refresh();
 }catch(err){
  status.textContent='無法讀取每日行情：'+err.message+'。請先將完整網站部署至 GitHub Pages，並執行每日行情更新工作。原本持股資料沒有被清除。';
 }finally{button.disabled=false}
}
$('quoteRefresh').onclick=updateQuotes;
// 僅在 HTTP(S) 網站開啟時自動取行情。直接點開本機 index.html 無法取得雲端行情。
if(location.protocol==='https:'||location.protocol==='http:'){
 if(!sessionStorage.getItem('asset-river-quote-check-'+today())){
  sessionStorage.setItem('asset-river-quote-check-'+today(),'1');
  if(db.trades.length)setTimeout(updateQuotes,1200);
 }
}

