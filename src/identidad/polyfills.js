import { Buffer } from "buffer";

if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
  window.global = window.global || window;
  window.process = window.process || { env: {} };
}

if (typeof globalThis !== "undefined") {
  globalThis.Buffer = globalThis.Buffer || Buffer;
  globalThis.global = globalThis.global || globalThis;
  globalThis.process = globalThis.process || { env: {} };
}
