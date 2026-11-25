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
   (aws/zd-reader; switched on with ZD_READ_API and ZD_RULES.AUTO_READ).
   Uses index.html's globals (D, LISTS, enqueue, holder, lic ...).
   ===================================================================== */

const CAP = { files: [], sets: [], i: 0, photo: null, carrierPhoto: null, pages: {} };
/* The kinds of scan. The kind decides the fields: a purchase (PTB / Delivery Docket, with the
   card copy) creates the holder and licence; a Notice of Disposal only finds the firearm by serial. */
const CAP_KINDS = {
  PTB: { name: "Permit to Buy + Delivery Docket", short: "PTB", desc: "the purchase - owner, firearm and licence from the card copy", docTypes: ["PTB", "Delivery Docket"] },
  DD:  { name: "Delivery Docket only", short: "DD", desc: "the card copy without a permit", docTypes: ["Delivery Docket"] },
  NOD: { name: "Notice of Disposal", short: "NOD", desc: "the sale - matched to the firearm by serial no", docTypes: ["NOD"] }
};

/* "20261119-001_PTB_Guo_Shujie.pdf" -> { date, seq, kind, person }. Forgiving about the separators:
   "20261119-002 NOD, Guo Shujie.pdf" and "20261119-002_NOD_Guo_Shujie.pdf" read the same.
   A name that doesn't follow the pattern fills nothing in (person ""). */
function capParse(name) {
  const stem = String(name).replace(/\.[^.]+$/, ""), sep = "[\\s_,.\\-]+";
  const m = stem.match(new RegExp(`^(\\d{8})(?:[-_ ]*(\\d{1,4}))?${sep}(PTB|NOD|DD|DOCKET|DELIVERY(?:${sep}DOCKET)?)${sep}(.+)$`, "i"))
    || stem.match(new RegExp(`^()()(PTB|NOD|DD|DOCKET|DELIVERY(?:${sep}DOCKET)?)${sep}(.+)$`, "i"));
  if (!m) return { stem, person: "", kind: "", date: "", seq: "" };
  const d = m[1];
  return { stem, date: d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "", seq: m[2] || "", kind: m[3].toUpperCase().replace(/\W+/g, " "),
    person: m[4].replace(/[_,.\-]+/g, " ").replace(/\s+/g, " ").trim() };
}
const capLabel = (s, k) => s.person || s.files[0].info.stem || "Set " + (k + 1);
/* the kind of scan from the file name: PTB / NOD / DD */
function capKindOf(kind) {
  if (/^PTB/.test(kind)) return "PTB";
  if (/^NOD/.test(kind)) return "NOD";
  if (/^(DD|DOCKET|DELIVERY)/.test(kind)) return "DD";
  return "";
}
const capDone = f => (D.docs || []).some(d => d.OriginalName === f.name);   // already attached in an earlier session

/* start a fresh batch: the list only lives in this tab - saved scans are already in the sync queue */
function capClear() { Object.assign(CAP, { files: [], sets: [], i: 0, photo: null, pages: {} }); S.dirty = false; }
const capAllDone = () => CAP.sets.length > 0 && CAP.sets.every(s => s.done);

function capLoadFiles(fileList) {
  if (capAllDone()) capClear();          // the last batch is finished: the new files replace it
  const add = [...fileList].filter(f => /\.(pdf|jpe?g|png)$/i.test(f.name) && !CAP.files.some(x => x.name === f.name));
  const keep = Object.fromEntries(CAP.sets.map(s => [s.files[0].name, s]));   // keep what's been done in this session
  CAP.files.push(...add.map(f => ({ name: f.name, file: f, info: capParse(f.name) })));
  CAP.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  // one scan at a time, in file-name order (so a PTB comes before the NOD for the same firearm)
  CAP.sets = CAP.files.map(f => keep[f.name] || { person: f.info.person, files: [f], type: capKindOf(f.info.kind), done: capDone(f) });
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

/* ---------- the page ----------
   One scan at a time. Top: progress. Left: choose what the scan is, then the fields that
   kind of document needs (or a green "Saved" summary once it's done). Right: the scan. */
function pageCapture() {
  const set = CAP.sets[CAP.i];
  const doneN = CAP.sets.filter(s => s.done).length;
  $("#main").innerHTML = banners() + `<div class="bar"><h2>Back-capture</h2><span class="grow"></span>
      ${CAP.sets.length && !capAllDone() ? `<button type="button" class="btn sm" id="capNewBatch" title="Clear this list and start again with other scans">Start new batch</button>` : ""}
      <label class="btn sm ${!CAP.sets.length || capAllDone() ? "primary" : ""}" style="margin:0">${!CAP.sets.length ? "Choose scanned files" : capAllDone() ? "Choose next batch" : "+ Add more scans"}<input type="file" class="capFiles" accept=".pdf,image/*" multiple hidden></label></div>
    ${!set ? `<div class="card cap-drop" id="capDrop"><p><b>Drop the scanned PDFs here</b>, or click <b>Choose scanned files</b>.</p>
        <p class="small muted">Name them like <span class="mono">20261119-001_PTB_Guo_Shujie.pdf</span> and <span class="mono">20261119-002_NOD_Guo_Shujie.pdf</span>
        - then the document type and names fill in by themselves. Scan the Permit to Buy / Delivery Docket before the Notice of Disposal for the same firearm.
        Scans already in the app show as done.</p></div>`
      : `<div class="cap-progress">
        <div class="cap-count"><b>Scan ${CAP.i + 1} of ${CAP.sets.length}</b><span class="muted"> · ${doneN} saved · ${CAP.sets.length - doneN} to do</span></div>
        <div class="cap-meter"><span style="width:${Math.round(100 * doneN / CAP.sets.length)}%"></span></div>
        <div class="cap-chips">${CAP.sets.map((s, k) => `<button type="button" class="cap-chip ${s.done ? "done" : ""} ${k === CAP.i ? "cur" : ""}" data-set="${k}" title="${esc(s.files[0].name)}">${s.done ? "✓ " : ""}${s.type ? `<b>${esc(CAP_KINDS[s.type].short)}</b> ` : ""}${esc(capLabel(s, k))}</button>`).join("")}</div></div>
      <div class="cap-grid">
        <div class="card cap-view"><div class="cap-tabs">
            <span class="small muted mono cap-fname" id="capName"></span><span class="grow"></span>
            <button type="button" class="btn sm" id="capZoom">Zoom</button>
            ${set.done ? "" : `<button type="button" class="btn sm" id="capPhoto" title="Cut the holder's photo from the card copy on this scan">Photo from scan</button>`}</div>
          <div id="capPage" class="cap-page"><p class="muted" style="color:#fff">Loading the scan…</p></div></div>
        <div class="card cap-side">${set.done ? capSavedHtml(set) : `<form id="capForm" class="cap-form" autocomplete="off">${capFormHtml(set)}</form>`}</div>
      </div>`}`;
  $$(".capFiles").forEach(inp => inp.onchange = e => { capLoadFiles(e.target.files); e.target.value = ""; CAP.photo = null; CAP.carrierPhoto = null; pageCapture(); });
  if ($("#capNewBatch")) $("#capNewBatch").onclick = async () => {
    const left = CAP.sets.filter(s => !s.done).length;
    if (!await ask(`${left} scan${left === 1 ? " hasn't" : "s haven't"} been saved yet. They'll be taken off this list (the files themselves aren't touched) - you can add them again later. Start a new batch?`,
      { title: "Start new batch", yes: "Start new batch", no: "Keep this batch" })) return;
    capClear(); pageCapture();
  };
  const drop = $("#capDrop") || $("#main");
  drop.ondragover = e => { if (hasFiles(e)) e.preventDefault(); };
  drop.ondrop = e => { if (!hasFiles(e)) return; e.preventDefault(); capLoadFiles(e.dataTransfer.files); CAP.photo = null; CAP.carrierPhoto = null; pageCapture(); };
  if (!set) return;
  $$("[data-set]").forEach(b => b.onclick = () => capGo(+b.dataset.set));
  $(".cap-chip.cur")?.scrollIntoView({ block: "nearest", inline: "center" });
  $("#capZoom").onclick = () => $("#capPage").classList.toggle("zoomed");
  if ($("#capPhoto")) $("#capPhoto").onclick = () => capCutPhoto(set, "photo");
  if (set.done) { $("#capNextSet")?.addEventListener("click", () => capGo(capNextTodo())); $("#capNextSet")?.focus(); }
  else capWireForm(set);
  capShow(set);
}
const capNextTodo = () => { const n = CAP.sets.findIndex((s, i) => i > CAP.i && !s.done); return n >= 0 ? n : CAP.sets.findIndex(s => !s.done); };
function capGo(i) {
  if (i < 0 || i >= CAP.sets.length) return;
  if (S.dirty) return ask("This scan hasn't been saved. Leave it without saving?", { title: "Not saved", yes: "Leave it", no: "Stay" }).then(ok => { if (ok) { S.dirty = false; capGo(i); } });
  CAP.i = i; CAP.photo = null; CAP.carrierPhoto = null; S.dirty = false; pageCapture(); window.scrollTo(0, 0);
}
async function capShow(set) {
  const f = set.files[0];
  $("#capName").textContent = f.name;
  try {
    const pages = await capPages(f), box = $("#capPage"); if (!box || $("#capName")?.textContent !== f.name) return;
    box.innerHTML = ""; pages.forEach(cv => { const img = document.createElement("img"); img.src = cv.toDataURL("image/jpeg", 0.85); box.appendChild(img); });
  } catch (e) { $("#capPage").innerHTML = `<p style="color:#fff">This scan couldn't be shown: ${esc(e.message)}</p>`; }
}
/* cut a photo from the card copy on the scan: the owner's ("photo") or the carrier's ("carrierPhoto") */
async function capCutPhoto(set, which) {
  const cv = (await capPages(set.files[0]))[0];
  const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92));
  const out = await openCrop(blob, { maxZoom: 14 });
  if (out && out !== "retake") { CAP[which] = out; capShowPhoto(); markDirty(); }
}
function capShowPhoto() {
  for (const [id, b] of [["#capPhotoSlot", CAP.photo], ["#capCarrierPhotoSlot", CAP.carrierPhoto]]) {
    const slot = $(id); if (slot) slot.innerHTML = b ? `<img src="${URL.createObjectURL(b)}" alt="">` : `<div class="nophoto small">No photo</div>`;
  }
  const same = $("#capCarrierSame"); if (same) same.hidden = !CAP.photo;
}

