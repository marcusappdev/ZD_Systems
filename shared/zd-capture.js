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

/* ---------- the page ----------
   Top: progress through the sets. Left: the scan. Right: either the form (set to do)
   or a green "Saved" summary (set done) with a Next button - so it's always clear
   whether the set in front of you has been saved. */
function pageCapture() {
  const set = CAP.sets[CAP.i];
  const doneN = CAP.sets.filter(s => s.done).length;
  $("#main").innerHTML = banners() + `<div class="bar"><h2>Back-capture</h2><span class="grow"></span>
      <label class="btn sm ${CAP.sets.length ? "" : "primary"}" style="margin:0">${CAP.sets.length ? "+ Add more scans" : "Choose scanned files"}<input type="file" id="capFiles" accept=".pdf,image/*" multiple hidden></label></div>
    ${!set ? `<div class="card cap-drop" id="capDrop"><p><b>Drop the scanned PDFs here</b>, or click <b>Choose scanned files</b>.</p>
        <p class="small muted">Name them like <span class="mono">20261119-001_PTB_Guo_Shujie.pdf</span> and <span class="mono">20261119-002_NOD_Guo_Shujie.pdf</span>.
        Files next to each other with the same name are one <b>set</b> (one firearm). Scans already in the app show as done.</p></div>`
      : `<div class="cap-progress">
        <div class="cap-count"><b>Set ${CAP.i + 1} of ${CAP.sets.length}</b><span class="muted"> · ${doneN} saved · ${CAP.sets.length - doneN} to do</span></div>
        <div class="cap-meter"><span style="width:${Math.round(100 * doneN / CAP.sets.length)}%"></span></div>
        <div class="cap-chips">${CAP.sets.map((s, k) => `<button type="button" class="cap-chip ${s.done ? "done" : ""} ${k === CAP.i ? "cur" : ""}" data-set="${k}" title="${esc(s.files.map(f => f.name).join("\n"))}">${s.done ? "✓ " : ""}${esc(s.person || "Set " + (k + 1))}</button>`).join("")}</div></div>
      <div class="cap-grid">
        <div class="card cap-view"><div class="cap-tabs">
            ${set.files.map((f, k) => `<button type="button" class="btn sm ${k === (CAP.tab || 0) ? "primary" : ""}" data-tab="${k}" title="${esc(f.name)}">${esc(f.info.kind || "Scan " + (k + 1))}</button>`).join("")}
            <span class="grow"></span>
            <button type="button" class="btn sm" id="capZoom">Zoom</button>
            ${set.done ? "" : `<button type="button" class="btn sm" id="capPhoto" title="Cut the holder's photo from the card copy on this scan">Photo from scan</button>`}</div>
          <div class="small muted mono cap-fname" id="capName"></div>
          <div id="capPage" class="cap-page"><p class="muted" style="color:#fff">Loading the scan…</p></div></div>
        <div class="card cap-side">${set.done ? capSavedHtml(set) : `<form id="capForm" class="cap-form" autocomplete="off">${capFormHtml(set)}</form>`}</div>
      </div>`}`;
  $("#capFiles").onchange = e => { capLoadFiles(e.target.files); e.target.value = ""; CAP.tab = 0; CAP.photo = null; pageCapture(); };
  const drop = $("#capDrop") || $("#main");
  drop.ondragover = e => { if (hasFiles(e)) e.preventDefault(); };
  drop.ondrop = e => { if (!hasFiles(e)) return; e.preventDefault(); capLoadFiles(e.dataTransfer.files); CAP.tab = 0; CAP.photo = null; pageCapture(); };
  if (!set) return;
  $$("[data-set]").forEach(b => b.onclick = () => capGo(+b.dataset.set));
  $(".cap-chip.cur")?.scrollIntoView({ block: "nearest", inline: "center" });
  $$("[data-tab]").forEach(b => b.onclick = () => { CAP.tab = +b.dataset.tab; capShow(set); $$("[data-tab]").forEach(x => x.classList.toggle("primary", x === b)); });
  $("#capZoom").onclick = () => $("#capPage").classList.toggle("zoomed");
  if ($("#capPhoto")) $("#capPhoto").onclick = async () => {
    const cv = (await capPages(set.files[CAP.tab || 0]))[0];
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92));
    const out = await openCrop(blob, { maxZoom: 14 });
    if (out && out !== "retake") { CAP.photo = out; capShowPhoto(); markDirty(); }
  };
  if (set.done) { $("#capNextSet")?.addEventListener("click", () => capGo(capNextTodo())); $("#capNextSet")?.focus(); }
  else capWireForm(set);
  capShow(set);
}
const capNextTodo = () => { const n = CAP.sets.findIndex((s, i) => i > CAP.i && !s.done); return n >= 0 ? n : CAP.sets.findIndex(s => !s.done); };
function capGo(i) {
  if (i < 0 || i >= CAP.sets.length) return;
  if (S.dirty) return ask("This set hasn't been saved. Leave it without saving?", { title: "Not saved", yes: "Leave it", no: "Stay" }).then(ok => { if (ok) { S.dirty = false; capGo(i); } });
  CAP.i = i; CAP.tab = 0; CAP.photo = null; S.dirty = false; pageCapture(); window.scrollTo(0, 0);
}
async function capShow(set) {
  const f = set.files[CAP.tab || 0];
  $("#capName").textContent = f.name;
  try {
    const pages = await capPages(f), box = $("#capPage"); if (!box || $("#capName")?.textContent !== f.name) return;
    box.innerHTML = ""; pages.forEach(cv => { const img = document.createElement("img"); img.src = cv.toDataURL("image/jpeg", 0.85); box.appendChild(img); });
  } catch (e) { $("#capPage").innerHTML = `<p style="color:#fff">This scan couldn't be shown: ${esc(e.message)}</p>`; }
}
function capShowPhoto() {
  const slot = $("#capPhotoSlot"); if (!slot) return;
  slot.innerHTML = CAP.photo ? `<img src="${URL.createObjectURL(CAP.photo)}" alt="">` : `<div class="nophoto small">No photo</div>`;
}

