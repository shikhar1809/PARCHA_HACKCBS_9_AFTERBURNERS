// Collects the microphone's sound on the audio thread, so it keeps every piece
// even while the page is busy (loading the speech model, writing down words).
// Sends it to the page in pieces of about a quarter of a second, and the rest
// when the page asks ("flush"), followed by "done".
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.parts = [];
    this.size = 0;
    this.port.onmessage = () => {
      this.send();
      this.port.postMessage("done");
    };
  }
  send() {
    if (!this.size) return;
    const out = new Float32Array(this.size);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    this.port.postMessage(out, [out.buffer]);
    this.parts = [];
    this.size = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this.parts.push(new Float32Array(ch));
      this.size += ch.length;
      if (this.size >= 4000) this.send();
    }
    return true;
  }
}
registerProcessor("parcha-capture", Capture);