/* ---------- a saved scan: what was done, and the way on ---------- */
function capSavedHtml(set) {
  let r = set.saved;
  if (!r) {                                           // saved in an earlier session: work it out from the attached document
    const d = (D.docs || []).find(x => x.OriginalName === set.files[0].name), l = d && lic_(d.LicenceRef);
    r = { holderRef: d?.HolderRef || l?.HolderRef, licRef: l?.ClientRef, earlier: true };
  }
  const h = holder(r.holderRef), l = r.licRef && lic_(r.licRef), next = capNextTodo();
  const row = (k, v) => v ? `<div class="cap-sum-row"><span>${k}</span><b>${v}</b></div>` : "";
  const tag = (isNew, old) => isNew ? ` <span class="tag ok">new</span>` : r.earlier ? "" : ` <span class="tag">${old}</span>`;
  return `<div class="cap-saved"><div class="cap-tick">✓</div><h3>Saved${r.earlier ? " earlier" : ""}</h3>
      <p class="muted small" style="margin:0 0 14px">${r.earlier ? "This scan was already attached in the app."
        : r.nod ? "The Notice of Disposal is attached to the licence below." : "This firearm is in the register. The scan goes to SharePoint with the next sync."}</p></div>
    ${row("Document", set.type ? esc(CAP_KINDS[set.type].name) : "")}
    ${row("Holder", h ? `<a href="#/holder/${encodeURIComponent(h.ClientRef)}" target="_blank">${esc(fullName(h))}</a>${tag(r.newHolder, "already in register")}` : "")}
    ${row("Licence", l ? `<a href="#/licence/${encodeURIComponent(l.ClientRef)}" target="_blank">${esc(l.Title)}</a>${tag(r.newLicence, r.nod ? "NOD attached" : "already in register - scan added")}` : "")}
    ${row("Firearm", l ? esc(gunText(l)) : "")}
    ${(() => { const c = r.ltcRef && lic_(r.ltcRef); return row("Licence to carry", c ? `<a href="#/licence/${encodeURIComponent(c.ClientRef)}" target="_blank">${esc(c.Title)}</a> · ${esc(carrierName(c))}${tag(r.newLtc, "already in register")}` : ""); })()}
    ${row("Seller", l?.PrevOwner ? esc(l.PrevOwner) + (l.PrevLicenceNo ? " (" + esc(l.PrevLicenceNo) + ")" : "") : "")}
    ${row("Transfer", r.transfer ? `licence ${esc(r.transfer)} marked Cancelled` : "")}
    ${row("Photo", r.photo ? "added from the scan" : "")}
    ${row("Scan", esc(set.files[0].name))}
    <div class="cap-actions">${next >= 0 ? `<button type="button" class="btn primary" id="capNextSet">Next scan: ${esc(capLabel(CAP.sets[next], next))} →</button>`
      : `<div class="cap-alldone">All ${CAP.sets.length} scans in this batch are done.<br><span class="small" style="font-weight:400">The next batch you choose or drop here replaces this list.</span>
          <label class="btn primary" style="margin:10px 0 0">Choose next batch<input type="file" class="capFiles" accept=".pdf,image/*" multiple hidden></label></div>`}</div>`;
}

