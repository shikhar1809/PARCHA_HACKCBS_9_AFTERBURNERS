/**
 * Checks a Twilio account is ready for Parcha's reminder calls, and can place a
 * test call.
 *
 *   TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1... \
 *     node scripts/twilio-check.mjs [--call +91XXXXXXXXXX]
 *
 * It reads the account; it only places a call if you pass --call. The test call
 * says a short Hindi sentence and needs no webhook, so you can hear the voice
 * before wiring anything else.
 */
const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_FROM;
const callIdx = process.argv.indexOf("--call");
const to = callIdx > -1 ? process.argv[callIdx + 1] : null;

if (!sid || !token || !from) {
  console.error("Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM first.");
  process.exit(1);
}

const auth = { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` };
const get = async (url) => {
  const r = await fetch(url, { headers: auth });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
};
let bad = 0;
const check = (ok, text) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
};

const account = await get(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`);
check(
  account.ok,
  account.ok
    ? `account "${account.body.friendly_name}" (${account.body.type}, ${account.body.status})`
    : `could not read the account (${account.status}): check the SID and token`,
);
if (account.ok && account.body.type === "Trial") {
  console.log("     This is a TRIAL account: it can only call numbers you have verified in the console, and every call starts with a trial message.");
}

const numbers = await get(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=100`);
const owned = (numbers.body.incoming_phone_numbers ?? []).map((n) => n.phone_number);
check(
  owned.includes(from),
  owned.includes(from)
    ? `${from} belongs to this account`
    : `${from} is not an incoming number on this account (it has: ${owned.join(", ") || "none"}). A verified caller ID also works on a trial.`,
);

const india = await get("https://voice.twilio.com/v1/DialingPermissions/Countries/IN");
check(
  india.ok && india.body.low_risk_numbers_enabled !== false,
  india.ok
    ? `voice calls to India: ${india.body.low_risk_numbers_enabled ? "enabled" : "NOT enabled (turn it on under Voice > Settings > Geo permissions)"}`
    : "could not read the India dialing permission",
);

console.log("");
console.log("Set these where the functions run:");
console.log("  CALL_PROVIDER=twilio");
console.log(`  TWILIO_ACCOUNT_SID=${sid}   TWILIO_AUTH_TOKEN=...   TWILIO_FROM=${from}`);
console.log("  TWILIO_WEBHOOK_URL=<the public address of the callWebhook function, no query string>");
console.log("  TWILIO_VOICE=Polly.Aditi   (optional)");
console.log("  SWEEP_KEY=<a long random string>");

if (to) {
  console.log("");
  const twiml = '<Response><Say voice="Polly.Aditi" language="hi-IN">नमस्ते। यह पर्चा की ओर से एक परीक्षण कॉल है। धन्यवाद।</Say></Response>';
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml }),
  });
  const body = await r.json().catch(() => ({}));
  check(r.ok, r.ok ? `test call placed to ${to} (${body.sid})` : `the call was refused: ${body.message ?? r.status}`);
}
process.exit(bad ? 1 : 0);
