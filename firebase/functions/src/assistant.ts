/**
 * Ask: the family's helper for "what is this medicine, and when was I to take it?"
 *
 * Three parts, each doing only what it is good at:
 *
 *   - **Gemini reads.** A photo of a strip goes in; what is printed on it comes
 *     out, into a fixed shape (name, strength, expiry, how sure). It is told to
 *     leave anything unclear empty, and a photo it cannot read is refused.
 *   - **Code decides.** Whether that medicine is on this person's Parcha
 *     (`sameMedicine`, which also catches a name misread off a photo) and
 *     whether it has expired (`parseExpiry`, `expiryStatus`) are plain, tested
 *     functions in packages/core — not a model's opinion.
 *   - **Meko remembers.** Earlier questions from the same person come back as
 *     context, so "and the other one?" means something. Every memory is keyed
 *     by a salted hash of the family and the person: no name, no phone, no
 *     diagnosis reaches Meko, and the datapack is opted out of Meko's
 *     cross-datapack search.
 *
 * Gemini then writes the reply from those facts and the family's own records,
 * under rules it cannot talk its way round: nothing about what a medicine is
 * for, no advice to start, stop or change anything, and "the Parcha does not
 * say — ask the doctor" for everything else. The records themselves stay on
 * the phone; the phone sends only what this one question needs.
 */
import { createHash } from "node:crypto";

import { sameMedicine } from "../../../packages/core/src/askMemory.js";
import { expiryStatus, parseExpiry } from "../../../packages/core/src/expiry.js";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db, rateLimit, requirePatientPhone, tenDigits } from "./guards.js";
import { MEKO_API_KEY, MEKO_SCOPE_SALT, tool } from "./meko.js";

export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/** Tried in order: the fast one, then the lighter one when the first is busy. */
const MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite"];
const MODEL_TIMEOUT_MS = 25_000;
const DATAPACK = () => process.env.MEKO_ASK_DATAPACK ?? "b1df71e1-9819-4e9b-9c01-e05efb1dd8fc";
const AGENT = "parcha-ask";
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 3_000_000;

type Lang = "en" | "hi" | "hg";
type RecordMed = { name: string; strength?: string | null; when?: string | null; food?: string | null; until?: string | null; doctor?: string | null; signed?: boolean };
type Read = { readable: boolean; medicines: { name: string; strength?: string | null; expiry?: string | null; confidence: "high" | "medium" | "low" }[]; problem?: string | null };

/* --------------------------------------------------------------- Gemini */

async function gemini<T>(parts: unknown[], schema: unknown, system?: string, models: string[] = MODELS): Promise<T> {
  let last: unknown = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), MODEL_TIMEOUT_MS);
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          signal: ctl.signal,
          headers: { "x-goog-api-key": GEMINI_API_KEY.value(), "content-type": "application/json" },
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents: [{ role: "user", parts }],
            generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: system ? 0.2 : 0 },
          }),
        });
        if (res.status === 503 || res.status === 429) {
          last = new Error(`${model} busy`);
          continue;
        }
        const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
        if (!res.ok) throw new Error(json.error?.message ?? `${model} ${res.status}`);
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error(`${model} gave no answer`);
        return JSON.parse(text) as T;
      } catch (e) {
        last = e;
        if ((e as Error).name === "AbortError") break; // too slow: try the next model
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new HttpsError("unavailable", `The reader is busy. Try again in a minute. (${(last as Error)?.message ?? "no answer"})`);
}

const READ_SCHEMA = {
  type: "OBJECT",
  properties: {
    readable: { type: "BOOLEAN" },
    medicines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          strength: { type: "STRING", nullable: true },
          expiry: { type: "STRING", nullable: true },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
        },
        required: ["name", "confidence"],
      },
    },
    problem: { type: "STRING", nullable: true },
  },
  required: ["readable", "medicines"],
};