/* ---------- the form: the document type decides the fields ---------- */
function capFormHtml(set) {
  const kind = set.type && CAP_KINDS[set.type];
  return `<div class="cap-head"><h3>${esc(capLabel(set, CAP.i))}</h3><span class="grow"></span>
      ${RULES.AUTO_READ && kind ? `<button type="button" class="btn sm" id="capRead">Read automatically</button>` : ""}</div>
    <div class="cap-body">
    <h4 class="cap-step"><span>?</span>What is this scan?</h4>
    <div class="cap-kinds">${Object.entries(CAP_KINDS).map(([k, v]) => `<button type="button" class="cap-kind ${set.type === k ? "on" : ""}" data-kind="${k}"><b>${esc(v.name)}</b><small>${esc(v.desc)}</small></button>`).join("")}</div>
    <div id="capMsg" class="small">${set.person ? `<span class="tag info">From the file name</span> ${esc(set.person)}${set.files[0].info.kind ? " · " + esc(set.files[0].info.kind) : ""}`
      : `<span class="tag warn">File name not recognised</span> Choose the document type above. Naming scans like <span class="mono">20261119-001_PTB_First_Last.pdf</span> fills it in for you.`}</div>
    ${!kind ? `<p class="muted" style="margin-top:18px">Choose what the scan is, and the fields it needs will appear.</p>` : set.type === "NOD" ? capNodHtml(set) : capBuyHtml(set)}
    </div>
    <div class="cap-foot"><span class="small muted" id="capFootMsg"></span><span class="grow"></span>
      <button type="button" class="btn" id="capSkip">Skip</button>${kind ? `<button type="button" class="btn primary" id="capSave">Save</button>` : ""}</div>`;
}

/* Permit to Buy / Delivery Docket: the purchase - owner, firearm, licence (from the card copy) */
function capBuyHtml(set) {
  const people = D.holders.slice().sort((a, b) => sortName(a).localeCompare(sortName(b)));
  const nameParts = String(set.person || "").split(/\s+/).filter(Boolean);   // file names are First_Last as on the card (Guo_Shujie)
  const step = (n, t) => `<h4 class="cap-step"><span>${n}</span>${t}</h4>`;
  return `
    ${step(1, "Owner - the buyer, from the card copy")}
    <input type="hidden" name="HolderRef"><input type="hidden" name="PrevOwner"><input type="hidden" name="PrevLicenceNo">
    <div class="grid2"><label>Licence no on the card *<input type="text" name="OwnerNo" class="mono" placeholder="e.g. 114608"></label>
      <label>or find in the register<input type="search" id="capFind" list="capPeople" placeholder="name or licence no">
        <datalist id="capPeople">${people.map(x => `<option value="${esc((x.LicenceNo ? cleanNo(x.LicenceNo) + " · " : "") + fullName(x))}">`).join("")}</datalist></label></div>
    <div class="cap-status" id="capWho"></div>
    <div class="cap-newowner">
      <div class="kindpick">${["Individual", "Company"].map(k => `<label class="chk"><input type="radio" name="HolderKind" value="${k}" ${k === "Individual" ? "checked" : ""}> ${k}</label>`).join("")}</div>
      <label class="cap-co">Company name *<input type="text" name="CompanyName"></label>
      <div class="grid3"><label>First name *<input type="text" name="GivenNames" value="${esc(nameParts[0] || "")}"></label>
        <label>Middle name<input type="text" name="MiddleName" value="${esc(nameParts.slice(1, -1).join(" "))}"></label>
        <label>Surname *<input type="text" name="Surname" value="${esc(nameParts.length > 1 ? nameParts[nameParts.length - 1] : "")}"></label></div>
      <label>Address (as on the card)<input type="text" name="Address"></label>
    </div>
    <div class="cap-photorow"><div id="capPhotoSlot" class="cap-photo"></div>
      <span class="small muted">Photo (optional): click <b>Photo from scan</b> above the scan and cut it from the card copy.</span></div>

    ${step(2, "Firearm")}
    <label>Serial no *<input type="text" name="SerialNo" class="mono"></label>
    <div class="cap-status" id="capSn"></div>
    <div class="grid3"><label>Make<input type="text" name="Make"></label><label>Model<input type="text" name="Model"></label>
      <label>Type<select name="FirearmType">${codeOptions(codeList("Type"), "")}</select></label></div>
    <div class="grid3"><label>Calibre<input type="text" name="Calibre"></label><label>Capacity<input type="text" name="Capacity" placeholder="e.g. 5 rds"></label>
      <label>Class<select name="Class">${codeOptions(codeList("Class"), "")}</select></label></div>

    ${step(3, "Licence - from the card copy")}
    ${purposePicker("", "")}
    <div class="grid2"><label>Expires *<input type="date" name="ExpiryDate"></label><label>Issued<input type="date" name="IssueDate"></label></div>

    ${step(4, "Licence to carry - a second card (LC …) on the docket")}
    <label class="chk"><input type="checkbox" name="HasLTC" value="1"> <span>There's also a <b>licence to carry</b> card for this firearm</span></label>
    <div class="cap-ltc">
      <p class="small muted" style="margin:4px 0 8px">Usually with a company firearm: the LC card shows the person who carries it and <b>their own</b> licence number. The firearm, purpose and dates come from the licence above.</p>
      <div class="grid2"><label>Carrier's licence no *<div class="pfx"><span>LC</span><input type="text" name="CarrierNo" class="mono" placeholder="e.g. 100300"></div></label>
        <label>Expires (LC card)<input type="date" name="CarrierExpiryDate"></label></div>
      <div class="cap-status" id="capCarrier"></div>
      <div class="grid3"><label>First name *<input type="text" name="CarrierGivenNames"></label>
        <label>Middle name<input type="text" name="CarrierMiddleName"></label>
        <label>Surname *<input type="text" name="CarrierSurname"></label></div>
      <label>Address (as on the LC card)<input type="text" name="CarrierAddress"></label>
      <div class="cap-photorow"><div id="capCarrierPhotoSlot" class="cap-photo"></div>
        <button type="button" class="btn sm" id="capCarrierCut">Carrier's photo from scan</button>
        <button type="button" class="btn sm" id="capCarrierSame" title="The carrier is the same person as on the owner's card">Same as owner's photo</button></div>
    </div>

    ${set.type === "PTB" ? `${step(5, "Permit to Buy and Delivery Docket")}
    <div class="grid3"><label>PTB no<input type="text" name="PTBNo" class="mono"></label><label>PTB dated<input type="date" name="PTBDate"></label>
      <label>Delivered<input type="date" name="DeliveredDate"></label></div>
    <div class="grid2"><label>Receipt no<input type="text" name="ReceiptNo" class="mono"></label><label>Office of issue<input type="text" name="OfficeOfIssue"></label></div>`
    : `${step(5, "Delivery Docket")}<label style="max-width:240px">Delivered<input type="date" name="DeliveredDate"></label>`}`;
}

/* Notice of Disposal: only finds the firearm by serial no and records the seller */
function capNodHtml(set) {
  const people = D.holders.slice().sort((a, b) => sortName(a).localeCompare(sortName(b)));
  return `
    <h4 class="cap-step"><span>1</span>The firearm on the notice</h4>
    <label>Serial no *<input type="text" name="SerialNo" class="mono" placeholder="as printed on the notice"></label>
    <div class="cap-status" id="capNod"></div>
    <h4 class="cap-step"><span>2</span>Seller and date</h4>
    <div class="grid2"><label>Seller (previous owner)<input type="text" name="PrevOwner" list="capPeopleNames"><datalist id="capPeopleNames">${people.map(x => `<option value="${esc(fullName(x))}">`).join("")}</datalist></label>
      <label>Seller's licence no<input type="text" name="PrevLicenceNo" class="mono"></label></div>
    <label style="max-width:240px">Notice dated<input type="date" name="NODDate"></label>`;
}

