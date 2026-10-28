# Document corner regression tests

Run `npm ci`, then `npm run test:detection`. Both the OpenCV detector and the
TypeScript fallback must pass. The release workflow runs this command and
`npm run typecheck` before building an installer.

The 34 deterministic synthetic cases cover perspective, portrait/landscape
orientation, receipts, textured and light desks, coloured paper, shadows,
partial finger occlusion, internal printed frames, a page touching the image
boundary, an existing full-frame scan, and a negative image without a document.
Twenty variations also change input dimensions, exposure and page geometry.
The synthetic labels are the page corners supplied to the renderer, not
detector predictions. The fallback is tested on a 640px search copy with the
higher-resolution image supplied for refinement, matching `proc.worker.ts`.

The metric is the worst of the four corner distances divided by the image
diagonal. Cyclic corner matching permits different starting corners, but never
hides a wrong corner or a reversed polygon. A positive case must be detected
and have less than 2% error. A negative case must return `found: false`.
JPEG overlays and JSON measurements are written to `.test-output/` (ignored).
Green marks the reference polygon; red marks the predicted polygon.

## Real photographs

Eight additional public examples were inspected and approximately labelled by
hand. These are useful regression checks, not a representative accuracy study
or a claim of pixel-perfect ground truth. The source photos are not redistributed
in this repository. To reproduce:

```sh
git clone https://github.com/andrewdcampbell/OpenCV-Document-Scanner.git .test-output/reference
git -C .test-output/reference checkout d3683eba1baf7f0dc7bbe6299352777440b91dbf
node scripts/test-detection.mjs --real
```

Source: `andrewdcampbell/OpenCV-Document-Scanner/sample_images` at the commit
above. Labels in `real-labels.json` are normalized image coordinates.

## Scope

The detector assumes one dominant, approximately planar document. A curled
page cannot be flattened accurately by four corners alone. A completely hidden
edge or a paper edge indistinguishable from its background cannot be guaranteed
from pixels alone. The frame-edge test labels the *visible* page boundary; it
does not ask the algorithm to invent corners outside the photograph.

Keep actual user failure photos as additional consented fixtures when available.
Passing generated examples and these eight photos does not establish that every
phone photo or the user's unprovided failing photos will pass.

## Verified results (2026-10-28)

Against base commit `5721db7e568b874919068f2fd05b87753c4058d8`:

- OpenCV: 34/34 synthetic cases pass; maximum positive corner error 0.170%.
- Fallback at worker resolution: 34/34 pass; maximum positive error 1.349%.
- OpenCV photographs: 8/8 pass against approximate manual labels; maximum error 1.872%.
- TypeScript checking and production web build pass.
- Headless Edge: import a receipt through the UI, process it, and download a PDF successfully, with no JavaScript page errors.

The Windows installer and hardware scanner were not run locally. These measurements
apply only to the documented test set, not unseen user photographs.
