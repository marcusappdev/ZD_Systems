// zd-face-api — face recognition for ZD Licensing (proof of concept)
//
// Built from cg-staff-face-api (CG HUBS) and rpyc-face-api (RPYC POC):
// same Microsoft token check, same Amazon Rekognition approach.
//
// Every request must carry the user's Microsoft sign-in (ID token):
//   Authorization: Bearer <id token issued to the ZD Licensing app>
// WHO is asking always comes from that token, never from the browser.
//
// Two face collections:
//   zd-staff      - staff sign-in face check (labelled with the sign-in name,
//                   "@" written as ":" because Rekognition labels can't hold "@")
//   zd-licensees  - licence holders (labelled with the licence's ClientRef)
//
// Actions (POST JSON):
//   status                          -> { enrolled, admin }      my sign-in face
//   enrol          { image }        -> set up my sign-in face (once only)
//   verify         { image }        -> { verified, similarity } is this me?
//   list                            -> (admin) staff with a sign-in face
//   reset          { email }        -> (admin) remove a staff member's sign-in face
//   licenseeEnrol  { ref, image }   -> { faceId, duplicates:[{ref, similarity}] }
//                                      replaces any earlier face for that licence
//   licenseeSearch { image }        -> { matches:[{ref, similarity}] }
//   licenseeRemove { ref }          -> (admin) remove a licence holder's face
//
// Photos are never stored here - only Rekognition face prints.

import {
  RekognitionClient,
  DetectFacesCommand,
  SearchFacesByImageCommand,
  IndexFacesCommand,
  DeleteFacesCommand,
  ListFacesCommand,
} from "@aws-sdk/client-rekognition";
import crypto from "node:crypto";

const TENANT_ID = process.env.TENANT_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const STAFF_COLLECTION = process.env.STAFF_COLLECTION || "zd-staff";
const LICENSEE_COLLECTION = process.env.LICENSEE_COLLECTION || "zd-licensees";
const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD || 90);    // sign-in check and duplicate warning
const SEARCH_THRESHOLD = Number(process.env.SEARCH_THRESHOLD || 85);  // "find by face" lists matches above this
const ADMIN_USERS = (process.env.ADMIN_USERS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);

const rek = new RekognitionClient({});

class AuthError extends Error {}
class ForbiddenError extends Error {}
class UserError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const reply = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

// ---------- Microsoft token check (same as cg-staff-face-api) ----------

let jwksCache = null;
let jwksFetchedAt = 0;

async function getSigningKeys(force = false) {
  const sixHours = 6 * 60 * 60 * 1000;
  if (!force && jwksCache && Date.now() - jwksFetchedAt < sixHours) return jwksCache;
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`);
  if (!res.ok) throw new Error(`Could not fetch Microsoft signing keys (${res.status})`);
  jwksCache = (await res.json()).keys;
  jwksFetchedAt = Date.now();
  return jwksCache;
}

const b64url = (s) => Buffer.from(s, "base64url");

async function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) throw new AuthError("Missing sign-in token");
  const parts = authHeader.slice(7).trim().split(".");
  if (parts.length !== 3) throw new AuthError("Malformed token");

  let header, payload;
  try {
    header = JSON.parse(b64url(parts[0]).toString("utf8"));
    payload = JSON.parse(b64url(parts[1]).toString("utf8"));
  } catch {
    throw new AuthError("Malformed token");
  }
  if (header.alg !== "RS256") throw new AuthError("Unexpected token algorithm");

  let jwk = (await getSigningKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getSigningKeys(true)).find((k) => k.kid === header.kid); // keys rotate
  if (!jwk) throw new AuthError("Unknown signing key");

  const publicKey = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, b64url(parts[2]));
  if (!ok) throw new AuthError("Invalid token signature");

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now > payload.exp + 60) throw new AuthError("Token expired");
  if (payload.nbf && now < payload.nbf - 60) throw new AuthError("Token not yet valid");
  if (payload.aud !== CLIENT_ID) throw new AuthError("Token is for a different app");
  if (payload.tid !== TENANT_ID) throw new AuthError("Token is from a different organisation");
  if (payload.iss !== `https://login.microsoftonline.com/${TENANT_ID}/v2.0`) throw new AuthError("Unexpected token issuer");

  const email = String(payload.preferred_username || payload.email || "").trim().toLowerCase();
  if (!email) throw new AuthError("Sign-in has no user name");
  return { email, label: emailToLabel(email), admin: ADMIN_USERS.includes(email) };
}