function capVal(form) {
  const fd = new FormData(form), f = {};
  for (const [k, v] of fd) if (k !== "PurposeCode") f[k] = String(v).trim();
  f.Purpose = purposeOrder(fd.getAll("PurposeCode").map(v => String(v).toUpperCase())).join("");
  f.LicenceNo = cleanNo(f.OwnerNo || "");   // named OwnerNo on screen so the browser doesn't offer to "save a driver's licence"
  return f;
}

/* who the owner is: the holder picked, or the holder with the licence no typed */
function capOwner(form) {
  const ref = form.elements.HolderRef?.value;
  if (ref) return holder(ref);
  const n = cleanNo(form.elements.OwnerNo?.value || "");
  return n ? D.holders.find(x => cleanNo(x.LicenceNo) === n) || null : null;
}

function capWireForm(set) {
  const form = $("#capForm");
  $$("[data-kind]").forEach(b => b.onclick = async () => {
    if (b.dataset.kind === set.type) return;
    if (S.dirty && !await ask("Changing the document type clears what you've typed for this scan. Change it?", { title: "Change document type", yes: "Change it", no: "Keep" })) return;
    set.type = b.dataset.kind; S.dirty = false; pageCapture();
  });
  $("#capSkip").onclick = () => { const n = capNextTodo(); capGo(n >= 0 && n !== CAP.i ? n : CAP.i + 1); };
  form.onsubmit = e => e.preventDefault();          // no real submit: browsers offer to "save" a submitted form
  form.querySelectorAll("input, select, textarea").forEach(el => { el.setAttribute("autocomplete", "off"); el.setAttribute("data-lpignore", "true"); });
  if (!set.type) return;
  form.oninput = markDirty;
  $("#capSave").onclick = () => set.type === "NOD" ? capSaveNod(set, form) : capSaveBuy(set, form);
  form.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("input:not([type=search]):not([type=checkbox]):not([type=radio])")) { e.preventDefault(); $("#capSave").click(); } });
  $("#capRead")?.addEventListener("click", () => capAutoRead(set, form));
  if (set.type === "NOD") {
    form.elements.SerialNo.addEventListener("input", () => capNodMatch(form));
    form.elements.PrevOwner.addEventListener("input", () => capFoot(form));
    capNodMatch(form); return;
  }
  const showKind = () => form.classList.toggle("kind-co", form.querySelector('[name="HolderKind"]:checked').value === "Company");
  form.querySelectorAll('[name="HolderKind"]').forEach(r => r.onchange = showKind); showKind();
  $("#capFind").addEventListener("change", () => {
    const v = $("#capFind").value.trim().toLowerCase();
    const p = D.holders.find(x => ((x.LicenceNo ? cleanNo(x.LicenceNo) + " · " : "") + fullName(x)).toLowerCase() === v);
    if (p) { form.elements.HolderRef.value = p.ClientRef; form.elements.OwnerNo.value = cleanNo(p.LicenceNo); $("#capFind").value = ""; capRefresh(form); markDirty(); }
  });
  form.elements.OwnerNo.addEventListener("input", () => {   // a different number from the picked holder's = a different owner
    const p = holder(form.elements.HolderRef.value);
    if (p && cleanNo(p.LicenceNo) && cleanNo(p.LicenceNo) !== cleanNo(form.elements.OwnerNo.value)) form.elements.HolderRef.value = "";
    capRefresh(form);
  });
  form.elements.SerialNo.addEventListener("input", () => capRefresh(form));
  form.elements.HasLTC.onchange = () => capRefresh(form);
  form.elements.CarrierNo.addEventListener("input", () => capRefresh(form));
  $("#capCarrierCut").onclick = () => capCutPhoto(set, "carrierPhoto");
  $("#capCarrierSame").onclick = () => { CAP.carrierPhoto = CAP.photo; capShowPhoto(); markDirty(); };
  form.elements.ExpiryDate.addEventListener("change", () => {   // one-year licences: issued = expiry less a year, when blank
    const e = form.elements.ExpiryDate.value, i = form.elements.IssueDate;
    if (e && !i.value) { const d = new Date(e); d.setFullYear(d.getFullYear() - RULES.LICENCE_YEARS); d.setDate(d.getDate() + 1); i.value = ymd(d); }
  });
  capShowPhoto(); capRefresh(form);
}

/* keeps the status boxes and the footer telling the operator exactly what Save will do */
function capRefresh(form) { capWho(form); capCheckSerial(form); capCarrier(form); capFoot(form); }

/* the licence to carry on the docket: whose number it is, and whether it's already recorded */
function capCarrierHolder(form) {
  const n = cleanNo(form.elements.CarrierNo?.value || "");
  return n ? D.holders.find(x => cleanNo(x.LicenceNo) === n) || null : null;
}
function capCarrier(form) {
  const on = !!form.elements.HasLTC?.checked, box = $("#capCarrier");
  form.classList.toggle("has-ltc", on);
  if (!on || !box) return;
  const n = cleanNo(form.elements.CarrierNo.value), p = capCarrierHolder(form), owner = capOwner(form);
  const ownerNo = cleanNo(owner?.LicenceNo || form.elements.OwnerNo.value);
  const gun = owner && capSameSerial(form.elements.SerialNo.value).find(x => x.HolderRef === owner.ClientRef);
  const dup = gun && n && ltcsOf(gun).find(x => cleanNo(x.Title) === n);
  if (!n) { box.className = "cap-status"; box.innerHTML = "Type the number from the LC card, without the letters LC."; }
  else if (n === ownerNo) { box.className = "cap-status warn"; box.innerHTML = `<b>That's the owner's number.</b> The LC card has the carrier's own number (e.g. LC 100300 next to C 100200).`; }
  else if (dup) { box.className = "cap-status info"; box.innerHTML = `<b>Already recorded:</b> ${esc(dup.Title)} for ${esc(carrierName(dup))} on this firearm. Nothing new is created for it.`; }
  else if (p) {
    box.className = "cap-status info";
    box.innerHTML = `<b>${esc(fullName(p))}</b> has licence no ${esc(n)} in the register - the licence to carry is linked to their record.`;
    const set = (k, v) => { const el = form.elements[k]; if (el && !el.value.trim() && v) el.value = v; };
    set("CarrierGivenNames", p.GivenNames); set("CarrierMiddleName", p.MiddleName); set("CarrierSurname", p.Surname); set("CarrierAddress", p.Address);
  } else { box.className = "cap-status ok"; box.innerHTML = `<b>New licence to carry</b> - LC ${esc(n)}. Fill in the carrier's details from the LC card.`; }
}

