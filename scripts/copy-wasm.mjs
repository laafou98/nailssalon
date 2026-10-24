// Copies the browser WASM runtimes from node_modules into public/ so the browser
// loads them from our own origin (no CDN dependency; the version always matches
// the installed package). Runs before `dev` and `build`.
// - MediaPipe (hand gate). The hand model (public/mediapipe/hand_landmarker.task) isn't on npm, so it is committed.
// - onnxruntime-web (MobileSAM nail outlines). The model (public/models/mobilesam/) is committed too.
import { cpSync, mkdirSync, readdirSync } from "node:fs";

function copy(from, to, pattern) {
  mkdirSync(to, { recursive: true });
  for (const file of readdirSync(from).filter((f) => pattern.test(f))) cpSync(`${from}/${file}`, `${to}/${file}`);
}

copy("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", /^vision_wasm_(nosimd_)?internal\./);
copy("node_modules/onnxruntime-web/dist", "public/ort", /^ort-wasm-simd-threaded\.(mjs|wasm)$/);
