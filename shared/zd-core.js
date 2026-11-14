/* =====================================================================
   ZD Licensing - shared helpers (no build step, plain script)
   Load order: shared/zd-config.js -> shared/zd-card.js -> shared/zd-core.js -> app

   Same patterns as the CG HUBS and MJE Hubs:
     - Microsoft sign-in with MSAL (PKCE, redirect only - no popups)
     - SharePoint through Microsoft Graph, unknown columns skipped on save
     - Local-date helpers (never toISOString for dates - UTC+10)
     - An offline queue (IndexedDB) for everything that is saved. Each row
       carries a ClientRef made on this device; before sending, SharePoint
       is checked for that ClientRef, so a retry can never make a duplicate.
   No licence data in this file - the repo is public.
   ===================================================================== */

/* ---------------- settings derived from zd-config.js ---------------- */
const BRAND = (() => {
  const b = Object.assign({ COMPANY: "ZD Systems", SHORT: "ZD", CARD_TITLE: "FIREARMS LICENCE", ISSUER: "",
    LIST_PREFIX: "ZD_", OFFICE_GROUP: "ZD Licensing Office" }, typeof ZD_BRAND === "object" ? ZD_BRAND : {});
  if (b.STORE_TAG == null) b.STORE_TAG = (ZD_TENANT.SP_HOST + ZD_TENANT.SITE_PATH).toLowerCase();
  return b;
})();
const RULES = Object.assign({ FACE_RECHECK_HOURS: 12, OFFLINE_GRACE_HOURS: 12, LICENCE_YEARS: 3 },
  typeof ZD_RULES === "object" ? ZD_RULES : {});
const CHOICES = typeof ZD_CHOICES === "object" ? ZD_CHOICES : { LICENCE_TYPES: [], FIREARM_TYPES: [], STATUSES: ["Active"] };
const DEMO = String(ZD_TENANT.CLIENT_ID).startsWith("<<");
const FACE_API = DEMO ? "" : String(typeof ZD_FACE_API === "string" ? ZD_FACE_API : "").trim();
const L = n => BRAND.LIST_PREFIX + n;
const LISTS = {
  holders: L("Holders"), licences: L("Licences"), firearms: L("Firearms"), staff: L("Staff"), activity: L("Activity"),
  codes: L("Codes"),
  photos: L("LicencePhotos"), backgrounds: L("CardBackgrounds")
};
const SCOPES = ["Sites.ReadWrite.All", "User.Read"];
const storeKey = k => BRAND.STORE_TAG ? `${k}|${BRAND.STORE_TAG}` : k;

/* ---------------- small helpers ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // local date
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const today = () => ymd(new Date());
const addYears = (s, n) => { const [y, m, d] = s.split("-").map(Number); const t = new Date(y + n, m - 1, d); t.setDate(t.getDate() - 1); return ymd(t); };
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y, m - 1, d + n)); };
const fmtDate = s => ZDCard.dmy(s);
const localStamp = iso => { const d = new Date(iso); return isNaN(d) ? "" : `${fmtDate(ymd(d))} ${hhmm(d)}`; };
const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 20);
const isNetErr = e => e instanceof TypeError || e?.kind === "offline" || /failed to fetch|networkerror|load failed|network request failed|offline/i.test(e?.message || "");
const isForbidden = e => e?.status === 403 || /access denied|forbidden|not authori[sz]ed/i.test(e?.message || "");
const isMissingList = e => e?.status === 404 || /not (be )?found|does not exist/i.test(e?.message || "");
let FORCE_OFFLINE = false;                      // DEMO only: "Pretend offline" switch for testing
const online = () => navigator.onLine && !FORCE_OFFLINE;
function toast(msg) { const t = $("#toast"); if (!t) return; t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2800); }
const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Image couldn't be loaded")); i.src = src; });
async function blobImage(blob) { const u = URL.createObjectURL(blob); try { return await loadImage(u); } finally { setTimeout(() => URL.revokeObjectURL(u), 10000); } }

/* ---------------- browser database: queue + offline copies ----------------
   "queue" - changes waiting to go to SharePoint (photos included)
   "kv"    - offline copies: the register snapshot, photos, backgrounds,
             and (DEMO only) the pretend SharePoint lists                 */