function capWho(form) {
  const box = $("#capWho"), p = capOwner(form), n = cleanNo(form.elements.OwnerNo.value);
  form.classList.toggle("owner-known", !!p);
  if (p) {
    box.className = "cap-status info";
    box.innerHTML = `<b>Already in the register:</b> ${esc(fullName(p))}${p.LicenceNo ? " (" + esc(cleanNo(p.LicenceNo)) + ")" : ""}${p.Address ? "<br><span class='small'>" + esc(p.Address) + "</span>" : ""}
      <br><span class="small">Their record is used - nothing new is created for the owner.</span>`;
  } else if (n) { box.className = "cap-status ok"; box.innerHTML = `<b>New holder</b> - licence no ${esc(n)} isn't in the register. Fill in their details below.`; }
  else { box.className = "cap-status"; box.innerHTML = `Type the licence no from the card copy, or find the owner in the register.`; }
}

const capSameSerial = (sn, live = true) => { const k = serialKey(sn); return k ? D.licences.filter(x => !isLTC(x) && serialKey(x.SerialNo) === k && (!live || x.LicenceStatus !== "Cancelled")) : []; };

/* purchase: the serial number decides - new firearm, already captured (attach the scan), or a transfer from another owner */
function capCheckSerial(form) {
  const box = $("#capSn"), sn = form.elements.SerialNo.value.trim(), owner = capOwner(form), same = capSameSerial(sn);
  const mine = owner && same.find(x => x.HolderRef === owner.ClientRef), other = !mine && same.find(x => !owner || x.HolderRef !== owner.ClientRef);
  const wasTick = form.elements.Transfer ? form.elements.Transfer.checked : true;
  if (form.elements.PrevOwner.dataset.src === "serial") { form.elements.PrevOwner.value = ""; form.elements.PrevLicenceNo.value = ""; form.elements.PrevOwner.dataset.src = ""; }
  if (!sn) { box.className = "cap-status"; box.innerHTML = "Type the serial number exactly as on the card."; }
  else if (mine) {
    box.className = "cap-status info";
    box.innerHTML = `<b>Already in the register</b> on licence <b>${esc(mine.Title)}</b> for ${esc(fullName(owner))}.<br><span class="small">No new licence - the scan is attached to that licence and any empty details are filled in.</span>`;
  } else if (other) {
    const ph = holder(other.HolderRef) || {};
    box.className = "cap-status warn";
    box.innerHTML = `<b>Registered to ${esc(fullName(ph))}</b> on licence <b>${esc(other.Title)}</b>.
      <label class="chk" style="margin-top:6px"><input type="checkbox" name="Transfer" value="${esc(other.ClientRef)}" ${wasTick ? "checked" : ""}> This is a transfer: cancel licence ${esc(other.Title)} - sold to the new owner</label>`;
    box.querySelector("[name=Transfer]").onchange = () => capFoot(form);
    form.elements.PrevOwner.value = fullName(ph); form.elements.PrevLicenceNo.value = other.Title; form.elements.PrevOwner.dataset.src = "serial";
  } else { box.className = "cap-status ok"; box.innerHTML = `<b>New firearm</b> - this serial isn't in the register. A new licence will be created.`; }
  return { mine, other };
}

/* NOD: find the licence the notice belongs to (the buyer's), and any seller's licence still live */
function capNodMatch(form) {
  const box = $("#capNod"), sn = form.elements.SerialNo.value.trim(), all = capSameSerial(sn, false);
  const live = all.filter(x => x.LicenceStatus !== "Cancelled");
  const newest = live.slice().sort((a, b) => String(b.IssueDate || "").localeCompare(String(a.IssueDate || "")))[0];
  const picked = form.elements.AttachTo ? form.querySelector("[name=AttachTo]:checked")?.value : "";
  const target = live.find(x => x.ClientRef === picked) || newest;
  if (!sn) { box.className = "cap-status"; box.innerHTML = "Type the serial number from the notice - the notice is attached to the licence for that firearm."; }
  else if (!all.length) {
    box.className = "cap-status warn";
    box.innerHTML = `<b>Not in the register.</b> Capture the Permit to Buy / Delivery Docket for this firearm first, then come back to this notice (<b>Skip</b> for now).`;
  } else if (!live.length) {
    box.className = "cap-status warn"; box.innerHTML = `<b>Only on cancelled licences</b> (${all.map(x => esc(x.Title)).join(", ")}). Capture the buyer's Permit to Buy / Delivery Docket first.`;
  } else {
    const rows = live.map(x => `<label class="chk"><input type="radio" name="AttachTo" value="${esc(x.ClientRef)}" ${x === target ? "checked" : ""}>
        Licence <b>${esc(x.Title)}</b> · ${esc(fullName(holder(x.HolderRef) || {}))}${x.IssueDate ? " · issued " + fmtDate(x.IssueDate) : ""}</label>`).join("");
    const others = live.filter(x => x !== target);
    box.className = "cap-status info";
    box.innerHTML = `<b>Found ${esc(gunText(target))}</b>${live.length > 1 ? "<br><span class='small'>Attach the notice to the buyer's licence:</span>" : ""}${rows}
      ${others.map(x => `<label class="chk cap-cancel"><input type="checkbox" name="CancelRef" value="${esc(x.ClientRef)}" checked> Cancel licence ${esc(x.Title)} (${esc(fullName(holder(x.HolderRef) || {}))}) - sold to the buyer</label>`).join("")}`;
    box.querySelectorAll("[name=AttachTo]").forEach(r => r.onchange = () => capNodMatch(form));
    box.querySelectorAll("[name=CancelRef]").forEach(r => r.onchange = () => capFoot(form));
    const seller = others[0] || all.find(x => x.LicenceStatus === "Cancelled" && x.HolderRef !== target.HolderRef);
    if (!form.elements.PrevOwner.value) {           // the seller: still-live or cancelled licence of someone else, or what the purchase recorded
      if (seller) { form.elements.PrevOwner.value = fullName(holder(seller.HolderRef) || {}); form.elements.PrevLicenceNo.value = seller.Title; }
      else if (target.PrevOwner) { form.elements.PrevOwner.value = target.PrevOwner; form.elements.PrevLicenceNo.value = target.PrevLicenceNo || ""; }
    }
  }
  capFoot(form);
  return { target: live.length ? target : null, cancel: [...form.querySelectorAll("[name=CancelRef]:checked")].map(x => lic_(x.value)).filter(Boolean) };
}

function capFoot(form) {
  const el = $("#capFootMsg"); if (!el) return;
  const parts = [];
  if (form.elements.AttachTo !== undefined && !form.elements.OwnerNo) {      // NOD
    const r = form.querySelector("[name=AttachTo]:checked"), t = r && lic_(r.value);
    if (t) parts.push("attach the notice to " + t.Title);
    form.querySelectorAll("[name=CancelRef]:checked").forEach(c => parts.push("cancel " + (lic_(c.value) || {}).Title));
  } else if (form.elements.OwnerNo) {
    const owner = capOwner(form), sn = form.elements.SerialNo.value.trim();
    if (form.elements.OwnerNo.value.trim()) parts.push(owner ? "existing holder" : "new holder");
    if (sn) {
      const same = capSameSerial(sn), m = owner && same.find(x => x.HolderRef === owner.ClientRef);
      parts.push(m ? "add the scan to " + m.Title : "new licence");
      if (!m && same.length && form.elements.Transfer?.checked) parts.push("cancel " + same[0].Title);
    }
    const cn = form.elements.HasLTC?.checked && cleanNo(form.elements.CarrierNo.value);
    if (cn) parts.push("licence to carry LC " + cn);
  }
  el.textContent = parts.length ? "Save will: " + parts.join(" · ") : "";
}

