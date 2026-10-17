/* المزامنة الأونلاين (Supabase) — أي تسجيل من أي مشرف يظهر عند الأدمن لحظيًا.
   الملف مقسوم: (1) محرك المزامنة (منطق صرف، قابل للاختبار) (2) الربط بالتطبيق والواجهة. */
(function (root) {
'use strict';

/* ======================= (1) المحرك ======================= */
const IMG_PREFIX = 'sbimg:';

function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function makeImageIndex() {
  const urlToRef = new Map(), refToUrl = new Map();
  return {
    refOf(url) {
      let r = urlToRef.get(url);
      if (!r) {
        r = IMG_PREFIX + cyrb53(url).toString(36) + '-' + url.length.toString(36);
        urlToRef.set(url, r); refToUrl.set(r, url);
      }
      return r;
    },
    urlOf: r => refToUrl.get(r),
    has: r => refToUrl.has(r),
    add(ref, url) { refToUrl.set(ref, url); urlToRef.set(url, ref); }
  };
}

const isImgData = v => typeof v === 'string' && v.length > 256 && v.startsWith('data:');

function sortKeys(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = {}; Object.keys(v).sort().forEach(k => { o[k] = v[k]; }); return o;
  }
  return v;
}
// JSON ثابت الترتيب (للمقارنة) وبدون الصور (الصور بتتبدل بمراجع)
function stripCanon(obj, idx, onImg) {
  return JSON.stringify(obj, (k, v) => {
    if (isImgData(v)) { const r = idx.refOf(v); if (onImg) onImg(r, v); return r; }
    return sortKeys(v);
  });
}
function canon(obj) { return JSON.stringify(obj, (k, v) => sortKeys(v)); }

function collectRefs(obj, out) {
  out = out || new Set();
  const walk = v => {
    if (typeof v === 'string') { if (v.startsWith(IMG_PREFIX)) out.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k]));
  };
  walk(obj); return out;
}

const MISSING = { missing: true };
function hydrate(obj, idx) {
  const walk = v => {
    if (typeof v === 'string') {
      if (v.startsWith(IMG_PREFIX)) { const u = idx.urlOf(v); return u === undefined ? MISSING : u; }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk).filter(x => x !== MISSING);
    if (v && typeof v === 'object') {
      const o = {}; Object.keys(v).forEach(k => { const r = walk(v[k]); o[k] = r === MISSING ? '' : r; }); return o;
    }
    return v;
  };
  return walk(obj);
}

/* ---- دمج ثلاثي (قاعدة / محلي / بعيد) على مستوى كل حقل ---- */
const POSITIONAL = ['days', 'overtime', 'dailyExpenses'];
const SETLIKE = ['transferImgs', 'receiptImgs', 'gpsLog'];
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergePositional(base, local, remote) {
  const n = Math.max(local.length, remote.length, (base || []).length), out = [];
  for (let i = 0; i < n; i++) {
    const b = base ? base[i] : undefined, l = local[i], r = remote[i];
    out[i] = (l !== undefined && !deepEq(l, b)) ? l : (r !== undefined ? r : l);
  }
  while (out.length && out[out.length - 1] === undefined) out.pop();
  return out.map(x => x === undefined ? '' : x);
}
function mergeSetLike(base, local, remote) {
  const key = x => typeof x === 'string' ? x : JSON.stringify(x);
  const b = new Set((base || []).map(key)), l = new Set(local.map(key));
  const removed = new Set((base || []).filter(x => !l.has(key(x))).map(key));
  const out = remote.filter(x => !removed.has(key(x)));
  const have = new Set(out.map(key));
  local.filter(x => !b.has(key(x))).forEach(x => { if (!have.has(key(x))) { out.push(x); have.add(key(x)); } });
  return out;
}
const PROTECTED = ['rate', 'overtime', 'status', 'history', 'settledDate', 'settledTs'];
function merge3(base, local, remote, protectedKeys) {
  base = base || {};
  const out = Object.assign({}, remote);
  let expChanged = false;
  Object.keys(local).forEach(k => {
    if (protectedKeys && protectedKeys.includes(k)) return;      // المشرف: الحقول دي من السيرفر دايمًا
    const l = local[k], b = base[k], r = remote[k];
    if (deepEq(l, b)) return;                  // المحلي ما اتغيرش -> خد البعيد
    if (deepEq(l, r)) { out[k] = r; return; }
    if (POSITIONAL.includes(k) && Array.isArray(l) && Array.isArray(r)) { out[k] = mergePositional(b, l, r); if (k === 'dailyExpenses') expChanged = true; }
    else if (SETLIKE.includes(k) && Array.isArray(l) && Array.isArray(r)) out[k] = mergeSetLike(b, l, r);
    else { out[k] = l; if (k === 'dailyExpenses') expChanged = true; }
  });
  if (expChanged && Array.isArray(out.dailyExpenses)) out.expenses = out.dailyExpenses.reduce((a, v) => a + (parseFloat(v) || 0), 0);
  return out;
}

const isNetErr = e => {
  if (!e) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const m = String(e.message || e) + ' ' + String(e.name || '');
  return /fetch|network|timeout|offline|Retryable|Load failed/i.test(m) || e.status === 0;
};

