# Devpost submission: NailsSalon

Text for the submission form, plus the testing instructions the judges need. Copy each section into the matching Devpost field.

## Checklist

- [ ] Live app link: https://nailssalon-five.vercel.app
- [ ] Repo link (public, MIT): https://github.com/laafou98/nailssalon
- [ ] Demo video uploaded to YouTube (2:56, names both APIs on screen and in the voice-over), link pasted in the form
- [ ] Screenshots uploaded: the seven files in `docs/screenshots/`
- [ ] Testing instructions pasted (section below)
- [ ] "Built with" tags set
- [ ] The app stays free to test until the end of judging (Nov 20): unit caps are 15 per phone per 24 h and 900 overall

## Project name

NailsSalon

## Tagline

Turn any nail screenshot into an exact per-finger recipe, shown on the client's own hand first, matched to the salon's real polishes.

## Inspiration

Every nail tech in Casablanca gets the same WhatsApp message: a blurry screenshot and "can you do this?". Then come twenty minutes of guessing: which colour, which finish, how long, how much, and a client who may not like the result on her own hand. Virtual try-on apps show you a picture; they do not tell the salon what to buy and paint. We wanted the step in between: a compiler from inspiration photo to salon recipe, with the try-on in the middle.

## What it does

1. **Hand photo, checked live and free.** A hand-tracking model runs on the phone and checks the shot as you hold it: one hand, back of the hand, flat, all five nails in frame, sharp, well lit, nails not washed out. It takes the picture itself when every check holds. Nothing is uploaded and no API unit is spent before the photo will render well.
2. **Inspiration photo to per-finger spec.** Drop in any nail photo. The app finds the five nails, outlines each one on the device and reads every nail separately: base colour, accents, finish, pattern, shape and length. The result is a structured spec the client can edit: change one colour, keep the art on some nails and only the colour on others, switch to extensions, choose tip shape and length.
3. **Rendered on the client's own hand.** The spec goes to the **YouCam AI Nail Virtual Try-On API** in a single call, every finger with its own colour, finish and artwork. When a design is too complex to read with confidence, the app says so and falls back to the **YouCam AI Nail Transfer API**, labelled approximate, with a one-tap "render each finger exactly instead".
4. **Matched to the salon's shelf.** Every nail is matched to the polishes this salon actually stocks by colour difference (CIEDE2000, shown as a number), and the client gets a price and a chair time from the salon's own price list.
5. **Recipe to the salon on WhatsApp.** One tap opens WhatsApp with the recipe link. The recipe card lists the look nail by nail: polish, finish, shape, length, the hand render and the price. That is what the technician paints.

## How we built it

- **Next.js 16 on Vercel**, TypeScript end to end, Supabase for Postgres and Storage. The YouCam key never leaves the server.
- **Hand quality gate in the browser** with MediaPipe Hand Landmarker (WASM). Pose is derived from landmark geometry (knuckle width over palm length, with direction from depth), sharpness from the variance of the Laplacian on fingertip crops, exposure and per-nail clipping from pixel statistics. Auto-capture at the camera's full resolution.
- **Nail outlining on the device** with MobileSAM (Segment Anything with a TinyViT encoder, quantised, self-hosted) on onnxruntime-web in a worker: the photo is encoded once, each nail is a 20 ms decode. An OKLab region flood is the fallback.
- **Colour science**: OKLab k-means per nail for base and accent colours, skipping glare and skin; CIELAB and CIEDE2000 for polish matching.
- **Design reading** with Claude (structured outputs): finish, pattern, shape and length per nail, with a confidence that drives the engine choice.
- **A typed `DesignSpec`** compiled into Nail VTO's per-finger effect schema by a pure, unit-tested function. Per-finger design PNGs are cut from the inspiration photo along the nail's axis and sized to Nail VTO's limits; extensions get a transparent full-nail cut-out.
- **Render router and cost engineering**: Nail VTO or Nail Transfer by measured confidence; cache key from the hand photo hash and the canonical spec, so identical requests never spend twice; a unit ledger with per-phone and global caps; stuck tasks time out and are refunded.
- **Post-processing on Nail VTO results**: a true-colour composite that keeps YouCam's mask and shading but hits the exact requested hue per finger, and a realism pass (photo grain, soft edges, gloss compression, a faint cuticle shadow) so renders sit in the photo instead of on it.
- **Recipe card** as a shared page with an Open Graph image, handed to WhatsApp with a prefilled message.

