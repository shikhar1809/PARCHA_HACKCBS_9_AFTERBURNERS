/**
 * Reading the name off a photograph of a strip — the one place Ask uses a model.
 *
 * This is the seam, and it is deliberately narrow: a picture goes in, a
 * medicine *name* comes back, and nothing else. No reason, no dose, no advice.
 * Whatever name comes back is then looked up in the Parchas this phone holds
 * (`packages/core/src/askMemory.ts`), so a name the records do not have is
 * reported as not found rather than described.
 *
 * The engine behind it is not wired yet: the MISO endpoint, its authentication
 * and its request shape are still to come, and until they are configured this
 * reports itself unavailable and Ask stays usable by typing a name. The call
 * is made server-side (a callable), never from the handset, so no key ever
 * reaches the browser bundle.
 */
import { call } from "@parcha/client";

/**
 * Whether photograph reading is set up for this build. Flipped on by setting
 * `VITE_PARCHA_DRUG_READING=on` once the server side is configured.
 */
export const drugReadingAvailable = import.meta.env.VITE_PARCHA_DRUG_READING === "on";

const MAX_BYTES = 2 * 1024 * 1024;

/** The picture as a data URL, which is what the callable takes. */
async function asDataUrl(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error("That photo is too large. Take it again, closer in.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That photo could not be opened."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/**
 * The medicine name printed on the strip, or null when nothing readable was
 * found. Throws when the reader is not configured or the call fails, so the
 * screen can say so plainly instead of showing an invented name.
 */
export async function readDrugPhoto(file: File): Promise<string | null> {
  if (!drugReadingAvailable) throw new Error("Photograph reading is not set up on this build yet.");
  const image = await asDataUrl(file);
  const result = await call<{ consent: true; image: string }, { name: string | null }>("readDrugName", {
    consent: true,
    image,
  });
  const name = result.name?.trim();
  return name ? name : null;
}
