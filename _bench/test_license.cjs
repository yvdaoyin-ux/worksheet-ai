// _bench/test_license.cjs
//
// /api/verify-license must answer THREE states, not two:
//   { valid: true }                  -> the key works, here is the plan
//   { valid: false, definitive:true } -> Gumroad answered: key dead / refunded
//   { valid: false, uncertain:true }  -> we could not ask, so we do not know
//
// Why this test exists (2026-10-18): every failure used to collapse into
// `{valid:false}`. The client reads valid:false as "this key is dead", deletes
// the stored license key, and silentRecheck() then returns early because there
// is no key left — so ONE Gumroad timeout / 5xx / offline moment permanently
// downgraded a paying customer to the free plan, with no way back except
// re-activating by hand. "We could not check" is not "you did not pay".
//
// Offline: global.fetch is stubbed, no network and no keys are used.
// Run: node _bench/test_license.cjs

const path = require("path");
const handler = require(path.join(__dirname, "..", "api", "verify-license.js"));

let pass = 0;
const fails = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fails.push(name); console.log("FAIL", name, extra === undefined ? "" : "| " + extra); }
}

// One configured product per tier is enough to exercise the loop.
process.env.GOOGLE_GUMROAD = "";
process.env.GUMROAD_PRODUCT_ID = "basic-id";
process.env.GUMROAD_PRO_PRODUCT_ID = "pro-id";
process.env.GUMROAD_CLASSROOM_PRODUCT_ID = "classroom-id";
process.env.GATE_OFF = "1"; // origin guard is covered by test_guard.cjs

function mkRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const req = { method: "POST", body: { license_key: "KEY-123" }, headers: {} };

const realFetch = global.fetch;
async function call(fakeFetch) {
  global.fetch = fakeFetch;
  const res = mkRes();
  await handler(req, res);
  return { code: res.code, body: res.body || {} };
}

// Gumroad answering "no such license" for every product id.
// NOTE: the real API answers this with HTTP 404 and a VALID JSON body — that is
// an answer about the key, not an outage. This exact shape is why the test has a
// separate 404 case below.
const gumroadSaysNo = async () => ({ ok: false, status: 404, json: async () => ({ success: false, message: "That license does not exist for the provided product." }) });
// Every product id verifies.
const gumroadSaysYes = async () => ({ ok: true, status: 200, json: async () => ({ success: true, purchase: { refunded: false } }) });
// Transport exploded.
const networkDown = async () => { throw new Error("ECONNRESET"); };
// Upstream genuinely broken: a 503 with no usable body.
const upstream503 = async () => ({ ok: false, status: 503, json: async () => { throw new Error("no body"); } });
// Upstream returned a 200 whose body is not JSON at all (gateway HTML).
const upstreamHtml = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } });

(async () => {
  let r;

  r = await call(gumroadSaysYes);
  check("a good key is valid", r.body.valid === true, JSON.stringify(r.body));
  check("a good key reports a plan", r.body.plan === "pro" || r.body.plan === "basic");
  check("a good key is NOT flagged definitive/uncertain", !r.body.definitive && !r.body.uncertain);

  r = await call(gumroadSaysNo);
  check("a rejected key is valid:false", r.body.valid === false);
  check("a rejected key is DEFINITIVE (safe to forget the key)", r.body.definitive === true);
  check("a rejected key is not 'uncertain'", !r.body.uncertain);

  r = await call(networkDown);
  check("network failure is valid:false", r.body.valid === false);
  check("network failure is NOT definitive (must not drop the plan)", !r.body.definitive, JSON.stringify(r.body));
  check("network failure is marked uncertain", r.body.uncertain === true);
  check("network failure answers 503, not 200", r.code === 503, "code=" + r.code);

  r = await call(upstream503);
  check("an upstream 5xx is NOT treated as an answer about the key", !r.body.definitive, JSON.stringify(r.body));
  check("an upstream 5xx is marked uncertain", r.body.uncertain === true);

  // REGRESSION (2026-10-18, found against the LIVE API): Gumroad reports "no
  // such license" as HTTP 404 with a valid JSON body. Treating any non-2xx as an
  // outage made EVERY invalid key come back `uncertain`, so a buyer who mistyped
  // their key was told "try again later" instead of "that key is wrong". The
  // 404-with-JSON shape must stay definitive.
  r = await call(gumroadSaysNo);
  check("a 404 with a JSON body counts as definitive, not uncertain", r.body.definitive === true && !r.body.uncertain, JSON.stringify(r.body));
  check("a 404 with a JSON body answers 200, not 503", r.code === 200, "code=" + r.code);

  // A 429 is real rate limiting: we were not answered, so it stays uncertain.
  r = await call(async () => ({ ok: false, status: 429, json: async () => ({}) }));
  check("a 429 is uncertain (rate limited, not an answer about the key)", r.body.uncertain === true && !r.body.definitive, JSON.stringify(r.body));

  // A 200 whose body is gateway HTML is not an answer either.
  r = await call(upstreamHtml);
  check("a non-JSON 200 body is uncertain", r.body.uncertain === true && !r.body.definitive, JSON.stringify(r.body));

  // A mixed case: first product id times out, the second answers "no".
  // We DID reach Gumroad, so this must be definitive, not uncertain.
  let n = 0;
  r = await call(async () => {
    n++;
    if (n === 1) throw new Error("first id timed out");
    return { ok: true, status: 200, json: async () => ({ success: false, message: "nope" }) };
  });
  check("one timeout + one real 'no' is definitive overall", r.body.definitive === true && !r.body.uncertain, JSON.stringify(r.body));

  // Refunded purchases must lose access (definitive).
  r = await call(async () => ({ ok: true, status: 200, json: async () => ({ success: true, purchase: { refunded: true } }) }));
  check("a refunded purchase is refused", r.body.valid === false);
  check("a refunded purchase is definitive", r.body.definitive === true);

  // Classroom must outrank Basic and be LABELLED classroom, since it is a
  // different product ($59 once) from Pro ($4.99/month).
  r = await call(async (url, opts) => {
    const body = String((opts && opts.body) || "");
    if (body.indexOf("classroom-id") >= 0) {
      return { ok: true, status: 200, json: async () => ({ success: true, purchase: {} }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: false }) };
  });
  check("a Classroom key grants pro-level rights", r.body.valid === true && r.body.plan === "pro", JSON.stringify(r.body));
  check("a Classroom key is labelled 'classroom', not 'pro'", r.body.label === "classroom", JSON.stringify(r.body));

  // Non-POST must be refused outright.
  global.fetch = realFetch;
  const res405 = mkRes();
  await handler({ method: "GET", body: {}, headers: {} }, res405);
  check("GET is rejected with 405", res405.code === 405);

  // An unconfigured server should say so instead of blaming the key.
  const savedBasic = process.env.GUMROAD_PRODUCT_ID;
  const savedPro = process.env.GUMROAD_PRO_PRODUCT_ID;
  const savedClass = process.env.GUMROAD_CLASSROOM_PRODUCT_ID;
  delete process.env.GUMROAD_PRODUCT_ID;
  delete process.env.GUMROAD_PRO_PRODUCT_ID;
  delete process.env.GUMROAD_CLASSROOM_PRODUCT_ID;
  const resCfg = mkRes();
  global.fetch = gumroadSaysNo;
  await handler(req, resCfg);
  check("an unconfigured server reports a config error", resCfg.body.valid === false && /not configured/i.test(String(resCfg.body.error)));
  process.env.GUMROAD_PRODUCT_ID = savedBasic;
  process.env.GUMROAD_PRO_PRODUCT_ID = savedPro;
  process.env.GUMROAD_CLASSROOM_PRODUCT_ID = savedClass;

  global.fetch = realFetch;

  console.log("");
  if (fails.length) {
    console.log("FAILED " + fails.length + "/" + (pass + fails.length) + ":");
    fails.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  console.log("license tri-state: " + pass + "/" + pass + " passed");
  console.log("ALL PASS");
})();