function createEngine(deps) {
  const sb = deps.sb, role = deps.role, clientId = deps.clientId, label = deps.label || '';
  const idx = makeImageIndex();
  const uuid = deps.uuid || (() => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const log = deps.log || (() => {});
  let shadow = { p: {}, g: {}, c: {}, u: [] };
  try { const s = deps.loadShadow && deps.loadShadow(); if (s) shadow = Object.assign(shadow, s); } catch (e) {}
  const uploaded = new Set(shadow.u || []);
  const rejected = new Map();                 // personId -> json اللي اترفض (عشان منعيدش المحاولة على نفس الحالة)
  let enabled = false, flushing = false, again = false, flushTimer = null, applyChain = Promise.resolve(), channel = null, subscribedOnce = false, timers = [];
  let lastState = 'offline', lastPending = 0;

  const groups = () => deps.getGroups();
  const allowed = gid => role === 'admin' || (deps.allowedGroups() || []).includes(gid);
  const setState = (state, extra) => { lastState = state; deps.onStatus && deps.onStatus(Object.assign({ state, pending: lastPending }, extra || {})); };
  function saveShadow() { shadow.u = Array.from(uploaded); deps.saveShadow && deps.saveShadow(shadow); }

  function findPerson(id) {
    for (const g of groups()) { const i = g.people.findIndex(p => p._id === id); if (i >= 0) return { g, i, p: g.people[i] }; }
    return null;
  }
  function replaceInPlace(target, src) { Object.keys(target).forEach(k => { delete target[k]; }); Object.assign(target, src); }

  function computeLocal() {
    const out = { persons: new Map(), groups: new Map(), imgs: new Map() };
    let assigned = false;
    groups().forEach(g => {
      const meta = Object.assign({}, g); delete meta.people;
      out.groups.set(g.id, { j: canon(meta), meta });
      (g.people || []).forEach(p => {
        if (!p._id) { p._id = uuid(); p._ts = Date.now(); assigned = true; }
        const j = stripCanon(p, idx, (r, u) => { if (!out.imgs.has(r)) out.imgs.set(r, u); });
        out.persons.set(p._id, { g: g.id, j, p });
      });
    });
    if (assigned) deps.persist();
    return out;
  }

  // المشرف مابيبعتش الحقول المحمية أبدًا: بنثبّتها على آخر قيمة معروفة من السيرفر
  function effectiveJson(curJ, sh) {
    if (role !== 'supervisor' || !sh || sh.j === curJ) return curJ;
    const cur = JSON.parse(curJ), base = JSON.parse(sh.j);
    PROTECTED.forEach(k => { if (k in base) cur[k] = base[k]; else delete cur[k]; });
    return canon(cur);
  }
  const protKeys = () => role === 'supervisor' ? PROTECTED : null;

  function listPending(cur) {
    let n = 0;
    cur.persons.forEach((v, id) => { const s = shadow.p[id]; const j = effectiveJson(v.j, s); if ((!s || s.j !== j || s.g !== v.g) && allowed(v.g) && rejected.get(id) !== j) n++; });
    if (role === 'admin') { cur.groups.forEach((v, id) => { const s = shadow.g[id]; if (!s || s.j !== v.j) n++; }); }
    return n;
  }
  function countPending() { try { return listPending(computeLocal()); } catch (e) { return lastPending; } }

  /* ---------- رفع الصور ---------- */
  async function uploadImages(gid, refsInJson, imgMap) {
    const todo = [];
    refsInJson.forEach(r => { if (!uploaded.has(gid + '|' + r)) { const u = imgMap.get(r) || idx.urlOf(r); if (u) todo.push({ group_id: gid, hash: r, data: u }); } });
    for (let i = 0; i < todo.length; i += 4) {
      const chunk = todo.slice(i, i + 4);
      const { error } = await sb.from('person_images').upsert(chunk, { onConflict: 'group_id,hash', ignoreDuplicates: true });
      if (error) throw error;
      chunk.forEach(r => uploaded.add(r.group_id + '|' + r.hash));
    }
  }
  async function ensureImages(gid, refs) {
    const need = Array.from(refs).filter(r => !idx.has(r));
    for (let i = 0; i < need.length; i += 6) {
      const chunk = need.slice(i, i + 6);
      const { data, error } = await sb.from('person_images').select('hash,data').eq('group_id', gid).in('hash', chunk);
      if (error) throw error;
      (data || []).forEach(r => { idx.add(r.hash, r.data); uploaded.add(gid + '|' + r.hash); });
    }
  }
  const refsOfJson = j => { const s = new Set(); (j.match(/sbimg:[a-z0-9\-]+/g) || []).forEach(x => s.add(x)); return s; };

  /* ---------- دفع الأشخاص ---------- */
  async function pushPerson(id, cur, imgMap) {
    const sh = shadow.p[id];
    await uploadImages(cur.g, refsOfJson(cur.j), imgMap);
    const data = JSON.parse(cur.j);
    const row = { group_id: cur.g, data, client_id: clientId, by_label: label };
    if (sh && sh.v != null) {
      const { data: res, error } = await sb.from('people').update(row).eq('id', id).eq('version', sh.v).select('version');
      if (error) throw error;
      if (res && res.length) { shadow.p[id] = { g: cur.g, j: cur.j, v: res[0].version }; return; }
      return resolveConflict(id, cur, sh);
    }
    const { data: res, error } = await sb.from('people').insert(Object.assign({ id }, row)).select('version');
    if (error) { if (error.code === '23505') return resolveConflict(id, cur, null); throw error; }
    shadow.p[id] = { g: cur.g, j: cur.j, v: res[0].version };
  }

  async function resolveConflict(id, cur, sh) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: rr, error } = await sb.from('people').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!rr) {                                           // اتمسح من السيرفر -> نرجّعه من النسخة المحلية
        const { data: res, error: e2 } = await sb.from('people').insert({ id, group_id: cur.g, data: JSON.parse(cur.j), client_id: clientId, by_label: label }).select('version');
        if (e2) { if (e2.code === '23505') continue; throw e2; }
        shadow.p[id] = { g: cur.g, j: cur.j, v: res[0].version }; return;
      }
      await ensureImages(rr.group_id, collectRefs(rr.data));
      const base = sh ? JSON.parse(sh.j) : rr.data;
      const merged = merge3(base, JSON.parse(cur.j), rr.data, protKeys());
      const mj = canon(merged);
      const { data: res, error: e3 } = await sb.from('people').update({ data: merged, group_id: rr.group_id, client_id: clientId, by_label: label }).eq('id', id).eq('version', rr.version).select('version');
      if (e3) throw e3;
      if (res && res.length) {
        const loc = findPerson(id);
        if (loc) replaceInPlace(loc.p, hydrate(merged, idx));
        shadow.p[id] = { g: rr.group_id, j: mj, v: res[0].version };
        deps.persist(); deps.onRemoteApplied && deps.onRemoteApplied({ personIds: [id], groupIds: [rr.group_id], structural: false, by: rr.by_label, name: merged.name, merged: true });
        return;
      }
      sh = { j: canon(rr.data) };                          // حد غيّر تاني في نفس اللحظة -> نعيد
    }
    throw new Error('conflict-retry-exceeded');
  }

  async function pushGroup(id, v) {
    const sh = shadow.g[id];
    const data = JSON.parse(v.j);
    if (sh && sh.v != null) {
      const { data: res, error } = await sb.from('groups').update({ data, client_id: clientId, by_label: label }).eq('id', id).select('version');
      if (error) throw error;
      if (res && res.length) { shadow.g[id] = { j: v.j, v: res[0].version }; return; }
    }
    const { data: res, error } = await sb.from('groups').upsert({ id, data, client_id: clientId, by_label: label }, { onConflict: 'id' }).select('version');
    if (error) throw error;
    shadow.g[id] = { j: v.j, v: res[0].version };
  }

  async function pushCustody() {
    if (role !== 'admin') return;
    const all = deps.getCustody() || {};
    for (const phone of Object.keys(all)) {
      const j = canon(all[phone]), sh = shadow.c[phone];
      if (sh && sh.j === j) continue;
      const { data: res, error } = await sb.from('custody').upsert({ phone, data: all[phone], client_id: clientId }, { onConflict: 'phone' }).select('version');
      if (error) throw error;
      shadow.c[phone] = { j, v: res[0].version };
    }
  }

  /* ---------- الدفع الرئيسي ---------- */
  function scheduleFlush(ms) {
    if (!enabled || deps.readOnly) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, ms == null ? 500 : ms);
  }

  async function flush() {
    if (!enabled || deps.readOnly) return;       // المشاهد: قراءة فقط، مفيش أي كتابة للسيرفر
    if (flushing) { again = true; return; }
    flushing = true; again = false;
    let failed = false;
    try {
      const cur = computeLocal();
      lastPending = listPending(cur);
      if (role === 'admin') {
        for (const [id, v] of cur.groups) { const s = shadow.g[id]; if (!s || s.j !== v.j) await pushGroup(id, v); }
        for (const id of Object.keys(shadow.g)) {
          if (!cur.groups.has(id)) {
            const r1 = await sb.from('people').delete().eq('group_id', id); if (r1.error) throw r1.error;
            const r2 = await sb.from('groups').delete().eq('id', id); if (r2.error) throw r2.error;
            Object.keys(shadow.p).forEach(pid => { if (shadow.p[pid].g === id) delete shadow.p[pid]; });
            delete shadow.g[id];
          }
        }
      }
      for (const [id, v] of cur.persons) {
        if (!allowed(v.g)) continue;
        const s = shadow.p[id];
        const j = effectiveJson(v.j, s);
        if (s && s.j === j && s.g === v.g) continue;
        if (rejected.get(id) === j) continue;
        setState('sync');
        const out = { g: v.g, j, p: v.p };
        try { await pushPerson(id, out, cur.imgs); lastPending = Math.max(0, lastPending - 1); }
        catch (e) {
          if (e && (e.code === '42501' || /row-level security|المشرف/i.test(e.message || ''))) { rejected.set(id, j); deps.onRejected && deps.onRejected(v.p, e); log('rejected', id, e.message); continue; }
          throw e;
        }
      }
      if (role === 'admin') {
        for (const id of Object.keys(shadow.p)) {
          if (!cur.persons.has(id)) { const r = await sb.from('people').delete().eq('id', id); if (r.error) throw r.error; delete shadow.p[id]; }
        }
      }
      await pushCustody();
      saveShadow();
      lastPending = 0;
    } catch (e) {
      failed = true;
      log('flush error', e && e.message);
      setState(isNetErr(e) ? 'offline' : 'error', { message: e && e.message });
    } finally {
      flushing = false;
      if (!failed) setState('online');
      if (again) scheduleFlush(50);
    }
  }

  /* ---------- استقبال التغييرات البعيدة ---------- */
  function ensureGroupLocal(gid, meta) {
    let g = groups().find(x => x.id === gid);
    if (!g) { g = Object.assign({}, meta, { id: gid, people: [] }); groups().push(g); }
    return g;
  }

  async function applyRemotePerson(row) {
    if (row.client_id === clientId) return;
    const id = row.id, sh = shadow.p[id];
    if (sh && sh.v != null && row.version <= sh.v) return;
    if (!allowed(row.group_id)) return;
    const loc = findPerson(id);
    let finalData = row.data, pendingLocal = false;
    if (loc) {
      const curJ = stripCanon(loc.p, idx);
      const baseJ = sh ? sh.j : canon(row.data);
      if (curJ !== baseJ) { finalData = merge3(JSON.parse(baseJ), JSON.parse(curJ), row.data, protKeys()); pendingLocal = true; }
    }
    await ensureImages(row.group_id, collectRefs(finalData));
    const obj = hydrate(finalData, idx);
    let grp = groups().find(g => g.id === row.group_id);
    if (!grp) {
      const { data: gr } = await sb.from('groups').select('*').eq('id', row.group_id).maybeSingle();
      if (!gr) return;
      grp = ensureGroupLocal(gr.id, gr.data); shadow.g[gr.id] = { j: canon(gr.data), v: gr.version };
    }
    let structural = false;
    if (loc) {
      if (loc.g.id !== grp.id) { loc.g.people.splice(loc.i, 1); grp.people.push(loc.p); structural = true; }
      replaceInPlace(loc.p, obj);
    } else { grp.people.push(obj); structural = true; }
    shadow.p[id] = { g: row.group_id, j: canon(row.data), v: row.version };
    deps.persist(); saveShadow();
    deps.onRemoteApplied && deps.onRemoteApplied({ personIds: [id], groupIds: [row.group_id], structural, by: row.by_label, name: obj.name });
    if (pendingLocal) scheduleFlush(200);
  }

  function removeLocalPerson(id) {
    const loc = findPerson(id);
    delete shadow.p[id];
    if (!loc) return;
    loc.g.people.splice(loc.i, 1);
    deps.persist(); saveShadow();
    deps.onRemoteApplied && deps.onRemoteApplied({ personIds: [id], groupIds: [loc.g.id], structural: true });
  }

  function applyRemoteGroup(row) {
    if (row.client_id === clientId) return;
    if (!allowed(row.id)) return;
    const sh = shadow.g[row.id];
    if (sh && sh.v != null && row.version <= sh.v) return;
    let g = groups().find(x => x.id === row.id);
    if (g) { const people = g.people; replaceInPlace(g, Object.assign({}, row.data, { id: row.id, people })); }
    else ensureGroupLocal(row.id, row.data);
    shadow.g[row.id] = { j: canon(row.data), v: row.version };
    deps.persist(); saveShadow();
    deps.onRemoteApplied && deps.onRemoteApplied({ groupIds: [row.id], structural: true, groupMeta: true });
  }
  function removeLocalGroup(id) {
    const i = groups().findIndex(g => g.id === id);
    Object.keys(shadow.p).forEach(pid => { if (shadow.p[pid].g === id) delete shadow.p[pid]; });
    delete shadow.g[id];
    if (i >= 0) groups().splice(i, 1);
    deps.persist(); saveShadow();
    deps.onRemoteApplied && deps.onRemoteApplied({ groupIds: [id], structural: true, groupMeta: true });
  }

  function applyRemoteCustody(row) {
    if (row.client_id === clientId) return;
    const all = deps.getCustody() || {};
    all[row.phone] = row.data;
    deps.setCustody(all);
    shadow.c[row.phone] = { j: canon(row.data), v: row.version };
    saveShadow();
    deps.onRemoteApplied && deps.onRemoteApplied({ custody: true, by: row.phone });
  }

  const enqueue = fn => { applyChain = applyChain.then(fn).catch(e => { log('apply error', e && e.message); }); return applyChain; };

  function onPeopleEvent(p) {
    if (p.eventType === 'DELETE') return enqueue(() => removeLocalPerson(p.old && p.old.id));
    return enqueue(() => applyRemotePerson(p.new));
  }
  function onGroupsEvent(p) {
    if (p.eventType === 'DELETE') return enqueue(() => removeLocalGroup(p.old && p.old.id));
    return enqueue(() => applyRemoteGroup(p.new));
  }
  function onCustodyEvent(p) { if (p.eventType !== 'DELETE') enqueue(() => applyRemoteCustody(p.new)); }

  /* ---------- السحب الكامل ---------- */
  async function fetchAll(table, sel, pk) {
    const out = []; let from = 0; const step = 500;
    for (;;) {
      const { data, error } = await sb.from(table).select(sel || '*').order(pk || 'id').range(from, from + step - 1);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < step) break;
      from += step;
    }
    return out;
  }

  async function pullAll() {
    const [rg, rp, rc] = await Promise.all([fetchAll('groups'), fetchAll('people'), fetchAll('custody', '*', 'phone')]);
    await enqueue(async () => {
      const remoteG = new Map(rg.map(r => [r.id, r])), remoteP = new Map(rp.map(r => [r.id, r]));
      // مجموعات
      for (const r of rg) { const sh = shadow.g[r.id]; if (!sh || r.version > sh.v) { applyRemoteGroup(Object.assign({}, r, { client_id: null })); } }
      // مجموعات اتشالت (أو المشرف مبقاش له صلاحية عليها)
      for (const g of groups().slice()) {
        if (!remoteG.has(g.id) && (shadow.g[g.id] || role !== 'admin')) {
          if (role === 'admin' && !shadow.g[g.id]) continue;
          removeLocalGroup(g.id);
        }
      }
      // أشخاص
      for (const r of rp) { await applyRemotePerson(Object.assign({}, r, { client_id: null })); }
      for (const id of Object.keys(shadow.p)) {
        if (!remoteP.has(id)) {
          const loc = findPerson(id);
          if (loc && stripCanon(loc.p, idx) !== shadow.p[id].j) { delete shadow.p[id]; }  // عليه تعديلات محلية -> نرفعه من جديد
          else removeLocalPerson(id);
        }
      }
      // العهدة
      for (const r of rc) { const sh = shadow.c[r.phone]; if (!sh || r.version > sh.v) applyRemoteCustody(Object.assign({}, r, { client_id: null })); }
      deps.persist(); saveShadow();
      deps.onRemoteApplied && deps.onRemoteApplied({ structural: true, full: true });
    });
  }

  /* ---------- التشغيل ---------- */
  function subscribe() {
    if (channel) { try { sb.removeChannel(channel); } catch (e) {} }
    channel = sb.channel('salary-live-' + clientId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, onPeopleEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, onGroupsEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custody' }, onCustodyEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, p => { deps.onProfileEvent && deps.onProfileEvent(p); })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          setState('online');
          if (subscribedOnce) pullAll().then(() => flush()).catch(() => {});
          subscribedOnce = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setState('offline');
        }
      });
  }

  async function start() {
    enabled = true;
    try { await pullAll(); setState('online'); }
    catch (e) { log('initial pull failed', e && e.message); setState(isNetErr(e) ? 'offline' : 'error', { message: e && e.message }); }
    subscribe();
    await flush();
    timers.push(setInterval(() => { if (lastPending > 0 || lastState !== 'online') flush(); }, 20000));
    timers.push(setInterval(() => { pullAll().catch(() => {}); }, 120000));
  }
  function stop() {
    enabled = false; timers.forEach(clearInterval); timers = []; clearTimeout(flushTimer);
    if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; }
  }

  return { start, stop, flush, scheduleFlush, pullAll, countPending, onPeopleEvent, onGroupsEvent, onCustodyEvent, getShadow: () => shadow, idx, state: () => lastState, _enqueueIdle: () => applyChain };
}