## Challenges we ran into

- **Hand landmarks fail on real inspiration photos** (cropped, close-up, styled). We switched to tap-to-pick, then to MobileSAM outlining after SlimSAM crashed iPhone Safari on memory.
- **Photo quality decides the render.** Nail plates blown out to white come back from YouCam as flat caps. We moved the fix upstream: per-nail clipping checks in the gate refuse those photos before a unit is spent.
- **Keeping designs on the right finger.** Nail Transfer copies a photo as a whole, so art can land on the wrong fingers. The per-finger spec and Nail VTO's per-finger design input solve this, with Transfer kept as the honest, labelled fallback.
- **Colour fidelity and realism.** Renders drifted in hue and looked pasted on. The composite and realism passes were measured against stored renders (nail lightness spread, highlight percentiles) rather than tuned by eye.
- **Units.** 1,000 units for the whole project, about 1 per render. Free browser gating, a cache, caps, a mock mode for development and a written test budget kept the spend at about 60 units including a 38-render test matrix.

## Accomplishments that we're proud of

- A complete loop a salon can use today: photo, spec, render on the client's hand, matched polishes, price, WhatsApp recipe.
- Every nail read and rendered separately, and editable, instead of one picture copied.
- The honest fallback: when the app is not confident, it says so on screen and labels the Transfer result approximate.
- Zero units wasted on bad photos, thanks to a gate that runs entirely on the phone.
- A build log (`docs/PROGRESS.md`) with every decision, test and unit spent.

## What we learned

- YouCam's Nail VTO is at its best when it is fed clean, structured inputs per finger; the work around it (gating, extraction, routing, colour science) is what makes the output usable in a salon.
- The hand photo matters more than any post-processing. Checks at capture time beat fixes after the render.
- Browser-side models (MediaPipe, MobileSAM) are good enough for the free steps, which keeps the paid API for the step that needs it.

## What's next for NailsSalon

- **Fidelity score**: photograph the finished nails and score them against the recipe, per finger, so the salon and the client agree on "done".
- **Salon admin**: catalogue, price list and WhatsApp number managed by the salon owner (seeded today).
- **French and Arabic**, with right-to-left layout, for the salons this was built for.
- Better reading of diagonal nails, marble and smoke art, and hidden thumbs.

## Built with

next.js, react, typescript, tailwindcss, supabase, postgresql, vercel, youcam-ai-nail-virtual-try-on, youcam-ai-nail-transfer, mediapipe, onnxruntime-web, mobilesam, claude, sharp, zod, vitest

## Testing instructions for the judges

Open **https://nailssalon-five.vercel.app** on a phone (iOS Safari or Android Chrome). No install, no account.

1. Tap **Start with my hand**. Put one hand flat on a table, back of the hand up, all five nails in frame, in good light. Hold still: the app takes the photo itself when the checks pass (the chips show which checks hold; tap "All checks" for the list). If it keeps refusing, move away from direct lamp light so the nails are not washed out.
2. Choose **Copy a nail photo** and pick any close-up of five nails (a screenshot or a saved photo works). Wait for "All 5 nails found" and the finish and pattern reading. Or choose **One colour** for a quicker test.
3. Optional: tap a finger to change its colour or switch between "Copy the art" and "Colour only"; open **Length & shape** for extensions.
4. Tap **Try on my hand**. A render takes about 10 to 30 seconds. Drag the slider to compare before and after. **Compare with YouCam Nail Transfer** renders the same look with the other API.
5. Scroll down for the matched polishes with their colour difference and the estimate, then tap **Send to my salon** to see the WhatsApp message and open the recipe card.

Notes:

- Each new look costs one YouCam unit; repeating the same look is free. Each phone can render 15 looks per 24 hours.
- The app reads the inspiration photo with Claude; a reading takes a few seconds.
- `https://nailssalon-five.vercel.app/api/health` shows that the backend and keys are up.
- The demo salon is "Studio Demo, Casablanca" with a seeded polish catalogue and price list in MAD.

## Demo video credits

Screen recording of the live app on an iPhone. Captions composed with the tooling in `video/`.
