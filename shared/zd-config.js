/* =====================================================================
   ZD Licensing - the ONLY file that changes between tenants.

   Proof of concept: runs on Concept Group's tenant (site /sites/ZD_POC).
   To move it to ZD Systems' own SharePoint later, give the new tenant its
   own copy of this file (new CLIENT_ID, TENANT_ID, SP_HOST, SITE_PATH) and
   run setup/Setup-ZD-Licensing.ps1 against the new site. No code changes.

   While CLIENT_ID starts with "<<" the app runs in DEMO mode: no Microsoft
   sign-in, nothing read from or saved to SharePoint (data stays in this
   browser), and the face check is simulated.

   This repository is PUBLIC: IDs and addresses only. Never put licence
   holders, photos, staff details or passwords anywhere in this repo.
   ===================================================================== */
const ZD_TENANT = {
  CLIENT_ID: "35593863-9ae0-4018-8dcc-a82a44e59c51",    // Entra app "ZD Licensing" (SPA)
  TENANT_ID: "ea9e105c-2df6-47ef-a8e3-b4aa1d788423",    // Concept Group (POC)
  SP_HOST:   "conceptcompg.sharepoint.com",
  SITE_PATH: "/sites/ZD_POC"
};

/* Face recognition service (aws/zd-face-api). Leave "" in DEMO mode.
   Outside DEMO mode the app will not open without it: the face check at
   sign-in is mandatory. */
const ZD_FACE_API = "https://fffkbkm4phzo7ivupypwqq4xbq0razio.lambda-url.ap-southeast-2.on.aws/";   // zd-face-api (Concept-RPYC-POC account, Sydney)

/* =====================================================================
   Branding and names
     COMPANY      - shown on the sign-in page and printouts
     SHORT        - short name for page titles and messages
     CARD_TITLE   - heading printed on cards whose background asks for it
     ISSUER       - small line under the heading on the card
     LIST_PREFIX  - start of every SharePoint list / library name
                    (ZD_ -> ZD_Licences). Must match the setup script's -Prefix.
     OFFICE_GROUP - SharePoint group whose members can read/write the lists
     REGISTRAR    - name printed after "Registrar" on cards that have it
     STORE_TAG    - keeps this site's offline data apart from other copies
                    opened in the same browser ("" = use the site address)
   ===================================================================== */
const ZD_BRAND = {
  COMPANY:      "ZD Systems",
  SHORT:        "ZD",
  CARD_TITLE:   "FIREARMS LICENCE",
  ISSUER:       "ZD Systems",
  LIST_PREFIX:  "ZD_",
  OFFICE_GROUP: "ZD Licensing Office",
  REGISTRAR:    "",                    // printed after "Registrar" on the PNG Firearm Licence card ("" = left blank)
  STORE_TAG:    null
};

/* =====================================================================
   Choices offered on the licence form. Placeholder values for the POC:
   replace them with ZD Systems' real licence types before go-live.
   ===================================================================== */
const ZD_CHOICES = {
  // Licence types and the prefix the app puts in front of the number the officer types:
  //   Individual  12345678     one per firearm, held by a person
  //   Company     C12345679    one per firearm owned by a company
  //   LTC         LTC12345671  licence to carry one of the company's firearms - the carrier's photo and details
  LICENCE_TYPES: { Individual: { prefix: "", label: "Individual" }, Company: { prefix: "C", label: "Company firearm" }, LTC: { prefix: "LTC", label: "Licence to carry" } },
  REP_ROLES: ["Owner", "Chief Executive Officer", "Managing Director", "Director", "General Manager"],
  FIREARM_TYPES: ["Rifle", "Shotgun", "Handgun", "Other"],   // old free-text types (records made before the Type codes)
  // STARTING LISTS ONLY. Admins keep the real Class, Purpose and Type codes in
  // the ZD_Codes SharePoint list (Codes page). These are used until a set has
  // been saved there, and can be copied there with one click.
  // Type codes from ZD Systems' updated list (Nov 2026). Printed in the card's
  // "Type" box; not all of them appear on the back of the legacy card.
  TYPES: ["REV", "RBA", "RSA", "SPA", "SSA", "AIR", "GAS", "DBS", "PSA", "RLA", "RPA", "RSS", "SSB", "SBA",
          "SDB", "SLA", "SLV", "SOU", "OBS", "SW", "SXS", "SSS", "SSP", "SSG", "ARMS", "MP", "PCA", "PDA",
          "SAP", "SB", "SDU", "PRV", "S/GUN"],
  // Class codes as printed on the back of the PNG Firearm Licence card (kept on record, not printed).
  CLASSES: [
    ["A", ".22 and Air Rifle"], ["B", "All Shotguns"], ["C", "All Pistols"], ["D", "All Other Rifles"], ["E", "Other"]
  ],
  // Purpose codes as printed on the back of the PNG Firearm Licence card.
  // The card's front prints only the letter.
  PURPOSES: [
    ["A", "Club Activities"],    ["B", "Self Protection"],      ["C", "Veterinary"],
    ["D", "Scientific"],         ["E", "Commercial Hunting"],   ["F", "Destruction Livestock"],
    ["G", "Sporting Purposes"],  ["H", "Subsistence Hunting"],  ["I", "Dealer Firearms"],
    ["J", "Dealer Ammunition"]
  ],
  // Document types offered when a document is attached (starting list - Admins keep the real one on the Codes page)
  DOC_TYPES: ["Application form", "Identity document", "Police clearance", "Medical certificate", "Competency certificate",
              "Payment receipt", "Previous licence", "Firearm photo", "Purchase / transfer", "Correspondence", "Other"],
  STATUSES:      ["Active", "Suspended", "Cancelled", "Expired"]
};

/* =====================================================================
   Rules
     FACE_RECHECK_HOURS  - a face check at sign-in lasts this long on a
                           device before another one is asked for
     OFFLINE_GRACE_HOURS - with no internet the face check can't run, so a
                           device that passed one within this many hours
                           may keep working offline. 0 = never work offline.
     LICENCE_YEARS       - default expiry = issue date + this many years
   ===================================================================== */
const ZD_RULES = {
  FACE_RECHECK_HOURS:  12,
  OFFLINE_GRACE_HOURS: 12,
  LICENCE_YEARS:       3
};
