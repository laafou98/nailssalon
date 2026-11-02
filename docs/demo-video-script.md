# Demo video: voice-over script

Target length 2:30 (the limit is 3:00; judges may stop at three). About 350 spoken words at a calm pace.
Record the phone screen for every app shot. Say the API names exactly as written: they are a judging requirement.
Never show the name or logo of the site the inspiration photo came from. No music, or royalty-free music only.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:12 | A blurry nail screenshot on a phone, then a WhatsApp chat with a salon (names hidden). | "Every nail tech knows this message. A screenshot, 'can you do this?', and twenty minutes of guessing: which colour, which finish, how long, how much. NailsSalon turns that screenshot into an exact recipe, and shows it on the client's own hand first." |
| 0:12–0:20 | Welcome screen, tap "Start with my hand". | "It's a web app. The client opens the salon's link on their phone, no install." |
| 0:20–0:38 | Camera: hand on the table, the outline turns orange, the ring fills, auto-capture. "Looking good" with the three chips. Tap "All checks" to show the list. | "First, the hand photo. A hand-tracking model runs on the phone and checks it live: one hand, back of the hand, flat, all five nails, sharp, well lit. It takes the picture itself when everything holds. Nothing is sent, and no API credit is spent, until the photo is good enough to render." |
| 0:38–0:58 | "Copy a nail photo", choose the inspiration photo, nails get outlined and lettered, the finish and pattern line appears, the per-finger strip. | "Then the inspiration. The app finds the five nails, outlines each one on the device, and reads every nail separately: base colour, accents, finish, pattern, shape and length. That's the key idea: not one picture to copy, but a spec, per finger, that the client can edit." |
| 0:58–1:10 | Tap a finger, the editor sheet: change the colour, switch "Copy the art" to "Colour only", tap Done. | "Don't like the ring finger? Change it. Keep the art on some nails, just the colour on others." |
| 1:10–1:35 | Tap "Try on my hand". Painting screen, then the Result with the compare slider dragged back and forth. | "Now the render. The spec goes to the YouCam AI Nail Virtual Try-On API, one call, every finger with its own colour, finish and artwork, on the client's real hand. When a design is too complex to read with confidence, the app says so and falls back to the YouCam AI Nail Transfer API instead, and labels that result as approximate." |
| 1:35–1:50 | Back, Length & shape sheet: Extensions, almond, long. Re-render, Result. | "Because it's a spec and not a picture, changes are cheap. Same look, almond extensions, one tap." |
| 1:50–2:10 | Scroll the Result: the salon's polishes with the ΔE numbers, the estimate. | "This is where the salon comes in. Every nail is matched to the polishes this salon actually stocks, by colour difference, with the number shown, and the client gets a price and a chair time from the salon's own price list. No surprises at the appointment." |
| 2:10–2:25 | "Send to my salon": the WhatsApp message with the recipe link, then the recipe card page. | "The recipe goes to the salon on WhatsApp, which is where Moroccan salons already book. Nail by nail: polish, finish, shape, length, the hand photo, the price." |
| 2:25–2:35 | Title card: NailsSalon logo, "Built on YouCam AI Nail Virtual Try-On and AI Nail Transfer", the repo link. | "NailsSalon. Built on the YouCam AI Nail Virtual Try-On and AI Nail Transfer APIs. Try before you paint." |

## Recording notes

- Units: each new look costs one YouCam credit; repeating the exact same look is free. The script above spends two (the first render and the almond re-render), plus one if you show the Transfer fallback. The phone's session allows 15 per day.
- Have both photos ready before you start: a hand photo that passes first time, and an inspiration photo with five face-on, sharp nails so the art copies cleanly. If the art comes out pasted-looking, switch those fingers to "Colour only" on camera; it reads as a feature.
- Say the API names in full at 1:10 and at the end. Add them as a caption on the title card too.
- If a render takes long, keep the Painting screen in the cut for three or four seconds, then jump cut to the result.
- Keep every other name off screen: no social-network logos, and blur any contact names in the WhatsApp shot.
