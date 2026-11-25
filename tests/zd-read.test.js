// Back-capture "Read automatically": the request the app sends to the zd-reader stack.
// The stack is generic, so the schema and instructions built here are what decide what is read.
// Run: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// zd-capture.js is a browser script; load it into a sandbox and pick out what we test.
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname + "/../shared/zd-capture.js", "utf8") +
  "\n;this.capReadRequest = capReadRequest; this.CAP_FIELDS = CAP_FIELDS;", ctx);
const { capReadRequest, CAP_FIELDS } = ctx;

const NOD_FORM = ["SerialNo", "PrevOwner", "PrevLicenceNo", "NODDate"];
const BUY_FORM = ["OwnerNo", "HolderKind", "Surname", "GivenNames", "MiddleName", "CompanyName", "Address", "SerialNo", "Make", "Model",
  "FirearmType", "Calibre", "Capacity", "PurposeCode", "ExpiryDate", "IssueDate", "PTBNo", "PTBDate", "DeliveredDate", "ReceiptNo",
  "OfficeOfIssue", "PrevOwner", "PrevLicenceNo", "HasLTC", "CarrierNo", "CarrierGivenNames", "CarrierMiddleName", "CarrierSurname",
  "CarrierAddress", "CarrierExpiryDate"];

test("a Notice of Disposal asks only for the NOD form's fields", () => {
  const { schema, instructions } = capReadRequest("NOD", ["20261119-002_NOD_Guo_Shujie.pdf"], n => NOD_FORM.includes(n));
  assert.deepEqual(Object.keys(schema.properties).sort(), [...NOD_FORM, "unclear", "note"].sort());
  assert.match(instructions, /Notice of Disposal/);
  assert.match(instructions, /Guo_Shujie/);
});

test("a purchase maps LicenceNo -> OwnerNo and Purpose -> PurposeCode", () => {
  const { schema } = capReadRequest("PTB", ["a.pdf"], n => BUY_FORM.includes(n));
  for (const k of ["LicenceNo", "Purpose", "HolderKind", "PTBNo"]) assert.ok(schema.properties[k], k);
  assert.ok(!schema.properties.NODDate, "no NOD date on the purchase form");
});

test("schema is valid for forced tool use: object, nullable strings, required keys exist", () => {
  const { schema } = capReadRequest("PTB", [], () => true);
  assert.equal(schema.type, "object");
  assert.equal(Object.keys(schema.properties).length, CAP_FIELDS.length + 2);
  for (const k of CAP_FIELDS) assert.deepEqual([...schema.properties[k].type], k === "HasLTC" ? ["boolean", "null"] : ["string", "null"]);
  for (const k of schema.required) assert.ok(schema.properties[k], "required key " + k + " is a property");
  assert.ok(JSON.stringify(schema).length < 8000);
});

test("instructions stay under the stack's 8000-character limit even with long file names", () => {
  const { instructions } = capReadRequest("PTB", Array(200).fill("x".repeat(50) + ".pdf"), () => true);
  assert.ok(instructions.length < 8000);
});

test("a purchase asks for the licence to carry card separately from the owner's card", () => {
  const { schema, instructions } = capReadRequest("PTB", ["a.pdf"], n => BUY_FORM.includes(n));
  for (const k of ["HasLTC", "CarrierNo", "CarrierGivenNames", "CarrierSurname", "CarrierExpiryDate"]) assert.ok(schema.properties[k], k);
  assert.match(schema.properties.LicenceNo.description, /Never the number on an LC card/);
  assert.match(instructions, /LC prefix/);
  assert.match(instructions, /C prefix/);
});

test("a Notice of Disposal doesn't get the card instructions or carrier fields", () => {
  const { schema, instructions } = capReadRequest("NOD", [], n => NOD_FORM.includes(n));
  assert.ok(!schema.properties.CarrierNo && !schema.properties.HasLTC);
  assert.doesNotMatch(instructions, /LICENCE TO CARRY/);
});
