/**
 * Everything both apps and the Cloud Functions share.
 *
 * Pure TypeScript only: no Firebase SDK, no DOM, no Node. That is what lets
 * the same stage guard run in a React screen and in the function that
 * actually writes, and the same dictation parser run wherever it is needed.
 */

export * from "./types.js";
export * from "./stages.js";
export * from "./items.js";
export * from "./forms.js";
export * from "./body.js";
export * from "./paths.js";
