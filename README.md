# ZD Licensing — firearms licence register and ID cards (proof of concept)

Served from **https://marcusappdev.github.io/ZD_Systems/**

Records firearms licence holders in SharePoint, takes their photo from a camera, puts
it with their details on a CR80 ID card (on one of several backgrounds, or none) and
prints it on the card printer. A face check is **required to sign in**, and licence
holders' faces can be registered so a licence can be found from a photo later.
Everything keeps working without internet and is sent to SharePoint when the
connection comes back.

Built the same way as the CG HUBS and MJE Hubs: a single-page app on GitHub Pages,
Microsoft sign-in (MSAL, PKCE, redirect only), SharePoint lists through Microsoft
Graph, and a small AWS Lambda using Amazon Rekognition for faces.

| Folder / file | What it is |
|---|---|
| `index.html` | The app |
| `shared/zd-config.js` | **The only file that changes between tenants**: client ID, tenant, site, names, choices, rules |
| `shared/zd-core.js` | Sign-in, SharePoint, the offline queue, the face service |
| `shared/zd-card.js` | Card drawing and printing (300 dpi, backgrounds always fill the card) |
| `sw.js` | Lets the app open with no internet |
| `aws/zd-face-api/` | The face service (AWS Lambda). Not served by GitHub Pages |
| `setup/Setup-ZD-Licensing.ps1` | Creates the SharePoint site, lists, libraries and group |
| `tests/` | Automatic tests (run on every pull request) |

## Demo mode

While `CLIENT_ID` in `shared/zd-config.js` starts with `<<`, the app runs in **demo
mode**: no Microsoft sign-in, nothing goes to SharePoint (data stays in that browser)
and the face check is simulated. Add `?role=Officer` or `?role=Viewer` to the address
to try other roles; **Settings → Pretend to be offline** tests the offline behaviour.

## Screens and roles

Roles come from the `ZD_Staff` list (**HubRole**). The first person to sign in before
anyone is an Admin gets the Admin view to set things up.

| Screen | Admin | Officer | Viewer |
|---|:-:|:-:|:-:|
| Register (search, filters: expiring, expired, face to check, waiting to send) | ✓ | ✓ | ✓ |
| Licence — details, photo, firearms, card preview, history | ✓ | ✓ | view |
| New licence, take photo, print card, find by face | ✓ | ✓ | |
| Card backgrounds, Staff & roles, sign-in face resets | ✓ | | |
| Settings — card printer adjustment for this computer | ✓ | ✓ | ✓ |

The role only decides which screens open. **Who can read or change the data is decided
by SharePoint**: only members of the *ZD Licensing Office* group have access to the site.

## How the face check at sign-in works

1. The person signs in with Microsoft, then the app asks for a photo from the camera.
2. First time: that photo becomes their face record (`zd-staff` collection). It's
   refused if the face is already set up for someone else.
3. Every sign-in after that: the photo must match the signed-in person, and they must
   be the best match. Otherwise the app stays locked.
4. A check lasts for the browser session (up to `FACE_RECHECK_HOURS`, default 12).
5. **No internet:** the check can't run, so a device that passed one for that person
   within `OFFLINE_GRACE_HOURS` (default 12) may carry on offline. Set it to `0` to
   never allow offline work.

Who is who always comes from the Microsoft sign-in token checked inside AWS, never from
the browser. Photos sent to AWS are not kept, only Rekognition face prints.

**Limits to know (proof of concept):** like CG Time Attendance's selfie check, this is a
strong deterrent and an audit trail, not a guarantee. There is no liveness detection
yet (someone holding up a photo); Rekognition Face Liveness can be added at extra cost.
The face check guards the app; the SharePoint group is what guards the data.

## Licence holders' faces (the "face recognition" option)

When a photo is taken with **Register the face** ticked, the face is added to the
`zd-licensees` collection, labelled with the licence's reference, and the licence gets a
**FaceId**. If the same face is already on a *different* licence, the licence is marked
**Face: check** with the other licence number(s) — one person, two licences. A new photo
replaces the old face record. **Find by face** lists the licences whose holder matches a
new photo.