const READ_PROMPT = [
  "This is a photo a family took of a medicine strip, bottle or box in India.",
  "Report only what is PRINTED on it: the medicine name as printed (brand or generic), the strength, and the expiry exactly as printed (e.g. 'EXP 07/2028').",
  "If any of these is not clearly readable, set it to null. Never guess, never complete a partly hidden word, never infer from the shape or colour of a tablet.",
  "If no medicine packaging is clearly visible, or the photo is too dark, blurred or cut off to read the name, set readable=false, medicines=[], and say in problem what is wrong in a few plain words.",
  "confidence is 'high' only if every letter of the name is sharp.",
].join(" ");

const ANSWER_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    chips: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["reply", "chips"],
};

function rules(lang: Lang, person: string): string {
  const language = lang === "hi" ? "Hindi, in Devanagari script" : lang === "hg" ? "Hinglish (Hindi in Roman script)" : "simple English";
  return [
    `You are Parcha's helper, talking to ${person} or their family in India about their own medicines. Reply in ${language}.`,
    "Answer ONLY from RECORDS (their prescriptions and reminder times), FACTS (what was read off a photo, already checked by code) and MEMORY (what they asked before).",
    "Never say what a medicine is for or treats. Never advise starting, stopping, skipping, doubling or changing a dose, and never suggest another medicine. If asked any of that, say the Parcha does not say and they should ask the doctor or chemist.",
    "If FACTS say a photographed medicine is NOT on their records, say clearly it is not on their Parcha and not to take it until a doctor or chemist confirms.",
    "If FACTS say it has expired, say plainly not to take it and to show it to the chemist. If it expires soon, say until when it is good.",
    "When asked when to take something, give the times and food instructions from RECORDS exactly. If RECORDS do not have it, say so.",
    "If something could not be read, say that, and ask for a clearer photo. Never guess.",
    "At most three short sentences, in words an elderly person understands. No drug jargon, no lists of side effects, no disclaimers beyond the rule above.",
    "ALREADY_SAID lists sentences that will be shown before your reply. Do not repeat them; add only what else is useful.",
    "chips: up to three very short next things they might want to tap, in the same language (for example: check the expiry, photograph another medicine, what is due today).",
  ].join("\n");
}

/* ----------------------------------------------------------------- Meko */

/** The person, as Meko sees them: a salted hash, never a name or a phone. */
const scopeOf = (phone: string, person: string) => createHash("sha256").update(`${MEKO_SCOPE_SALT.value()}|ask|${phone}|${person}`).digest("hex").slice(0, 32);

/**
 * One Meko conversation per person, found by their hashed scope. Meko keys
 * memory to a conversation, and extracts what is worth remembering from each
 * message by itself, so a turn is logged as a message and recalled by search.
 */
async function conversationFor(scope: string): Promise<string | null> {
  const ref = db().collection("askScopes").doc(scope);
  const known = (await ref.get()).data()?.conversationId;
  if (typeof known === "string") return known;
  try {
    const made = await tool<{ id?: string; conversation_id?: string }>(
      "conversation_create",
      { agent_id: AGENT, session_id: scope, datapack_id: DATAPACK(), title: `ask ${scope.slice(0, 8)}` },
      6000,
    );
    const id = made?.id ?? made?.conversation_id ?? null;
    if (id) await ref.set({ conversationId: id, createdAt: new Date().toISOString() });
    return id;
  } catch {
    return null;
  }
}

/**
 * What this person asked before. Meko's search takes seconds, so it runs
 * while the photo is being read and is given up on at five: memory helps, and
 * is never worth making Dadi wait.
 */
async function recall(conversationId: string | null, query: string): Promise<string[]> {
  if (!conversationId) return [];
  try {
    const hits = await tool<{ results?: { memory?: { memory?: string; run_id?: string }[] } }>(
      "context_search",
      { query, conversation_id: conversationId, agent_id: AGENT, datapack_id: DATAPACK(), limit: 6 },
      5000,
    );
    return (hits?.results?.memory ?? [])
      // Only this person's: a memory is tied to the conversation it came from.
      .filter((m) => !m.run_id || m.run_id === conversationId)
      .map((m) => m.memory ?? "")
      .filter(Boolean)
      .slice(0, 6);
  } catch {
    return [];
  }
}

