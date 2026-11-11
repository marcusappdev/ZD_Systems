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
  CLIENT_ID: "<<ZD Licensing app client ID>>",          // Entra app "ZD Licensing" (SPA)
  TENANT_ID: "ea9e105c-2df6-47ef-a8e3-b4aa1d788423",    // Concept Group (POC)
  SP_HOST:   "conceptcompg.sharepoint.com",
  SITE_PATH: "/sites/ZD_POC"
};

/* Face recognition service (aws/zd-face-api). Leave "" in DEMO mode.
   Outside DEMO mode the app will not open without it: the face check at
   sign-in is mandatory. */
const ZD_FACE_API = "";

/* =====================================================================
   Branding and names
     COMPANY      - shown on the sign-in page and printouts
     SHORT        - short name for page titles and messages
     CARD_TITLE   - heading printed on cards whose background asks for it
     ISSUER       - small line under the heading on the card
     LIST_PREFIX  - start of every SharePoint list / library name
                    (ZD_ -> ZD_Licences). Must match the setup script's -Prefix.
     OFFICE_GROUP - SharePoint group whose members can read/write the lists
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
  STORE_TAG:    null
};

/* =====================================================================
   Choices offered on the licence form. Placeholder values for the POC:
   replace them with ZD Systems' real licence types before go-live.
   ===================================================================== */
const ZD_CHOICES = {
  LICENCE_TYPES: ["Shooter", "Collector", "Club member", "Security", "Dealer"],
  FIREARM_TYPES: ["Rifle", "Shotgun", "Handgun", "Other"],
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
