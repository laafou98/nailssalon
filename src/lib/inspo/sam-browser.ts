// Browser-only side of the MobileSAM nail outliner: loads onnxruntime-web and the
// self-hosted model (public/models/mobilesam, public/ort), encodes each
// inspiration photo once, then answers each tap in tens of milliseconds.
// Everything is lazy: nothing downloads until a photo is chosen.

import type { InferenceSession, Tensor } from "onnxruntime-web/wasm";
import type { LoadedInspiration } from "./browser";
import type { SamOutline } from "./pick";
import type { Point } from "./region";
import { type MaskLimits, chooseSamMask, samMasks, samPixels, samPrompt, samSize } from "./sam";

const MODEL = "/models/mobilesam";

interface Runtime {
  ort: typeof import("onnxruntime-web/wasm");
  encoder: InferenceSession;
  decoder: InferenceSession;
}

interface Embedding {
  embeddings: Tensor;
  /** Width of the encoder input the photo was drawn at. */
  samWidth: number;
}

let runtime: Promise<Runtime> | null = null;

function loadRuntime(): Promise<Runtime> {
  runtime ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.wasmPaths = "/ort/";
    // Runs inference in a worker, so encoding a photo (a second or two on a phone) doesn't freeze the page.
    ort.env.wasm.proxy = true;
    const [encoder, decoder] = await Promise.all([
      ort.InferenceSession.create(`${MODEL}/encoder.onnx`),
      ort.InferenceSession.create(`${MODEL}/decoder.onnx`),
    ]);
    return { ort, encoder, decoder };
  })();
  // A failed load (offline, old browser) is retried on the next photo.
  runtime.catch(() => (runtime = null));
  return runtime;
}

const embeddings = new WeakMap<Blob, Promise<Embedding>>();

/** Starts encoding the photo (once per file). Call as soon as it is chosen, so the first tap is quick. */
export function encodeForSam(loaded: LoadedInspiration): Promise<Embedding> {
  let pending = embeddings.get(loaded.file);
  if (!pending) {
    pending = (async () => {
      const { ort, encoder } = await loadRuntime();
      const bitmap = await createImageBitmap(loaded.file, { imageOrientation: "from-image" });
      const size = samSize(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      bitmap.close();
      const { data } = ctx.getImageData(0, 0, size.width, size.height);
      const image = new ort.Tensor("float32", samPixels(data, size.width, size.height), [size.height, size.width, 3]);
      const out = await encoder.run({ input_image: image });
      return { embeddings: out.image_embeddings, samWidth: size.width };
    })();
    pending.catch(() => embeddings.delete(loaded.file));
    embeddings.set(loaded.file, pending);
  }
  return pending;
}

/** MobileSAM's outline of the nail under a tap (working-image pixels), or null when no guess is nail-sized. */
export async function samOutline(loaded: LoadedInspiration, tap: Point, limits: MaskLimits = {}): Promise<SamOutline | null> {
  const [{ ort, decoder }, embedding] = await Promise.all([loadRuntime(), encodeForSam(loaded)]);
  const { width, height } = loaded;
  const prompt = samPrompt(tap, embedding.samWidth, width);
  const out = await decoder.run({
    // A copy: the worker takes ownership of input buffers, and the embedding is reused for every tap.
    image_embeddings: new ort.Tensor("float32", (embedding.embeddings.data as Float32Array).slice(), embedding.embeddings.dims),
    point_coords: new ort.Tensor("float32", prompt.coords, [1, 2, 2]),
    point_labels: new ort.Tensor("float32", prompt.labels, [1, 2]),
    mask_input: new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor("float32", new Float32Array([0]), [1]),
    // Masks come back at this size: the working image.
    orig_im_size: new ort.Tensor("float32", new Float32Array([height, width]), [2]),
  });
  const masks = samMasks(out.masks.data as Float32Array, out.masks.dims[1], width, height);
  const scores = out.iou_predictions.data as Float32Array;
  const best = chooseSamMask(masks, scores, tap, width, height, limits);
  return best === null ? null : { mask: masks[best], score: Math.min(1, Math.max(0, scores[best])) };
}
