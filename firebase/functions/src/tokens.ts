/**
 * Token numbers: what the room calls out. One running count per hospital per
 * clinic day (India time), so the first patient of the morning is token 1.
 *
 * Kept in hospitalPrivate, which no client can read or write; a transaction
 * hands out each number once, however many desks are registering at once.
 */
import { getFirestore } from "firebase-admin/firestore";

import { todayInClinic } from "../../../packages/core/src/slots.js";

const db = () => getFirestore();

export const tokenDoc = (hospitalId: string, day = todayInClinic()) =>
  db().collection("hospitalPrivate").doc(hospitalId).collection("tokens").doc(day);

/** The next token at this hospital today. */
export async function nextToken(hospitalId: string): Promise<number> {
  const ref = tokenDoc(hospitalId);
  return db().runTransaction(async (tx) => {
    const last = ((await tx.get(ref)).data()?.last as number | undefined) ?? 0;
    tx.set(ref, { last: last + 1 }, { merge: true });
    return last + 1;
  });
}
