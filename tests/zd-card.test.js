// Card maths: backgrounds and photos must always cover the whole area, never stretch.
// Run: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../shared/zd-card.js");

const covers = (iw, ih, w, h) => {
  const r = C.coverRect(iw, ih, w, h);
  // the part drawn stays inside the picture...
  assert.ok(r.sx >= -1e-9 && r.sy >= -1e-9 && r.sx + r.sw <= iw + 1e-9 && r.sy + r.sh <= ih + 1e-9, "inside picture");
  // ...has exactly the card's shape (no stretching)...
  assert.ok(Math.abs(r.sw / r.sh - w / h) < 1e-9, "same shape as the card");
  // ...and uses the whole width or the whole height (as much picture as possible)
  assert.ok(Math.abs(r.sw - iw) < 1e-9 || Math.abs(r.sh - ih) < 1e-9, "no needless trimming");
  return r;
};

test("card is 1012 x 638 at 300 dpi (CR80)", () => {
  assert.deepEqual(C.SIZE.Landscape, { w: 1012, h: 638 });
  assert.deepEqual(C.SIZE.Portrait, { w: 638, h: 1012 });
  assert.ok(Math.abs(85.6 * C.MM - 1011) < 1.5 && Math.abs(54 * C.MM - 638) < 1.5);
});

test("exact-size background is used whole", () => {
  assert.deepEqual(covers(1012, 638, 1012, 638), { sx: 0, sy: 0, sw: 1012, sh: 638, scale: 1 });
});

test("wide, tall, tiny and huge backgrounds all cover the card", () => {
  for (const [iw, ih] of [[1500, 700], [600, 1000], [100, 60], [8000, 8000], [1013, 638], [1012, 640]]) {
    covers(iw, ih, 1012, 638); covers(iw, ih, 638, 1012);
  }
});

test("overflow is trimmed evenly from both sides", () => {
  const r = covers(1500, 700, 1012, 638);
  assert.ok(Math.abs(r.sx - (1500 - r.sw - r.sx)) < 1e-9);
  const t = covers(600, 1000, 1012, 638);
  assert.ok(Math.abs(t.sy - (1000 - t.sh - t.sy)) < 1e-9);
});

test("bad sizes are refused", () => {
  assert.throws(() => C.coverRect(0, 10, 10, 10));
});

test("dates print as DD/MM/YYYY without a time-zone shift", () => {
  assert.equal(C.dmy("2026-11-12"), "12/11/2026");
  assert.equal(C.dmy("2026-01-01T00:00:00Z"), "01/01/2026");
  assert.equal(C.dmy(""), "");
});

test("layouts keep everything on the card", () => {
  for (const o of ["Landscape", "Portrait"]) for (const h of [true, false]) {
    const L = C.layout(o, h);
    assert.ok(L.photo.x >= 0 && L.photo.y >= 0 && L.photo.x + L.photo.w <= L.w && L.photo.y + L.photo.h <= L.h, `${o} photo`);
    for (const r of L.rows) assert.ok(r.y < L.h - 20 && r.x >= 0, `${o} row ${r.keys}`);
  }
});

test("PNG Firearm Licence layout: photo and values stay inside the card's white panel", () => {
  const T = C.LAYOUTS["PNG Firearm Licence"];
  const panel = { x0: 35, y0: 78, x1: 962, y1: 578 };       // white area of the preprinted card (1012 x 638)
  const p = T.photo;
  assert.ok(p.x >= panel.x0 && p.y >= panel.y0 && p.x + p.w <= 390 && p.y + p.h <= 470, "photo clear of the SN label and the text column");
  assert.ok(Math.abs(p.w / p.h - 0.75) < 0.01, "photo is 3 x 4");
  for (const f of T.fields) {
    assert.ok(f.x >= panel.x0 && f.x + f.max <= panel.x1 && f.y <= panel.y1 - 8, `${f.key} inside the panel`);
    if (f.y < 223) assert.ok(f.x + f.max <= 786, `${f.key} clear of the hologram`);
  }
});

test("long addresses wrap onto two lines at most", () => {
  const ctx = { measureText: t => ({ width: t.length * 10 }) };
  const lines = C.wrapLines(ctx, "Section 12, Allotment 4,\nKonedobu, National Capital District, Papua New Guinea", 300, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].length * 10 <= 300);
});