let DBP = null;
function db() {
  return DBP ||= new Promise((res, rej) => {
    const r = indexedDB.open(storeKey("zd-licensing"), 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("queue", { keyPath: "qid", autoIncrement: true });
      r.result.createObjectStore("kv");
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const st = d.transaction(store, mode).objectStore(store), r = fn(st); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const kvGet = k => idb("kv", "readonly", s => s.get(k));
const kvSet = (k, v) => idb("kv", "readwrite", s => s.put(v, k));
const kvDel = k => idb("kv", "readwrite", s => s.delete(k));

/* ---------------- Microsoft sign-in (MSAL 3, redirect only) ---------------- */
let msalApp = null, account = null;
const me = () => String(account?.username || (DEMO ? "demo@zd.local" : "")).toLowerCase();
async function initAuth() {
  if (DEMO) { account = { username: "demo@zd.local", name: "Demo Officer" }; return; }
  msalApp = new msal.PublicClientApplication({
    auth: { clientId: ZD_TENANT.CLIENT_ID, authority: `https://login.microsoftonline.com/${ZD_TENANT.TENANT_ID}`,
            redirectUri: location.origin + location.pathname },
    cache: { cacheLocation: "localStorage" }
  });
  await msalApp.initialize();
  const r = await msalApp.handleRedirectPromise().catch(e => { console.warn(e); return null; });
  account = r?.account || msalApp.getAllAccounts()[0] || null;
  if (account) msalApp.setActiveAccount(account);
}
const signIn = () => msalApp.loginRedirect({ scopes: SCOPES });
const signOut = () => { sessionStorage.clear(); return DEMO ? location.reload() : msalApp.logoutRedirect({ account }); };
/* A token without ever leaving the page; offline or expired sign-in just throws. */
async function quietToken() {
  try { return (await msalApp.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; }
  catch (e) { const err = new Error(isNetErr(e) || /network|timed_out|no_network/i.test(e.errorCode || e.message) ? "offline" : "signin"); err.kind = err.message; throw err; }
}
async function token() {
  try { return await quietToken(); }
  catch (e) { if (e.kind === "signin") { await msalApp.acquireTokenRedirect({ scopes: SCOPES, account }); } throw e; }
}
/* The ID token proves to the face service who is asking. */
async function idToken() {
  let r = await msalApp.acquireTokenSilent({ scopes: SCOPES, account });
  const exp = Number(r?.idTokenClaims?.exp) || 0;
  if (!r?.idToken || exp - Date.now() / 1000 < 300) r = await msalApp.acquireTokenSilent({ scopes: SCOPES, account, forceRefresh: true });
  if (!r?.idToken) throw new Error("Couldn't confirm your sign-in - please sign out and in again.");
  return r.idToken;
}

/* ---------------- Microsoft Graph / SharePoint ---------------- */
let siteId = null;
async function graph(path, opts = {}, tries = 0) {
  if (!online()) { const e = new Error("offline"); e.kind = "offline"; throw e; }
  const r = await fetch(path.startsWith("http") ? path : "https://graph.microsoft.com/v1.0" + path, {
    ...opts, headers: { Authorization: "Bearer " + await token(), "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  if ((r.status === 429 || r.status === 503) && tries < 3) {           // SharePoint busy: wait and retry
    await new Promise(s => setTimeout(s, (Number(r.headers.get("Retry-After")) || 2 ** tries) * 1000));
    return graph(path, opts, tries + 1);
  }
  if (!r.ok) { let m = r.status + " " + r.statusText; try { m = (await r.json()).error.message; } catch {} const e = new Error(m); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}
async function getSite() { siteId = (await graph(`/sites/${ZD_TENANT.SP_HOST}:${ZD_TENANT.SITE_PATH}`)).id; }
async function listItems(list) {
  if (DEMO) return (await kvGet("demo:" + list)) || [];
  let url = `/sites/${siteId}/lists/${list}/items?expand=fields&$top=999`, out = [];
  while (url) { const j = await graph(url); out.push(...j.value.map(i => ({ id: i.id, ...i.fields }))); url = j["@odata.nextLink"]; }
  return out;
}
async function findByRef(list, ref) {
  if (DEMO) return ((await kvGet("demo:" + list)) || []).find(x => x.ClientRef === ref) || null;
  const j = await graph(`/sites/${siteId}/lists/${list}/items?$filter=fields/ClientRef eq '${ref}'&expand=fields&$top=1`,
    { headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" } });
  const it = j.value?.[0]; return it ? { id: it.id, ...it.fields } : null;
}
/* Create or update with field fallback: strip columns SharePoint doesn't know and retry.
   Any column that had a value is remembered in SKIPPED, and the app shows a red warning. */
const SKIPPED = new Set();
async function saveItem(list, id, fields) {
  if (DEMO) {
    const rows = (await kvGet("demo:" + list)) || [];
    let row = id ? rows.find(r => r.id === id) : null;
    if (row) Object.assign(row, fields); else { row = { id: "d" + Date.now() + Math.random().toString(36).slice(2, 6), ...fields, Created: new Date().toISOString() }; rows.push(row); }
    await kvSet("demo:" + list, rows); return { ...row };
  }
  const base = `/sites/${siteId}/lists/${list}/items`;
  let f = { ...fields };
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res = id ? await graph(`${base}/${id}/fields`, { method: "PATCH", body: JSON.stringify(f) })
                     : await graph(base, { method: "POST", body: JSON.stringify({ fields: f }) });
      return id ? { id, ...res } : { id: res.id, ...res.fields };
    } catch (e) {
      const m = /Field '([^']+)' is not recognized/i.exec(e.message);
      if (m && m[1] in f) {
        console.warn("Column not on list, skipped:", list, m[1]);
        if (f[m[1]] !== "" && f[m[1]] != null) { SKIPPED.add(`${list}.${m[1]}`); SYNC.onChange(); toast(`Not saved: ${m[1]} - SharePoint has no such column (run the set-up script)`); }
        delete f[m[1]]; continue;
      }
      throw e;
    }
  }
}
async function deleteItem(list, id) {
  if (DEMO) { await kvSet("demo:" + list, ((await kvGet("demo:" + list)) || []).filter(r => r.id !== id)); return; }
  await graph(`/sites/${siteId}/lists/${list}/items/${id}`, { method: "DELETE" });
}

/* ---------------- document libraries (photos, backgrounds) ---------------- */
const DRIVES = {};
async function driveOf(list) {
  if (DEMO) return "demo";
  if (DRIVES[list] === undefined) { try { DRIVES[list] = (await graph(`/sites/${siteId}/lists/${list}/drive`)).id; } catch (e) { if (isNetErr(e)) throw e; DRIVES[list] = null; } }
  return DRIVES[list];
}
async function uploadFile(list, path, blob, type = "image/jpeg") {
  if (DEMO) { const key = `demofile:${list}/${path}`; await kvSet(key, blob); return { id: key, webUrl: "#demo", name: path.split("/").pop() }; }
  const drive = await driveOf(list);
  if (!drive) throw Object.assign(new Error(`The ${list} library isn't set up`), { status: 404 });
  const r = await fetch(`https://graph.microsoft.com/v1.0/drives/${drive}/root:/${path.split("/").map(encodeURIComponent).join("/")}:/content`,
    { method: "PUT", headers: { Authorization: "Bearer " + await token(), "Content-Type": type }, body: blob });
  if (!r.ok) { const e = new Error(r.status === 403 ? "you don't have permission to add files" : `upload failed (${r.status})`); e.status = r.status; throw e; }
  return r.json();
}
async function downloadFile(list, itemId) {
  if (DEMO) return kvGet(itemId);
  const drive = await driveOf(list);
  const r = await fetch(`https://graph.microsoft.com/v1.0/drives/${drive}/items/${itemId}/content`, { headers: { Authorization: "Bearer " + await token() } });
  if (!r.ok) throw Object.assign(new Error(`download failed (${r.status})`), { status: r.status });
  return r.blob();
}
/* Library files with their columns (backgrounds) */
async function libraryFiles(list) {
  if (DEMO) return (await kvGet("demo:" + list)) || [];
  const drive = await driveOf(list); if (!drive) throw Object.assign(new Error("missing"), { status: 404 });
  let url = `/sites/${siteId}/lists/${list}/items?expand=fields,driveItem&$top=999`, out = [];
  while (url) {
    const j = await graph(url);
    out.push(...j.value.filter(i => i.driveItem?.file).map(i => ({ id: i.id, fileId: i.driveItem.id, name: i.driveItem.name, ...i.fields })));
    url = j["@odata.nextLink"];
  }
  return out;
}
async function setFileFields(list, listItemId, fields) {
  if (DEMO) return saveItem(list, listItemId, fields);
  return graph(`/sites/${siteId}/lists/${list}/items/${listItemId}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
}
async function addLibraryFile(list, name, blob, fields) {
  if (DEMO) {
    const up = await uploadFile(list, name, blob, blob.type);
    return saveItem(list, null, { ...fields, name, fileId: up.id, FileLeafRef: name });
  }
  const up = await uploadFile(list, name, blob, blob.type || "image/png");
  const li = await graph(`/drives/${await driveOf(list)}/items/${up.id}/listItem`);
  await setFileFields(list, li.id, fields);
  return { id: li.id, fileId: up.id, name: up.name, ...fields };
}

/* =====================================================================
   OFFLINE QUEUE
   op = { user, kind:"upsert"|"face", list, ref, fields, file, label, created, tries, error }
     upsert - find the row by ClientRef: update it if it's there, else create it.
              A photo travels with it and is uploaded first.
     face   - (licence holder's face) sent to the face service once online,
              then the FaceId is written onto the licence.
   Ops are sent in the order they were made.
   ===================================================================== */
const SYNC = { waiting: 0, error: "", busy: false, onChange: () => {} };
const qAll = () => idb("queue", "readonly", s => s.getAll());
const qMine = async () => (await qAll()).filter(o => o.user === me());
const qPut = op => idb("queue", "readwrite", s => s.put(op));
const qDel = qid => idb("queue", "readwrite", s => s.delete(qid));
async function qCount() { const ops = await qMine(); SYNC.waiting = ops.length; SYNC.error = ops.find(o => o.error)?.error || ""; SYNC.onChange(); return ops; }
async function enqueue(op) {
  await idb("queue", "readwrite", s => s.add({ user: me(), created: new Date().toISOString(), tries: 0, error: "", file: null, ...op }));
  await qCount(); flushSoon(300);
}
let FLUSH_T = null;
const flushSoon = (ms = 1500) => { clearTimeout(FLUSH_T); FLUSH_T = setTimeout(flushQueue, ms); };
const SENT_HOOKS = [];
const KNOWN_IDS = new Map();                    // list|ClientRef -> SharePoint id of rows sent from this device                          // app listens: (op, savedRow) after each op is sent

async function sendOp(op) {
  if (op.kind === "face") {
    const r = await faceCall({ action: "licenseeEnrol", ref: op.ref, image: await blobToB64(op.file.blob) });
    const f = { ClientRef: op.ref, FaceId: r.faceId || "", FaceStatus: r.duplicates?.length ? "Check" : "Enrolled",
      FaceNote: r.duplicates?.length ? "Same face as holder(s): " + r.duplicates.map(d => `${d.ref} (${d.similarity}%)`).join(", ") : "", FaceDate: today() };
    return sendOp({ kind: "upsert", list: LISTS.holders, ref: op.ref, fields: f });
  }
  const f = { ...op.fields, ClientRef: op.fields.ClientRef || op.ref };   // a converted row may take a new ClientRef
  // A row this device created moments ago may not show up in SharePoint's search yet, so
  // remember its id: otherwise a quick second change would create a second copy.
  const known = KNOWN_IDS.get(op.list + "|" + op.ref) || (await kvGet("id:" + op.list + "|" + op.ref).catch(() => null));
  const found = known ? { id: known } : await findByRef(op.list, op.ref);
  if (op.file?.blob && !f.PhotoItemId) {
    const up = await uploadFile(LISTS.photos, op.file.path, op.file.blob, op.file.type || "image/jpeg");
    f.PhotoUrl = up.webUrl; f.PhotoItemId = up.id;
    await kvSet("photo:" + up.id, op.file.blob);                        // keep the offline copy under its real id
  }
  const saved = await saveItem(op.list, found?.id || null, f);
  for (const r of new Set([op.ref, f.ClientRef])) { KNOWN_IDS.set(op.list + "|" + r, saved.id); kvSet("id:" + op.list + "|" + r, saved.id).catch(() => {}); }
  return saved;
}
async function flushQueue() {
  if (SYNC.busy) return; SYNC.busy = true;
  let sent = 0;
  try {
    const ops = await qMine(); if (!ops.length || !online()) return;
    if (!DEMO) {
      try { await quietToken(); if (!siteId) await getSite(); }
      catch (e) { if (e.kind === "signin") { SYNC.error = "Sign in again to send your changes"; SYNC.onChange(); } return; }
    }
    for (const op of ops) {
      if (!online()) break;
      try {
        const saved = await sendOp(op);
        await qDel(op.qid); sent++;
        SENT_HOOKS.forEach(h => { try { h(op, saved); } catch (e) { console.warn(e); } });
      } catch (e) {
        if (isNetErr(e)) break;                                        // connection dropped: try again later
        if (op.kind === "face" && e.status >= 400 && e.status < 500 && e.status !== 401) {
          // The photo itself was refused (no face, two faces, too dark): record it on the licence and move on
          try {
            const saved = await sendOp({ kind: "upsert", list: LISTS.holders, ref: op.ref, fields: { FaceStatus: "Failed", FaceNote: e.message, FaceDate: today() } });
            await qDel(op.qid); SENT_HOOKS.forEach(h => { try { h({ ...op, kind: "upsert" }, saved); } catch {} }); continue;
          } catch (e2) { if (isNetErr(e2)) break; }
        }
        op.tries = (op.tries || 0) + 1;
        op.error = isForbidden(e) ? "SharePoint refused this change (no permission)" : (e.message || "Failed");
        await qPut(op);
        if (op.kind === "upsert") break;                               // keep order: later changes may depend on it
      }
    }
  } finally {
    SYNC.busy = false; await qCount();
    if (sent) toast(`${sent} change${sent === 1 ? "" : "s"} sent to SharePoint`);
  }
}
window.addEventListener("online", () => flushSoon(500));
setInterval(() => { if (SYNC.waiting) flushSoon(0); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && SYNC.waiting) flushSoon(0); });

/* =====================================================================
   FACE SERVICE (aws/zd-face-api). Who is asking comes from the Microsoft
   ID token, never from this page. In DEMO mode it is simulated.
   ===================================================================== */
async function faceCall(body) {
  if (DEMO) return demoFace(body);
  if (!FACE_API) throw Object.assign(new Error("The face service isn't set up (ZD_FACE_API in zd-config.js)."), { code: "NO_SERVICE" });
  if (!online()) { const e = new Error("offline"); e.kind = "offline"; throw e; }
  let res;
  try {
    res = await fetch(FACE_API, { method: "POST", headers: { Authorization: "Bearer " + await idToken(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) { const err = new Error("Couldn't reach the face service - check the internet connection."); err.kind = "offline"; throw err; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `Face service error (${res.status})`); err.code = data.code; err.status = res.status; throw err; }
  return data;
}
/* DEMO: pretend face service. Remembers who "enrolled" in this browser. */
async function demoFace(b) {
  if (!online()) { const e = new Error("offline"); e.kind = "offline"; throw e; }
  await new Promise(r => setTimeout(r, 400));
  const staff = (await kvGet("demoface:staff")) || [], lic = (await kvGet("demoface:licensees")) || [];
  switch (b.action) {
    case "status": return { enrolled: staff.includes(me()), admin: true };
    case "enrol": staff.push(me()); await kvSet("demoface:staff", staff); return { enrolled: true };
    case "verify": return { verified: true, similarity: 99.1 };
    case "list": return { employees: staff.map(e => ({ email: e, faces: 1 })) };
    case "reset": await kvSet("demoface:staff", staff.filter(e => e !== b.email)); return { removed: 1 };
    case "licenseeEnrol": { const id = "demo-" + b.ref; if (!lic.includes(b.ref)) lic.push(b.ref); await kvSet("demoface:licensees", lic); return { faceId: id, duplicates: [] }; }
    case "licenseeSearch": return { matches: lic.slice(-1).map(ref => ({ ref, similarity: 97.4 })) };
    case "licenseeRemove": await kvSet("demoface:licensees", lic.filter(r => r !== b.ref)); return { removed: 1 };
  }
  return {};
}

/* Face pass for this device: a successful check at sign-in. */
const PASS_KEY = () => storeKey("zd-facepass");
function facePass() { try { const p = JSON.parse(localStorage.getItem(PASS_KEY()) || "null"); return p && p.user === me() ? p : null; } catch { return null; } }
function setFacePass(note) { const p = { user: me(), at: Date.now(), note }; localStorage.setItem(PASS_KEY(), JSON.stringify(p)); sessionStorage.setItem(PASS_KEY(), "1"); return p; }
function clearFacePass() { localStorage.removeItem(PASS_KEY()); sessionStorage.removeItem(PASS_KEY()); }
const hoursSince = t => (Date.now() - t) / 3600000;
/* "ok" - passed in this browser session and recently
   "offline" - no internet, but passed on this device within the grace period
   "needed" - take a face check now                                        */
function facePassState() {
  const p = facePass();
  if (p && sessionStorage.getItem(PASS_KEY()) && hoursSince(p.at) < RULES.FACE_RECHECK_HOURS) return "ok";
  if (!online() && p && RULES.OFFLINE_GRACE_HOURS > 0 && hoursSince(p.at) < RULES.OFFLINE_GRACE_HOURS) return "offline";
  return "needed";
}
