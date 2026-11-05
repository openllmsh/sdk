import { Schema as S } from "effect";
import type { TMediaDefaultSurface } from "./media-default";
import { MediaDefaultSurface } from "./media-default";

/**
 * The surface an EXPLICIT-model plan fetch is for.
 *
 * `GET /api/daemon/plan?model=…` was surface-blind: the daemon asked for
 * whatever model string the client sent, whichever endpoint it arrived on,
 * and the cloud resolved it under the `chat` default. For an unambiguous
 * media id that merely failed to resolve; for an AMBIGUOUS family name it
 * resolved to the wrong thing entirely — `model=grok` on
 * `/v1/images/generations` planned the grok CHAT model, while the cloud's
 * own image handler (which knows its surface) selects grok's image model
 * for the identical request. One request, two answers, decided by which
 * transport happened to serve it.
 *
 * So the surface travels WITH the query. It is the surface NAME, not a
 * capability: the mapping from surface to capability (`image_edit` →
 * `image_editing`, never `image_generation`) already exists once on the
 * cloud, next to the gate that enforces it, and must not be re-stated by
 * every caller.
 *
 * Absent means "no surface stated" and keeps the historical chat-default
 * behaviour — an older compiled daemon never sends it, and a plan it
 * fetches must keep working exactly as before.
 */
export const PLAN_SURFACE_QUERY_KEY = "surface";

/** A surface a plan can be scoped to — the media-default surface set. */
export const PlanSurface = MediaDefaultSurface;
export type TPlanSurface = TMediaDefaultSurface;

const decodeSurface = S.decodeUnknownResult(PlanSurface);

export const encodePlanSurfaceQueryValue = (surface: TPlanSurface): string =>
  surface;

/**
 * `absent` (no surface stated) and `invalid` (stated, unrecognised) are
 * deliberately different results: the first must keep the legacy default,
 * the second is our own client sending something wrong and is worth a 400
 * rather than being silently planned on the wrong surface.
 */
export type TPlanSurfaceQuery =
  | { readonly kind: "absent" }
  | { readonly kind: "surface"; readonly surface: TPlanSurface }
  | { readonly kind: "invalid" };

export const decodePlanSurfaceQuery = (
  params: URLSearchParams,
): TPlanSurfaceQuery => {
  const raw = params.get(PLAN_SURFACE_QUERY_KEY);
  if (raw === null || raw.length === 0) return { kind: "absent" };
  const decoded = decodeSurface(raw);
  return decoded._tag === "Success"
    ? { kind: "surface", surface: decoded.success }
    : { kind: "invalid" };
};
