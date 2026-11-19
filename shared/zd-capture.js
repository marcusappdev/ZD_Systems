/* =====================================================================
   BACK-CAPTURE - digitising the old paper files (Permit to Buy, Delivery
   Docket, Notice of Disposal). One screen: the scan on the left, a short
   form on the right, "Save & next" to move through a lever-arch file.

   Scans are separate PDFs (or pictures) named like
     20261119-001_PTB_Guo_Shujie.pdf   20261119-002_NOD_Guo_Shujie.pdf
   Consecutive files for the same name are treated as one set (one firearm).
   Saving: finds or creates the holder, creates the licence (or attaches to
   the existing one with that serial number), records the previous owner,
   attaches every scan as a document, and can take the holder's photo from
   the card copy on the docket. Optional automatic reading fills the form
   (switched on with ZD_RULES.AUTO_READ once the AWS side is set up).
   Uses index.html's globals (D, LISTS, enqueue, holder, lic ...).
   ===================================================================== */

const CAP = { files: [], sets: [], i: 0, photo: null, pages: {} };
const CAP_TYPES = ["PTB", "Delivery Docket", "NOD"];
const CAP_TYPE_NAMES = { PTB: "Permit to Buy", "Delivery Docket": "Delivery Docket", NOD: "Notice of Disposal" };

/* "20261119-001_PTB_Guo_Shujie.pdf" -> { date, seq, kind, person } */
function capParse(name) {
  const m = String(name).match(/^(\d{8})-(\d+)_([^_]+)_(.+?)\.(pdf|jpe?g|png|tiff?)$/i);
  if (!m) return { person: name.replace(/\.[^.]+$/, ""), kind: "", date: "", seq: "" };
  const d = m[1];
  return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, seq: m[2], kind: m[3].toUpperCase(), person: m[4].replace(/[_-]+/g, " ").trim() };
}
/* The document types a file most likely holds: the PTB sheet also carries the Delivery Docket */
function capGuessTypes(kind) {
  if (/^PTB/.test(kind)) return ["PTB", "Delivery Docket"];
  if (/^NOD/.test(kind)) return ["NOD"];
  if (/^(DD|DOCKET|DELIVERY)/.test(kind)) return ["Delivery Docket"];
  return [];
}
const capDone = f => (D.docs || []).some(d => d.OriginalName === f.name);   // already attached in an earlier session

function capLoadFiles(fileList) {
  const add = [...fileList].filter(f => /\.(pdf|jpe?g|png)$/i.test(f.name) && !CAP.files.some(x => x.name === f.name));
  CAP.files.push(...add.map(f => ({ name: f.name, file: f, info: capParse(f.name), types: capGuessTypes(capParse(f.name).kind) })));
  CAP.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  // consecutive files for the same person make one set
  CAP.sets = [];
  for (const f of CAP.files) {
    const last = CAP.sets[CAP.sets.length - 1];
    if (last && norm(last.person) === norm(f.info.person)) last.files.push(f);
    else CAP.sets.push({ person: f.info.person, files: [f] });
  }
  CAP.sets.forEach(s => s.done = s.files.every(capDone));
  CAP.i = Math.max(0, CAP.sets.findIndex(s => !s.done));
  if (add.length < fileList.length) toast(`${fileList.length - add.length} file(s) skipped (not a PDF / picture, or already in the list)`);
}

/* ---------- showing a scan: PDF pages are drawn with PDF.js (shared/vendor/pdfjs, Apache-2.0) ---------- */
let PDFJS = null;
async function pdfjs() {
  if (PDFJS) return PDFJS;
  const base = new URL("shared/vendor/pdfjs/", location.href).href;   // classic script: resolve from the page, not the script
  PDFJS = await import(base + "pdf.min.mjs");
  PDFJS.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
  return PDFJS;
}
/* -> array of canvases (one per page), about 1600 px on the long side */
async function capPages(f) {
  if (CAP.pages[f.name]) return CAP.pages[f.name];
  let out = [];
  if (/\.pdf$/i.test(f.name)) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await f.file.arrayBuffer()) }).promise;
    for (let p = 1; p <= Math.min(doc.numPages, 6); p++) {
      const page = await doc.getPage(p), v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 1600 / Math.max(v1.width, v1.height) });
      const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      out.push(cv);
    }
  } else {
    const bmp = await createImageBitmap(f.file), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); out = [cv];
  }
  return (CAP.pages[f.name] = out);
}