/* ---- دمج بيانات الخزينة والمشتريات (أدمن فقط): دمج ثلاثي بالـ id من غير ما أي جهاز يضيّع بيانات التاني ----
   local / remote = {treasury:[...], purchases:[...]}، shadow = الـ ids اللي كانت متزامنة آخر مرة.
   موجود في الاتنين: الأحدث (upd) يكسب. موجود في طرف بس: لو كان في الـ shadow يبقى اتحذف من الطرف التاني، غير كده يبقى جديد. */
function vaultMerge(local, remote, shadow) {
  const out = {};
  ['treasury', 'purchases'].forEach(kind => {
    const L = new Map((local[kind] || []).filter(e => e && e.id).map(e => [e.id, e]));
    const R = new Map((remote[kind] || []).filter(e => e && e.id).map(e => [e.id, e]));
    const S = new Set((shadow && shadow[kind]) || []);
    const res = [];
    new Set([...L.keys(), ...R.keys()]).forEach(id => {
      const l = L.get(id), r = R.get(id);
      if (l && r) { const lu = +l.upd || +l.ts || 0, ru = +r.upd || +r.ts || 0; res.push(ru > lu ? r : l); }
      else if (l) { if (!S.has(id)) res.push(l); }
      else if (r) { if (!S.has(id)) res.push(r); }
    });
    out[kind] = res.sort((a, b) => (+a.ts || 0) - (+b.ts || 0) || (a.id < b.id ? -1 : 1));
  });
  return out;
}