/** The turn, as a message in their conversation. Only medicine names and the gist: nothing that names the family. */
async function remember(conversationId: string | null, question: string, answer: string, read: string | null) {
  if (!conversationId) return;
  await tool(
    "conversation_add_message",
    { conversation_id: conversationId, agent_id: AGENT, datapack_id: DATAPACK(), input: [read ? `(photo of a strip: ${read})` : "", question.slice(0, 300)].filter(Boolean).join(" "), output: answer.slice(0, 400) },
    5000,
  ).catch(() => undefined);
}

/**
 * The sentences that must be said, whatever the model writes: a medicine that
 * is not on the Parcha, or has expired. Said by code, in her language, first.
 */
function mustSay(facts: { printedName: string; onRecord: unknown; expiry: { status: string } }[], lang: Lang): string[] {
  const out: string[] = [];
  for (const f of facts) {
    if (f.expiry.status === "expired") {
      out.push(lang === "hi" ? `${f.printedName} एक्सपायर हो चुकी है — इसे न लें, केमिस्ट को दिखाएँ।` : lang === "hg" ? `${f.printedName} expire ho chuki hai — ise na lein, chemist ko dikhayein.` : `${f.printedName} has expired — do not take it; show it to the chemist.`);
    }
    if (!f.onRecord) {
      out.push(lang === "hi" ? `${f.printedName} आपके पर्चे पर नहीं है — डॉक्टर या केमिस्ट से पूछे बिना न लें।` : lang === "hg" ? `${f.printedName} aapke Parche par nahi hai — doctor ya chemist se poochhe bina na lein.` : `${f.printedName} is not on your Parcha — do not take it until a doctor or chemist confirms.`);
    }
  }
  return out;
}

/* ------------------------------------------------------------- callable */