/* attach one scan to a licence (and its holder) in ZD_Documents */
async function capAttach(set, h, l, docTypes, docDate) {
  const file = set.files[0]; if (capDone(file)) return;
  const dref = newRef(), dot = file.name.lastIndexOf(".");
  const folder = `${safeName(fullName(h))} (${String(h.ClientRef).slice(0, 6)})`;
  const df = { DocType: docTypes.join(" + "), DocDescription: "Back-captured scan", DocDate: docDate || "", HolderRef: h.ClientRef, HolderName: fullName(h),
    LicenceRef: l.ClientRef, LicenceNo: l.Title, OriginalName: file.name, UploadedBy: me(), UploadedAt: `${today()} ${hhmm(new Date())}` };
  mergeLocal(LISTS.docs, dref, df, { name: file.name, size: file.file.size });
  await enqueue({ kind: "doc", list: LISTS.docs, ref: dref, fields: df, label: `Back-capture · ${df.DocType} · ${file.name}`,
    file: { blob: file.file, name: file.name, type: file.file.type || "application/pdf", path: `${folder}/${safeName(file.name.slice(0, dot > 0 ? dot : undefined))} (${dref.slice(0, 6)})${dot > 0 ? file.name.slice(dot) : ""}` } });
}
async function capCancel(old, h, l, when) {
  const note = `${String(old.Notes || "").trim()}\nDisposed of to ${fullName(h)} (${l.Title})${when ? " on " + when : ""} - back-captured`.trim();
  mergeLocal(LISTS.licences, old.ClientRef, { LicenceStatus: "Cancelled", Notes: note });
  await enqueue({ kind: "upsert", list: LISTS.licences, ref: old.ClientRef, fields: { LicenceStatus: "Cancelled", Notes: note }, label: `Transfer · ${old.Title} cancelled` });
  logActivity("Licence cancelled (transfer)", holder(old.HolderRef), lic(old.ClientRef), `to ${fullName(h)} ${l.Title}`);
}
function capFinish(set, form, saved) {
  set.done = true; set.saved = saved; S.dirty = false;
  form.querySelectorAll("input:not([type=checkbox]):not([type=radio]), textarea").forEach(el => el.value = "");   // nothing left for the browser to offer to save
  pageCapture(); window.scrollTo(0, 0);           // same scan, now showing the green "Saved" summary and the Next button
}

async function capSaveNod(set, form) {
  const f = capVal(form), { target, cancel } = capNodMatch(form);
  if (!f.SerialNo) return toast("Type the serial number from the notice");
  if (!target) return toast("This firearm isn't in the register yet - capture its Permit to Buy / Delivery Docket first, or Skip");
  $("#capSave").disabled = true;
  try {
    const h = holder(target.HolderRef) || {};
    const prevRef = (D.holders.find(x => norm(fullName(x)) === norm(f.PrevOwner)) || {}).ClientRef || "";
    const want = { PrevOwner: f.PrevOwner, PrevOwnerRef: prevRef, PrevLicenceNo: f.PrevLicenceNo, NODDate: f.NODDate };
    const upd = Object.fromEntries(Object.entries(want).filter(([k, v]) => v && !String(target[k] || "").trim()));
    upd.SourceFile = [target.SourceFile, set.files[0].name].filter(Boolean).join(", ");
    mergeLocal(LISTS.licences, target.ClientRef, upd);
    await enqueue({ kind: "upsert", list: LISTS.licences, ref: target.ClientRef, fields: upd, label: `Back-capture · NOD · ${target.Title}` });
    const l = lic(target.ClientRef);
    for (const old of cancel) await capCancel(old, h, l, f.NODDate);
    await capAttach(set, h, l, ["NOD"], f.NODDate);
    logActivity("NOD attached (back-capture)", h, l, `SN ${l.SerialNo}`);
    capFinish(set, form, { holderRef: h.ClientRef, licRef: l.ClientRef, nod: true, transfer: cancel.map(x => x.Title).join(", ") });
  } finally { const b = $("#capSave"); if (b) b.disabled = false; }
}