// Rekognition labels allow letters, digits and _ . - : only.
function emailToLabel(email) {
  const label = String(email).trim().toLowerCase().replace("@", ":");
  if (!/^[a-z0-9_.\-:]{3,255}$/.test(label)) throw new UserError("This sign-in name can't be used for a face record", "BAD_NAME");
  return label;
}
const labelToEmail = (label) => String(label).replace(":", "@");
function checkRef(ref) {
  const r = String(ref || "");
  if (!/^[A-Za-z0-9_.\-]{6,64}$/.test(r)) throw new UserError("Missing or invalid licence reference", "BAD_REF");
  return r;
}

// ---------- Face helpers ----------

function imageBytes(b64) {
  if (!b64) throw new UserError("No photo supplied", "NO_IMAGE");
  const bytes = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ""), "base64");
  if (bytes.length < 1000) throw new UserError("Photo is empty or unreadable", "BAD_IMAGE");
  if (bytes.length > 4.5 * 1024 * 1024) throw new UserError("Photo is too large", "TOO_LARGE");
  return bytes;
}

async function requireOneFace(bytes) {
  const r = await rek.send(new DetectFacesCommand({ Image: { Bytes: bytes } }));
  const faces = (r.FaceDetails || []).filter((f) => f.Confidence >= 90);
  if (faces.length === 0) throw new UserError("No face found in the photo. Face the camera in good light.", "NO_FACE");
  if (faces.length > 1) throw new UserError("More than one face in the photo. Only one person should be in the picture.", "MULTIPLE_FACES");
}

function inputError(err) {
  if (err?.name === "InvalidParameterException" || err?.name === "InvalidImageFormatException") {
    return new UserError("The photo wasn't clear enough. Please try again in better light.", "LOW_QUALITY");
  }
  return err;
}

async function allFaces(collection) {
  const faces = [];
  let NextToken;
  do {
    const r = await rek.send(new ListFacesCommand({ CollectionId: collection, MaxResults: 1000, NextToken }));
    for (const f of r.Faces || []) faces.push({ faceId: f.FaceId, label: f.ExternalImageId || "" });
    NextToken = r.NextToken;
  } while (NextToken);
  return faces;
}
const facesFor = async (collection, label) => (await allFaces(collection)).filter((f) => f.label === label);

async function search(collection, bytes, threshold, max = 5) {
  try {
    const r = await rek.send(new SearchFacesByImageCommand({
      CollectionId: collection,
      Image: { Bytes: bytes },
      FaceMatchThreshold: threshold,
      MaxFaces: max,
      QualityFilter: "AUTO",
    }));
    return (r.FaceMatches || []).map((m) => ({ label: m.Face.ExternalImageId, faceId: m.Face.FaceId, similarity: Math.round(m.Similarity * 10) / 10 }));
  } catch (err) {
    // An empty collection has nothing to search
    if (err?.name === "InvalidParameterException" && /no faces/i.test(err.message || "")) return [];
    throw inputError(err);
  }
}

async function index(collection, bytes, label) {
  try {
    const r = await rek.send(new IndexFacesCommand({
      CollectionId: collection,
      Image: { Bytes: bytes },
      ExternalImageId: label,
      MaxFaces: 1,
      QualityFilter: "AUTO",
      DetectionAttributes: [],
    }));
    if (!r.FaceRecords?.length) throw new UserError("The photo wasn't clear enough to make a face record. Please retake it.", "LOW_QUALITY");
    return r.FaceRecords[0].Face.FaceId;
  } catch (err) {
    throw inputError(err);
  }
}

async function remove(collection, label) {
  const ids = (await facesFor(collection, label)).map((f) => f.faceId);
  if (ids.length) await rek.send(new DeleteFacesCommand({ CollectionId: collection, FaceIds: ids }));
  return ids.length;
}

// ---------- Staff sign-in face check ----------

async function status(user) {
  return { enrolled: (await facesFor(STAFF_COLLECTION, user.label)).length > 0, admin: user.admin };
}

async function enrol(user, b64) {
  if ((await facesFor(STAFF_COLLECTION, user.label)).length) {
    throw new UserError("Your face is already set up. Ask an administrator to reset it if it needs changing.", "ALREADY_ENROLLED", 409);
  }
  const bytes = imageBytes(b64);
  await requireOneFace(bytes);
  const other = (await search(STAFF_COLLECTION, bytes, MATCH_THRESHOLD)).find((m) => m.label !== user.label);
  if (other) throw new UserError("This face is already set up for another person. Please see your administrator.", "FACE_IN_USE", 409);
  await index(STAFF_COLLECTION, bytes, user.label);
  return { enrolled: true };
}

