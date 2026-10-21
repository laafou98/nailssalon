// Copies MediaPipe's WASM runtime from node_modules into public/ so the browser
// loads it from our own origin (no CDN dependency; the version always matches
// the installed package). Runs before `dev` and `build`. The hand model
// (public/mediapipe/hand_landmarker.task) isn't on npm, so it is committed.
import { cpSync, mkdirSync, readdirSync } from "node:fs";

const from = "node_modules/@mediapipe/tasks-vision/wasm";
const to = "public/mediapipe/wasm";
mkdirSync(to, { recursive: true });
for (const file of readdirSync(from).filter((f) => /^vision_wasm_(nosimd_)?internal\./.test(f))) {
  cpSync(`${from}/${file}`, `${to}/${file}`);
}