## Working offline

Every change (new licence, edits, photos, faces, firearms, card prints, the activity log)
goes into a queue in the browser first and is sent in order when there's a connection.
Each row carries a `ClientRef` made on the device; before sending, SharePoint is checked
for it, so a retry can never make a duplicate. The register, photos and backgrounds are
also kept on the device, so cards can be looked up and printed offline. The status button
in the header shows what's waiting; click it to see or send.

## Cards

- CR80 (85.6 × 54 mm), drawn at the printer's 300 dpi: **1012 × 638 px** landscape or
  **638 × 1012 px** upright.
- **Backgrounds always fill the whole card.** A picture of any size is enlarged until it
  covers the card and the overflow is trimmed evenly — so a background with the wrong shape
  can't leave a white strip. The Backgrounds screen shows how much is trimmed.
- Each background has: card direction, text colour (dark/light), whether the card heading
  is printed (No when the picture already carries it), a shaded panel behind the text for
  busy pictures, and whether it's offered. "No background" is always available.
- **Printing:** choose the card printer, *Margins: None*, *Scale 100%*, no headers/footers.
  **Settings** has a bleed (default 0.5 mm past each edge) and left/right/up/down nudges
  saved per computer, plus a test card with lines 1, 2 and 3 mm from each edge.
- **Save as picture** gives a 300 dpi PNG for the printer's own software (Entrust Instant ID).

## Setting it up

### 1. SharePoint
Run `setup/Setup-ZD-Licensing.ps1` (PowerShell 7 + PnP.PowerShell). It pauses before each
step and is safe to re-run. Then add the users to the *ZD Licensing Office* group.

### 2. Microsoft Entra app registration
In the Entra admin centre → **App registrations → New registration**:
- Name **ZD Licensing**, single tenant.
- Platform **Single-page application**, redirect URI `https://marcusappdev.github.io/ZD_Systems/`
  (add `http://localhost:8080/` too if you test locally).
- API permissions (delegated): Microsoft Graph **Sites.ReadWrite.All** and **User.Read** →
  *Grant admin consent*.
- Recommended: **Enterprise applications → ZD Licensing → Properties → Assignment required
  = Yes**, then under *Users and groups* add only the people who should use it. Nobody else
  can then get a sign-in token for the app at all — which also locks the face service.

Put the **Application (client) ID** into `CLIENT_ID` in `shared/zd-config.js` (by pull request).

### 3. The face service in AWS (CloudShell, Sydney `ap-southeast-2`)
Same steps as `cg-staff-face-api` in CG HUBS. Run each command on its own.

**Collections**
```
aws rekognition create-collection --collection-id zd-staff --region ap-southeast-2
aws rekognition create-collection --collection-id zd-licensees --region ap-southeast-2
```
**Role** (logs + these two collections only)
```
ACCOUNT=$(aws sts get-caller-identity --query Account --output text); echo $ACCOUNT
```
```
aws iam create-role --role-name zd-face-api-role --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
```
```
aws iam attach-role-policy --role-name zd-face-api-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```
```
aws iam put-role-policy --role-name zd-face-api-role --policy-name zd-rekognition-access --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"rekognition:SearchFacesByImage\",\"rekognition:IndexFaces\",\"rekognition:DeleteFaces\",\"rekognition:ListFaces\"],\"Resource\":[\"arn:aws:rekognition:ap-southeast-2:$ACCOUNT:collection/zd-staff\",\"arn:aws:rekognition:ap-southeast-2:$ACCOUNT:collection/zd-licensees\"]},{\"Effect\":\"Allow\",\"Action\":\"rekognition:DetectFaces\",\"Resource\":\"*\"}]}"
```
**Function** (replace `<<CLIENT_ID>>` with the ZD Licensing client ID)
```
curl -sSo index.mjs https://raw.githubusercontent.com/marcusappdev/ZD_Systems/main/aws/zd-face-api/index.mjs && zip -q function.zip index.mjs && ls -l function.zip
```
```
aws lambda create-function --function-name zd-face-api --runtime nodejs22.x --handler index.handler --zip-file fileb://function.zip --role arn:aws:iam::$ACCOUNT:role/zd-face-api-role --timeout 15 --memory-size 256 --region ap-southeast-2 --environment "Variables={TENANT_ID=ea9e105c-2df6-47ef-a8e3-b4aa1d788423,CLIENT_ID=<<CLIENT_ID>>,ADMIN_USERS=mscully@concept.com.pg}"
```
If it says the role "cannot be assumed", wait 10 seconds and run it again.