async function capSaveBuy(set, form) {
  const f = capVal(form), owner = capOwner(form), kind = owner ? (isCompany(owner) ? "Company" : "Individual") : f.HolderKind;
  const need = [["LicenceNo", "Licence no"], ["SerialNo", "Serial no"], ["ExpiryDate", "Expires"],
    ...(owner ? [] : kind === "Company" ? [["CompanyName", "Company name"]] : [["Surname", "Surname"], ["GivenNames", "First name"]])];
  const missing = need.filter(([k]) => !f[k]).map(x => x[1]);
  if (missing.length) return toast("Please fill in: " + missing.join(", "));
  if (!f.Purpose) return toast("Tick at least one purpose");
  const carry = f.HasLTC ? { no: cleanNo(f.CarrierNo), p: capCarrierHolder(form) } : null;
  if (carry) {
    const miss = [[carry.no, "Carrier's licence no"], [f.CarrierGivenNames || carry.p?.GivenNames, "Carrier's first name"], [f.CarrierSurname || carry.p?.Surname, "Carrier's surname"]]
      .filter(([v]) => !v).map(x => x[1]);
    if (miss.length) return toast("Licence to carry - please fill in: " + miss.join(", ") + " (or untick it)");
    if (carry.no === f.LicenceNo) return toast(`LC ${carry.no} is the owner's own number. Type the number from the LC card.`);
  }

  let h = owner, newHolder = false;
  if (h && cleanNo(h.LicenceNo) && cleanNo(h.LicenceNo) !== f.LicenceNo)
    return toast(`${fullName(h)} has licence no ${cleanNo(h.LicenceNo)}, not ${f.LicenceNo}. Check the number.`);
  if (!h) {
    const twin = kind === "Company" ? D.holders.find(x => isCompany(x) && norm(x.CompanyName) === norm(f.CompanyName))
      : D.holders.find(x => !isCompany(x) && norm(x.Surname) === norm(f.Surname) && norm(firstNames(x)) === norm(firstNames(f)));
    if (twin && await ask(`${fullName(twin)}${twin.LicenceNo ? " (licence no " + cleanNo(twin.LicenceNo) + ")" : ""} is already a licence holder. Is this the same ${kind === "Company" ? "company" : "person"}?`,
      { title: "Already a holder?", yes: "Yes - use that record", no: "No - a different holder" })) {
      if (cleanNo(twin.LicenceNo) && cleanNo(twin.LicenceNo) !== f.LicenceNo) return toast(`${fullName(twin)} has licence no ${cleanNo(twin.LicenceNo)}, not ${f.LicenceNo}. Check the number.`);
      h = twin;
    }
  }
  const { mine, other } = capCheckSerial(form);
  const transfer = !mine && other && form.elements.Transfer?.checked ? other : null;
  if (other && !mine && !transfer) return toast(`Serial ${f.SerialNo} is on licence ${other.Title}. Tick the transfer box, or check the serial number.`);
  $("#capSave").disabled = true;
  try {
    if (!h) {
      const hf = { HolderKind: kind, LicenceNo: f.LicenceNo, Surname: f.Surname, GivenNames: f.GivenNames, MiddleName: f.MiddleName, Address: f.Address,
        CompanyName: kind === "Company" ? f.CompanyName : "", Notes: "Back-captured from " + set.files[0].name };
      hf.Title = fullName(hf);
      const ref = newRef();
      mergeLocal(LISTS.holders, ref, hf);
      await enqueue({ kind: "upsert", list: LISTS.holders, ref, fields: hf, label: `Back-capture · new holder · ${hf.Title}` });
      h = holder(ref); newHolder = true; logActivity("Holder added (back-capture)", h, null);
    } else if (!cleanNo(h.LicenceNo)) {
      mergeLocal(LISTS.holders, h.ClientRef, { LicenceNo: f.LicenceNo });
      await enqueue({ kind: "upsert", list: LISTS.holders, ref: h.ClientRef, fields: { LicenceNo: f.LicenceNo }, label: `Holder licence no · ${fullName(h)}` });
      h = holder(h.ClientRef);
    }
    const photo = !!CAP.photo;
    if (CAP.photo) { await queuePhoto(h, CAP.photo, false); CAP.photo = null; }

    const prevRef = (D.holders.find(x => norm(fullName(x)) === norm(f.PrevOwner)) || {}).ClientRef || "";
    const lf = { SerialNo: f.SerialNo, Make: f.Make, Model: f.Model, FirearmType: f.FirearmType, Calibre: f.Calibre, Capacity: f.Capacity, Class: f.Class,
      Purpose: f.Purpose, IssueDate: f.IssueDate, ExpiryDate: f.ExpiryDate, PTBNo: f.PTBNo, PTBDate: f.PTBDate, DeliveredDate: f.DeliveredDate,
      ReceiptNo: f.ReceiptNo, OfficeOfIssue: f.OfficeOfIssue, PrevOwner: f.PrevOwner, PrevOwnerRef: prevRef, PrevLicenceNo: f.PrevLicenceNo,
      SourceFile: set.files[0].name };
    let l, newLicence = false;
    const already = mine && mine.HolderRef === h.ClientRef ? mine : null;
    if (already) {                                       // already captured: fill in what's missing, keep what's there
      const upd = Object.fromEntries(Object.entries(lf).filter(([k, v]) => v && k !== "SourceFile" && !String(already[k] || "").trim()));
      upd.SourceFile = [already.SourceFile, set.files[0].name].filter(Boolean).join(", ");
      mergeLocal(LISTS.licences, already.ClientRef, upd);
      await enqueue({ kind: "upsert", list: LISTS.licences, ref: already.ClientRef, fields: upd, label: `Back-capture · ${already.Title}` });
      l = lic(already.ClientRef);
    } else {
      const ref = newRef(), type = isCompany(h) ? "Company" : "Individual";
      Object.assign(lf, { Title: licNoFor(h, type), LicenceType: type, HolderRef: h.ClientRef, LicenceStatus: "Active", Notes: "Back-captured" });
      mergeLocal(LISTS.licences, ref, lf);
      await enqueue({ kind: "upsert", list: LISTS.licences, ref, fields: lf, label: `Back-capture · licence ${lf.Title} · SN ${lf.SerialNo}` });
      l = lic(ref); newLicence = true; logActivity("Licence created (back-capture)", h, l, `SN ${lf.SerialNo}`);
    }
    if (transfer) await capCancel(transfer, h, l, f.PTBDate || f.DeliveredDate);
    const ltc = carry ? await capSaveLtc(set, f, carry, h, l) : null;
    await capAttach(set, h, l, CAP_KINDS[set.type].docTypes, f.PTBDate || f.DeliveredDate);
    capFinish(set, form, { holderRef: h.ClientRef, licRef: l.ClientRef, newHolder, newLicence, transfer: transfer?.Title, photo, ltcRef: ltc?.ref, newLtc: ltc?.isNew });
  } finally { const b = $("#capSave"); if (b) b.disabled = false; }
}

/* the licence to carry from the docket: numbered LC + the carrier's own number, tied to the firearm's
   licence (CarryForRef), which it copies the firearm, purpose and dates from - as on the licence screen */
async function capSaveLtc(set, f, carry, h, l) {
  const dup = ltcsOf(l).find(x => cleanNo(x.Title) === carry.no);
  if (dup) return { ref: dup.ClientRef, isNew: false };
  const p = carry.p, ref = newRef();
  const lf = { Title: withPfx("LC", carry.no), LicenceType: "LTC", HolderRef: h.ClientRef, CarryForRef: l.ClientRef, CarrierRef: p?.ClientRef || "",
    CarrierGivenNames: f.CarrierGivenNames || p?.GivenNames || "", CarrierMiddleName: f.CarrierMiddleName || p?.MiddleName || "", CarrierSurname: f.CarrierSurname || p?.Surname || "",
    CarrierSex: p?.Sex || "", CarrierPhone: p?.Phone || "", CarrierAddress: f.CarrierAddress || p?.Address || "",
    SerialNo: l.SerialNo || "", Make: l.Make || "", Model: l.Model || "", FirearmType: l.FirearmType || "", Calibre: l.Calibre || "", Class: l.Class || "",
    Purpose: l.Purpose || f.Purpose, IssueDate: l.IssueDate || f.IssueDate, ExpiryDate: f.CarrierExpiryDate || l.ExpiryDate || f.ExpiryDate,
    LicenceStatus: "Active", Notes: "Back-captured", SourceFile: set.files[0].name };
  mergeLocal(LISTS.licences, ref, lf);
  await enqueue({ kind: "upsert", list: LISTS.licences, ref, fields: lf, label: `Back-capture · licence to carry ${lf.Title} · SN ${lf.SerialNo}` });
  logActivity("Licence to carry created (back-capture)", h, lic(ref), carrierName(lf));
  if (CAP.carrierPhoto) { await queuePhoto(lic(ref), CAP.carrierPhoto, false, LISTS.licences); CAP.carrierPhoto = null; }
  return { ref, isNew: true };
}

/* ---------- automatic reading (Claude on AWS Bedrock, through the zd-reader stack) ----------
   The stack is generic: everything about ZD's documents - the fields, what each one means
   and the instructions - lives here and is sent with the pages. Only the fields the form
   for this kind of scan actually has are asked for. Nothing is saved until Save is pressed. */
