# Vehicle showroom and visual assets

The existing React 18 / TypeScript frontend, FastAPI API, PostgreSQL schema and Firebase identity system remain the application architecture. The visual layer uses a reviewed, local asset manifest. It does not require a database migration, a paid provider, image generation, an LLM, or a new backend.

## Identity and selection

`frontend/src/vehicle-assets.json` associates assets with the exact catalogue `make` and `model`. `frontend/src/assets.ts` resolves these names case-insensitively, without fuzzy matching or guessing filenames. `Nexon` does not match `Nexon Ev`. Missing matches use the branded unavailable-photo state.

The homepage selection lives in the `car` URL parameter, for example `/?car=1054`. The actual ID must exist in the current database; IDs are not hardcoded into the asset registry. `Home` retrieves the complete selected record through the existing API. Vehicle cards, advisor results and details all link to the same showroom URL. Names, specifications, prices and the viewer derive from that single response. An old request cannot overwrite a newer selection.

The initial showroom choices are looked up through paginated `make`/`model` catalogue queries. No complete-catalogue download is required. A missing vehicle or failed backend request produces a retry/reset state.

## What is actually available

- **One real GLB:** Porsche 911 Carrera 4S by **Karol Miklas**, as identified in the GLB's embedded creator metadata. Distributed under **CC BY-SA 4.0**. Downloaded unchanged from [the PlayCanvas documentation asset](https://developer.playcanvas.com/assets/porsche-911-carrera-4s.glb); [original credited model](https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf).
- **Compatibility limitation:** the current catalogue has a closed-roof **Carrera S**, not an exact 4S record. Its viewer explicitly labels the 4S as a model-family reference and explains the variant differences. It is not a scan or photograph of the listed variant. The **Carrera S Cabriolet never receives this closed-roof mesh** and uses its model-family photo fallback.
- **17 photo mappings / 16 unique photographs:** Hyundai Creta and Venue; Tata Nexon and Nano Genx; Maruti Suzuki Swift, Alto, Omni, Baleno, Dzire, Dzire Tour and Ciaz; Datsun Redi-Go; Bajaj Qute (Re60); Honda City and Amaze; Porsche 911. Dzire Tour shares a clearly labelled Dzire model-family photograph. Photos may differ in generation, colour and equipment. They are not live-stock images.
- **All other variants:** honest unavailable-photo state, unless their exact make/model already resolves to one of those photographs. They do not receive a generic car photograph, generated visual or pretend 3D model.

All image source URLs, authors and licences are in the manifest and on `/credits`. Images are converted to WebP and reduced in size. Attribution and share-alike requirements remain applicable. The GLB's metadata is retained, with its distribution source, original hash and licence in `frontend/public/assets/vehicles/LICENSE-porsche.md`. Manrope's OFL and the Draco decoder's licence are included alongside those assets. Asset copyright licences do not grant manufacturer trademark rights.

## Viewer implementation

`VehicleViewer.tsx` resolves the model or photo and isolates scene errors. `VehicleScene.tsx` is dynamically imported only for a compatible model. Catalogue cards and photo-only vehicles do not load Three.js or a GLB.

The scene uses Three.js 0.180, GLTFLoader, a locally served Draco decoder and OrbitControls. It has a neutral studio environment generated in memory, contact shadows, bounded orbit, keyboard rotation, zoom buttons, reset, and photo/3D selection. Canvas identity and all catalogue facts remain available as regular text. Horizontal touch dragging rotates; vertical page scrolling remains available. There is no automatic spin.

Rendering happens on demand, with frames only for interaction, damping, resizing or a short camera transition. Reduced motion removes the camera transition and CSS animation. Pixel ratio is capped at 1 on small screens and 1.5 elsewhere; mobile shadow maps use 512px instead of 1024px. The current GLB is about 3.9 MiB. Three.js is a separate lazy chunk (about 154 KiB gzipped at the verification build), rather than part of the initial application bundle.

Unmounting or switching vehicles aborts the model fetch, disconnects observers/listeners, stops animation frames, disposes geometries/materials/textures/environment/shadows, terminates Draco workers, disposes the renderer and releases its WebGL context. A late model load is disposed instead of attached. Module, network and WebGL failures retain a usable photo and an honest message. Invalid photo URLs or image decode errors fall back to the neutral branded state.

## Adding an asset

1. Obtain a model/photo whose licence permits the intended hosting and redistribution. Keep author, source, licence, and modification history. Do not use a model extracted from a game or an unverified download.
2. Prefer a self-contained **GLB 2.0** under `frontend/public/assets/vehicles/`. GLTF 2.0 is also supported by GLTFLoader when its relative buffers/textures are served alongside it. Keep names stable and use local paths. Remote URLs require verified availability and CORS; the current registry deliberately serves assets locally.
3. Target under 5 MiB per model, a reasonable mesh count, and textures of 1024px or less where possible. The current loader supports Draco with bundled local decoders. Do not add Meshopt or KTX2-compressed assets until their decoders are explicitly configured and tested.
4. Add the exact make/model entry and its image metadata to `vehicle-assets.json`. For a model, add `modelUrl`, compatible `modelVariants`, `modelAuthor`, `modelSource`, `modelLicense`, and a clear `modelNote`. Verify the shape, roof, generation and trim against the catalogue. Never infer a GLB path from a name.
5. Prefer a WebP poster with explicit rights and a complete image attribution. The current system uses one primary photograph per model; no extra gallery is claimed where none has been verified.
6. Run `npm test` and `npm run build` in `frontend`. Open the real catalogue record in the showroom. Verify rotation, bounds, keyboard controls, reset, normal-photo view, model failure, unavailable WebGL, mobile scrolling and rapid vehicle switching. Check `/credits` and preserve licence files before publishing.