**Web address** (only the GitHub Pages site may call it from a browser)
```
aws lambda create-function-url-config --function-name zd-face-api --auth-type NONE --region ap-southeast-2 --cors '{"AllowOrigins":["https://marcusappdev.github.io"],"AllowMethods":["POST"],"AllowHeaders":["authorization","content-type"],"MaxAge":86400}'
```
```
aws lambda add-permission --function-name zd-face-api --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ap-southeast-2
```
```
aws lambda add-permission --function-name zd-face-api --statement-id FunctionURLInvokeAllowPublicAccess --action lambda:InvokeFunction --principal "*" --invoked-via-function-url --region ap-southeast-2
```
**Test** — without a sign-in it must refuse:
```
URL=$(aws lambda get-function-url-config --function-name zd-face-api --region ap-southeast-2 --query FunctionUrl --output text); echo $URL
curl -s -X POST $URL -H "content-type: application/json" -d '{"action":"status"}'
```
Expected: `{"error":"Missing sign-in token","code":"UNAUTHORISED"}`. Put the URL into
`ZD_FACE_API` in `shared/zd-config.js` (by pull request).

| Lambda setting | Value |
|---|---|
| `TENANT_ID`, `CLIENT_ID` | As in `shared/zd-config.js` |
| `ADMIN_USERS` | Comma-separated sign-ins who can list/reset faces |
| `STAFF_COLLECTION` / `LICENSEE_COLLECTION` | Optional, default `zd-staff` / `zd-licensees` |
| `MATCH_THRESHOLD` | Optional, default `90` (sign-in check and duplicate warning) |
| `SEARCH_THRESHOLD` | Optional, default `85` (Find by face) |

**Updating the code later**, after a change to `index.mjs` is merged:
```
curl -sSo index.mjs https://raw.githubusercontent.com/marcusappdev/ZD_Systems/main/aws/zd-face-api/index.mjs && zip -q function.zip index.mjs && aws lambda update-function-code --function-name zd-face-api --zip-file fileb://function.zip --region ap-southeast-2 --query LastUpdateStatus
```

## Moving to ZD Systems' own SharePoint

1. In ZD's tenant: run the setup script (change its five settings at the top), create the
   Entra app as above, and point a face service at the new tenant (`TENANT_ID`, `CLIENT_ID`).
2. Give the new tenant its own `shared/zd-config.js` values. No code changes.
3. Move the data: export the lists and the two libraries from the POC site and import them
   into the new site. Face records stay valid — they're labelled with each licence's
   `ClientRef`, which moves with the data.

## How changes are made

1. Every change is made on its own branch and arrives as a **pull request**.
2. The pull request is reviewed (**Files changed** tab) and merged into `main`.
3. GitHub Pages publishes `main` automatically within a few minutes.
4. To undo a change, open the merged pull request and click **Revert**.

## Rules for this repository

- **This repository is public.** Only IDs and addresses belong here — never passwords,
  licence holders, photos, staff data or customer data.
- Settings live in one place: `shared/zd-config.js`.
- Dates are plain `YYYY-MM-DD` text built from local calendar parts, never `toISOString()`.

Tests: `node --test tests/*.test.js`

© Concept Group Limited