export const askParcha = onCall({ secrets: [GEMINI_API_KEY, MEKO_API_KEY, MEKO_SCOPE_SALT], timeoutSeconds: 90, memory: "512MiB" }, async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`ask:${phone}`, 80, 3600);
  const d = (request.data ?? {}) as Record<string, unknown>;
  const lang: Lang = d.lang === "hi" || d.lang === "hg" ? d.lang : "en";
  const person = typeof d.person === "string" && d.person.trim() ? d.person.trim().slice(0, 60) : "the patient";
  const question = typeof d.question === "string" ? d.question.trim().slice(0, 500) : "";
  const image = typeof d.image === "string" ? d.image : null;
  if (image && (image.length > MAX_IMAGE_CHARS || !IMAGE.test(image))) throw new HttpsError("invalid-argument", "That photo could not be used. Take it again.");
  if (!image && !question) throw new HttpsError("invalid-argument", "Ask a question, or take a photo.");
  const records: RecordMed[] = Array.isArray(d.records) ? (d.records as RecordMed[]).slice(0, 40) : [];
  const history = Array.isArray(d.history) ? (d.history as { who: string; text: string }[]).slice(-6) : [];
  const today = new Date();

  // Meko's search is slow, so it starts now and runs alongside the reading.
  const scope = scopeOf(phone, person);
  const conversationPromise = conversationFor(scope);
  const memoryPromise = conversationPromise.then((id) => recall(id, question || "medicines and when to take them"));

  // 1. Read the photo, or refuse it.
  let facts: Record<string, unknown>[] = [];
  let readLine: string | null = null;
  if (image) {
    const [, mime, data] = image.match(/^data:(image\/[a-z]+);base64,(.*)$/) ?? [];
    const read = await gemini<Read>([{ inline_data: { mime_type: mime, data } }, { text: READ_PROMPT }], READ_SCHEMA);
    const usable = read.readable ? read.medicines.filter((m) => m.name && m.confidence !== "low") : [];
    if (!usable.length) {
      return {
        kind: "refused",
        problem: read.problem ?? (read.readable ? "The name on it is not clear." : "No medicine could be read."),
        reply:
          lang === "hi"
            ? "यह फ़ोटो साफ़ नहीं है, इसलिए मैंने कुछ नहीं माना। दवा का नाम वाला हिस्सा रोशनी में, पास से फिर फ़ोटो लें।"
            : lang === "hg"
              ? "Yeh photo saaf nahi hai, isliye maine kuch nahi maana. Dawai ke naam wala hissa roshni mein, paas se phir photo lein."
              : "This photo is not clear, so I have not assumed anything. Take it again close up, in good light, with the name showing.",
        chips: [],
        read: [],
      };
    }
    // 2. Code decides: on the Parcha? Expired?
    facts = usable.map((m) => {
      const onRecord = records.find((r) => sameMedicine(r.name, m.name) || (m.strength ? sameMedicine(`${r.name} ${r.strength ?? ""}`, `${m.name} ${m.strength}`) : false));
      const exp = m.expiry ? parseExpiry(/exp|use|best/i.test(m.expiry) ? m.expiry : `EXP ${m.expiry}`) : null;
      const status = exp ? expiryStatus(exp, today) : null;
      return {
        printedName: m.name,
        strength: m.strength ?? null,
        onRecord: onRecord ? { name: onRecord.name, strength: onRecord.strength ?? null, when: onRecord.when ?? null, food: onRecord.food ?? null, until: onRecord.until ?? null, doctor: onRecord.doctor ?? null, signed: !!onRecord.signed } : null,
        expiry: status ? { printed: m.expiry, lastDay: status.lastDay, status: status.status, daysLeft: status.daysLeft } : { printed: m.expiry ?? null, status: "unreadable" },
        readConfidence: m.confidence,
      };
    });
    readLine = usable.map((m) => `${m.name}${m.strength ? ` ${m.strength}` : ""}${m.expiry ? ` (exp ${m.expiry})` : ""}`).join("; ");
  }

  // 3. Meko: what this person asked before (started early, so it overlaps the reading).
  const memory = await memoryPromise;
  const must = mustSay(facts as { printedName: string; onRecord: unknown; expiry: { status: string } }[], lang);

  // 4. The reply, from the facts and the records only.
  const ask = question || (lang === "hi" ? "यह कौन सी दवा है और कब लेनी है?" : "What is this medicine and when do I take it?");
  const answer = await gemini<{ reply: string; chips: string[] }>(
    [
      {
        text: JSON.stringify({
          TODAY: today.toISOString().slice(0, 10),
          RECORDS: records,
          FACTS: facts,
          MEMORY: memory,
          CONVERSATION: history,
          QUESTION: ask,
          ALREADY_SAID: must,
        }),
      },
    ],
    ANSWER_SCHEMA,
    rules(lang, person.split(" ")[0]),
  );

  // 5. Remember, briefly and de-identified.
  const reply = [...must, answer.reply].join(" ");
  await remember(await conversationPromise, ask, reply, readLine);

  return { kind: "answer", reply, chips: (answer.chips ?? []).slice(0, 3), read: facts, memoryUsed: memory.length };
});

/* ---------------------------------------------- the doctor's and chemist's words */

/** One medicine as somebody said or wrote it. Every field but the name is "only if said". */
const MEDICINES_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING" },
    medicines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          strength: { type: "STRING", nullable: true },
          morning: { type: "INTEGER", nullable: true },
          afternoon: { type: "INTEGER", nullable: true },
          night: { type: "INTEGER", nullable: true },
          sos: { type: "BOOLEAN" },
          food: { type: "STRING", enum: ["after_food", "before_food", "empty_stomach"], nullable: true },
          days: { type: "INTEGER", nullable: true },
          said: { type: "STRING" },
        },
        required: ["name", "sos", "said"],
      },
    },
    notes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["transcript", "medicines", "notes"],
};
const AUDIO = /^data:audio\/(webm|ogg|mp4|aac|mpeg|wav|x-m4a)(;[a-z0-9=.-]+)*;base64,[A-Za-z0-9+/=]+$/;
/** Audio is read best by the light model, and it is the one that is rarely busy. */
const AUDIO_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash"];