const Core = { createEngine, merge3, vaultMerge, PROTECTED, stripCanon, canon, hydrate, collectRefs, makeImageIndex, cyrb53, isNetErr, IMG_PREFIX };
root.SalarySyncCore = Core;
if (typeof module !== 'undefined' && module.exports) module.exports = Core;

/* ======================= (2) الربط بالتطبيق ======================= */
if (typeof document === 'undefined' || !root.document) return;
const CFG = root.SALARY_APP_CONFIG || {};
const WANT = !!(CFG.ENABLE_CLOUD_SYNC && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
root.SALARY_CLOUD_WANTED = WANT;
if (!WANT) return;
const LIB = !!(root.supabase && root.supabase.createClient);

const $ = id => document.getElementById(id);
const DOMAIN = CFG.PHONE_EMAIL_DOMAIN || 'salary-app.net';
const normPhone = p => String(p || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');
const phoneEmail = p => 'p' + normPhone(p) + '@' + DOMAIN;
const esc = s => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
const rawSet = Storage.prototype.setItem;
let engine = null, sb = null, muted = 0, vault = null;

const CLIENT_ID = (() => { let c = localStorage.getItem('salaryAppClientId'); if (!c) { c = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); rawSet.call(localStorage, 'salaryAppClientId', c); } return c; })();
const STORE_KEYS = ['salaryAppGroups', 'salaryAppCustody', 'salaryAppShadow', 'salaryAppTreasury', 'salaryAppPurchases', 'salaryAppVaultShadow'];

/* ---- شارة الحالة + إشعارات ---- */
function badge() {
  let b = $('cloudBadge');
  if (!b) {
    b = document.createElement('div'); b.id = 'cloudBadge';
    b.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:9998;background:#fff;border:1px solid #ddd;border-radius:20px;padding:4px 10px;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.15);direction:rtl;display:none';
    document.body.appendChild(b);
  }
  return b;
}
function showStatus(s) {
  const b = badge(); b.style.display = 'block';
  const pend = s.pending > 0 ? ' • ' + s.pending + ' تعديل معلّق' : '';
  if (s.state === 'online') b.textContent = '🟢 متصل ولحظي' + pend;
  else if (s.state === 'sync') b.textContent = '🟡 بيتزامن…' + pend;
  else if (s.state === 'offline') b.textContent = '🔴 أوفلاين — هيتزامن أول ما النت يرجع' + pend;
  else b.textContent = '⚠️ مشكلة في المزامنة' + pend;
  b.title = s.message || '';
}
let toastN = 0, toastTimer = null, toastBy = '';
function toast(msg) {
  let t = $('cloudToast');
  if (!t) {
    t = document.createElement('div'); t.id = 'cloudToast';
    t.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9998;background:#1f2937;color:#fff;border-radius:10px;padding:8px 14px;font-size:13px;direction:rtl;max-width:90%;text-align:center;display:none';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.display = 'block'; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; toastN = 0; }, 3500);
}

/* ---- تحديث الشاشة من غير ما نبوّظ اللي بيكتبه المستخدم ---- */
const pendingCards = new Set(); let needFull = false;
function isVisible(id) { const e = $(id); return !!e && e.style.display === 'block'; }
function activeInside(el) { const a = document.activeElement; return !!(a && el && el.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }

function refreshCard(idx) {
  const g = currentGroup(); if (!g || !g.people[idx]) return;
  const pc = $('peopleContainer');
  const old = pc.querySelector('.card[data-idx="' + idx + '"]');
  if (old && activeInside(old)) { pendingCards.add(idx); return; }
  const open = old && old.querySelector('.days-wrap') && old.querySelector('.days-wrap').style.display !== 'none';
  renderPersonCard(g.people[idx], idx);
  const nw = pc.lastElementChild;
  if (old && nw && nw !== old) { old.replaceWith(nw); }
  if (open && nw) { const tb = nw.querySelector('.toggleDays'); if (tb) tb.click(); }
}
document.addEventListener('focusout', () => {
  if (!pendingCards.size && !needFull) return;
  setTimeout(() => {
    if (activeInside($('peopleContainer'))) return;
    if (needFull) { needFull = false; pendingCards.clear(); if (isVisible('screenGroup')) { const y = window.scrollY; renderPeople(); window.scrollTo(0, y); } return; }
    const list = Array.from(pendingCards); pendingCards.clear(); list.forEach(refreshCard); try { recalcGroupTotals(); } catch (e) {}
  }, 350);
});

function onRemoteApplied(info) {
  try {
    if (isVisible('screenGroups')) { renderGroupsScreen(); }
    else if (isVisible('screenGroup')) {
      const g = typeof currentGroup === 'function' ? currentGroup() : null;
      if (!g) { renderGroupsScreen(); }
      else if (info.full || info.structural || info.groupMeta) {
        const pc = $('peopleContainer');
        if (activeInside(pc)) { needFull = true; }
        else { const y = window.scrollY; renderPeople(); window.scrollTo(0, y); }
      } else if ((info.groupIds || []).includes(g.id)) {
        (info.personIds || []).forEach(id => { const i = g.people.findIndex(p => p._id === id); if (i >= 0) refreshCard(i); });
        try { recalcGroupTotals(); renderDailyAttendance(); } catch (e) {}
      }
    } else if (isVisible('screenReportGroup') && typeof currentReportGroupId !== 'undefined' && currentReportGroupId) {
      const g = groups.find(x => x.id === currentReportGroupId); if (g) renderReportEntries(g);
    }
  } catch (e) { console.warn('refresh failed', e); }
  if (info.by && !info.full && !info.merged && !(window.supSession)) {
    toastN++; toastBy = info.by;
    toast(toastN > 1 ? '🔔 ' + toastN + ' تحديثات جديدة' : '🔔 ' + info.by + (info.name ? ' — ' + info.name : ''));
  }
}

/* ---- التخزين المحلي (من غير ما نعمل لوب) ---- */
function persistGroups() {
  muted++; try { rawSet.call(localStorage, 'salaryAppGroups', JSON.stringify(groups)); } catch (e) { toast('⚠️ مساحة التخزين على الجهاز ممتلئة'); } finally { muted--; }
}
const getCustody = () => { try { return JSON.parse(localStorage.getItem('salaryAppCustody') || '{}'); } catch (e) { return {}; } };
const setCustody = o => { muted++; try { rawSet.call(localStorage, 'salaryAppCustody', JSON.stringify(o)); } finally { muted--; } };

Storage.prototype.setItem = function (k, v) {
  const r = rawSet.apply(this, arguments);
  if (engine && this === localStorage && !muted && (k === 'salaryAppGroups' || k === 'salaryAppCustody')) engine.scheduleFlush(k === 'salaryAppGroups' ? 500 : 300);
  if (vault && this === localStorage && !muted && (k === 'salaryAppTreasury' || k === 'salaryAppPurchases')) vault.schedule();
  return r;
};

/* ---- تبديل بيانات الجهاز بين المستخدمين (من غير ما نمسح حاجة) ---- */
function switchUser(newId, role) {
  const active = localStorage.getItem('salaryAppCloudUser') || 'legacy';
  if (active === newId) return;
  const has = suffix => STORE_KEYS.some(k => localStorage.getItem(k + '@' + suffix) != null);
  STORE_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v != null) { rawSet.call(localStorage, k + '@' + active, v); localStorage.removeItem(k); } });
  let src = newId;
  if (!has(newId) && role === 'admin' && has('legacy')) src = 'legacy';
  STORE_KEYS.forEach(k => { const v = localStorage.getItem(k + '@' + src); if (v != null) { rawSet.call(localStorage, k, v); localStorage.removeItem(k + '@' + src); } });
  rawSet.call(localStorage, 'salaryAppCloudUser', newId);
}

