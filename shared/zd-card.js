/* =====================================================================
   ZD Licensing - ID card renderer (CR80 card, 85.6 x 54 mm)

   Cards are drawn on a canvas at the card printer's own resolution
   (300 dpi = 1012 x 638 pixels) so what you see is what prints.

   Backgrounds ALWAYS fill the whole card: the image is scaled up until it
   covers the card and the overflow is trimmed evenly from both sides
   ("cover"), so a background of the wrong shape or size can never leave
   a white strip (the Gun Club card problem). The same is done for the
   licence holder's photo inside its frame.

   No data here - the repo is public.
   ===================================================================== */
(function (root) {
  const DPI = 300;
  const MM = DPI / 25.4;                         // pixels per millimetre
  const CARD_MM = { w: 85.6, h: 54 };
  const SIZE = {
    Landscape: { w: 1012, h: 638 },
    Portrait:  { w: 638,  h: 1012 }
  };

  /* Part of the source image to draw so it covers a box of w x h with no
     gaps and no stretching: keeps the middle, trims the overflow. */
  function coverRect(iw, ih, w, h) {
    if (!(iw > 0 && ih > 0 && w > 0 && h > 0)) throw new Error("coverRect needs positive sizes");
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale, sh = h / scale;
    return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, scale };
  }

  const pad = n => String(n).padStart(2, "0");
  // "2026-11-12" -> "12/11/2026" (no Date objects: avoids the UTC+10 shift)
  const dmy = s => { if (!s) return ""; const [y, m, d] = String(s).slice(0, 10).split("-"); return d && m && y ? `${d}/${m}/${y}` : String(s); };

  /* Largest font size (down to min) at which text fits in maxWidth. */
  function fitFont(ctx, text, weight, size, min, maxWidth, family) {
    let s = size;
    for (; s > min; s -= 1) {
      ctx.font = `${weight} ${s}px ${family}`;
      if (ctx.measureText(text).width <= maxWidth) return s;
    }
    ctx.font = `${weight} ${min}px ${family}`;
    return min;
  }

  const FONT = '"Segoe UI", Arial, Helvetica, sans-serif';

  function layout(orientation, showHeader) {
    const { w, h } = SIZE[orientation] || SIZE.Landscape;
    if (orientation === "Portrait") {
      const top = showHeader ? 150 : 70;
      return {
        w, h, align: "center",
        title: { x: w / 2, y: 70, size: 40 }, issuer: { x: w / 2, y: 112, size: 24 },
        photo: { x: (w - 300) / 2, y: top, w: 300, h: 400 },
        name: { x: w / 2, y: top + 470, size: 40, max: w - 70 },
        rows: [
          { x: w / 2, y: top + 540, max: w - 70, keys: ["LicenceNo"] },
          { x: w / 2, y: top + 615, max: w - 70, keys: ["LicenceType"] },
          { x: 70, y: top + 700, max: 240, keys: ["DateOfBirth"], left: true },
          { x: w - 70 - 240, y: top + 700, max: 240, keys: ["ExpiryDate"], left: true }
        ]
      };
    }
    const top = showHeader ? 150 : 60;
    const fx = 340, fw = w - fx - 40;
    return {
      w, h, align: "left",
      title: { x: 40, y: 72, size: 46 }, issuer: { x: 40, y: 112, size: 24 },
      photo: { x: 40, y: top, w: 270, h: 360 },
      name: { x: fx, y: top + 40, size: 40, max: fw },
      rows: [
        { x: fx, y: top + 115, max: fw, keys: ["LicenceNo"] },
        { x: fx, y: top + 195, max: fw, keys: ["LicenceType"] },
        { x: fx, y: top + 275, max: fw / 2 - 10, keys: ["DateOfBirth"] },
        { x: fx + fw / 2 + 10, y: top + 275, max: fw / 2 - 10, keys: ["Sex"] },
        { x: fx, y: top + 355, max: fw / 2 - 10, keys: ["IssueDate"] },
        { x: fx + fw / 2 + 10, y: top + 355, max: fw / 2 - 10, keys: ["ExpiryDate"] }
      ]
    };
  }

  const LABELS = {
    LicenceNo: "Licence No", LicenceType: "Licence type", DateOfBirth: "Date of birth",
    Sex: "Sex", IssueDate: "Issued", ExpiryDate: "Expires"
  };
  const isDate = k => k === "DateOfBirth" || /Date$/.test(k);

  /* =====================================================================
     FIXED LAYOUTS for preprinted cards. The labels are already printed on
     the card, so only the values (and the photo) are placed, each one
     against its printed label. Positions are card pixels at 300 dpi
     (1012 x 638), measured from a 300 dpi scan of the blank card;
     y is the text baseline. 1 mm = 11.8 px.
       key   - field from the licence / chosen firearm
       max   - width available before the text is shrunk to fit
       lines - wrap onto this many lines (Address)
     ===================================================================== */
  const LAYOUTS = {
    "PNG Firearm Licence": {
      orientation: "Landscape", needsFirearm: true,
      photo: { x: 62, y: 92, w: 276, h: 368 },          // blank area on the left, ~2 mm clear of "SN"
      size: 26,
      fields: [
        { key: "LicenceNo",   x: 452, y: 147, max: 325, size: 32 },   // after "Lic No:", left of the hologram
        { key: "GivenNames",  x: 396, y: 258, max: 236 },             // under "First Name"
        { key: "Surname",     x: 642, y: 258, max: 300, upper: true },// under "Last Name"
        { key: "Address",     x: 396, y: 368, max: 545, size: 24, lines: 2, lineHeight: 30 },
        { key: "Make",        x: 396, y: 482, max: 268 },             // under "Make"
        { key: "FirearmType", x: 674, y: 482, max: 268 },             // under "Type"
        { key: "SerialNo",    x: 82,  y: 501, max: 290, size: 24 },   // after "SN"
        { key: "Registrar",   x: 156, y: 553, max: 220, size: 22 },   // after "Registrar"
        { key: "Calibre",     x: 396, y: 564, max: 190, size: 24 },   // under "Calibre"
        { key: "Purpose",     x: 596, y: 564, max: 175, size: 24 },   // under "Purpose"
        { key: "ExpiryDate",  x: 779, y: 564, max: 170, size: 24 }    // under "Expiry Date"
      ]
    }
  };

  function wrapLines(ctx, text, max, lines) {
    const words = String(text).replace(/\s*[\r\n]+\s*/g, ", ").split(/\s+/).filter(Boolean), out = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (ctx.measureText(t).width <= max || !cur) cur = t;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    if (out.length > lines) out.splice(lines - 1, out.length, out.slice(lines - 1).join(" "));  // the rest goes on the last line (shrunk)
    return out;
  }

  function drawTemplate(ctx, T, lic, photo, light) {
    const P = T.photo;
    if (photo) {
      ctx.save(); roundRect(ctx, P.x, P.y, P.w, P.h, 8); ctx.clip();
      const iw = photo.naturalWidth || photo.width, ih = photo.naturalHeight || photo.height;
      const c = coverRect(iw, ih, P.w, P.h);
      ctx.drawImage(photo, c.sx, c.sy, c.sw, c.sh, P.x, P.y, P.w, P.h);
      ctx.restore();
    }
    ctx.textAlign = "left"; ctx.fillStyle = light ? "#ffffff" : "#111418";
    for (const f of T.fields) {
      let v = String(lic[f.key] ?? "").trim();
      if (!v) continue;
      if (isDate(f.key)) v = dmy(v);
      if (f.upper) v = v.toUpperCase();
      const size = f.size || T.size;
      if (f.lines > 1) {
        ctx.font = `600 ${size}px ${FONT}`;
        wrapLines(ctx, v, f.max, f.lines).forEach((line, i) => {
          fitFont(ctx, line, 600, size, 14, f.max, FONT);
          ctx.fillText(line, f.x, f.y + i * (f.lineHeight || size + 6));
        });
      } else {
        fitFont(ctx, v, 700, size, 14, f.max, FONT);
        ctx.fillText(v, f.x, f.y);
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* Draw a card.
       canvas  - any canvas; it is resized to the card
       lic     - licence fields (Surname, GivenNames, LicenceNo, ...)
       photo   - an image/bitmap of the holder, or null
       bg      - { image|null, orientation:"Landscape"|"Portrait", textColour:"Dark"|"Light", showHeader:bool }
       brand   - { CARD_TITLE, ISSUER }
       opts    - { print:true } leaves out a background marked preprinted
                 (the card already has it), so only the values print */
  function drawCard(canvas, lic, photo, bg, brand, opts) {
    bg = bg || {}; opts = opts || {};
    const T = bg.layout && LAYOUTS[bg.layout];
    if (T) bg = { ...bg, orientation: T.orientation };
    const orientation = bg.orientation === "Portrait" ? "Portrait" : "Landscape";
    const L = layout(orientation, bg.showHeader !== false);
    canvas.width = L.w; canvas.height = L.h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";

    // 1. Background - white card, then the image covering ALL of it
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, L.w, L.h);
    if (bg.image && !(opts.print && bg.preprinted)) {
      const iw = bg.image.naturalWidth || bg.image.width, ih = bg.image.naturalHeight || bg.image.height;
      const c = coverRect(iw, ih, L.w, L.h);
      ctx.drawImage(bg.image, c.sx, c.sy, c.sw, c.sh, 0, 0, L.w, L.h);
    }

    const light = bg.textColour === "Light";
    if (T) { drawTemplate(ctx, T, lic, photo, light); return canvas; }
    const ink = light ? "#ffffff" : "#111418", soft = light ? "rgba(255,255,255,.82)" : "#4a5260";
    if (light) { ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1; }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = L.align;

    // 2. Heading (only when the background doesn't already carry one)
    if (bg.showHeader !== false && brand) {
      ctx.fillStyle = ink;
      fitFont(ctx, brand.CARD_TITLE || "", 800, L.title.size, 20, L.w - 80, FONT);
      ctx.fillText(brand.CARD_TITLE || "", L.title.x, L.title.y);
      ctx.fillStyle = soft; ctx.font = `600 ${L.issuer.size}px ${FONT}`;
      ctx.fillText(brand.ISSUER || "", L.issuer.x, L.issuer.y);
    }

    // 3. Photo frame - photo covers the frame, never stretched
    const P = L.photo;
    ctx.save();
    ctx.shadowColor = "transparent";
    roundRect(ctx, P.x - 4, P.y - 4, P.w + 8, P.h + 8, 14); ctx.fillStyle = "#ffffff"; ctx.fill();
    roundRect(ctx, P.x, P.y, P.w, P.h, 10); ctx.clip();
    if (photo) {
      const iw = photo.naturalWidth || photo.width, ih = photo.naturalHeight || photo.height;
      const c = coverRect(iw, ih, P.w, P.h);
      ctx.drawImage(photo, c.sx, c.sy, c.sw, c.sh, P.x, P.y, P.w, P.h);
    } else {
      ctx.fillStyle = "#e6e9ee"; ctx.fillRect(P.x, P.y, P.w, P.h);
      ctx.fillStyle = "#98a2b0"; ctx.font = `600 26px ${FONT}`; ctx.textAlign = "center";
      ctx.fillText("No photo", P.x + P.w / 2, P.y + P.h / 2);
    }
    ctx.restore();
    ctx.textAlign = L.align;

    // 4. Optional shaded panel behind the text, for busy backgrounds
    if (bg.panel) {
      const last = L.rows[L.rows.length - 1];
      const x0 = L.align === "center" ? 30 : L.name.x - 18, y0 = L.name.y - L.name.size - 14;
      const x1 = L.align === "center" ? L.w - 30 : L.w - 22, y1 = last.y + 18;
      ctx.save(); ctx.shadowColor = "transparent";
      ctx.fillStyle = light ? "rgba(0,0,0,.38)" : "rgba(255,255,255,.72)";
      roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 16); ctx.fill(); ctx.restore();
    }

    // 5. Name, then the labelled fields
    const name = [String(lic.GivenNames || "").trim(), String(lic.Surname || "").trim().toUpperCase()].filter(Boolean).join(" ");
    ctx.fillStyle = ink;
    fitFont(ctx, name || "—", 800, L.name.size, 22, L.name.max, FONT);
    ctx.fillText(name || "—", L.name.x, L.name.y);

    for (const r of L.rows) {
      const k = r.keys[0];
      const value = isDate(k) ? dmy(lic[k]) : String(lic[k] ?? "");
      ctx.textAlign = r.left ? "left" : L.align;
      ctx.fillStyle = soft; ctx.font = `700 21px ${FONT}`;
      ctx.fillText(LABELS[k].toUpperCase(), r.x, r.y - 36);
      ctx.fillStyle = ink;
      fitFont(ctx, value || "—", 700, 32, 18, r.max, FONT);
      ctx.fillText(value || "—", r.x, r.y);
    }
    ctx.shadowColor = "transparent";
    return canvas;
  }

  /* Print one card through the browser to the card printer.
     The page is exactly card size with no margins; the image is made a
     little bigger than the card ("bleed") and can be nudged, so small
     printer offsets don't leave a white edge.
       settings = { bleedMm: 0.5, offsetXmm: 0, offsetYmm: 0 } */
  function printCard(canvas, settings) {
    const s = Object.assign({ bleedMm: 0.5, offsetXmm: 0, offsetYmm: 0 }, settings || {});
    const portrait = canvas.height > canvas.width;
    const W = portrait ? CARD_MM.h : CARD_MM.w, H = portrait ? CARD_MM.w : CARD_MM.h;
    const b = Math.max(0, Math.min(3, +s.bleedMm || 0));
    const png = canvas.toDataURL("image/png");
    const html = `<!doctype html><html><head><title>Card</title><style>
      @page{size:${W}mm ${H}mm;margin:0}
      html,body{margin:0;padding:0;width:${W}mm;height:${H}mm;overflow:hidden}
      img{position:absolute;display:block;width:${W + 2 * b}mm;height:${H + 2 * b}mm;
          left:${-b + (+s.offsetXmm || 0)}mm;top:${-b + (+s.offsetYmm || 0)}mm}
      </style></head><body><img src="${png}"></body></html>`;
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(f);
    const d = f.contentWindow.document; d.open(); d.write(html); d.close();
    const img = d.querySelector("img");
    const go = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); };
    if (img.complete) setTimeout(go, 50); else img.onload = go;
  }

  const api = { DPI, MM, CARD_MM, SIZE, LAYOUTS, coverRect, layout, drawCard, printCard, dmy, fitFont, wrapLines };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZDCard = api;
})(typeof window !== "undefined" ? window : globalThis);
