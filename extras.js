/* إضافات: مشرفين برقم موبايل وباسورد، GPS للحضور، نسخة احتياطية، صور تحويل وإيصال متعددة */
(function(){
const SUP_KEY='salaryAppSupervisors';
const $=s=>document.querySelector(s);
const getSups=()=>{try{return JSON.parse(localStorage.getItem(SUP_KEY)||'[]')}catch(e){return[]}};
const setSups=a=>localStorage.setItem(SUP_KEY,JSON.stringify(a));
async function hash(pw,salt){const b=new TextEncoder().encode(salt+':'+pw);const h=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('');}
const normPhone=p=>String(p||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g,'');

/* ---- دخول المشرف ---- */
window.supervisorLogin=async function(phone,pw){
  const ph=normPhone(phone), s=getSups().find(x=>x.phone===ph);
  if(!s||!pw) return false;
  if((await hash(pw,s.salt))!==s.hash) return false;
  window.supSession=s; return true;
};
window.supGroups=()=>{const s=window.supSession; return s?(groups||[]).filter(g=>(s.groupIds||[]).includes(g.id)):(groups||[]);};
window.manageSupervisors=function(){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const draw=()=>{
    const list=getSups();
    ov.innerHTML='<div style="background:#fff;border-radius:14px;padding:16px;width:100%;max-width:380px;max-height:85vh;overflow:auto;direction:rtl">'+
    '<h3 style="margin:0 0 10px">👷 حسابات المشرفين</h3>'+
    (list.length?list.map((s,i)=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee"><span>'+s.phone+' <small style="color:#888">('+(s.groupIds||[]).filter(id=>(groups||[]).some(g=>g.id===id)).map(id=>escapeHtml((groups.find(g=>g.id===id)||{}).name)).join('، ')+')</small></span><span><button data-cus="'+i+'" style="background:none;border:none">💰 العهدة</button><button data-del="'+i+'" style="color:#c0392b;background:none;border:none">حذف</button></span></div>').join(''):'<div style="color:#888;margin-bottom:8px">لا يوجد مشرفين بعد</div>')+
    '<div style="margin-top:10px;font-size:13px">المجموعات المسموحة (اختار مجموعة أو أكتر):</div>'+(groups||[]).map(g=>'<label style="display:block;margin:4px 0"><input type="checkbox" class="xsG" value="'+g.id+'"> '+g.name+'</label>').join('')+'<input id="xsPh" type="tel" placeholder="رقم الموبايل" style="width:100%;margin-top:10px">'+
    '<input id="xsPw" type="password" placeholder="الباسورد (8 أحرف أو أكتر، حروف وأرقام)" style="width:100%;margin-top:6px">'+
    '<div id="xsErr" style="color:#c0392b;font-size:12px;min-height:16px"></div>'+
    '<button id="xsAdd" class="toggle-btn full-btn">إضافة / تغيير باسورد</button>'+
    '<button id="xsClose" class="toggle-btn full-btn" style="margin-top:6px">إغلاق</button></div>';
    ov.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{const l=getSups();l.splice(+b.dataset.del,1);setSups(l);draw();});
    ov.querySelector('#xsClose').onclick=()=>ov.remove();
    ov.querySelectorAll('[data-cus]').forEach(b=>b.onclick=()=>window.openCustodyAdmin(getSups()[+b.dataset.cus].phone));
    ov.querySelector('#xsAdd').onclick=async()=>{
      const ph=normPhone(ov.querySelector('#xsPh').value), pw=ov.querySelector('#xsPw').value, err=ov.querySelector('#xsErr');
      if(ph.length<10) return err.textContent='رقم الموبايل غير صحيح';
      if(pw.length<8||!/[A-Za-z]/.test(pw)||!/\d/.test(pw)) return err.textContent='الباسورد لازم 8 أحرف على الأقل، فيها حروف وأرقام';
      const gids=[...ov.querySelectorAll('.xsG:checked')].map(x=>x.value); if(!gids.length) return err.textContent='اختار مجموعة واحدة على الأقل';
      const salt=Math.random().toString(36).slice(2), l=getSups().filter(x=>x.phone!==ph);
      l.push({phone:ph,salt,groupIds:gids,hash:await hash(pw,salt)});setSups(l);draw();
    };
  };
  draw();document.body.appendChild(ov);
};

/* ---- GPS مع تسجيل الحضور ---- */
function xLogGps(persons){
  if(!persons||!persons.length||!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos=>{
    const e={ts:Date.now(),lat:+pos.coords.latitude.toFixed(6),lng:+pos.coords.longitude.toFixed(6),acc:Math.round(pos.coords.accuracy)};
    persons.forEach(p=>{(p.gpsLog=p.gpsLog||[]).push(Object.assign({},e)); if(p.gpsLog.length>120)p.gpsLog.shift();});
    saveGroups();
  },()=>{},{enableHighAccuracy:true,timeout:10000,maximumAge:0});
}
const origMark=window.markPersonPresentToday;
if(typeof origMark==='function'){
  window.markPersonPresentToday=function(idx){
    const g=currentGroup();
    if(window.supSession&&(!g||!(window.supSession.groupIds||[]).includes(g.id))) return;
    const r=origMark.apply(this,arguments);
    if(g&&g.people[idx]&&navigator.geolocation){
      navigator.geolocation.getCurrentPosition(pos=>{
        const p=g.people[idx]; (p.gpsLog=p.gpsLog||[]).push({ts:Date.now(),lat:+pos.coords.latitude.toFixed(6),lng:+pos.coords.longitude.toFixed(6),acc:Math.round(pos.coords.accuracy)});
        if(p.gpsLog.length>120)p.gpsLog.shift(); saveGroups();
      },()=>{},{enableHighAccuracy:true,timeout:10000,maximumAge:0});
    }
    return r;
  };
}

/* ---- نسخة احتياطية ---- */
function backupBlob(){return new Blob([JSON.stringify({v:2,at:new Date().toISOString(),groups:groups,supervisors:getSups(),custody:getCus(),treasury:getTrs(),purchases:getPur()})],{type:'application/json'});}
function backupName(){return 'salary-backup-'+new Date().toISOString().slice(0,10)+'.json';}
function openBackup(){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML='<div style="background:#fff;border-radius:14px;padding:16px;width:100%;max-width:340px;direction:rtl"><h3 style="margin:0 0 10px">💾 نسخة احتياطية</h3>'+
  '<button id="bkE" class="toggle-btn full-btn">⬇️ تصدير ملف</button>'+
  '<button id="bkS" class="toggle-btn full-btn" style="margin-top:6px">📤 مشاركة (واتساب / فيسبوك)</button>'+
  '<button id="bkI" class="toggle-btn full-btn" style="margin-top:6px">⬆️ استرجاع من ملف</button>'+
  '<input id="bkF" type="file" accept=".json,application/json" hidden>'+
  '<button id="bkC" class="toggle-btn full-btn" style="margin-top:6px">إغلاق</button></div>';
  document.body.appendChild(ov);
  ov.querySelector('#bkC').onclick=()=>ov.remove();
  ov.querySelector('#bkE').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(backupBlob());a.download=backupName();a.click();};
  ov.querySelector('#bkS').onclick=async()=>{
    const f=new File([backupBlob()],backupName(),{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[f]})){try{await navigator.share({files:[f],title:'نسخة احتياطية - حاسبة الرواتب'});}catch(e){}}
    else alert('المشاركة المباشرة غير مدعومة هنا، استخدم التصدير.');
  };
  const inp=ov.querySelector('#bkF');
  ov.querySelector('#bkI').onclick=()=>inp.click();
  inp.onchange=async()=>{
    try{
      const d=JSON.parse(await inp.files[0].text());
      if(!Array.isArray(d.groups)) throw 0;
      if(!(await showConfirm('هيتم استبدال كل البيانات الحالية بالنسخة الاحتياطية. متأكد؟'))) return;
      localStorage.setItem('salaryAppGroups',JSON.stringify(d.groups));
      if(d.supervisors) setSups(d.supervisors);
      if(d.custody) setCus(d.custody);
      if(d.treasury) setTrs(d.treasury);
      if(d.purchases) setPur(d.purchases);
      location.reload();
    }catch(e){alert('الملف غير صالح');}
  };
}
window.addEventListener('load',()=>{
  const tb=$('#appContent .topbar')||$('.topbar'); if(!tb) return;
  const b=document.createElement('button'); b.textContent='💾'; b.title='نسخة احتياطية'; b.className='toggle-btn'; b.id='xBackupBtn'; b.onclick=openBackup;
  tb.appendChild(b);
});

/* ---- صور تحويل وإيصال متعددة ---- */
function compress(file){return new Promise(res=>{const r=new FileReader();r.onload=()=>{const i=new Image();i.onload=()=>{const k=Math.min(1,900/Math.max(i.width,i.height)),c=document.createElement('canvas');c.width=i.width*k;c.height=i.height*k;c.getContext('2d').drawImage(i,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',.7));};i.src=r.result;};r.readAsDataURL(file);});}
function gallery(card,p,key,title,icon){
  const wrap=document.createElement('div'); wrap.className='xGallery'; wrap.style.cssText='margin-top:10px';
  const render=()=>{
    const arr=p[key]=p[key]||[];
    wrap.innerHTML='<label>'+title+' ('+arr.length+')</label><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">'+
    arr.map((s,i)=>'<div style="position:relative"><img src="'+s+'" data-v="'+i+'" style="width:72px;height:72px;object-fit:cover;border-radius:8px"><button data-d="'+i+'" style="position:absolute;top:-6px;left:-6px;border-radius:50%;border:none;background:#c0392b;color:#fff;width:20px;height:20px;line-height:20px;padding:0">✕</button></div>').join('')+
    '<label style="width:72px;height:72px;border:2px dashed #aaa;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0">'+icon+'<input type="file" accept="image/*" hidden></label></div>';
    wrap.querySelector('input').onchange=async e=>{const f=e.target.files[0];if(!f)return;arr.push(await compress(f));saveGroups();render();};
    wrap.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>{arr.splice(+b.dataset.d,1);saveGroups();render();});
    wrap.querySelectorAll('[data-v]').forEach(im=>im.onclick=()=>{const w=window.open();w&&(w.document.write('<img src="'+im.src+'" style="max-width:100%">'));});
  };
  render(); card.appendChild(wrap);
}
const origCard=window.renderPersonCard;
window.renderPersonCard=function(data,idx){
  origCard.apply(this,arguments);
  const g=currentGroup(), p=g&&g.people[idx]; if(!p) return;
  const card=peopleContainer.querySelector('.card[data-idx="'+idx+'"]'); if(!card) return;
  if(p.paymentImg){(p.transferImgs=p.transferImgs||[]).push(p.paymentImg);p.paymentImg='';saveGroups();}
  const pb=card.querySelector('.paymentBox'); if(pb&&pb.parentElement) pb.parentElement.style.display='none';
  const tb=card.querySelectorAll('.dayChk')[new Date().getDate()-1];
  if(tb) tb.addEventListener('click',()=>{ if(tb.dataset.present==='1') xLogGps([p]); });
  gallery(card,p,'transferImgs','صور التحويل (فودافون كاش / انستاباي)','📸');
  gallery(card,p,'receiptImgs','صور إيصال استلام الراتب','🧾');
};
window.xHistoryImgs=h=>((h.transferImgs||[]).length||(h.receiptImgs||[]).length)?' • صور تحويل: '+(h.transferImgs||[]).length+' • إيصالات: '+(h.receiptImgs||[]).length:'';

/* ---- عهدة المشرفين: الأدمن يسجل، المشرف يشوف فقط ---- */
const CUS_KEY='salaryAppCustody';
const getCus=()=>{try{return JSON.parse(localStorage.getItem(CUS_KEY)||'{}')}catch(e){return{}}};
const setCus=o=>localStorage.setItem(CUS_KEY,JSON.stringify(o));
const mKey=(y,m)=>y+'-'+String(m+1).padStart(2,'0');
const dim=(y,m)=>new Date(y,m+1,0).getDate();
const money=n=>(Math.round(n*100)/100).toLocaleString('ar-EG');
const monthLabel=(y,m)=>new Date(y,m,1).toLocaleDateString('ar-EG',{month:'long',year:'numeric'});
function wd(y,m,d){return new Date(y,m,d).toLocaleDateString('ar-EG',{weekday:'short'});}
function endOfToday(){const t=new Date();return new Date(t.getFullYear(),t.getMonth(),t.getDate(),23,59,59,999);}
function sumMonth(rec,y,m,untilToday){
  const mm=(rec||{})[mKey(y,m)]||{}, lim=endOfToday(); let t=0;
  Object.keys(mm).forEach(d=>{const v=+mm[d]||0; if(!untilToday||new Date(y,m,+d)<=lim) t+=v;});
  return t;
}
function sumAllUntilToday(rec){
  const lim=endOfToday(); let t=0;
  Object.keys(rec||{}).forEach(k=>{const [y,mo]=k.split('-').map(Number); Object.keys(rec[k]).forEach(d=>{if(new Date(y,mo-1,+d)<=lim) t+=(+rec[k][d]||0);});});
  return t;
}
function custodyShell(title){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML='<div style="background:#fff;border-radius:14px;padding:16px;width:100%;max-width:380px;max-height:88vh;overflow:auto;direction:rtl"><h3 style="margin:0 0 10px">'+title+'</h3><div class="xcBody"></div><button class="xcClose toggle-btn full-btn" style="margin-top:10px">إغلاق</button></div>';
  ov.querySelector('.xcClose').onclick=()=>ov.remove();
  document.body.appendChild(ov); return ov;
}
function navRow(y,m){
  return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><button class="xcPrev toggle-btn">›</button><strong>'+monthLabel(y,m)+'</strong><button class="xcNext toggle-btn">‹</button></div>';
}
function wireNav(ov,st,draw){
  ov.querySelector('.xcPrev').onclick=()=>{st.m--; if(st.m<0){st.m=11;st.y--;} draw();};
  ov.querySelector('.xcNext').onclick=()=>{st.m++; if(st.m>11){st.m=0;st.y++;} draw();};
}

/* الأدمن: تسجيل مبلغ لكل يوم */
window.openCustodyAdmin=function(phone){
  const ov=custodyShell('💰 عهدة المشرف '+phone), body=ov.querySelector('.xcBody'), t=new Date(), st={y:t.getFullYear(),m:t.getMonth()};
  const draw=()=>{
    const all=getCus(), rec=all[phone]||{}, mm=rec[mKey(st.y,st.m)]||{}, n=dim(st.y,st.m);
    let h=navRow(st.y,st.m)+'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
    for(let d=1;d<=n;d++){
      h+='<label style="display:flex;align-items:center;gap:6px;border:1px solid #eee;border-radius:8px;padding:4px 6px;font-size:12px;margin:0"><span style="min-width:48px">'+d+' '+wd(st.y,st.m,d)+'</span><input type="number" inputmode="decimal" min="0" data-d="'+d+'" value="'+(mm[d]||'')+'" style="width:100%;min-width:0"></label>';
    }
    h+='</div><div class="xcTot" style="margin-top:10px;font-weight:bold"></div>';
    body.innerHTML=h; wireNav(ov,st,draw);
    const tot=()=>{body.querySelector('.xcTot').textContent='إجمالي الشهر: '+money(sumMonth(getCus()[phone],st.y,st.m,false));};
    body.querySelectorAll('input[data-d]').forEach(inp=>inp.oninput=()=>{
      const a=getCus(), r=a[phone]=a[phone]||{}, k=mKey(st.y,st.m), o=r[k]=r[k]||{}, v=parseFloat(inp.value);
      if(v>0) o[inp.dataset.d]=v; else delete o[inp.dataset.d];
      if(!Object.keys(o).length) delete r[k];
      setCus(a); tot();
    });
    tot();
  };
  draw();
};

/* المشرف: اطلاع فقط حتى تاريخ اليوم */
window.openCustodyMine=function(){
  const phone=window.supSession&&window.supSession.phone; if(!phone) return;
  const ov=custodyShell('💰 عهدتي'), body=ov.querySelector('.xcBody'), t=new Date(), st={y:t.getFullYear(),m:t.getMonth()};
  const draw=()=>{
    const rec=getCus()[phone]||{}, mm=rec[mKey(st.y,st.m)]||{}, lim=endOfToday();
    const days=Object.keys(mm).map(Number).filter(d=>new Date(st.y,st.m,d)<=lim&&mm[d]>0).sort((a,b)=>a-b);
    let h=navRow(st.y,st.m);
    h+=days.length?days.map(d=>'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee"><span>'+d+' '+wd(st.y,st.m,d)+'</span><strong>'+money(mm[d])+'</strong></div>').join(''):'<div style="color:#888;padding:8px 0">لا توجد مبالغ مسجلة في هذا الشهر</div>';
    h+='<div style="margin-top:10px;display:flex;justify-content:space-between"><span>إجمالي الشهر حتى تاريخه</span><strong>'+money(sumMonth(rec,st.y,st.m,true))+'</strong></div>';
    h+='<div style="margin-top:6px;display:flex;justify-content:space-between"><span>إجمالي كل الشهور حتى تاريخه</span><strong>'+money(sumAllUntilToday(rec))+'</strong></div>';
    body.innerHTML=h; wireNav(ov,st,draw);
  };
  draw();
};

/* ---- الخزينة: وارد الأدمن فقط، كل شهر مستقل. محفوظة محليًا على جهاز الأدمن وخارج المزامنة، فمش بتوصل للمشرفين أبدًا ---- */
/* لما بيانات الخزينة/المشتريات توصل من جهاز تاني، الشاشة المفتوحة بتتحدث لوحدها (إلا لو بتكتب فيها) */
function vaultLive(ov,draw){
  const h=()=>{
    if(!document.body.contains(ov)){window.removeEventListener('vaultUpdated',h);return;}
    const a=document.activeElement; if(a&&ov.contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    const d=ov.querySelector('details'), op=d&&d.open; draw(); const d2=ov.querySelector('details'); if(d2&&op) d2.open=true;
  };
  window.addEventListener('vaultUpdated',h);
}
const TRS_KEY='salaryAppTreasury';
const getTrs=()=>{try{return JSON.parse(localStorage.getItem(TRS_KEY)||'{}')}catch(e){return{}}};
const setTrs=o=>{try{localStorage.setItem(TRS_KEY,JSON.stringify(o));return true}catch(e){alert('مساحة التخزين على الجهاز ممتلئة');return false}};
const trsSum=a=>(a||[]).reduce((t,e)=>t+(+e.amount||0),0);
const trsAllTotal=()=>{const o=getTrs();return Object.keys(o).reduce((t,k)=>t+trsSum(o[k]),0);};
const todayISO=()=>{const t=new Date();return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');};
window.openTreasury=function(){
  if(window.supSession) return;
  const ov=custodyShell('🏦 الخزينة'), body=ov.querySelector('.xcBody'), t=new Date(), st={y:t.getFullYear(),m:t.getMonth(),edit:null};
  const draw=()=>{
    const all=getTrs(), k=mKey(st.y,st.m);
    const list=(all[k]||[]).slice().sort((a,b)=>(a.date<b.date?1:a.date>b.date?-1:b.ts-a.ts));
    const ed=st.edit?list.find(e=>e.id===st.edit):null;
    const defDate=ed?ed.date:(t.getFullYear()===st.y&&t.getMonth()===st.m?todayISO():mKey(st.y,st.m)+'-01');
    let h=navRow(st.y,st.m)+
      '<div style="background:#f4f8f5;border-radius:10px;padding:10px;margin-bottom:10px;display:flex;justify-content:space-between"><span>إجمالي وارد الشهر</span><strong style="font-size:18px">'+money(trsSum(all[k]))+'</strong></div>'+
      '<div style="border:1px solid #eee;border-radius:10px;padding:10px;margin-bottom:10px">'+
      '<div style="font-weight:bold;margin-bottom:6px">'+(ed?'تعديل دفعة':'دفعة جديدة')+'</div>'+
      '<input id="xtAmt" type="number" inputmode="decimal" min="0" placeholder="المبلغ" value="'+(ed?ed.amount:'')+'" style="width:100%;box-sizing:border-box">'+
      '<input id="xtDate" type="date" value="'+defDate+'" style="width:100%;box-sizing:border-box;margin-top:6px">'+
      '<input id="xtFrom" type="text" placeholder="من (اسم الدافع / الجهة)" value="'+(ed?escapeHtml(ed.from||''):'')+'" style="width:100%;box-sizing:border-box;margin-top:6px">'+
      '<input id="xtNote" type="text" placeholder="ملاحظة (اختياري)" value="'+(ed?escapeHtml(ed.note||''):'')+'" style="width:100%;box-sizing:border-box;margin-top:6px">'+
      '<div id="xtErr" style="color:#c0392b;font-size:12px;min-height:16px"></div>'+
      '<button id="xtSave" class="add-btn" type="button">'+(ed?'حفظ التعديل':'+ تسجيل الدفعة')+'</button>'+
      (ed?'<button id="xtCancel" class="toggle-btn full-btn" type="button" style="margin-top:6px">إلغاء التعديل</button>':'')+'</div>'+
      (list.length?list.map(e=>'<div style="padding:8px 0;border-bottom:1px solid #eee"><div style="display:flex;justify-content:space-between"><strong>'+money(e.amount)+'</strong><span style="color:#888;font-size:12px">'+e.date+'</span></div>'+
        ((e.from||e.note)?'<div style="font-size:13px;color:#555">'+escapeHtml([e.from,e.note].filter(Boolean).join(' • '))+'</div>':'')+
        '<div style="margin-top:4px"><button data-e="'+e.id+'" style="background:none;border:none;color:var(--accent)">✎ تعديل</button><button data-x="'+e.id+'" style="background:none;border:none;color:#c0392b">حذف</button></div></div>').join(''):'<div style="color:#888;padding:8px 0">لا توجد دفعات في هذا الشهر.</div>')+
      '<div style="margin-top:12px;display:flex;justify-content:space-between;font-size:13px;color:#555"><span>إجمالي كل الشهور</span><strong>'+money(trsAllTotal())+'</strong></div>'+
      '<button id="xtMonths" class="toggle-btn full-btn" type="button" style="margin-top:8px">📅 ملخص كل الشهور</button><div id="xtSum"></div>';
    body.innerHTML=h; wireNav(ov,Object.assign(st,{}),()=>{st.edit=null;draw();});
    body.querySelector('#xtSave').onclick=async()=>{
      const amt=parseFloat(body.querySelector('#xtAmt').value), date=body.querySelector('#xtDate').value, err=body.querySelector('#xtErr');
      if(!(amt>0)) return err.textContent='اكتب مبلغ صحيح';
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err.textContent='اختار التاريخ';
      const rec={amount:amt,date:date,from:body.querySelector('#xtFrom').value.trim(),note:body.querySelector('#xtNote').value.trim()};
      const a=getTrs();
      if(ed){ /* التعديل ممكن ينقل الدفعة لشهر تاني لو التاريخ اتغير */
        a[k]=(a[k]||[]).filter(e=>e.id!==ed.id); if(!a[k].length) delete a[k];
        rec.id=ed.id; rec.ts=ed.ts;
      } else { rec.id='t'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); rec.ts=Date.now(); }
      rec.upd=Date.now();
      const nk=date.slice(0,7); (a[nk]=a[nk]||[]).push(rec);
      if(!setTrs(a)) return;
      const [yy,mm]=nk.split('-').map(Number); st.y=yy; st.m=mm-1; st.edit=null; draw();
    };
    const c=body.querySelector('#xtCancel'); if(c) c.onclick=()=>{st.edit=null;draw();};
    body.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{st.edit=b.dataset.e;draw();body.scrollIntoView();});
    body.querySelectorAll('[data-x]').forEach(b=>b.onclick=async()=>{
      if(!(await showConfirm('حذف الدفعة دي؟'))) return;
      const a=getTrs(); a[k]=(a[k]||[]).filter(e=>e.id!==b.dataset.x); if(!a[k].length) delete a[k]; setTrs(a); st.edit=null; draw();
    });
    body.querySelector('#xtMonths').onclick=()=>{
      const a=getTrs(), ks=Object.keys(a).sort().reverse(), box=body.querySelector('#xtSum');
      box.innerHTML=ks.length?ks.map(x=>{const [y,mo]=x.split('-').map(Number);return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span>'+monthLabel(y,mo-1)+' <small style="color:#888">('+a[x].length+' دفعة)</small></span><strong>'+money(trsSum(a[x]))+'</strong></div>';}).join(''):'<div style="color:#888;padding:6px 0">لا توجد بيانات.</div>';
    };
  };
  vaultLive(ov,draw);
  draw();
};
window.addEventListener('load',()=>{
  if(window.supSession) return;
  const anchor=document.getElementById('openReportsBtn'); if(!anchor||document.getElementById('xTreasuryBtn')) return;
  const b=document.createElement('button'); b.id='xTreasuryBtn'; b.type='button'; b.className='toggle-btn full-btn'; b.style.marginBottom='8px'; b.textContent='🏦 الخزينة';
  b.onclick=()=>window.openTreasury(); anchor.insertAdjacentElement('beforebegin',b);
});

/* ---- تقارير المشرف (للأدمن فقط): الرصيد = وارد الخزينة − (المشتريات + العهد + مستحقات الأشخاص المصفّاة) ---- */
const PUR_KEY='salaryAppPurchases';
const getPur=()=>{try{return JSON.parse(localStorage.getItem(PUR_KEY)||'[]')}catch(e){return[]}};
const setPur=a=>{try{localStorage.setItem(PUR_KEY,JSON.stringify(a));return true}catch(e){alert('مساحة التخزين على الجهاز ممتلئة');return false}};
const inMonth=(ts,y,m)=>{const d=new Date(ts);return d.getFullYear()===y&&d.getMonth()===m;};
/* كل التصفيات: المتبقي وقت التصفية (للي اتصفّوا وفاتوا في السجل + اللي متصفّي حاليًا ولسه ما بدأش فترة جديدة) */
function settledList(){
  const out=[];
  (groups||[]).forEach(g=>(g.people||[]).forEach(p=>{
    (p.history||[]).forEach(h=>out.push({name:p.name||'بدون اسم',group:g.name,ts:+h.ts||0,amt:Math.max(0,+h.remaining||0)}));
    if(p.status==='settled'){const c=calcPerson(p);out.push({name:p.name||'بدون اسم',group:g.name,ts:+p.settledTs||0,amt:Math.max(0,c.remaining)});}
  }));
  return out;
}
/* y,m = شهر معيّن، أو null = كل الشهور. العهد محسوبة لحد النهارده بس (زي ما المشرف بيشوفها) */
function custodyRows(y,m){
  const all=getCus(), lim=endOfToday(), rows=[];
  Object.keys(all).forEach(ph=>{
    let t=0;
    Object.keys(all[ph]||{}).forEach(k=>{
      const [yy,mo]=k.split('-').map(Number); if(m!==null&&(yy!==y||mo-1!==m)) return;
      Object.keys(all[ph][k]).forEach(d=>{if(new Date(yy,mo-1,+d)<=lim) t+=(+all[ph][k][d]||0);});
    });
    if(t>0) rows.push({phone:ph,amt:t});
  });
  return rows;
}
function reportFor(y,m){
  const all=(m===null), tr=getTrs(), pur=getPur(), st=settledList();
  const income=all?trsAllTotal():trsSum(tr[mKey(y,m)]);
  const purs=pur.filter(e=>all||e.date.slice(0,7)===mKey(y,m));
  const cus=custodyRows(y,m);
  const sets=st.filter(e=>all||(e.ts&&inMonth(e.ts,y,m)));
  const pT=trsSum(purs), cT=trsSum(cus.map(e=>({amount:e.amt}))), sT=trsSum(sets.map(e=>({amount:e.amt})));
  return {income,purs,cus,sets,pT,cT,sT,spent:pT+cT+sT,balance:income-(pT+cT+sT),undated:all?0:st.filter(e=>!e.ts).length};
}
const stat=(l,v,c)=>'<div style="display:flex;justify-content:space-between;padding:6px 0"><span>'+l+'</span><strong'+(c?' style="color:'+c+'"':'')+'>'+money(v)+'</strong></div>';
window.openSupReports=function(opts){
  if(window.supSession) return;
  const ov=custodyShell('📊 تقارير المشرف'), body=ov.querySelector('.xcBody'), t=new Date(), st={y:t.getFullYear(),m:t.getMonth(),all:false,open:!!(opts&&opts.buy)};
  const draw=()=>{
    const r=reportFor(st.y,st.all?null:st.m), mk=mKey(st.y,st.m);
    const sups=getSups();
    let h='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px"><button id="xrM" class="toggle-btn'+(st.all?'':' active')+'" style="'+(st.all?'':'background:var(--accent);color:#fff')+'">شهر معيّن</button><button id="xrA" class="toggle-btn" style="'+(st.all?'background:var(--accent);color:#fff':'')+'">كل الشهور</button></div>'+
      (st.all?'':navRow(st.y,st.m))+
      '<div style="background:#f4f8f5;border-radius:10px;padding:8px 10px;margin-bottom:10px">'+
      stat('💵 وارد الخزينة',r.income)+
      '<div style="border-top:1px dashed #ccc;margin:4px 0"></div><div style="font-weight:bold;font-size:13px;color:#555">المنصرف حتى الآن</div>'+
      stat('🛒 المشتريات',r.pT)+stat('💰 عهد المشرفين',r.cT)+stat('👷 متبقي الأشخاص المصفّيين',r.sT)+
      '<div style="border-top:1px solid #bbb;margin:4px 0"></div>'+
      stat('إجمالي المنصرف',r.spent,'#c0392b')+
      '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:17px"><span>الرصيد المتبقي</span><strong style="color:'+(r.balance<0?'#c0392b':'#1e7a46')+'">'+money(r.balance)+'</strong></div></div>'+
      (r.undated?'<div style="font-size:12px;color:#888;margin-bottom:8px">ملاحظة: '+r.undated+' تصفية قديمة من غير تاريخ دقيق، بتظهر في "كل الشهور" بس.</div>':'')+
      '<button id="xrBuy" class="add-btn" type="button" style="margin-bottom:8px">🛒 فتح شاشة المشتريات (تسجيل وتعديل)</button>'+
      '<div style="font-weight:bold;margin:8px 0 4px">🛒 المشتريات حسب القسم</div>'+purBreakdownHtml(r.purs)+
      '<div style="font-weight:bold;margin:8px 0 4px">🛒 المشتريات ('+r.purs.length+')</div>'+
      (r.purs.length?r.purs.slice().sort((a,b)=>a.date<b.date?1:-1).map(e=>'<div style="padding:6px 0;border-bottom:1px solid #eee"><div style="display:flex;justify-content:space-between"><span>'+escapeHtml(e.item||'مشتريات')+' <small style="color:#888">('+escapeHtml(purScopeLabel(e.scope))+')</small>'+'</span><strong>'+money(e.amount)+'</strong></div><div style="font-size:12px;color:#888">'+e.date+' <button data-px="'+e.id+'" style="background:none;border:none;color:#c0392b">حذف</button></div></div>').join(''):'<div style="color:#888;font-size:13px">لا يوجد.</div>')+
      '<div style="font-weight:bold;margin:12px 0 4px">💰 العهد لكل مشرف</div>'+
      (r.cus.length?r.cus.map(e=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span>'+e.phone+'</span><strong>'+money(e.amt)+'</strong></div>').join(''):'<div style="color:#888;font-size:13px">لا يوجد.</div>')+
      '<div style="font-weight:bold;margin:12px 0 4px">👷 متبقي الأشخاص اللي اتصفّوا ('+r.sets.length+')</div>'+
      (r.sets.length?r.sets.slice().sort((a,b)=>b.ts-a.ts).map(e=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span>'+escapeHtml(e.name)+' <small style="color:#888">'+escapeHtml(e.group||'')+(e.ts?' • '+new Date(e.ts).toLocaleDateString('ar-EG'):'')+'</small></span><strong>'+money(e.amt)+'</strong></div>').join(''):'<div style="color:#888;font-size:13px">لا يوجد.</div>');
    body.innerHTML=h; st.open=false;
    body.querySelector('#xrM').onclick=()=>{st.all=false;draw();};
    body.querySelector('#xrA').onclick=()=>{st.all=true;draw();};
    if(!st.all) wireNav(ov,st,draw);
    body.querySelector('#xrBuy').onclick=()=>{ov.remove();window.openPurchases();};
    body.querySelectorAll('[data-px]').forEach(b=>b.onclick=async()=>{
      if(!(await showConfirm('حذف المشتريات دي؟'))) return; setPur(getPur().filter(e=>e.id!==b.dataset.px)); draw();
    });
  };
  vaultLive(ov,draw);
  draw();
};
window.addEventListener('load',()=>{
  const anchor=document.getElementById('openReportsBtn'); if(!anchor||document.getElementById('xSupRepBtn')) return;
  const b=document.createElement('button'); b.id='xSupRepBtn'; b.type='button'; b.className='toggle-btn full-btn'; b.style.marginBottom='8px'; b.textContent='📊 تقارير المشرف';
  b.onclick=()=>window.openSupReports(); anchor.insertAdjacentElement('beforebegin',b);
});

/* ---- باسورد الأدمن: تغيير بباسورد قوي (محلي أو Supabase حسب وضع التشغيل) ---- */
window.openAdminPassword=function(){
  if(window.supSession||!window.AdminPw) return;
  const cloud=!!(window.SALARY_CLOUD_WANTED&&window.cloudChangePassword);
  const ov=custodyShell('🔑 باسورد الأدمن'), body=ov.querySelector('.xcBody');
  const inp='style="width:100%;box-sizing:border-box;margin-top:6px"';
  body.innerHTML=
    '<div style="font-size:13px;color:#666;margin-bottom:8px">'+(cloud?'ده باسورد دخولك بالإيميل على كل الأجهزة.':'ده الباسورد اللي بتفتح بيه التطبيق على الجهاز ده.')+'</div>'+
    '<input id="xaCur" type="password" autocomplete="current-password" placeholder="الباسورد الحالي" '+inp+'>'+
    '<input id="xaNew" type="password" autocomplete="new-password" placeholder="الباسورد الجديد (10 أحرف على الأقل)" '+inp+'>'+
    '<div style="height:6px;background:#eee;border-radius:3px;margin-top:6px;overflow:hidden"><div id="xaBar" style="height:100%;width:0;background:#c0392b;transition:width .2s"></div></div>'+
    '<div id="xaMsg" style="font-size:12px;color:#888;min-height:32px;margin-top:4px">اكتب باسورد جديد أو اضغط اقتراح.</div>'+
    '<input id="xaRep" type="password" autocomplete="new-password" placeholder="أكّد الباسورد الجديد" '+inp+'>'+
    '<div style="display:flex;gap:6px;margin-top:8px"><button id="xaGen" class="toggle-btn" type="button" style="flex:1">🎲 اقتراح باسورد قوي</button><button id="xaShow" class="toggle-btn" type="button">👁</button></div>'+
    '<div id="xaErr" style="color:#c0392b;font-size:12px;min-height:16px;margin-top:6px"></div>'+
    '<button id="xaSave" class="add-btn" type="button">حفظ الباسورد الجديد</button>';
  const $q=x=>body.querySelector(x), nw=$q('#xaNew'), rp=$q('#xaRep'), cur=$q('#xaCur');
  const colors=['#c0392b','#e67e22','#d4a017','#4caf50','#1e7a46'];
  const meter=()=>{const st=AdminPw.strength(nw.value);$q('#xaBar').style.width=nw.value?(20+st.score*20)+'%':'0';$q('#xaBar').style.background=colors[st.score];
    $q('#xaMsg').textContent=!nw.value?'اكتب باسورد جديد أو اضغط اقتراح.':st.ok?(st.score>=3?'باسورد قوي ✓':'مقبول ✓ (كل ما كان أطول كان أقوى)'):'ناقص: '+st.miss.join(' • ');};
  nw.oninput=meter;
  $q('#xaGen').onclick=()=>{const g=AdminPw.generate(16);nw.value=g;rp.value=g;nw.type='text';rp.type='text';meter();$q('#xaErr').textContent='';$q('#xaMsg').textContent+=' — اكتبه في مكان آمن قبل ما تحفظ.';};
  $q('#xaShow').onclick=()=>{const t=nw.type==='password'?'text':'password';nw.type=t;rp.type=t;cur.type=t;};
  $q('#xaSave').onclick=async()=>{
    const err=$q('#xaErr'), st=AdminPw.strength(nw.value);
    if(!cur.value) return err.textContent='اكتب الباسورد الحالي';
    if(!st.ok) return err.textContent='الباسورد ضعيف: '+st.miss[0];
    if(nw.value!==rp.value) return err.textContent='الباسورد الجديد مش متطابق';
    if(nw.value===cur.value) return err.textContent='الباسورد الجديد لازم يختلف عن الحالي';
    err.style.color='#888'; err.textContent='جاري الحفظ…';
    try{
      if(cloud){ const r=await window.cloudChangePassword(cur.value,nw.value); if(!r.ok){err.style.color='#c0392b';return err.textContent=r.msg;} }
      else { if(!(await AdminPw.verify(cur.value))){err.style.color='#c0392b';return err.textContent='الباسورد الحالي غلط';} await AdminPw.set(nw.value); }
      body.innerHTML='<div style="padding:12px 0;color:#1e7a46;font-weight:bold">تم تغيير الباسورد ✅</div><div style="font-size:13px;color:#666">'+(cloud?'استخدمه في تسجيل الدخول من أي جهاز.':'استخدمه عند فتح التطبيق المرة الجاية.')+'</div>';
    }catch(e){err.style.color='#c0392b';err.textContent='تعذر الحفظ: '+(e&&e.message||e);}
  };
};
window.addEventListener('load',()=>{
  const anchor=document.getElementById('supervisorSettingsBtn'); if(!anchor||document.getElementById('xAdminPwBtn')) return;
  const b=document.createElement('button'); b.id='xAdminPwBtn'; b.type='button'; b.className='toggle-btn full-btn'; b.style.marginBottom='8px'; b.textContent='🔑 باسورد الأدمن';
  b.onclick=()=>window.openAdminPassword(); anchor.insertAdjacentElement('beforebegin',b);
});

/* ---- تقارير الأدمن: كام وصلني لحد دلوقتي + ملخص المنصرف والرصيد ---- */
window.openAdminReport=function(){
  if(window.supSession) return;
  const ov=custodyShell('📈 تقارير الأدمن'), body=ov.querySelector('.xcBody');
  const draw=()=>{
    const t=new Date(), todayStr=todayISO(), cm=mKey(t.getFullYear(),t.getMonth());
    const tr=getTrs(), all=[]; Object.keys(tr).forEach(k=>(tr[k]||[]).forEach(e=>all.push(e)));
    const upto=all.filter(e=>e.date<=todayStr), future=all.filter(e=>e.date>todayStr);
    const recvT=trsSum(upto), monthT=trsSum(upto.filter(e=>e.date.slice(0,7)===cm));
    const sp=reportFor(null,null), balance=recvT-sp.spent;
    const last=upto.slice().sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:b.ts-a.ts)[0];
    const byM={}; upto.forEach(e=>{const k=e.date.slice(0,7);(byM[k]=byM[k]||[]).push(e);});
    const ks=Object.keys(byM).sort().reverse();
    let h='<div style="background:#f4f8f5;border-radius:12px;padding:12px;margin-bottom:10px">'+
      '<div style="font-size:13px;color:#555">إجمالي اللي وصلني لحد دلوقتي</div>'+
      '<div style="font-size:26px;font-weight:bold;margin:2px 0">'+money(recvT)+'</div>'+
      '<div style="font-size:12px;color:#666">'+upto.length+' دفعة'+(last?' • آخر دفعة '+money(last.amount)+' بتاريخ '+last.date:'')+'</div></div>'+
      stat('📅 وصلني الشهر ده ('+monthLabel(t.getFullYear(),t.getMonth())+')',monthT)+
      '<div style="border-top:1px dashed #ccc;margin:6px 0"></div>'+
      stat('🛒 المشتريات',sp.pT)+stat('💰 عهد المشرفين',sp.cT)+stat('👷 متبقي الأشخاص المصفّيين',sp.sT)+
      stat('إجمالي المنصرف',sp.spent,'#c0392b')+
      '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:17px"><span>الرصيد المتبقي</span><strong style="color:'+(balance<0?'#c0392b':'#1e7a46')+'">'+money(balance)+'</strong></div>'+
      (future.length?'<div style="font-size:12px;color:#888;margin-top:4px">فيه '+future.length+' دفعة بتاريخ جاي ('+money(trsSum(future))+') مش محسوبة لحد ما ييجي تاريخها.</div>':'')+
      '<div style="font-weight:bold;margin:12px 0 4px">🛒 المشتريات حسب القسم</div>'+purBreakdownHtml(sp.purs)+
      '<div style="font-weight:bold;margin:12px 0 4px">الوارد لكل شهر</div>'+
      (ks.length?ks.map(k=>{const [y,mo]=k.split('-').map(Number);return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span>'+monthLabel(y,mo-1)+' <small style="color:#888">('+byM[k].length+' دفعة)</small></span><strong>'+money(trsSum(byM[k]))+'</strong></div>';}).join(''):'<div style="color:#888;font-size:13px">لا توجد دفعات مسجلة لسه.</div>')+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px"><button id="xarT" class="toggle-btn" type="button">🏦 الخزينة</button><button id="xarB" class="toggle-btn" type="button">🛒 المشتريات</button></div>';
    body.innerHTML=h;
    body.querySelector('#xarT').onclick=()=>{ov.remove();window.openTreasury();};
    body.querySelector('#xarB').onclick=()=>{ov.remove();window.openPurchases();};
  };
  vaultLive(ov,draw); draw();
};
window.addEventListener('load',()=>{
  const anchor=document.getElementById('xTreasuryBtn')||document.getElementById('openReportsBtn'); if(!anchor||document.getElementById('xAdminRepBtn')) return;
  const b=document.createElement('button'); b.id='xAdminRepBtn'; b.type='button'; b.className='toggle-btn full-btn'; b.style.marginBottom='8px'; b.textContent='📈 تقارير الأدمن';
  b.onclick=()=>window.openAdminReport(); anchor.insertAdjacentElement('beforebegin',b);
});

/* ---- وضع المشاهد (قراءة فقط): نفس شاشات الأدمن من غير أي تعديل. الحماية الحقيقية على السيرفر (RLS)، ودي طبقة واجهة فوقها ---- */
(function(){
  const BLOCK='.dayChk,.settleCheck,.removeBtn,.statusActionBtn,.media-remove,.registerFaceBtn,#addPersonBtn,#addGroupBtn,#renameGroupBtn,#faceAttendanceBtn,.xNote';
  function lockInputs(root){
    (root||document).querySelectorAll('#screenGroups input,#screenGroups select,#screenGroups textarea,#screenGroup input,#screenGroup select,#screenGroup textarea,#peopleContainer input,#peopleContainer select,#peopleContainer textarea').forEach(el=>{
      if(el.id==='codeSearchInput'||el.type==='file') return;
      el.disabled=true; el.readOnly=true;
    });
  }
  window.initViewerMode=function(){
    document.body.classList.add('view-mode');
    const rb=document.getElementById('roleBadge'); if(rb) rb.textContent='👁 مشاهد (قراءة فقط)';
    if(!document.getElementById('viewStyle')){
      const st=document.createElement('style'); st.id='viewStyle';
      st.textContent='body.view-mode #xBackupBtn,body.view-mode #xTreasuryBtn,body.view-mode #xPurBtn,body.view-mode #xAdminRepBtn,body.view-mode #xSupRepBtn,body.view-mode #xAdminPwBtn,body.view-mode #xViewersBtn,body.view-mode #supervisorSettingsBtn,body.view-mode #addGroupBtn,body.view-mode #renameGroupBtn,body.view-mode #addPersonBtn,body.view-mode #faceAttendanceBtn,body.view-mode .xNote,body.view-mode .removeBtn,body.view-mode .settleCheck,body.view-mode .statusActionBtn,body.view-mode .registerFaceBtn,body.view-mode .media-remove,body.view-mode .xGallery label,body.view-mode .weekday-select-row{display:none!important}'+
        'body.view-mode #peopleContainer input:disabled,body.view-mode #peopleContainer select:disabled{opacity:1;-webkit-text-fill-color:currentColor}'+
        '#viewBanner{background:#eef4ff;color:#2a4d8f;border-radius:10px;padding:8px 12px;margin:8px 0;font-size:13px}';
      document.head.appendChild(st);
    }
    const tb=document.querySelector('#appContent .topbar');
    if(tb&&!document.getElementById('viewBanner')){const d=document.createElement('div');d.id='viewBanner';d.textContent='وضع المشاهدة: تقدر تشوف كل البيانات لكن مينفعش تعدّل.';tb.insertAdjacentElement('afterend',d);}
    // أي محاولة تعديل بتتمنع قبل ما توصل للتطبيق
    document.addEventListener('click',e=>{
      const t=e.target; if(!t||!t.closest) return;
      if((t.matches&&t.matches('input[type=file]'))||t.closest(BLOCK)){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();}
    },true);
    document.addEventListener('change',e=>{ if(e.target&&e.target.id!=='codeSearchInput'){e.stopImmediatePropagation();} },true);
    document.addEventListener('input',e=>{ if(e.target&&e.target.id!=='codeSearchInput'){e.stopImmediatePropagation();} },true);
    const ac=document.getElementById('appContent');
    if(ac) new MutationObserver(()=>lockInputs(ac)).observe(ac,{childList:true,subtree:true});
    lockInputs(document);
    if(typeof renderGroupsScreen==='function') renderGroupsScreen();
  };
})();

/* ---- المشتريات: لكل مجموعة مشترياتها + بند مشتريات الشركة (أدمن فقط، متزامنة) ---- */
function purScopeLabel(sc){
  if(sc==='company') return '🏢 مشتريات الشركة';
  if(!sc) return 'غير مصنّفة';
  const g=(groups||[]).find(x=>x.id===sc); return g?g.name:'مجموعة محذوفة';
}
function purBreakdown(list){
  const m={}; (list||[]).forEach(e=>{const k=e.scope||'';m[k]=(m[k]||0)+(+e.amount||0);});
  return Object.keys(m).map(k=>({scope:k,label:purScopeLabel(k),amt:m[k]})).sort((a,b)=>b.amt-a.amt);
}
function purBreakdownHtml(list){
  const r=purBreakdown(list);
  return r.length?r.map(x=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span>'+escapeHtml(x.label)+'</span><strong>'+money(x.amt)+'</strong></div>').join(''):'<div style="color:#888;font-size:13px">لا يوجد.</div>';
}
window.openPurchases=function(opts){
  if(window.supSession||window.viewSession) return;
  const ov=custodyShell('🛒 المشتريات'), body=ov.querySelector('.xcBody'), t=new Date();
  const st={y:t.getFullYear(),m:t.getMonth(),all:false,scope:'all',edit:null};
  const inp='style="width:100%;box-sizing:border-box;margin-top:6px"';
  const draw=()=>{
    const all=getPur(), mk=mKey(st.y,st.m);
    const pm=all.filter(e=>st.all||String(e.date).slice(0,7)===mk);
    const sc=new Set(['company']); (groups||[]).forEach(g=>sc.add(g.id)); pm.forEach(e=>{ if(e.scope) sc.add(e.scope); });
    const hasNone=pm.some(e=>!e.scope);
    const tot=k=>trsSum(pm.filter(e=>(e.scope||'')===k).map(e=>e));
    const chips=[{k:'all',l:'الكل',a:trsSum(pm)}].concat([...sc].map(k=>({k:k,l:purScopeLabel(k),a:tot(k)}))).concat(hasNone?[{k:'none',l:'غير مصنّفة',a:tot('')}]:[]);
    if(!chips.some(c=>c.k===st.scope)) st.scope='all';
    const shown=pm.filter(e=>st.scope==='all'||(st.scope==='none'?!e.scope:e.scope===st.scope));
    const ed=st.edit?all.find(e=>e.id===st.edit):null;
    const defScope=ed?(ed.scope||'company'):(st.scope==='all'||st.scope==='none'?'company':st.scope);
    const defDate=ed?ed.date:(t.getFullYear()===st.y&&t.getMonth()===st.m?todayISO():mk+'-01');
    const opt=(v,l)=>'<option value="'+escapeHtml(v)+'"'+(v===defScope?' selected':'')+'>'+escapeHtml(l)+'</option>';
    let h='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px"><button id="xuM" class="toggle-btn" type="button" style="'+(st.all?'':'background:var(--accent);color:#fff')+'">شهر معيّن</button><button id="xuA" class="toggle-btn" type="button" style="'+(st.all?'background:var(--accent);color:#fff':'')+'">كل الشهور</button></div>'+
      (st.all?'':navRow(st.y,st.m))+
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'+chips.map(c=>'<button type="button" data-sc="'+escapeHtml(c.k)+'" class="toggle-btn" style="padding:6px 10px;font-size:12px;'+(c.k===st.scope?'background:var(--accent);color:#fff;':'')+'">'+escapeHtml(c.l)+(c.a?' • '+money(c.a):'')+'</button>').join('')+'</div>'+
      '<div style="background:#f4f8f5;border-radius:10px;padding:8px 10px;margin-bottom:10px;display:flex;justify-content:space-between"><span>إجمالي '+escapeHtml(chips.find(c=>c.k===st.scope).l)+'</span><strong style="font-size:18px">'+money(trsSum(shown))+'</strong></div>'+
      '<div style="border:1px solid #eee;border-radius:10px;padding:10px;margin-bottom:10px"><div style="font-weight:bold">'+(ed?'تعديل مشتريات':'مشتريات جديدة')+'</div>'+
      '<input id="xuAmt" type="number" inputmode="decimal" min="0" placeholder="المبلغ" value="'+(ed?ed.amount:'')+'" '+inp+'>'+
      '<input id="xuItem" type="text" placeholder="البند (إيه اللي اتشرى)" value="'+(ed?escapeHtml(ed.item||''):'')+'" '+inp+'>'+
      '<select id="xuScope" '+inp+'>'+opt('company','🏢 مشتريات الشركة')+(groups||[]).map(g=>opt(g.id,'مجموعة: '+g.name)).join('')+'</select>'+
      '<input id="xuDate" type="date" value="'+defDate+'" '+inp+'>'+
      '<div id="xuErr" style="color:#c0392b;font-size:12px;min-height:16px"></div>'+
      '<button id="xuSave" class="add-btn" type="button">'+(ed?'حفظ التعديل':'+ تسجيل')+'</button>'+(ed?'<button id="xuCancel" class="toggle-btn full-btn" type="button" style="margin-top:6px">إلغاء التعديل</button>':'')+'</div>'+
      (shown.length?shown.slice().sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:(b.ts||0)-(a.ts||0)).map(e=>'<div style="padding:8px 0;border-bottom:1px solid #eee"><div style="display:flex;justify-content:space-between"><span>'+escapeHtml(e.item||'مشتريات')+'</span><strong>'+money(e.amount)+'</strong></div><div style="font-size:12px;color:#888">'+escapeHtml(purScopeLabel(e.scope))+' • '+e.date+'</div><div><button data-e="'+e.id+'" style="background:none;border:none;color:var(--accent)">✎ تعديل</button><button data-x="'+e.id+'" style="background:none;border:none;color:#c0392b">حذف</button></div></div>').join(''):'<div style="color:#888;padding:8px 0">لا توجد مشتريات هنا.</div>');
    body.innerHTML=h;
    body.querySelector('#xuM').onclick=()=>{st.all=false;draw();};
    body.querySelector('#xuA').onclick=()=>{st.all=true;draw();};
    if(!st.all) wireNav(ov,st,()=>{st.edit=null;draw();});
    body.querySelectorAll('[data-sc]').forEach(b=>b.onclick=()=>{st.scope=b.dataset.sc;st.edit=null;draw();});
    body.querySelector('#xuSave').onclick=()=>{
      const amt=parseFloat(body.querySelector('#xuAmt').value), date=body.querySelector('#xuDate').value, err=body.querySelector('#xuErr'), scope=body.querySelector('#xuScope').value;
      if(!(amt>0)) return err.textContent='اكتب مبلغ صحيح';
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err.textContent='اختار التاريخ';
      const rec={amount:amt,date:date,item:body.querySelector('#xuItem').value.trim(),scope:scope,upd:Date.now()};
      const a=getPur();
      if(ed){ const i=a.findIndex(e=>e.id===ed.id); if(i>=0){ a[i]=Object.assign({},a[i],rec); } }
      else { rec.id='p'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); rec.ts=Date.now(); a.push(rec); }
      if(!setPur(a)) return;
      const [yy,mm]=date.split('-').map(Number); if(!st.all){st.y=yy;st.m=mm-1;} st.scope=scope; st.edit=null; draw();
    };
    const c=body.querySelector('#xuCancel'); if(c) c.onclick=()=>{st.edit=null;draw();};
    body.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{st.edit=b.dataset.e;draw();body.scrollIntoView();});
    body.querySelectorAll('[data-x]').forEach(b=>b.onclick=async()=>{
      if(!(await showConfirm('حذف المشتريات دي؟'))) return; setPur(getPur().filter(e=>e.id!==b.dataset.x)); st.edit=null; draw();
    });
  };
  if(opts&&opts.scope) st.scope=opts.scope;
  vaultLive(ov,draw); draw();
};
window.addEventListener('load',()=>{
  const anchor=document.getElementById('xSupRepBtn')||document.getElementById('openReportsBtn'); if(!anchor||document.getElementById('xPurBtn')) return;
  const b=document.createElement('button'); b.id='xPurBtn'; b.type='button'; b.className='toggle-btn full-btn'; b.style.marginBottom='8px'; b.textContent='🛒 المشتريات';
  b.onclick=()=>window.openPurchases(); anchor.insertAdjacentElement('beforebegin',b);
});

/* ---- أدوات مشتركة ---- */
const nrmName=s=>String(s||'').replace(/[\u064B-\u065F\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/\s+/g,' ').trim().toLowerCase();
function stripGroupCodes(){let ch=false;(groups||[]).forEach(g=>{if('code' in g){delete g.code;ch=true;}}); if(ch) saveGroups(); try{localStorage.removeItem('salaryAppDailyDraft')}catch(e){}}
const origRG=window.renderGroupsScreen;
window.renderGroupsScreen=function(){stripGroupCodes(); return origRG.apply(this,arguments);};

/* ---- نوتة المجموعة: اكتب أسماء الأشخاص وتتسجل في المجموعة ---- */
function parseNames(txt){
  const seen=new Set(), out=[];
  String(txt||'').split(/[\n\r,،;؛]+/).forEach(x=>{
    const n=x.replace(/^\s*[\d٠-٩]+\s*[-.)\u066B]\s*/,'').replace(/\s+/g,' ').trim();
    const k=nrmName(n); if(!n||seen.has(k)) return; seen.add(k); out.push(n);
  });
  return out;
}
function newPerson(name){
  return {name:name,rate:0,expenses:0,dailyExpenses:[],days:[],overtime:[],phone:'',idCardImg:'',paymentImg:'',faceDescriptor:null,history:[],status:'active',settledDate:'',settledTs:''};
}
function openNotebook(gid){
  if(isSup()&&!supOwns(gid)) return;
  if(isSup()&&supBlocked()) return;
  const g=groups.find(x=>x.id===gid); if(!g) return;
  const ov=custodyShell('📝 نوتة '+escapeHtml(g.name)), body=ov.querySelector('.xcBody');
  body.innerHTML='<div style="font-size:13px;color:#666;margin-bottom:8px">اكتب اسم كل شخص في سطر. بيتسجل حضور النهارده للأشخاص اللي ليهم كرت في المجموعة دي بس، واللي مالوش كرت بيظهر بالأحمر ومش بيتسجل.</div>'+
    '<textarea id="xnTxt" rows="9" placeholder="مثال:&#10;أحمد محمود&#10;محمد علي" style="width:100%;box-sizing:border-box;padding:10px;font:inherit;border:1px solid #ddd;border-radius:10px"></textarea>'+
    '<button id="xnSave" class="add-btn" type="button" style="margin-top:8px">تسجيل الأسماء وحضور النهارده</button><div id="xnRes" style="margin-top:10px;font-size:13px;line-height:1.7"></div>';
  body.querySelector('#xnSave').onclick=()=>{
    const names=parseNames(body.querySelector('#xnTxt').value), res=body.querySelector('#xnRes');
    if(!names.length){res.textContent='اكتب اسم واحد على الأقل.'; return;}
    g.people=g.people||[]; const di=new Date().getDate()-1, unknown=[], marked=[], was=[], settled=[];
    names.forEach(n=>{
      const ex=g.people.find(p=>nrmName(p.name)===nrmName(n));
      if(!ex) unknown.push(n);
      else if(ex.status==='settled') settled.push(n);
      else if(ex.days&&ex.days[di]) was.push(n);
      else {if(!ex.days) ex.days=[]; ex.days[di]=true; marked.push(n);}
    });
    if(marked.length){
      saveGroups();
      const nm=new Set(marked.map(nrmName));
      xLogGps(g.people.filter(p=>nm.has(nrmName(p.name))));
    }
    body.querySelector('#xnTxt').value=unknown.join('\n');   // الأسماء اللي مالهاش كرت بتفضل قدامك عشان تصحّحها أو تعمل لها كرت
    const li=(t,a)=>a.length?'<div>'+t+' ('+a.length+'): '+escapeHtml(a.join('، '))+'</div>':'';
    res.innerHTML=(unknown.length?'<div style="background:#fdecea;color:#c0392b;border:1px solid #f0c9c2;border-radius:10px;padding:8px 10px;margin-bottom:8px;font-weight:bold">⚠️ مالهمش كرت في المجموعة، ومتسجلش لهم حضور ('+unknown.length+'): '+escapeHtml(unknown.join('، '))+'<div style="font-weight:normal;font-size:12px;margin-top:4px">اعمل لهم كرت من المجموعة الأول (+ إضافة شخص) أو صحّح الاسم، وبعدها سجّلهم تاني.</div></div>':'')+li('اتسجل حضورهم النهارده',marked)+li('كان حضورهم متسجل قبل كده',was)+li('حسابهم متصفّي ومتسجلش لهم حضور',settled);
    if(marked.length) renderGroupsScreen();
  };
}
function addNoteButtons(){
  document.querySelectorAll('#groupsContainer .group-card').forEach((c,i)=>{
    const g=groups[i]; if(!g) return;
    if(isSup()&&!supOwns(g.id)){ c.remove(); return; }
    if(c.querySelector('.xNote')) return;
    const b=document.createElement('button'); b.type='button'; b.className='xNote'; b.textContent='📝 النوتة';
    b.style.cssText='margin:0 8px;padding:6px 8px;font-size:12px;white-space:nowrap;background:none;border:1px solid var(--accent);color:var(--accent);border-radius:8px';
    b.onclick=e=>{e.stopPropagation(); openNotebook(g.id);};
    c.insertBefore(b,c.querySelector('.gremaining'));
  });
  if(isSup()) supGroupsExtras();
}
const origRG2=window.renderGroupsScreen;
window.renderGroupsScreen=function(){const r=origRG2.apply(this,arguments); addNoteButtons(); return r;};

/* ---- وضع المشرف: يشوف مجموعته كاملة بصلاحيات محدودة، ونافذة تسجيل من 6 صباحًا لـ 12 منتصف الليل ---- */
function isSup(){return !!window.supSession;}
function supOwns(gid){return isSup()&&(window.supSession.groupIds||[]).includes(gid);}
function supClosed(){return isSup()&&new Date().getHours()<6;}
function supTodayIdx(){return new Date().getDate()-1;}
const SUP_CLOSED_MSG='التسجيل مقفول دلوقتي. متاح من ٦ الصبح لحد ١٢ منتصف الليل. للتعديل كلّم المدير.';
function supBlocked(){ if(supClosed()){ showConfirm(SUP_CLOSED_MSG); return true; } return false; }
function supInstallStyle(){
  if(document.getElementById('supStyle')) return;
  const st=document.createElement('style'); st.id='supStyle';
  st.textContent='body.sup-mode #openReportsBtn,body.sup-mode #xTreasuryBtn,body.sup-mode #xPurBtn,body.sup-mode #xAdminRepBtn,body.sup-mode #xAdminPwBtn,body.sup-mode #xSupRepBtn,body.sup-mode #supervisorSettingsBtn,body.sup-mode #openFullReportBtn,body.sup-mode #addGroupBtn,body.sup-mode #renameGroupBtn,body.sup-mode #screenGroups .summary,body.sup-mode .weekday-select-row,body.sup-mode .removeBtn,body.sup-mode .settleCheck,body.sup-mode .statusActionBtn{display:none!important}'+
    'body.sup-mode .supLockedBox{pointer-events:none;opacity:.55}'+
    '#supBanner{background:#fdecea;color:#c0392b;border-radius:10px;padding:10px 12px;margin:8px 0;font-size:13px;display:none}';
  document.head.appendChild(st);
}
function supBanner(){
  let b=document.getElementById('supBanner');
  if(!b){ b=document.createElement('div'); b.id='supBanner'; const tb=document.querySelector('#appContent .topbar'); if(tb) tb.insertAdjacentElement('afterend',b); }
  b.textContent=SUP_CLOSED_MSG; b.style.display=supClosed()?'block':'none';
}
/* بطاقة الشخص: اليومية والأوفر تايم للأدمن بس، واليوم الحالي بس هو اللي يتعدّل */
const origRPC=window.renderPersonCard;
window.renderPersonCard=function(data,idx){
  const r=origRPC.apply(this,arguments);
  if(isSup()) supLockCard(document.getElementById('peopleContainer').lastElementChild);
  return r;
};
function supLockCard(card){
  if(!card) return; const closed=supClosed(), ti=supTodayIdx();
  const rate=card.querySelector('.dayRate'); if(rate){rate.readOnly=true; rate.classList.add('readonlyField');}
  card.querySelectorAll('.dayOt').forEach(s=>{s.disabled=true;});
  card.querySelectorAll('.dayChk').forEach((b,i)=>{ if(closed||i!==ti) b.disabled=true; });
  card.querySelectorAll('.dayExpense').forEach((x,i)=>{ if(closed||i!==ti){x.disabled=true; x.classList.add('lockedField');} });
  if(closed){
    ['.pName','.pPhone'].forEach(s=>{const e=card.querySelector(s); if(e) e.disabled=true;});
    card.querySelectorAll('.registerFaceBtn').forEach(b=>{b.disabled=true;});
    card.querySelectorAll('.profileBox,.idCardBox,.paymentBox,.xGallery').forEach(b=>b.classList.add('supLockedBox'));
  }
}
const origRP=window.renderPeople;
window.renderPeople=function(){ const r=origRP.apply(this,arguments); if(isSup()) supGroupControls(); return r; };
function supGroupControls(){
  const closed=supClosed();
  ['addPersonBtn','faceAttendanceBtn'].forEach(id=>{const b=document.getElementById(id); if(b){b.disabled=closed; b.style.opacity=closed?'.5':'';}});
  if(!document.getElementById('xSupBar')){
    const fb=document.getElementById('faceAttendanceBtn'); if(fb){
      const bar=document.createElement('div'); bar.id='xSupBar';
      const mk=(t,f)=>{const b=document.createElement('button'); b.type='button'; b.className='toggle-btn full-btn'; b.textContent=t; b.onclick=f; bar.appendChild(b);};
      mk('📝 النوتة',()=>{ if(currentGroupId) openNotebook(currentGroupId); });
      mk('💰 إجمالي المصاريف',supExpTotal);
      mk('💰 عهدتي',()=>window.openCustodyMine());
      fb.insertAdjacentElement('beforebegin',bar);
    }
  }
  supBanner();
}
function supExpTotal(){
  const g=currentGroup(); if(!g||!supOwns(g.id)) return;
  const ov=custodyShell('💰 مصاريف '+escapeHtml(g.name)), body=ov.querySelector('.xcBody'); let tot=0;
  const rows=(g.people||[]).map(p=>{ let s=0; (p.dailyExpenses||[]).forEach(v=>{s+=parseFloat(v)||0;}); tot+=s; return {n:p.name||'بدون اسم',s:s}; }).filter(r=>r.s>0);
  body.innerHTML=(rows.length?rows.map(r=>'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee"><span>'+escapeHtml(r.n)+'</span><strong>'+money(r.s)+'</strong></div>').join(''):'<div style="color:#888;padding:8px 0">لا توجد مصاريف مسجلة</div>')+
    '<div style="margin-top:10px;display:flex;justify-content:space-between"><span>إجمالي مصاريف كل الأشخاص (الفترة الحالية)</span><strong>'+money(tot)+'</strong></div>';
}
/* المجموعات: مجموعات المشرف بس */
const origOG=window.openGroup;
window.openGroup=function(id){ if(isSup()&&!supOwns(id)) return; return origOG.apply(this,arguments); };
const origMark2=window.markPersonPresentToday;
window.markPersonPresentToday=function(){ if(isSup()&&supBlocked()) return; return origMark2.apply(this,arguments); };
const origFC=window.openFaceCapture;
window.openFaceCapture=function(){ if(isSup()&&supBlocked()) return; return origFC.apply(this,arguments); };
function supGroupsExtras(){
  const sg=document.getElementById('screenGroups'), gc=document.getElementById('groupsContainer');
  if(sg&&gc&&!document.getElementById('xCustodyBtn')){
    const b=document.createElement('button'); b.id='xCustodyBtn'; b.type='button'; b.className='toggle-btn full-btn'; b.style.marginBottom='12px'; b.textContent='💰 عهدتي';
    b.onclick=()=>window.openCustodyMine(); gc.insertAdjacentElement('beforebegin',b);
  }
  if(gc&&!gc.children.length) gc.innerHTML='<div class="empty-note">لا توجد مجموعات مخصصة لك. كلم المدير.</div>';
  supBanner();
}
/* فتح/قفل النافذة تلقائيًا عند 6 صباحًا و12 منتصف الليل */
let supLast=null;
const supStamp=()=>(supClosed()?'closed':'open')+'|'+new Date().toDateString();
function supTick(){
  if(!isSup()) return; const c=supStamp(); if(c===supLast) return; supLast=c;
  const sgp=document.getElementById('screenGroup');
  if(sgp&&sgp.style.display==='block'&&currentGroupId) renderPeople(); else renderGroupsScreen();
  supBanner();
}
window.initSupervisorMode=function(){
  document.getElementById('roleBadge').textContent='👷 المشرف';
  document.body.classList.add('sup-mode');
  const bk=document.getElementById('xBackupBtn'); if(bk) bk.style.display='none';
  const sc=document.getElementById('supervisorContent'); if(sc) sc.style.display='none';
  supInstallStyle(); supLast=supStamp(); setInterval(supTick,30000); document.addEventListener('visibilitychange',()=>{ if(!document.hidden) supTick(); });
  const own=(groups||[]).filter(g=>supOwns(g.id));
  if(own.length<=1){ const bb=document.getElementById('backToGroupsBtn'); if(bb) bb.style.visibility='hidden'; }
  renderGroupsScreen();
};
const origRG3=window.renderGroupsScreen;
window.renderGroupsScreen=function(){
  if(isSup()){ const own=(groups||[]).filter(g=>supOwns(g.id)); if(own.length===1) return window.openGroup(own[0].id); }
  return origRG3.apply(this,arguments);
};
})();
