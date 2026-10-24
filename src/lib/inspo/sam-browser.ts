// Browser-only side of the SlimSAM nail outliner: loads onnxruntime-web and the
// self-hosted model (public/models/slimsam, public/ort), encodes each
// inspiration photo once, then answers each tap in tens of milliseconds.
// Everything is lazy: nothing downloads until a photo is chosen.

import type { InferenceSession, Tensor } from "onnxruntime-web/wasm";
import type { LoadedInspiration } from "./browser";
import type { SamOutline } from "./pick";
import type { Point } from "./region";
import { type MaskLimits, SAM_SIDE, chooseSamMask, samMasks, samPixels, samPoint, samSize } from "./sam";

const MODEL = "/models/slimsam/onnx";

interface Runtime {
  ort: typeof import("onnxruntime-web/wasm");
  encoder: InferenceSession;
  decoder: InferenceSession;
}

interface Embedding {
  embeddings: Tensor;
  positional: Tensor;
  /** Width of the SAM input the photo was drawn at. */
  samWidth: number;
}

let runtime: Promise<Runtime> | null = null;

function loadRuntime(): Promise<Runtime> {
  runtime ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.wasmPaths = "/ort/";
    // Runs inference in a worker, so encoding a photo (a few seconds on a phone) doesn't freeze the page.
    ort.env.wasm.proxy = true;
    const [encoder, decoder] = await Promise.all([
      ort.InferenceSession.create(`${MODEL}/vision_encoder_quantized.onnx`),
      ort.InferenceSession.create(`${MODEL}/prompt_encoder_mask_decoder_quantized.onnx`),
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
      const pixels = new ort.Tensor("float32", samPixels(data, size.width, size.height), [1, 3, SAM_SIDE, SAM_SIDE]);
      const out = await encoder.run({ pixel_values: pixels });
      return { embeddings: out.image_embeddings, positional: out.image_positional_embeddings, samWidth: size.width };
    })();
    pending.catch(() => embeddings.delete(loaded.file));
    embeddings.set(loaded.file, pending);
  }
  return pending;
}

/** SlimSAM's outline of the nail under a tap (working-image pixels), or null when no guess is nail-sized. */
export async function samOutline(loaded: LoadedInspiration, tap: Point, limits: MaskLimits = {}): Promise<SamOutline | null> {
  const [{ ort, decoder }, embedding] = await Promise.all([loadRuntime(), encodeForSam(loaded)]);
  const [x, y] = samPoint(tap, embedding.samWidth, loaded.width);
  const out = await decoder.run({
    input_points: new ort.Tensor("float32", new Float32Array([x, y]), [1, 1, 1, 2]),
    input_labels: new ort.Tensor("int64", new BigInt64Array([BigInt(1)]), [1, 1, 1]),
    // Copies: the worker takes ownership of input buffers, and these are reused for every tap.
    image_embeddings: new ort.Tensor("float32", (embedding.embeddings.data as Float32Array).slice(), embedding.embeddings.dims),
    image_positional_embeddings: new ort.Tensor("float32", (embedding.positional.data as Float32Array).slice(), embedding.positional.dims),
  });
  const masks = samMasks(out.pred_masks.data as Float32Array, embedding.samWidth, loaded.width, loaded.height);
  const scores = out.iou_scores.data as Float32Array;
  const best = chooseSamMask(masks, scores, tap, loaded.width, loaded.height, limits);
  return best === null ? null : { mask: masks[best], score: Math.min(1, Math.max(0, scores[best])) };
}