const CAP_READ = {
  LicenceNo: "Lic No on the OWNER's licence card copy, exactly as printed including a C prefix if it has one (e.g. 123456 or C 100200). Never the number on an LC card",
  HolderKind: "\"Company\" if the owner's card number starts with C (or the PTB names a company), otherwise \"Individual\"",
  Surname: "owner's surname - an individual only; null for a company card", GivenNames: "owner's first name - an individual only; null for a company card",
  MiddleName: "owner's middle name(s) - an individual only",
  CompanyName: "company name, if the owner is a company. On a C card it is split across the First Name / Last Name boxes (e.g. ACME + TRADING LTD): join it, and prefer the full name on the PTB",
  Address: "owner's address as printed on the owner's card copy (else the PTB)",
  SerialNo: "firearm serial number, exactly as printed", Make: "firearm make, e.g. WINCHESTER", Model: "firearm model, e.g. SPA",
  FirearmType: "type code printed on the card if any (e.g. SG, R, P)", Calibre: "calibre or gauge, e.g. 12G", Capacity: "chamber / magazine capacity, e.g. 5 rds",
  Purpose: "purpose code letter(s) printed on the card, e.g. B or BEFG",
  ExpiryDate: "licence expiry date (YYYY-MM-DD)", IssueDate: "licence issue date if shown (YYYY-MM-DD)",
  PTBNo: "Permit to Buy number", PTBDate: "date the Permit to Buy was issued (YYYY-MM-DD)",
  DeliveredDate: "date on the Delivery Docket (YYYY-MM-DD)", ReceiptNo: "official receipt number for the fee", OfficeOfIssue: "office where the permit was issued",
  PrevOwner: "previous owner / seller named on the Notice of Disposal", PrevLicenceNo: "previous owner's licence number on the Notice of Disposal",
  NODDate: "date of the Notice of Disposal (YYYY-MM-DD)",
  HasLTC: "true if a second card copy with an LC number (licence to carry, e.g. LC 100300) is on the pages, otherwise false",
  CarrierNo: "the LC card's Lic No without the letters LC (e.g. 100300)", CarrierGivenNames: "first name on the LC card", CarrierMiddleName: "middle name(s) on the LC card",
  CarrierSurname: "last name on the LC card", CarrierAddress: "address on the LC card", CarrierExpiryDate: "expiry date on the LC card (YYYY-MM-DD)"
};
const CAP_BOOL = new Set(["HasLTC"]);
const CAP_FIELDS = Object.keys(CAP_READ);
const CAP_FORM_NAME = { LicenceNo: "OwnerNo", Purpose: "PurposeCode" };   // read field -> form field, where they differ
/* The request for one set: { schema, instructions }. `has(name)` says whether the form has that field. */
function capReadRequest(type, names, has) {
  const keys = CAP_FIELDS.filter(k => has(CAP_FORM_NAME[k] || k));
  const props = {};
  for (const k of keys) props[k] = { type: CAP_BOOL.has(k) ? ["boolean", "null"] : ["string", "null"], description: CAP_READ[k] };
  props.unclear = { type: "array", items: { type: "string" }, description: "names of fields that are on the pages but can't be read with confidence" };
  props.note = { type: ["string", "null"], description: "one short sentence about anything unclear, or null" };
  const what = type === "NOD" ? "a Notice of Disposal (NOD) recording the sale of ONE firearm - read the firearm and the previous owner (the seller)"
    : type === "DD" ? "a Delivery Docket, usually with a photocopy of the newly issued licence card, for ONE firearm"
    : "a Permit to Buy (PTB, often handwritten) and a Delivery Docket (often with a photocopy of the newly issued licence card) for ONE firearm sale";
  const instructions = `These are scanned Papua New Guinea firearms licensing documents: ${what}.
File names: ${(names || []).map(String).join(", ").slice(0, 400)}.
Record the values with the record_fields tool. Use null when a value isn't shown or you can't read it - never guess.
Prefer the printed licence card for the owner's details. Dates as YYYY-MM-DD. Names in normal capitalisation.${type === "NOD" ? "" : `
The Delivery Docket can show one or two PNG Firearm Licence card copies for the same firearm (same serial number):
- the OWNER's card: Lic No with no letters (an individual) or with a C prefix (a company firearm). This one gives LicenceNo and the owner.
- a LICENCE TO CARRY card: Lic No with an LC prefix. It names the person who carries the firearm and their own number. Put it ONLY in the Carrier fields and set HasLTC true.
A page may also include a Notice of Disposal: the seller there is PrevOwner / PrevLicenceNo.`}`;
  return { schema: { type: "object", properties: props, required: [...keys, "unclear"] }, instructions };
}
async function capAutoRead(set, form) {
  const btn = $("#capRead"); btn.disabled = true; btn.textContent = "Reading…";
  try {
    const images = [];
    for (const f of set.files) for (const cv of await capPages(f)) images.push(cv.toDataURL("image/jpeg", 0.75).split(",")[1]);
    const req = capReadRequest(set.type, set.files.map(f => f.name), n => !!form.elements[n]);
    const r = await readerCall({ format: "jpeg", images: images.slice(0, 6), ...req });
    const got = r.fields || {}, unclear = Array.isArray(got.unclear) ? got.unclear.map(String).slice(0, 12) : [];
    let n = 0;
    const owner = String(got.LicenceNo || "").trim();
    if (/^LC\s*\d/i.test(owner)) { if (!got.CarrierNo) { got.CarrierNo = owner; got.HasLTC = true; } delete got.LicenceNo; }   // an LC number is never the owner's
    else if (/^C\s*\d/i.test(owner)) got.HolderKind = "Company";
    if (got.HasLTC === true || /^(true|yes)$/i.test(String(got.HasLTC)) || (got.CarrierNo && got.HasLTC == null)) {
      if (form.elements.HasLTC && !form.elements.HasLTC.checked) { form.elements.HasLTC.checked = true; n++; }
    }
    for (const k of CAP_FIELDS) {
      if (CAP_BOOL.has(k)) continue;
      let v = got[k]; if (v == null || v === "") continue;
      v = String(v).trim().slice(0, 300);
      if (k === "Purpose") {
        if (!form.elements.PurposeCode) continue;
        const codes = purposeCodes(v);
        form.querySelectorAll('[name="PurposeCode"]').forEach(c => { if (codes.includes(String(c.value).toUpperCase())) c.checked = true; }); n++; continue;
      }
      const el = form.elements[k === "LicenceNo" ? "OwnerNo" : k]; if (!el || String(el.value).trim()) continue;   // never overwrites what the operator typed
      if (k === "LicenceNo" || k === "CarrierNo") v = cleanNo(v);
      if (el.tagName === "SELECT" && ![...el.options].some(o => o.value === v)) continue;
      el.value = v; el.classList.add("auto"); n++;
    }
    if (got.HolderKind === "Company" && form.elements.HolderKind) { form.querySelector('[name="HolderKind"][value="Company"]').checked = true; form.classList.add("kind-co"); }
    $("#capMsg").innerHTML = `<span class="tag info">Read automatically</span> ${n} field${n === 1 ? "" : "s"} filled in (shaded) - check each one against the scan before saving.${unclear.length ? " Couldn't read clearly: " + esc(unclear.join(", ")) + "." : ""}${typeof got.note === "string" && got.note ? " " + esc(got.note.slice(0, 300)) : ""}`;
    if (set.type === "NOD") capNodMatch(form); else capRefresh(form);
    markDirty();
  } catch (e) { toast(isNetErr(e) && e.code !== "NO_SERVICE" ? "Automatic reading needs an internet connection" : "Automatic reading failed: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Read automatically"; }
}