/**
 * What the doctor (or the chemist) said, as words and as medicines.
 *
 * The same shape the wizard checks point by point: each medicine with
 * when, food and how long — and each of those only if it was actually said.
 * A field left out is "not said", and the person sees it as that; nothing is
 * filled in to make a row look complete. It is a transcript, not a judge:
 * the family confirms every point before any of it reaches a schedule.
 */
export const hearInstructions = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 90, memory: "512MiB" }, async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`hear:${phone}`, 40, 3600);
  const d = (request.data ?? {}) as Record<string, unknown>;
  const audio = typeof d.audio === "string" ? d.audio : "";
  if (audio.length > 4_000_000 || !AUDIO.test(audio)) throw new HttpsError("invalid-argument", "The recording could not be used. Record it again.");
  const who = d.who === "pharmacist" ? "a pharmacist (chemist)" : "a doctor";
  const known = Array.isArray(d.known) ? (d.known as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20) : [];
  const [, mime, data] = audio.match(/^data:(audio\/[a-z0-9-]+)[^,]*;base64,(.*)$/) ?? [];
  return gemini(
    [
      { inline_data: { mime_type: mime, data } },
      {
        text: [
          `This is a recording of ${who} in India telling a patient how to take medicines, in Hindi, English or Hinglish.`,
          "Transcribe it exactly. Then list each medicine as it was said.",
          "Fill a field ONLY if it was said in the recording; otherwise leave it null. Never infer a time, a food rule or a duration from what the medicine usually is.",
          "morning/afternoon/night are how many tablets at that time. 'Sone se pehle' and 'raat' are night. 'Zaroorat ho to' or 'when needed' is sos=true.",
          "Advice that is not a medicine (walk daily, drink water) goes in notes.",
          known.length ? `Medicines already found on the bill or prescription, for spelling only (do not add them if not said): ${known.join(", ")}.` : "",
          "If nothing about medicines can be heard, return an empty medicines list and say so in transcript.",
        ].filter(Boolean).join(" "),
      },
    ],
    MEDICINES_SCHEMA,
    undefined,
    AUDIO_MODELS,
  );
});

/**
 * A handwritten prescription, read — the one photo that is sent away, and
 * only when the person taps the button that says so. Printed text is read on
 * the phone instead; handwriting is where the phone's own reader fails.
 */
export const readHandwriting = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 90, memory: "512MiB" }, async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`hand:${phone}`, 30, 3600);
  const image = typeof request.data?.image === "string" ? request.data.image : "";
  if (image.length > MAX_IMAGE_CHARS || !IMAGE.test(image)) throw new HttpsError("invalid-argument", "That photo could not be used. Take it again.");
  const [, mime, data] = image.match(/^data:(image\/[a-z]+);base64,(.*)$/) ?? [];
  return gemini(
    [
      { inline_data: { mime_type: mime, data } },
      {
        text: [
          "This is a photo of a doctor's prescription in India, possibly handwritten.",
          "In transcript, write out what you can read. Then list each medicine as written.",
          "Fill a field ONLY if it is written and clearly legible; otherwise null. Never guess a smudged word; never complete a name from its first letters.",
          "Doctors write times as 1-0-1 (morning-afternoon-night), OD, BD, TDS, HS, SOS; AC is before food, PC after food; x5d is 5 days.",
          "If the photo is not a prescription or cannot be read, return an empty medicines list and say why in transcript.",
        ].join(" "),
      },
    ],
    MEDICINES_SCHEMA,
    undefined,
    AUDIO_MODELS,
  );
});