/* ---------- the page ---------- */
function pageCapture() {
  const set = CAP.sets[CAP.i];
  const doneN = CAP.sets.filter(s => s.done).length;
  $("#main").innerHTML = banners() + `<div class="bar"><h2>Back-capture</h2>
      <span class="small muted" style="margin-left:10px">${CAP.sets.length ? `${doneN} of ${CAP.sets.length} sets done · ${CAP.files.length} scans` : "Digitise the paper files: PTB, Delivery Docket, NOD"}</span>
      <span class="grow"></span>
      <label class="btn sm ${CAP.sets.length ? "" : "primary"}" style="margin:0">${CAP.sets.length ? "Add scans" : "Choose scanned files"}<input type="file" id="capFiles" accept=".pdf,image/*" multiple hidden></label>
      ${CAP.sets.length ? `<button class="btn sm" id="capPrev" ${CAP.i <= 0 ? "disabled" : ""}>◀ Previous</button><button class="btn sm" id="capNext" ${CAP.i >= CAP.sets.length - 1 ? "disabled" : ""}>Skip ▶</button>` : ""}</div>
    ${!set ? `<div class="card cap-drop" id="capDrop"><p><b>Drop the scanned PDFs here</b>, or click <b>Choose scanned files</b>.</p>
        <p class="small muted">Name them like <span class="mono">20261119-001_PTB_Guo_Shujie.pdf</span> and <span class="mono">20261119-002_NOD_Guo_Shujie.pdf</span>:
        consecutive files with the same name are one set (one firearm), and PTB / NOD / DD in the name ticks the document type.
        Scans already attached in the app are marked done.</p></div>`
      : `<div class="cap-grid">
      <div class="card cap-view"><div class="bar" style="flex-wrap:wrap;gap:6px">
          ${set.files.map((f, k) => `<button class="btn sm ${k === (CAP.tab || 0) ? "primary" : ""}" data-tab="${k}">${esc(f.info.kind || "Scan")} ${capDone(f) ? "✓" : ""}</button>`).join("")}
          <span class="grow"></span>
          <button class="btn sm" id="capZoom">Zoom</button>
          <button class="btn sm" id="capPhoto" title="Draw the holder's photo from the card copy on this scan">Photo from scan</button></div>
        <div class="small muted mono" id="capName" style="margin:6px 0"></div>
        <div id="capPage" class="cap-page"><p class="muted">Loading the scan…</p></div></div>
      <form class="card cap-form" id="capForm" autocomplete="off">${capFormHtml(set)}</form></div>`}`;
  $("#capFiles").onchange = e => { capLoadFiles(e.target.files); e.target.value = ""; CAP.tab = 0; CAP.photo = null; pageCapture(); };
  const drop = $("#capDrop") || $("#main");
  drop.ondragover = e => { if (hasFiles(e)) { e.preventDefault(); } };
  drop.ondrop = e => { if (!hasFiles(e)) return; e.preventDefault(); capLoadFiles(e.dataTransfer.files); CAP.tab = 0; CAP.photo = null; pageCapture(); };
  if (!set) return;
  $("#capPrev").onclick = () => capGo(CAP.i - 1);
  $("#capNext").onclick = () => capGo(CAP.i + 1);
  $$("[data-tab]").forEach(b => b.onclick = () => { CAP.tab = +b.dataset.tab; capShow(set); $$("[data-tab]").forEach(x => x.classList.toggle("primary", x === b)); });
  $("#capZoom").onclick = () => $("#capPage").classList.toggle("zoomed");
  $("#capPhoto").onclick = async () => {
    const cv = (await capPages(set.files[CAP.tab || 0]))[0];
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92));
    const out = await openCrop(blob, { maxZoom: 14 });
    if (out && out !== "retake") { CAP.photo = out; capShowPhoto(); markDirty(); }
  };
  capWireForm(set);
  capShow(set);
}
function capGo(i) {
  if (i < 0 || i >= CAP.sets.length) return;
  if (S.dirty) return ask("This set has changes that aren't saved. Move on without saving?", { title: "Not saved", yes: "Move on", no: "Stay" }).then(ok => { if (ok) { S.dirty = false; capGo(i); } });
  CAP.i = i; CAP.tab = 0; CAP.photo = null; S.dirty = false; pageCapture(); window.scrollTo(0, 0);
}
async function capShow(set) {
  const f = set.files[CAP.tab || 0];
  $("#capName").textContent = `${f.name} · set ${CAP.i + 1} of ${CAP.sets.length}`;
  try {
    const pages = await capPages(f), box = $("#capPage"); if (!box) return;
    box.innerHTML = ""; pages.forEach(cv => { const img = document.createElement("img"); img.src = cv.toDataURL("image/jpeg", 0.85); box.appendChild(img); });
  } catch (e) { $("#capPage").innerHTML = `<p style="color:var(--bad)">This scan couldn't be shown: ${esc(e.message)}</p>`; }
}
function capShowPhoto() {
  const slot = $("#capPhotoSlot"); if (!slot) return;
  slot.innerHTML = CAP.photo ? `<img src="${URL.createObjectURL(CAP.photo)}" alt="">` : `<div class="nophoto small">No photo</div>`;
}