/* ---------- a saved set: what was done, and the way on ---------- */
function capSavedHtml(set) {
  let r = set.saved;
  if (!r) {                                           // saved in an earlier session: work it out from the attached documents
    const d = (D.docs || []).find(x => set.files.some(f => f.name === x.OriginalName)), l = d && lic_(d.LicenceRef);
    r = { holderRef: d?.HolderRef || l?.HolderRef, licRef: l?.ClientRef, earlier: true };
  }
  const h = holder(r.holderRef), l = r.licRef && lic_(r.licRef), next = capNextTodo();
  const row = (k, v) => v ? `<div class="cap-sum-row"><span>${k}</span><b>${v}</b></div>` : "";
  return `<div class="cap-saved"><div class="cap-tick">✓</div><h3>Saved${r.earlier ? " earlier" : ""}</h3>
      <p class="muted small" style="margin:0 0 14px">${r.earlier ? "These scans were already attached in the app." : "This set is in the register. The documents go to SharePoint with the next sync."}</p></div>
    ${row("Holder", h ? `<a href="#/holder/${encodeURIComponent(h.ClientRef)}" target="_blank">${esc(fullName(h))}</a>${r.newHolder ? ` <span class="tag ok">new</span>` : ` <span class="tag">already in register</span>`}` : "")}
    ${row("Licence", l ? `<a href="#/licence/${encodeURIComponent(l.ClientRef)}" target="_blank">${esc(l.Title)}</a>${r.newLicence ? ` <span class="tag ok">new</span>` : r.earlier ? "" : ` <span class="tag">already in register - scans added</span>`}` : "")}
    ${row("Firearm", l ? esc(gunText(l)) : "")}
    ${row("Previous owner", l?.PrevOwner ? esc(l.PrevOwner) + (l.PrevLicenceNo ? " (" + esc(l.PrevLicenceNo) + ")" : "") : "")}
    ${row("Transfer", r.transfer ? `licence ${esc(r.transfer)} marked Cancelled` : "")}
    ${row("Photo", r.photo ? "added from the scan" : "")}
    ${row("Documents", set.files.map(f => esc(f.name)).join("<br>"))}
    <div class="cap-actions">${next >= 0 ? `<button type="button" class="btn primary" id="capNextSet">Next set: ${esc(CAP.sets[next].person || "set " + (next + 1))} →</button>`
      : `<div class="cap-alldone">All ${CAP.sets.length} sets in this batch are done. Use <b>+ Add more scans</b> for the next batch.</div>`}</div>`;
}