/* ---- الدخول ---- */
async function hashPw(pw, salt) { const b = new TextEncoder().encode(salt + ':' + pw); const h = await crypto.subtle.digest('SHA-256', b); return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, '0')).join(''); }

function getClient() {
  if (!sb && LIB) sb = root.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'salaryAppSb' } });
  return sb;
}

/* ---- مزامنة الخزينة والمشتريات (أدمن فقط، جدول admin_vault محمي بـ RLS) ---- */
root.__startVault = startVault;
function startVault(client) {
  if (vault) return;
  const KINDS = ['treasury', 'purchases'];
  const readJ = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const readLocal = () => {
    const t = readJ('salaryAppTreasury', {}), flat = [];
    Object.keys(t || {}).forEach(m => (t[m] || []).forEach(e => flat.push(e)));
    const p = readJ('salaryAppPurchases', []);
    return { treasury: flat, purchases: Array.isArray(p) ? p : [] };
  };
  const writeLocal = d => {
    const t = {}; (d.treasury || []).forEach(e => { const m = String(e.date || '').slice(0, 7) || 'x'; (t[m] = t[m] || []).push(e); });
    muted++; try { rawSet.call(localStorage, 'salaryAppTreasury', JSON.stringify(t)); rawSet.call(localStorage, 'salaryAppPurchases', JSON.stringify(d.purchases || [])); } catch (e) { toast('⚠️ مساحة التخزين على الجهاز ممتلئة'); } finally { muted--; }
  };
  const canon = d => JSON.stringify(KINDS.map(k => (d[k] || []).slice().sort((a, b) => a.id < b.id ? -1 : 1)));
  const ids = d => { const o = {}; KINDS.forEach(k => { o[k] = (d[k] || []).map(e => e.id); }); return o; };
  let busy = false, again = false, timer = null, warned = false;

  async function sync() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { data: row, error } = await client.from('admin_vault').select('*').eq('id', 'main').maybeSingle();
        if (error) throw error;
        const remote = row && row.data ? row.data : { treasury: [], purchases: [] };
        const local = readLocal();
        const merged = vaultMerge(local, remote, readJ('salaryAppVaultShadow', null));
        const localChanged = canon(merged) !== canon(local);
        if (canon(merged) !== canon(remote) || !row) {
          if (!row) { const ins = await client.from('admin_vault').insert({ id: 'main', data: merged, client_id: CLIENT_ID }); if (ins.error) continue; }
          else {
            const up = await client.from('admin_vault').update({ data: merged, client_id: CLIENT_ID }).eq('id', 'main').eq('version', row.version).select('version');
            if (up.error) throw up.error;
            if (!up.data || !up.data.length) continue;       // جهاز تاني سبقنا → نعيد الدمج
          }
        }
        if (localChanged) { writeLocal(merged); window.dispatchEvent(new Event('vaultUpdated')); }
        muted++; try { rawSet.call(localStorage, 'salaryAppVaultShadow', JSON.stringify(ids(merged))); } finally { muted--; }
        warned = false; break;
      }
    } catch (e) {
      console.warn('[vault]', e);
      if (!warned && !(e && isNetErr(e))) { warned = true; toast('⚠️ مزامنة الخزينة فشلت — تأكد إنك شغّلت ملف supabase_vault.sql'); }
    } finally { busy = false; if (again) { again = false; schedule(500); } }
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(sync, ms == null ? 800 : ms); }

  client.channel('vault-live-' + CLIENT_ID)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_vault' }, p => { if (!p.new || p.new.client_id !== CLIENT_ID) schedule(200); })
    .subscribe();
  window.addEventListener('online', () => schedule(200));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(200); });
  setInterval(() => { if (!document.hidden) schedule(0); }, 60000);
  vault = { schedule, sync };
  root.__vault = vault;
  return sync();
}