## External setup

No cloud resources were created or migrated for the visual redesign. See [CLOUD_SETUP.md](CLOUD_SETUP.md) for dedicated Neon and Firebase configuration and [DEPLOYMENT.md](DEPLOYMENT.md) for deployment. `CARSAGE_CONFIRM_TARGET`, explicit CORS origins, server-side Firebase verification and per-user saved-car filtering are unchanged.

The current development database is local PostgreSQL 16 with migration `0002` and 1,267 visible variants. Live Neon and Firebase verification remain unavailable without credentials. Login and saving must not be bypassed to simulate a working account. The advisor remains rule-based; price prediction remains experimental. The planned Chrome extension was not present and is outside this website redesign; none was created or published.

## Motion, themes and catalogue grouping

GSAP 3.15 supplies one motion system: a pre-paint hero introduction, small staggered entrance reveals, and a lazy-loaded ScrollTrigger timeline for the desktop hero. One CSS-sticky scene provides bounded storytelling; the remaining page scrolls normally. The timeline fades copy, shifts/scales the vehicle and updates a nonessential progress line. There is no automatic vehicle selection or carousel. Selecting a vehicle is explicit and changes the real URL/record. Navigation, discovery CTAs and comparison state remain independent of the animation.

Home sections, catalogue cards, details/specifications, comparison table/summary, advisor messages, saved cards and account feedback use entrance reveals. Content is visible without the optional scroll plugin; focus cancels a reveal for its active control. Animation contexts, IntersectionObservers and MutationObservers are cleaned up on navigation. At widths under 900px, heights under 720px, or with reduced motion, the hero uses ordinary document flow. Reduced motion disables entrance animations and camera interpolation.

System/light/dark preferences live in `carsage.theme`. `public/theme-init.js` applies the resolved theme before styles; React follows later system changes. All route surfaces use shared tokens. Three.js updates exposure, environment, lights and shadows in place, retaining the current camera/model.

Catalogue grouping runs on the server after filtering: `view=models` chooses the cheapest matching variant per make/model; API callers retain the original `view=variants` default. The frontend defaults to Models and preserves filters when opening all variants. Body types split on commas, fuel memberships on plus signs, and Automatic includes AMT/CVT/DCT; raw source specifications remain unchanged. Facet counts exclude their own constraint and include the other filters; makes also exclude the dependent model. A make change clears that model. Recommendations and related-car categories use the same membership predicate.

## Verification at this revision

- Frontend: **41 tests pass**; TypeScript checking and production build pass. Coverage includes asset resolution, wrong-model protection, Cabriolet exclusion, image/scene failure, stale responses, URL-driven vehicle selection, dependent model facets, grouping/filter preservation, budget recovery and persisted/system themes.
- Backend: **132 pass, 5 live-service tests skipped**. Category membership, model pagination/representatives, filtered facets and related/recommended cars have regression coverage. Firebase verification, saved-car isolation, input validation and database-error checks remain intact.
- Dependencies: **0 npm audit vulnerabilities** with the lockfile. Vite 6.4.5 and Vitest 4.1.12 replace vulnerable development/test releases. Firebase's optional gRPC dependency is constrained to a patched release within major version 1. Firebase and React majors are unchanged.
- Chrome: dev and built-preview versions were exercised at desktop/mobile widths. Checks cover rendered 3D rotation, keyboard controls, photo switching, vehicle selection/deep links, filters/search, pagination, comparison add/remove/replace/clear, advisor actions, all eight responsive routes, invalid IDs, model-fetch failure, missing WebGL and context loss. Pointer dragging changed canvas pixels; the idle scene requested zero extra frames during the observation window.
- Current Chrome checks verify all 39 make, 10 body, 5 fuel and 2 transmission facet counts against the actual API totals; a filtered model opens its 11 matching Nexon automatic variants under ₹15 lakh; comparison and advisor links use actual IDs. Theme switching retains the canvas, scroll scrubbing changes transforms, hero triggers disappear on navigation/reduced motion, and eight routes have no page overflow at 320/390/768/1440px.
- The production preview verifies 3D buttons/keyboard, scrolling over the canvas, explicit vehicle identity/photo changes, mobile dependent filters and a visible WebGL-unavailable fallback. A blocked React entry confirms dark theme initialization before React loads. Chrome touch emulation confirms vertical scrolling over the live 3D canvas; a 600px-high desktop viewport has no sticky hero.
- Automated axe-core WCAG 2 A/AA and WCAG 2.1 AA checks reported **zero violations** on eight inspected routes in both themes at a desktop viewport. This is a scoped automated check, not a full accessibility certification or assistive-technology audit.
- No live Neon/Firebase credentials, deployment, extension publication or real-device performance profiling were used. Browser mobile checks use viewport/touch emulation.

Design references: the supplied nine-page **Course File Manager 3D** PDF was rendered and its layered light surfaces inspected. The public homepage of [Refund AI](https://refund-ai1.vercel.app) was inspected in Chrome at desktop/mobile sizes, including the centered typography, floating navigation and scroll-driven scene zoom/layers. Its authenticated flows were not assessed. The latest brief mentions a screen recording, but no video was present among the supplied files, so frame-accurate timing was not verified. The separate automotive concept image was also unavailable. CarSage uses original automotive content and its own restrained lime/charcoal visual identity.