/* ---------- the form ---------- */
function capFormHtml(set) {
  const first = set.files[0].info, people = D.holders.slice().sort((a, b) => sortName(a).localeCompare(sortName(b)));
  const opts = people.map(x => `<option value="${esc((x.LicenceNo ? cleanNo(x.LicenceNo) + " · " : "") + fullName(x))}">`).join("");
  const nameParts = String(set.person || "").split(/\s+/);   // file names are First_Last as on the card (Guo_Shujie) - check against the card
  return `
    <div class="bar"><h3 style="margin:0">${esc(set.person || "Set")}</h3><span class="grow"></span>
      ${RULES.AUTO_READ ? `<button type="button" class="btn sm" id="capRead">Read automatically</button>`
        : `<span class="small muted" title="Switched off until the AWS reading service is set up (ZD_RULES.AUTO_READ)">Automatic reading: off</span>`}</div>
    <div id="capMsg" class="small" style="margin:8px 0"></div>
    <h4 class="subhead">Licence holder (new owner)</h4>
    <label>Already in the register? Find by name or licence no<input type="search" id="capFind" list="capPeople" placeholder="e.g. 114608 or Guo">
      <datalist id="capPeople">${opts}</datalist></label>
    <input type="hidden" name="HolderRef">
    <div class="kindpick">${["Individual", "Company"].map(k => `<label class="chk"><input type="radio" name="HolderKind" value="${k}" ${k === "Individual" ? "checked" : ""}> ${k}</label>`).join("")}</div>
    <div class="grid3"><label>Licence no *<input type="text" name="LicenceNo" class="mono" placeholder="from the card, e.g. 114608"></label>
      <label class="cap-co">Company name<input type="text" name="CompanyName"></label><span class="cap-ind"></span></div>
    <div class="grid3"><label>Surname *<input type="text" name="Surname" value="${esc(nameParts.length > 1 ? nameParts[nameParts.length - 1] : "")}"></label>
      <label>First name *<input type="text" name="GivenNames" value="${esc(nameParts[0] || "")}"></label>
      <label>Middle name<input type="text" name="MiddleName" value="${esc(nameParts.slice(1, -1).join(" "))}"></label></div>
    <div class="grid2"><label>Address (as on the card)<textarea name="Address" rows="2"></textarea></label>
      <div style="display:flex;gap:10px;align-items:flex-start"><div id="capPhotoSlot" class="cap-photo"><div class="nophoto small">No photo</div></div>
        <p class="small muted" style="margin:0">Photo: use <b>Photo from scan</b> to cut it from the card copy on the docket.</p></div></div>
    <h4 class="subhead">Firearm</h4>
    <div class="grid3"><label>Serial no *<input type="text" name="SerialNo" class="mono"><span class="field-warn" id="capSnWarn" hidden></span></label>
      <label>Make<input type="text" name="Make"></label><label>Model<input type="text" name="Model"></label></div>
    <div class="grid3"><label>Type<select name="FirearmType">${codeOptions(codeList("Type"), "")}</select></label>
      <label>Calibre<input type="text" name="Calibre"></label><label>Chamber capacity<input type="text" name="Capacity" placeholder="e.g. 5 rds"></label></div>
    <h4 class="subhead">Licence</h4>
    ${purposePicker("", "")}
    <div class="grid3"><label>Class<select name="Class">${codeOptions(codeList("Class"), "")}</select></label>
      <label>Issued<input type="date" name="IssueDate"></label><label>Expires *<input type="date" name="ExpiryDate"></label></div>
    <h4 class="subhead">Permit to Buy &amp; Delivery Docket</h4>
    <div class="grid3"><label>PTB no<input type="text" name="PTBNo" class="mono"></label><label>PTB dated<input type="date" name="PTBDate"></label>
      <label>Delivered<input type="date" name="DeliveredDate"></label></div>
    <div class="grid2"><label>Official receipt no<input type="text" name="ReceiptNo" class="mono"></label><label>Office of issue<input type="text" name="OfficeOfIssue"></label></div>
    <h4 class="subhead">Notice of Disposal - previous owner</h4>
    <div class="grid2"><label>Previous owner<input type="text" name="PrevOwner" list="capPeopleNames"><datalist id="capPeopleNames">${people.map(x => `<option value="${esc(fullName(x))}">`).join("")}</datalist></label>
      <label>Previous licence no<input type="text" name="PrevLicenceNo" class="mono"></label></div>
    <label>NOD dated<input type="date" name="NODDate" style="max-width:220px"></label>
    <div id="capTransfer"></div>
    <h4 class="subhead">Scans in this set</h4>
    ${set.files.map((f, k) => `<div class="cap-file"><span class="mono small">${esc(f.name)}</span>${capDone(f) ? ` <span class="tag ok">attached</span>` : ""}<br>
      ${CAP_TYPES.map(t => `<label class="chk"><input type="checkbox" data-ft="${k}" value="${esc(t)}" ${f.types.includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join(" ")}</div>`).join("")}
    <div class="bar" style="margin-top:16px"><span class="grow"></span><button type="submit" class="btn primary" id="capSave">Save &amp; next set ⏎</button></div>`;
}

function capVal(form) {
  const fd = new FormData(form), f = {};
  for (const [k, v] of fd) if (k !== "PurposeCode") f[k] = String(v).trim();
  f.Purpose = purposeOrder(fd.getAll("PurposeCode").map(v => String(v).toUpperCase())).join("");
  f.LicenceNo = cleanNo(f.LicenceNo);
  return f;
}

function capWireForm(set) {
  const form = $("#capForm");
  form.oninput = markDirty;
  const kind = () => form.querySelector('[name="HolderKind"]:checked').value;
  const showKind = () => form.classList.toggle("kind-co", kind() === "Company");
  form.querySelectorAll('[name="HolderKind"]').forEach(r => r.onchange = showKind); showKind();
  // choosing someone already in the register
  $("#capFind").addEventListener("change", () => {
    const v = $("#capFind").value.trim().toLowerCase();
    const p = D.holders.find(x => ((x.LicenceNo ? cleanNo(x.LicenceNo) + " · " : "") + fullName(x)).toLowerCase() === v);
    if (!p) return;
    capLinkHolder(form, p); $("#capFind").value = "";
  });
  // typing a licence no that belongs to a holder links them
  form.elements.LicenceNo.addEventListener("change", () => {
    const n = cleanNo(form.elements.LicenceNo.value), p = n && D.holders.find(x => cleanNo(x.LicenceNo) === n);
    if (p && form.elements.HolderRef.value !== p.ClientRef) capLinkHolder(form, p);
  });
  // the issue date follows the expiry (one year licences) when it's blank
  form.elements.ExpiryDate.addEventListener("change", () => {
    const e = form.elements.ExpiryDate.value, i = form.elements.IssueDate;
    if (e && !i.value) { const d = new Date(e); d.setFullYear(d.getFullYear() - RULES.LICENCE_YEARS); d.setDate(d.getDate() + 1); i.value = ymd(d); }
  });
  form.elements.SerialNo.addEventListener("input", () => capCheckSerial(form));
  $("#capRead")?.addEventListener("click", () => capAutoRead(set, form));
  form.onsubmit = e => { e.preventDefault(); capSave(set, form); };
  capShowPhoto();
}

function capLinkHolder(form, p) {
  const set = (k, v) => { if (form.elements[k]) form.elements[k].value = v || ""; };
  set("HolderRef", p.ClientRef); set("LicenceNo", cleanNo(p.LicenceNo)); set("Surname", p.Surname); set("GivenNames", p.GivenNames);
  set("MiddleName", p.MiddleName); set("CompanyName", p.CompanyName); set("Address", p.Address);
  form.querySelector(`[name="HolderKind"][value="${isCompany(p) ? "Company" : "Individual"}"]`).checked = true;
  form.classList.toggle("kind-co", isCompany(p));
  $("#capMsg").innerHTML = `<span class="tag ok">In the register</span> Linked to <a href="#/holder/${encodeURIComponent(p.ClientRef)}" target="_blank">${esc(fullName(p))}</a>${p.LicenceNo ? " (" + esc(cleanNo(p.LicenceNo)) + ")" : ""} - their record is used, nothing new is created for them.`;
  markDirty(); capCheckSerial(form);
}

/* the serial number decides: new firearm, already captured (attach the scans), or a transfer from another owner */
function capCheckSerial(form) {
  const w = $("#capSnWarn"), t = $("#capTransfer"), sn = form.elements.SerialNo.value;
  const k = serialKey(sn), same = k ? D.licences.filter(x => !isLTC(x) && serialKey(x.SerialNo) === k && x.LicenceStatus !== "Cancelled") : [];
  const mine = same.find(x => x.HolderRef === form.elements.HolderRef.value), other = same.find(x => x.HolderRef !== form.elements.HolderRef.value);
  w.hidden = !same.length; t.innerHTML = "";
  if (mine) { w.className = "field-warn soft"; w.innerHTML = `Already captured: licence ${esc(mine.Title)} - the scans will be added to it`; }
  else if (other) {
    w.className = "field-warn"; w.innerHTML = `⚠ On licence ${esc(other.Title)} - ${esc(fullName(holder(other.HolderRef) || {}))}`;
    t.innerHTML = `<label class="chk cap-transfer"><input type="checkbox" name="Transfer" value="${esc(other.ClientRef)}" checked>
      Transfer: mark licence <b>${esc(other.Title)}</b> (${esc(fullName(holder(other.HolderRef) || {}))}) as <b>Cancelled</b> - the firearm was disposed of to the new owner</label>`;
    if (!form.elements.PrevOwner.value) form.elements.PrevOwner.value = fullName(holder(other.HolderRef) || {});
    if (!form.elements.PrevLicenceNo.value) form.elements.PrevLicenceNo.value = other.Title;
  }
  return { mine, other };
}

async function capSave(set, form) {
  const f = capVal(form), kind = f.HolderKind;
  const need = [["LicenceNo", "Licence no"], ["SerialNo", "Serial no"], ["ExpiryDate", "Expires"], ...(kind === "Company" ? [["CompanyName", "Company name"]] : [["Surname", "Surname"], ["GivenNames", "First name"]])];
  const missing = need.filter(([k]) => !f[k]).map(x => x[1]);
  if (missing.length) return toast("Please fill in: " + missing.join(", "));
  if (!f.Purpose) return toast("Tick at least one purpose");
  const types = set.files.map((_, k) => [...form.querySelectorAll(`[data-ft="${k}"]:checked`)].map(x => x.value));
  if (types.some(t => !t.length)) return toast("Tick what each scan is (PTB, Delivery Docket, NOD)");

  // 1. the holder: linked, found by licence no, or new
  let h = f.HolderRef && holder(f.HolderRef);
  const byNo = D.holders.find(x => cleanNo(x.LicenceNo) === f.LicenceNo);
  if (!h && byNo) h = byNo;
  if (h && cleanNo(h.LicenceNo) && cleanNo(h.LicenceNo) !== f.LicenceNo)
    return toast(`${fullName(h)} has licence no ${cleanNo(h.LicenceNo)}, not ${f.LicenceNo}. Check the number, or change it on the holder first.`);
  if (byNo && h && byNo.ClientRef !== h.ClientRef) return toast(`Licence no ${f.LicenceNo} belongs to ${fullName(byNo)}`);
  if (!h) {
    const twin = kind === "Company" ? D.holders.find(x => isCompany(x) && norm(x.CompanyName) === norm(f.CompanyName))
      : D.holders.find(x => !isCompany(x) && norm(x.Surname) === norm(f.Surname) && norm(firstNames(x)) === norm(firstNames(f)));
    if (twin && await ask(`${fullName(twin)}${twin.LicenceNo ? " (" + cleanNo(twin.LicenceNo) + ")" : ""} is already a licence holder. Use that record?`,
      { title: "Already a holder", yes: "Use that record", no: "Create a new holder" })) h = twin;
  }
  // 2. the firearm
  const { mine, other } = capCheckSerial(form);
  const transfer = form.elements.Transfer?.checked ? other : null;
  if (other && !transfer && !mine) return toast(`Serial ${f.SerialNo} is on licence ${other.Title} - tick Transfer, or check the serial number`);
  $("#capSave").disabled = true;
  try {
    if (!h) {
      const hf = { HolderKind: kind, LicenceNo: f.LicenceNo, Surname: f.Surname, GivenNames: f.GivenNames, MiddleName: f.MiddleName, Address: f.Address,
        CompanyName: kind === "Company" ? f.CompanyName : "", Notes: "Back-captured from " + set.files.map(x => x.name).join(", ") };
      hf.Title = fullName(hf);
      const ref = newRef();
      mergeLocal(LISTS.holders, ref, hf);
      await enqueue({ kind: "upsert", list: LISTS.holders, ref, fields: hf, label: `Back-capture · new holder · ${hf.Title}` });
      h = holder(ref); logActivity("Holder added (back-capture)", h, null);
    } else if (!cleanNo(h.LicenceNo)) {
      mergeLocal(LISTS.holders, h.ClientRef, { LicenceNo: f.LicenceNo });
      await enqueue({ kind: "upsert", list: LISTS.holders, ref: h.ClientRef, fields: { LicenceNo: f.LicenceNo }, label: `Holder licence no · ${fullName(h)}` });
      h = holder(h.ClientRef);
    }
    if (CAP.photo) { await queuePhoto(h, CAP.photo, false); CAP.photo = null; }

    const prevRef = (D.holders.find(x => norm(fullName(x)) === norm(f.PrevOwner)) || {}).ClientRef || "";
    const lf = { SerialNo: f.SerialNo, Make: f.Make, Model: f.Model, FirearmType: f.FirearmType, Calibre: f.Calibre, Capacity: f.Capacity, Class: f.Class,
      Purpose: f.Purpose, IssueDate: f.IssueDate, ExpiryDate: f.ExpiryDate, PTBNo: f.PTBNo, PTBDate: f.PTBDate, DeliveredDate: f.DeliveredDate,
      ReceiptNo: f.ReceiptNo, OfficeOfIssue: f.OfficeOfIssue, PrevOwner: f.PrevOwner, PrevOwnerRef: prevRef, PrevLicenceNo: f.PrevLicenceNo, NODDate: f.NODDate,
      SourceFile: set.files.map(x => x.name).join(", ") };
    let l;
    if (mine) {                                          // already captured: fill in what's missing, keep what's there
      const upd = Object.fromEntries(Object.entries(lf).filter(([k, v]) => v && !String(mine[k] || "").trim()));
      if (Object.keys(upd).length) { mergeLocal(LISTS.licences, mine.ClientRef, upd); await enqueue({ kind: "upsert", list: LISTS.licences, ref: mine.ClientRef, fields: upd, label: `Back-capture · ${mine.Title}` }); }
      l = lic(mine.ClientRef);
    } else {
      const ref = newRef(), type = isCompany(h) ? "Company" : "Individual";
      Object.assign(lf, { Title: licNoFor(h, type), LicenceType: type, HolderRef: h.ClientRef, LicenceStatus: "Active", Notes: "Back-captured" });
      mergeLocal(LISTS.licences, ref, lf);
      await enqueue({ kind: "upsert", list: LISTS.licences, ref, fields: lf, label: `Back-capture · licence ${lf.Title} · SN ${lf.SerialNo}` });
      l = lic(ref); logActivity("Licence created (back-capture)", h, l, `SN ${lf.SerialNo}`);
    }
    if (transfer) {                                      // the previous owner's licence ends: disposed of to the new owner
      const note = `${String(transfer.Notes || "").trim()}\nDisposed of to ${fullName(h)} (${l.Title})${f.NODDate ? " on " + f.NODDate : ""} - NOD back-captured`.trim();
      mergeLocal(LISTS.licences, transfer.ClientRef, { LicenceStatus: "Cancelled", Notes: note });
      await enqueue({ kind: "upsert", list: LISTS.licences, ref: transfer.ClientRef, fields: { LicenceStatus: "Cancelled", Notes: note }, label: `Transfer · ${transfer.Title} cancelled` });
      logActivity("Licence cancelled (transfer)", holder(transfer.HolderRef), lic(transfer.ClientRef), `to ${fullName(h)} ${l.Title}`);
    }
    // 3. every scan in the set becomes a document on the licence
    const folder = `${safeName(fullName(h))} (${String(h.ClientRef).slice(0, 6)})`;
    for (const [k, file] of set.files.entries()) {
      if (capDone(file)) continue;
      const dref = newRef(), t = types[k], dot = file.name.lastIndexOf(".");
      const docDate = t.includes("NOD") ? f.NODDate : t.includes("PTB") ? f.PTBDate : t.includes("Delivery Docket") ? f.DeliveredDate : "";
      const df = { DocType: t.join(" + "), DocDescription: "Back-captured scan", DocDate: docDate || "", HolderRef: h.ClientRef, HolderName: fullName(h),
        LicenceRef: l.ClientRef, LicenceNo: l.Title, OriginalName: file.name, UploadedBy: me(), UploadedAt: `${today()} ${hhmm(new Date())}` };
      mergeLocal(LISTS.docs, dref, df, { name: file.name, size: file.file.size });
      await enqueue({ kind: "doc", list: LISTS.docs, ref: dref, fields: df, label: `Back-capture · ${df.DocType} · ${file.name}`,
        file: { blob: file.file, name: file.name, type: file.file.type || "application/pdf", path: `${folder}/${safeName(file.name.slice(0, dot > 0 ? dot : undefined))} (${dref.slice(0, 6)})${dot > 0 ? file.name.slice(dot) : ""}` } });
    }
    set.done = true; S.dirty = false;
    toast(`Saved: ${fullName(h)} · ${l.Title} · SN ${l.SerialNo}`);
    const next = CAP.sets.findIndex((s, i) => i > CAP.i && !s.done);
    CAP.i = next >= 0 ? next : CAP.i; CAP.tab = 0; CAP.photo = null;
    pageCapture(); window.scrollTo(0, 0);
    if (next < 0) toast("All sets in the list are done");
  } finally { const b = $("#capSave"); if (b) b.disabled = false; }
}

/* ---------- automatic reading (AWS Bedrock, through the face service) ---------- */
const CAP_FIELDS = ["LicenceNo", "Surname", "GivenNames", "MiddleName", "CompanyName", "Address", "SerialNo", "Make", "Model", "FirearmType", "Calibre", "Capacity",
  "Purpose", "ExpiryDate", "IssueDate", "PTBNo", "PTBDate", "DeliveredDate", "ReceiptNo", "OfficeOfIssue", "PrevOwner", "PrevLicenceNo", "NODDate"];
async function capAutoRead(set, form) {
  const btn = $("#capRead"); btn.disabled = true; btn.textContent = "Reading…";
  try {
    const images = [];
    for (const f of set.files) for (const cv of await capPages(f)) images.push(cv.toDataURL("image/jpeg", 0.75).split(",")[1]);
    const r = await faceCall({ action: "readDocs", images: images.slice(0, 6), names: set.files.map(f => f.name) });
    const got = r.fields || {};
    let n = 0;
    for (const k of CAP_FIELDS) {
      let v = got[k]; if (v == null || v === "") continue;
      if (k === "Purpose") {
        const codes = purposeCodes(v);
        form.querySelectorAll('[name="PurposeCode"]').forEach(c => { if (codes.includes(String(c.value).toUpperCase())) c.checked = true; }); n++; continue;
      }
      const el = form.elements[k]; if (!el || String(el.value).trim()) continue;   // never overwrites what the operator typed
      if (k === "LicenceNo") v = cleanNo(v);
      if (el.tagName === "SELECT" && ![...el.options].some(o => o.value === v)) continue;
      el.value = v; el.classList.add("auto"); n++;
    }
    if (got.HolderKind === "Company") { form.querySelector('[name="HolderKind"][value="Company"]').checked = true; form.classList.add("kind-co"); }
    $("#capMsg").innerHTML = `<span class="tag info">Read automatically</span> ${n} field${n === 1 ? "" : "s"} filled in (shaded) - check each one against the scan before saving.${r.note ? " " + esc(r.note) : ""}`;
    form.elements.LicenceNo.dispatchEvent(new Event("change")); capCheckSerial(form); markDirty();
  } catch (e) { toast(isNetErr(e) ? "Automatic reading needs an internet connection" : "Automatic reading failed: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Read automatically"; }
}