/* ---------- the form ---------- */
function capFormHtml(set) {
  const people = D.holders.slice().sort((a, b) => sortName(a).localeCompare(sortName(b)));
  const nameParts = String(set.person || "").split(/\s+/);   // file names are First_Last as on the card (Guo_Shujie) - check against the card
  const step = (n, t) => `<h4 class="cap-step"><span>${n}</span>${t}</h4>`;
  return `<div class="cap-head"><h3>${esc(set.person || "Set " + (CAP.i + 1))}</h3><span class="grow"></span>
      ${RULES.AUTO_READ ? `<button type="button" class="btn sm" id="capRead">Read automatically</button>` : ""}</div>
    <div id="capMsg" class="small"></div>
    <div class="cap-body">
    ${step(1, "Owner (new owner on the card)")}
    <input type="hidden" name="HolderRef">
    <div class="grid2"><label>Licence no on the card *<input type="text" name="LicenceNo" class="mono" placeholder="e.g. 114608"></label>
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
      <span class="small muted">Photo: click <b>Photo from scan</b> above the scan and cut it from the card copy (optional).</span></div>

    ${step(2, "Firearm")}
    <label>Serial no *<input type="text" name="SerialNo" class="mono"></label>
    <div class="cap-status" id="capSn"></div>
    <div class="grid3"><label>Make<input type="text" name="Make"></label><label>Model<input type="text" name="Model"></label>
      <label>Type<select name="FirearmType">${codeOptions(codeList("Type"), "")}</select></label></div>
    <div class="grid3"><label>Calibre<input type="text" name="Calibre"></label><label>Capacity<input type="text" name="Capacity" placeholder="e.g. 5 rds"></label>
      <label>Class<select name="Class">${codeOptions(codeList("Class"), "")}</select></label></div>

    ${step(3, "Licence")}
    ${purposePicker("", "")}
    <div class="grid2"><label>Expires *<input type="date" name="ExpiryDate"></label><label>Issued<input type="date" name="IssueDate"></label></div>

    ${step(4, "Permit to Buy, Delivery Docket and Notice of Disposal")}
    <div class="grid3"><label>PTB no<input type="text" name="PTBNo" class="mono"></label><label>PTB dated<input type="date" name="PTBDate"></label>
      <label>Delivered<input type="date" name="DeliveredDate"></label></div>
    <div class="grid2"><label>Receipt no<input type="text" name="ReceiptNo" class="mono"></label><label>Office of issue<input type="text" name="OfficeOfIssue"></label></div>
    <div class="grid3"><label>Previous owner (seller)<input type="text" name="PrevOwner" list="capPeopleNames"><datalist id="capPeopleNames">${people.map(x => `<option value="${esc(fullName(x))}">`).join("")}</datalist></label>
      <label>Previous licence no<input type="text" name="PrevLicenceNo" class="mono"></label><label>NOD dated<input type="date" name="NODDate"></label></div>

    ${step(5, "What each scan is")}
    ${set.files.map((f, k) => `<div class="cap-file"><span class="mono small">${esc(f.name)}</span><div>
      ${CAP_TYPES.map(t => `<label class="chk"><input type="checkbox" data-ft="${k}" value="${esc(t)}" ${f.types.includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("")}</div></div>`).join("")}
    </div>
    <div class="cap-foot"><span class="small muted" id="capFootMsg"></span><span class="grow"></span>
      <button type="button" class="btn" id="capSkip">Skip</button><button type="submit" class="btn primary" id="capSave">Save this set</button></div>`;
}

function capVal(form) {
  const fd = new FormData(form), f = {};
  for (const [k, v] of fd) if (k !== "PurposeCode") f[k] = String(v).trim();
  f.Purpose = purposeOrder(fd.getAll("PurposeCode").map(v => String(v).toUpperCase())).join("");
  f.LicenceNo = cleanNo(f.LicenceNo);
  return f;
}

/* who the owner is: the holder picked, or the holder with the licence no typed */
function capOwner(form) {
  const ref = form.elements.HolderRef.value;
  if (ref) return holder(ref);
  const n = cleanNo(form.elements.LicenceNo.value);
  return n ? D.holders.find(x => cleanNo(x.LicenceNo) === n) || null : null;
}

function capWireForm(set) {
  const form = $("#capForm");
  form.oninput = markDirty;
  const showKind = () => form.classList.toggle("kind-co", form.querySelector('[name="HolderKind"]:checked').value === "Company");
  form.querySelectorAll('[name="HolderKind"]').forEach(r => r.onchange = showKind); showKind();
  $("#capFind").addEventListener("change", () => {
    const v = $("#capFind").value.trim().toLowerCase();
    const p = D.holders.find(x => ((x.LicenceNo ? cleanNo(x.LicenceNo) + " · " : "") + fullName(x)).toLowerCase() === v);
    if (p) { form.elements.HolderRef.value = p.ClientRef; form.elements.LicenceNo.value = cleanNo(p.LicenceNo); $("#capFind").value = ""; capRefresh(form); markDirty(); }
  });
  form.elements.LicenceNo.addEventListener("input", () => {   // a different number from the picked holder's = a different owner
    const p = holder(form.elements.HolderRef.value);
    if (p && cleanNo(p.LicenceNo) && cleanNo(p.LicenceNo) !== cleanNo(form.elements.LicenceNo.value)) form.elements.HolderRef.value = "";
    capRefresh(form);
  });
  form.elements.SerialNo.addEventListener("input", () => capRefresh(form));
  form.elements.ExpiryDate.addEventListener("change", () => {   // one-year licences: issued = expiry less a year, when blank
    const e = form.elements.ExpiryDate.value, i = form.elements.IssueDate;
    if (e && !i.value) { const d = new Date(e); d.setFullYear(d.getFullYear() - RULES.LICENCE_YEARS); d.setDate(d.getDate() + 1); i.value = ymd(d); }
  });
  $("#capRead")?.addEventListener("click", () => capAutoRead(set, form));
  $("#capSkip").onclick = () => capGo(capNextTodo() >= 0 && capNextTodo() !== CAP.i ? capNextTodo() : CAP.i + 1);
  form.onsubmit = e => { e.preventDefault(); capSave(set, form); };
  capShowPhoto(); capRefresh(form);
}

/* keeps the two status boxes (owner, serial) and the footer telling the operator exactly what Save will do */
function capRefresh(form) { capWho(form); capCheckSerial(form); capFoot(form); }

function capWho(form) {
  const box = $("#capWho"), p = capOwner(form), n = cleanNo(form.elements.LicenceNo.value);
  form.classList.toggle("owner-known", !!p);
  if (p) {
    box.className = "cap-status info";
    box.innerHTML = `<b>Already in the register:</b> ${esc(fullName(p))}${p.LicenceNo ? " (" + esc(cleanNo(p.LicenceNo)) + ")" : ""}${p.Address ? "<br><span class='small'>" + esc(p.Address) + "</span>" : ""}
      <br><span class="small">Their record is used - nothing new is created for the owner.</span>`;
  } else if (n) { box.className = "cap-status ok"; box.innerHTML = `<b>New holder</b> - licence no ${esc(n)} isn't in the register. Fill in their details below.`; }
  else { box.className = "cap-status"; box.innerHTML = `Type the licence no from the card copy, or find the owner in the register.`; }
}