async function verify(user, b64) {
  if (!(await facesFor(STAFF_COLLECTION, user.label)).length) throw new UserError("Your face isn't set up yet.", "NOT_ENROLLED", 409);
  const bytes = imageBytes(b64);
  await requireOneFace(bytes);
  const matches = await search(STAFF_COLLECTION, bytes, MATCH_THRESHOLD);
  const mine = matches.find((m) => m.label === user.label);
  // Verified only if the signed-in person is the best match.
  if (mine && matches[0]?.label === user.label) return { verified: true, similarity: mine.similarity };
  return { verified: false };
}

async function list(user) {
  if (!user.admin) throw new ForbiddenError("Only administrators can do this");
  const counts = new Map();
  for (const f of await allFaces(STAFF_COLLECTION)) counts.set(f.label, (counts.get(f.label) || 0) + 1);
  return {
    employees: [...counts].map(([label, faces]) => ({ email: labelToEmail(label), faces }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  };
}

async function reset(user, email) {
  if (!user.admin) throw new ForbiddenError("Only administrators can do this");
  return { removed: await remove(STAFF_COLLECTION, emailToLabel(email)) };
}

// ---------- Licence holders ----------

async function licenseeEnrol(user, ref, b64) {
  ref = checkRef(ref);
  const bytes = imageBytes(b64);
  await requireOneFace(bytes);
  // The same face on a different licence is worth a second look (one person, two names).
  const duplicates = (await search(LICENSEE_COLLECTION, bytes, MATCH_THRESHOLD))
    .filter((m) => m.label !== ref)
    .map((m) => ({ ref: m.label, similarity: m.similarity }));
  await remove(LICENSEE_COLLECTION, ref);            // a new photo replaces the old face record
  const faceId = await index(LICENSEE_COLLECTION, bytes, ref);
  console.log(JSON.stringify({ action: "licenseeEnrol", by: user.email, ref, duplicates: duplicates.length }));
  return { faceId, duplicates };
}

async function licenseeSearch(user, b64) {
  const bytes = imageBytes(b64);
  await requireOneFace(bytes);
  const best = new Map();
  for (const m of await search(LICENSEE_COLLECTION, bytes, SEARCH_THRESHOLD, 10)) {
    if (!best.has(m.label) || best.get(m.label) < m.similarity) best.set(m.label, m.similarity);
  }
  console.log(JSON.stringify({ action: "licenseeSearch", by: user.email, found: best.size }));
  return { matches: [...best].map(([ref, similarity]) => ({ ref, similarity })).sort((a, b) => b.similarity - a.similarity) };
}

async function licenseeRemove(user, ref) {
  if (!user.admin) throw new ForbiddenError("Only administrators can do this");
  return { removed: await remove(LICENSEE_COLLECTION, checkRef(ref)) };
}

// ---------- Entry point ----------

export const handler = async (event) => {
  try {
    if (!TENANT_ID || !CLIENT_ID) throw new Error("TENANT_ID and CLIENT_ID environment variables must be set");
    if (event.requestContext?.http?.method !== "POST") return reply(405, { error: "Use POST" });

    const user = await verifyToken(event.headers?.authorization);

    let body = event.body || "{}";
    if (event.isBase64Encoded) body = Buffer.from(body, "base64").toString("utf8");
    let req;
    try {
      req = JSON.parse(body);
    } catch {
      return reply(400, { error: "Body must be JSON", code: "BAD_JSON" });
    }

    switch (req.action) {
      case "status":         return reply(200, await status(user));
      case "enrol":          return reply(200, await enrol(user, req.image));
      case "verify":         return reply(200, await verify(user, req.image));
      case "list":           return reply(200, await list(user));
      case "reset":          return reply(200, await reset(user, req.email));
      case "licenseeEnrol":  return reply(200, await licenseeEnrol(user, req.ref, req.image));
      case "licenseeSearch": return reply(200, await licenseeSearch(user, req.image));
      case "licenseeRemove": return reply(200, await licenseeRemove(user, req.ref));
      default:               return reply(400, { error: "Unknown action", code: "BAD_ACTION" });
    }
  } catch (err) {
    if (err instanceof AuthError) return reply(401, { error: err.message, code: "UNAUTHORISED" });
    if (err instanceof ForbiddenError) return reply(403, { error: err.message, code: "FORBIDDEN" });
    if (err instanceof UserError) return reply(err.status, { error: err.message, code: err.code });
    console.error(err);
    return reply(500, { error: "Server error", code: "SERVER_ERROR" });
  }
};