/* ---- حسابات المشاهدين (قراءة فقط) — للأدمن ---- */
function addViewersButton() {
  if ($('xViewersBtn')) return;
  const anchor = $('supervisorSettingsBtn'); if (!anchor) return;
  const b = document.createElement('button'); b.id = 'xViewersBtn'; b.type = 'button'; b.className = 'toggle-btn full-btn'; b.style.marginBottom = '8px'; b.textContent = '👁 حسابات المشاهدين';
  b.onclick = () => root.manageViewers(); anchor.insertAdjacentElement('afterend', b);
}
root.manageViewers = async function () {
  const client = getClient(); if (!client) return alert('مكتبة المزامنة مش محمّلة');
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  document.body.appendChild(ov);
  const box = h => '<div style="background:#fff;border-radius:14px;padding:16px;width:100%;max-width:380px;max-height:88vh;overflow:auto;direction:rtl">' + h + '</div>';
  const draw = async (msg, okMsg) => {
    ov.innerHTML = box('جاري التحميل…');
    const { data: list, error } = await client.from('profiles').select('*').eq('role', 'viewer').order('created_at');
    if (error) { ov.innerHTML = box('تعذر التحميل: ' + esc(error.message) + '<br>تأكد إنك شغّلت ملف supabase_viewer.sql<br><button class="toggle-btn full-btn" id="xvClose" style="margin-top:8px">إغلاق</button>'); ov.querySelector('#xvClose').onclick = () => ov.remove(); return; }
    ov.innerHTML = box('<h3 style="margin:0 0 6px">👁 حسابات المشاهدين</h3><div style="font-size:12px;color:#666;margin-bottom:8px">المشاهد يشوف المجموعات والأشخاص والرواتب والتقارير، من غير ما يقدر يعدّل أي حاجة، ومن غير الخزينة والمشتريات. بيدخل من تبويب "المشرف" برقم الموبايل والباسورد.</div>' +
      (list.length ? list.map((v, i) => '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #eee"><span>' + esc(v.phone) + '</span><span><button data-pw="' + i + '" style="background:none;border:none">🔑 تغيير الباسورد</button><button data-del="' + i + '" style="color:#c0392b;background:none;border:none">حذف</button></span></div>').join('') : '<div style="color:#888">لا يوجد مشاهدين بعد</div>') +
      '<input id="xvPh" type="tel" placeholder="رقم موبايل المشاهد" style="width:100%;margin-top:10px;box-sizing:border-box">' +
      '<input id="xvPw" type="text" autocomplete="off" placeholder="الباسورد (10 أحرف قوية) — أو اضغط اقتراح" style="width:100%;margin-top:6px;box-sizing:border-box">' +
      '<button id="xvGen" class="toggle-btn full-btn" type="button" style="margin-top:6px">🎲 اقتراح باسورد قوي</button>' +
      '<div id="xvErr" style="font-size:12px;min-height:16px;margin-top:6px;color:' + (okMsg ? '#1e7a46' : '#c0392b') + '">' + esc(msg || '') + '</div>' +
      '<button id="xvAdd" class="add-btn" type="button">إضافة / تغيير الباسورد</button><button id="xvClose" class="toggle-btn full-btn" style="margin-top:6px">إغلاق</button>');
    ov.querySelector('#xvClose').onclick = () => ov.remove();
    ov.querySelector('#xvGen').onclick = () => { ov.querySelector('#xvPw').value = root.AdminPw.generate(14); };
    ov.querySelectorAll('[data-pw]').forEach(b => b.onclick = () => { ov.querySelector('#xvPh').value = list[+b.dataset.pw].phone; ov.querySelector('#xvPw').focus(); });
    ov.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const v = list[+b.dataset.del];
      if (!(await showConfirm('حذف حساب المشاهد ' + v.phone + '؟'))) return;
      const { error: de } = await client.rpc('admin_delete_supervisor', { p_id: v.id });
      draw(de ? 'تعذر الحذف: ' + de.message : 'تم الحذف', !de);
    });
    ov.querySelector('#xvAdd').onclick = async () => {
      const err = ov.querySelector('#xvErr'), ph = normPhone(ov.querySelector('#xvPh').value), pw = ov.querySelector('#xvPw').value;
      err.style.color = '#c0392b';
      if (ph.length < 10) return err.textContent = 'رقم الموبايل غير صحيح';
      const st = root.AdminPw.strength(pw); if (!st.ok) return err.textContent = 'الباسورد ضعيف: ' + st.miss[0];
      err.style.color = '#888'; err.textContent = 'جاري الحفظ…';
      try {
        const ex = await client.from('profiles').select('role').eq('phone', ph).maybeSingle();
        if (ex.data && ex.data.role !== 'viewer') throw new Error('الرقم ده مستخدم لحساب مشرف أو مدير');
        const existing = list.find(v => v.phone === ph);
        let id = existing && existing.id;
        if (existing) { const r = await client.rpc('admin_set_user_password', { p_email: phoneEmail(ph), p_password: pw }); if (r.error) throw r.error; }
        else {
          const tmp = root.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'salaryAppSbTmp' } });
          const { data, error } = await tmp.auth.signUp({ email: phoneEmail(ph), password: pw });
          if (error && !/registered|exists/i.test(error.message)) throw error;
          if (error) { const r = await client.rpc('admin_set_user_password', { p_email: phoneEmail(ph), p_password: pw }); if (r.error) throw r.error; id = r.data; }
          else id = data.user && data.user.id;
          if (!id) throw new Error('لم يتم إنشاء الحساب — تأكد إن Confirm email مقفول في Supabase');
        }
        const up = await client.from('profiles').upsert({ id, role: 'viewer', phone: ph, group_ids: [] }, { onConflict: 'id' });
        if (up.error) throw up.error;
        draw('تم الحفظ ✅ — ابعت للمشاهد رقمه والباسورد ورابط التطبيق: ' + pw, true);
      } catch (e) { err.style.color = '#c0392b'; err.textContent = 'تعذر الحفظ: ' + (e.message || e); }
    };
  };
  draw();
};