/* the serial number decides: new firearm, already captured (attach the scans), or a transfer from another owner */
function capCheckSerial(form) {
  const box = $("#capSn"), sn = form.elements.SerialNo.value.trim(), owner = capOwner(form);
  const k = serialKey(sn), same = k ? D.licences.filter(x => !isLTC(x) && serialKey(x.SerialNo) === k && x.LicenceStatus !== "Cancelled") : [];
  const mine = owner && same.find(x => x.HolderRef === owner.ClientRef), other = !mine && same.find(x => !owner || x.HolderRef !== owner.ClientRef);
  const wasTick = form.elements.Transfer ? form.elements.Transfer.checked : true;
  if (!sn) { box.className = "cap-status"; box.innerHTML = "Type the serial number exactly as on the card."; }
  else if (mine) {
    box.className = "cap-status info";
    box.innerHTML = `<b>Already in the register</b> on licence <b>${esc(mine.Title)}</b> for ${esc(fullName(owner))}.<br><span class="small">No new licence - the scans are attached to that licence and any empty details are filled in.</span>`;
  } else if (other) {
    const ph = holder(other.HolderRef) || {};
    box.className = "cap-status warn";
    box.innerHTML = `<b>Registered to ${esc(fullName(ph))}</b> on licence <b>${esc(other.Title)}</b>.
      <label class="chk" style="margin-top:6px"><input type="checkbox" name="Transfer" value="${esc(other.ClientRef)}" ${wasTick ? "checked" : ""}> This is a transfer: cancel licence ${esc(other.Title)} - sold to the new owner</label>`;
    box.querySelector("[name=Transfer]").onchange = () => capFoot(form);
    if (!form.elements.PrevOwner.value) form.elements.PrevOwner.value = fullName(ph);
    if (!form.elements.PrevLicenceNo.value) form.elements.PrevLicenceNo.value = other.Title;
  } else { box.className = "cap-status ok"; box.innerHTML = `<b>New firearm</b> - this serial isn't in the register. A new licence will be created.`; }
  return { mine, other };
}

function capFoot(form) {
  const el = $("#capFootMsg"); if (!el) return;
  const owner = capOwner(form), sn = form.elements.SerialNo.value.trim();
  const parts = [];
  if (form.elements.LicenceNo.value.trim()) parts.push(owner ? "existing holder" : "new holder");
  if (sn) {
    const k = serialKey(sn), same = D.licences.filter(x => !isLTC(x) && serialKey(x.SerialNo) === k && x.LicenceStatus !== "Cancelled");
    const m = owner && same.find(x => x.HolderRef === owner.ClientRef);
    parts.push(m ? "add scans to " + m.Title : "new licence");
    if (!m && same.length && form.elements.Transfer?.checked) parts.push("cancel " + same[0].Title);
  }
  el.textContent = parts.length ? "Save will: " + parts.join(" · ") : "";
}

async function capSave(set, form) {
  const f = capVal(form), owner = capOwner(form), kind = owner ? (isCompany(owner) ? "Company" : "Individual") : f.HolderKind;
  const need = [["LicenceNo", "Licence no"], ["SerialNo", "Serial no"], ["ExpiryDate", "Expires"],
    ...(owner ? [] : kind === "Company" ? [["CompanyName", "Company name"]] : [["Surname", "Surname"], ["GivenNames", "First name"]])];
  const missing = need.filter(([k]) => !f[k]).map(x => x[1]);
  if (missing.length) return toast("Please fill in: " + missing.join(", "));
  if (!f.Purpose) return toast("Tick at least one purpose");
  const types = set.files.map((_, k) => [...form.querySelectorAll(`[data-ft="${k}"]:checked`)].map(x => x.value));
  if (types.some(t => !t.length)) return toast("In step 5, tick what each scan is (PTB, Delivery Docket, NOD)");

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
        CompanyName: kind === "Company" ? f.CompanyName : "", Notes: "Back-captured from " + set.files.map(x => x.name).join(", ") };
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
      ReceiptNo: f.ReceiptNo, OfficeOfIssue: f.OfficeOfIssue, PrevOwner: f.PrevOwner, PrevOwnerRef: prevRef, PrevLicenceNo: f.PrevLicenceNo, NODDate: f.NODDate,
      SourceFile: set.files.map(x => x.name).join(", ") };
    let l, newLicence = false;
    const already = mine && mine.HolderRef === h.ClientRef ? mine : null;
    if (already) {                                       // already captured: fill in what's missing, keep what's there
      const upd = Object.fromEntries(Object.entries(lf).filter(([k, v]) => v && !String(already[k] || "").trim()));
      if (Object.keys(upd).length) { mergeLocal(LISTS.licences, already.ClientRef, upd); await enqueue({ kind: "upsert", list: LISTS.licences, ref: already.ClientRef, fields: upd, label: `Back-capture · ${already.Title}` }); }
      l = lic(already.ClientRef);
    } else {
      const ref = newRef(), type = isCompany(h) ? "Company" : "Individual";
      Object.assign(lf, { Title: licNoFor(h, type), LicenceType: type, HolderRef: h.ClientRef, LicenceStatus: "Active", Notes: "Back-captured" });
      mergeLocal(LISTS.licences, ref, lf);
      await enqueue({ kind: "upsert", list: LISTS.licences, ref, fields: lf, label: `Back-capture · licence ${lf.Title} · SN ${lf.SerialNo}` });
      l = lic(ref); newLicence = true; logActivity("Licence created (back-capture)", h, l, `SN ${lf.SerialNo}`);
    }
    if (transfer) {                                      // the previous owner's licence ends: disposed of to the new owner
      const note = `${String(transfer.Notes || "").trim()}\nDisposed of to ${fullName(h)} (${l.Title})${f.NODDate ? " on " + f.NODDate : ""} - NOD back-captured`.trim();
      mergeLocal(LISTS.licences, transfer.ClientRef, { LicenceStatus: "Cancelled", Notes: note });
      await enqueue({ kind: "upsert", list: LISTS.licences, ref: transfer.ClientRef, fields: { LicenceStatus: "Cancelled", Notes: note }, label: `Transfer · ${transfer.Title} cancelled` });
      logActivity("Licence cancelled (transfer)", holder(transfer.HolderRef), lic(transfer.ClientRef), `to ${fullName(h)} ${l.Title}`);
    }
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
    set.done = true; set.saved = { holderRef: h.ClientRef, licRef: l.ClientRef, newHolder, newLicence, transfer: transfer?.Title, photo };
    S.dirty = false;
    pageCapture(); window.scrollTo(0, 0);           // same set, now showing the green "Saved" summary and the Next button
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
    capRefresh(form); markDirty();
  } catch (e) { toast(isNetErr(e) ? "Automatic reading needs an internet connection" : "Automatic reading failed: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Read automatically"; }
}