async function startEngine(role, session) {
  try { loadGroups(); } catch (e) {}
  const client = getClient();
  if (!client) { showStatus({ state: 'error', pending: 0, message: 'مكتبة المزامنة مش محمّلة' }); return; }
  engine = createEngine({
    sb: client, role: role === 'viewer' ? 'admin' : role, readOnly: role === 'viewer', clientId: CLIENT_ID,
    label: role === 'admin' ? 'المدير' : role === 'viewer' ? 'مشاهد ' + (session.phone || '') : 'المشرف ' + (session.phone || ''),
    getGroups: () => groups,
    allowedGroups: () => (root.supSession && root.supSession.groupIds) || [],
    persist: persistGroups,
    getCustody, setCustody,
    loadShadow: () => { try { return JSON.parse(localStorage.getItem('salaryAppShadow') || 'null'); } catch (e) { return null; } },
    saveShadow: s => { muted++; try { rawSet.call(localStorage, 'salaryAppShadow', JSON.stringify(s)); } catch (e) {} finally { muted--; } },
    onStatus: showStatus,
    onRemoteApplied,
    onRejected: (p) => toast('⚠️ السيرفر رفض تعديل على "' + (p.name || '') + '" (صلاحية)'),
    onProfileEvent: async ev => {
      if (role !== 'supervisor' || !ev.new || ev.new.id !== session.userId) return;
      root.supSession.groupIds = ev.new.group_ids || [];
      session.groupIds = root.supSession.groupIds;
      try { await engine.pullAll(); } catch (e) {}
      toast('تم تحديث مجموعاتك');
    },
    log: (...a) => console.log('[sync]', ...a)
  });
  root.__cloudEngine = engine;
  window.addEventListener('online', () => { engine.pullAll().then(() => engine.flush()).catch(() => engine.flush()); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) engine.flush(); });
  await engine.start();
  if (role === 'admin') { startVault(client); addViewersButton(); }
}

async function loginFlow(role, ident, pass) {
  const email = role === 'supervisor' ? phoneEmail(ident) : String(ident || '').trim().toLowerCase();
  if (!ident || !pass) return { ok: false, msg: role === 'supervisor' ? 'اكتب رقم الموبايل والباسورد' : 'اكتب الإيميل والباسورد' };
  const client = getClient();
  let user = null, netFail = false;
  if (client) {
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password: pass });
      if (error) { if (isNetErr(error)) netFail = true; else return { ok: false, msg: role === 'supervisor' ? 'رقم الموبايل أو الباسورد غلط' : 'الإيميل أو الباسورد غلط' }; }
      else user = data.user;
    } catch (e) { netFail = true; }
  } else netFail = true;

  const authKey = 'salaryAppCloudAuth';
  if (netFail) {                                      // دخول أوفلاين بحساب سبق الدخول بيه على نفس الجهاز
    let saved = null; try { saved = JSON.parse(localStorage.getItem(authKey) || 'null'); } catch (e) {}
    if (!saved || saved.email !== email || saved.role !== role || (await hashPw(pass, saved.salt)) !== saved.hash)
      return { ok: false, msg: 'مفيش اتصال بالنت، والدخول أوفلاين متاح بس لحساب دخلت بيه قبل كده على الجهاز ده' };
    switchUser(saved.userId, role);
    const savedKind = saved.kind || role;
    if (role === 'supervisor' && savedKind === 'supervisor') root.supSession = { phone: saved.phone, groupIds: saved.groupIds || [], userId: saved.userId };
    else root.supSession = undefined;
    root.viewSession = savedKind === 'viewer' ? { phone: saved.phone, userId: saved.userId } : undefined;
    if (LIB) startEngine(savedKind, { phone: saved.phone, userId: saved.userId, groupIds: saved.groupIds });
    else showStatus({ state: 'error', pending: 0, message: 'مكتبة المزامنة مش محمّلة' });
    return { ok: true };
  }

  const { data: prof, error: pe } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (pe || !prof) { await client.auth.signOut(); return { ok: false, msg: 'الحساب ده مش مفعّل في التطبيق' }; }
  const okRole = prof.role === role || (role === 'supervisor' && prof.role === 'viewer');
  if (!okRole) { await client.auth.signOut(); return { ok: false, msg: role === 'admin' ? 'ده حساب مشرف — ادخل من تبويب المشرف' : 'ده حساب المدير — ادخل من تبويب المدير' }; }
  try { switchUser(user.id, role); }
  catch (e) { return { ok: false, msg: 'مساحة التخزين على الجهاز ممتلئة، فضّي مساحة وحاول تاني' }; }

  const session = { userId: user.id, phone: prof.phone, groupIds: prof.group_ids || [] };
  if (prof.role === 'supervisor') root.supSession = { phone: prof.phone, groupIds: session.groupIds, userId: user.id };
  else root.supSession = undefined;
  root.viewSession = prof.role === 'viewer' ? { phone: prof.phone, userId: user.id } : undefined;
  const salt = Math.random().toString(36).slice(2);
  rawSet.call(localStorage, authKey, JSON.stringify({ email, role, kind: prof.role, userId: user.id, phone: prof.phone, groupIds: session.groupIds, salt, hash: await hashPw(pass, salt) }));
  await startEngine(prof.role, session);
  return { ok: true };
}

/* ---- ربط شاشة الدخول ---- */
function injectLoginFields() {
  if ($('cloudEmail')) return;
  const pin = $('pinInput');
  const mk = (id, type, ph) => { const i = document.createElement('input'); i.id = id; i.type = type; i.placeholder = ph; i.autocomplete = 'off'; i.style.cssText = 'display:none;margin-bottom:8px'; return i; };
  const em = mk('cloudEmail', 'email', 'إيميل المدير'), pw = mk('cloudPass', 'password', 'الباسورد');
  pin.parentNode.insertBefore(em, pin); pin.parentNode.insertBefore(pw, pin);
  ['cloudEmail', 'cloudPass', 'supPhone', 'supPass'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('pinSubmit').click(); }));
}
root.cloudSetupUI = function (role) {
  injectLoginFields();
  const adm = role !== 'supervisor';
  $('cloudEmail').style.display = adm ? 'block' : 'none';
  $('cloudPass').style.display = adm ? 'block' : 'none';
  $('pinInput').style.display = 'none';
  const rb = $('resetPinBtn'); if (rb) rb.style.display = 'none';
  $('lockTitle').textContent = adm ? 'دخول المدير' : 'دخول المشرف';
  $('lockSubtitle').textContent = adm ? 'أدخل إيميل وباسورد المدير' : 'أدخل رقم الموبايل والباسورد';
  const f = adm ? $('cloudEmail') : $('supPhone'); if (f) f.focus();
};
root.cloudHandleLogin = async function (role) {
  const err = $('lockError'); err.textContent = '';
  const btn = $('pinSubmit'); btn.disabled = true; const t = btn.textContent; btn.textContent = '...';
  try {
    const r = role === 'supervisor' ? await loginFlow('supervisor', $('supPhone').value, $('supPass').value) : await loginFlow('admin', $('cloudEmail').value, $('cloudPass').value);
    if (!r.ok) { err.textContent = r.msg; ($('supPass') || {}).value = ''; ($('cloudPass') || {}).value = ''; }
    return r.ok;
  } catch (e) { err.textContent = 'حصلت مشكلة: ' + (e && e.message || e); return false; }
  finally { btn.disabled = false; btn.textContent = t; }
};

/* ---- تغيير باسورد الأدمن على Supabase (بعد التأكد من الباسورد الحالي) ---- */
root.cloudChangePassword = async function (current, next) {
  const client = getClient(); if (!client) return { ok: false, msg: 'مكتبة المزامنة مش محمّلة' };
  try {
    const { data: u, error: ue } = await client.auth.getUser();
    if (ue || !u || !u.user || !u.user.email) return { ok: false, msg: 'سجّل دخول بالإيميل الأول' };
    const chk = await client.auth.signInWithPassword({ email: u.user.email, password: current });
    if (chk.error) return { ok: false, msg: isNetErr(chk.error) ? 'مفيش اتصال بالنت' : 'الباسورد الحالي غلط' };
    const up = await client.auth.updateUser({ password: next });
    if (up.error) return { ok: false, msg: 'تعذر التغيير: ' + up.error.message };
    return { ok: true };
  } catch (e) { return { ok: false, msg: 'حصلت مشكلة: ' + (e && e.message || e) }; }
};

injectLoginFields();
root.cloudSetupUI('admin');

/* ---- إدارة حسابات المشرفين (أونلاين) ---- */
root.manageSupervisors = async function () {
  const client = getClient(); if (!client) return alert('مكتبة المزامنة مش محمّلة');
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  document.body.appendChild(ov);
  const draw = async (msg) => {
    ov.innerHTML = '<div style="background:#fff;border-radius:14px;padding:16px;width:100%;max-width:380px;direction:rtl">جاري التحميل…</div>';
    const { data: list, error } = await client.from('profiles').select('*').eq('role', 'supervisor').order('created_at');
    if (error) { ov.innerHTML = '<div style="background:#fff;border-radius:14px;padding:16px;direction:rtl">تعذر التحميل: ' + esc(error.message) + '<br><button class="toggle-btn full-btn" id="xsClose">إغلاق</button></div>'; ov.querySelector('#xsClose').onclick = () => ov.remove(); return; }
    ov.innerHTML = '<div style="background:#fff;border-radius:14px;padding:16px;width:100%;max-width:380px;max-height:85vh;overflow:auto;direction:rtl"><h3 style="margin:0 0 10px">👷 حسابات المشرفين</h3>' +
      (list.length ? list.map((s, i) => '<div style="padding:8px 0;border-bottom:1px solid #eee"><div style="display:flex;justify-content:space-between;align-items:center"><span>' + esc(s.phone) + '</span><span><button class="toggle-btn" data-cus="' + i + '">💰 عهدة</button> <button class="toggle-btn" data-edit="' + i + '">✏️</button> <button class="toggle-btn" data-del="' + i + '">🗑</button></span></div><small style="color:#888">' +
        (s.group_ids || []).filter(id => groups.some(g => g.id === id)).map(id => esc(groups.find(g => g.id === id).name)).join('، ') + '</small></div>').join('') : '<div style="color:#888">لا يوجد مشرفين</div>') +
      '<div style="margin-top:10px;font-size:13px">المجموعات المسموحة (مجموعة أو أكتر):</div>' +
      groups.map(g => '<label style="display:block;margin:4px 0"><input type="checkbox" class="xsG" value="' + esc(g.id) + '"> ' + esc(g.name) + '</label>').join('') +
      '<input id="xsPh" type="tel" placeholder="رقم موبايل المشرف" style="width:100%;margin-top:6px">' +
      '<input id="xsPw" type="password" placeholder="الباسورد (8 أحرف أو أكتر، حروف وأرقام) — سيبه فاضي لو بتغيّر المجموعات بس" style="width:100%;margin-top:6px">' +
      '<div id="xsErr" style="color:#c0392b;font-size:12px;min-height:16px">' + esc(msg || '') + '</div>' +
      '<button id="xsAdd" class="toggle-btn full-btn">إضافة / تعديل</button><button id="xsClose" class="toggle-btn full-btn" style="margin-top:6px">إغلاق</button></div>';
    ov.querySelector('#xsClose').onclick = () => ov.remove();
    ov.querySelectorAll('[data-cus]').forEach(b => b.onclick = () => root.openCustodyAdmin(list[+b.dataset.cus].phone));
    ov.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      const s = list[+b.dataset.edit]; ov.querySelector('#xsPh').value = s.phone;
      ov.querySelectorAll('.xsG').forEach(c => { c.checked = (s.group_ids || []).includes(c.value); });
    });
    ov.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const s = list[+b.dataset.del];
      if (!(await showConfirm('حذف حساب المشرف ' + s.phone + '؟'))) return;
      const { error: de } = await client.rpc('admin_delete_supervisor', { p_id: s.id });
      draw(de ? 'تعذر الحذف: ' + de.message : '');
    });
    ov.querySelector('#xsAdd').onclick = async () => {
      const err = ov.querySelector('#xsErr'), ph = normPhone(ov.querySelector('#xsPh').value), pw = ov.querySelector('#xsPw').value;
      const gids = Array.from(ov.querySelectorAll('.xsG:checked')).map(x => x.value);
      if (ph.length < 10) return err.textContent = 'رقم الموبايل غير صحيح';
      if (!gids.length) return err.textContent = 'اختار مجموعة واحدة على الأقل';
      const existing = list.find(s => s.phone === ph);
      if (!existing && (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw))) return err.textContent = 'الباسورد لازم 8 أحرف على الأقل، فيها حروف وأرقام';
      if (pw && (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw))) return err.textContent = 'الباسورد لازم 8 أحرف على الأقل، فيها حروف وأرقام';
      err.textContent = 'جاري الحفظ…';
      try {
        let id = existing && existing.id;
        if (!existing) {
          const tmp = root.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'salaryAppSbTmp' } });
          const { data, error } = await tmp.auth.signUp({ email: phoneEmail(ph), password: pw });
          if (error && !/registered|exists/i.test(error.message)) throw error;
          if (error) { const r = await client.rpc('admin_set_user_password', { p_email: phoneEmail(ph), p_password: pw }); if (r.error) throw r.error; id = r.data; }
          else id = data.user && data.user.id;
          if (!id) throw new Error('لم يتم إنشاء الحساب — تأكد إن Confirm email مقفول في Supabase');
        } else if (pw) {
          const r = await client.rpc('admin_set_user_password', { p_email: phoneEmail(ph), p_password: pw }); if (r.error) throw r.error;
        }
        const up = await client.from('profiles').upsert({ id, role: 'supervisor', phone: ph, group_ids: gids }, { onConflict: 'id' });
        if (up.error) throw up.error;
        draw('تم الحفظ ✅');
      } catch (e) { err.textContent = 'تعذر الحفظ: ' + (e.message || e); }
    };
  };
  draw();
};

})(typeof window !== 'undefined' ? window : globalThis);
