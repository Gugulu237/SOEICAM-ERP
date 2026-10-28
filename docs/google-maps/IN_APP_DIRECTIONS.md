# Directions inside the SOEICAM customer map

Customer and outlet actions, pin selections and the delivery planner now keep the map and driving directions inside the ERP. The planner preserves the chosen order of up to three stops. Saved GPS coordinates are used directly; the customer does not need a Google Places listing.

## Staff workflow

1. Open Customers > Map, select a YOLA pin and choose **Directions from my location**.
2. Allow browser location access. The ERP opens its expanded map, draws the driving route and shows the estimated distance, duration and route steps.
3. **Update from my position** explicitly requests a fresh fix and recalculates. **Clear route** removes the route. **Close** returns to the page; browser Back also closes the expanded view.

The blue point and accuracy circle represent the requested driver position. YOLA pins remain the exact recorded customer entrances, even when Google's road route ends on a nearby road. Location requests do not update customers, record deliveries, or write the driver's location to the ERP database or browser storage. Position and destination coordinates are sent to Google to calculate the requested route.

The map is displayed in an app viewport dialog, including on iOS, without depending on native browser fullscreen. Expanding and closing move the existing map canvas; they do not construct another map or repeat the route request. Long directions scroll in a bounded panel while map controls and provider attribution remain visible.

## Google Cloud setup

Use the existing project, browser API key and JavaScript map ID:

1. In **APIs & Services > Library**, enable **Maps JavaScript API** and **Routes API**, with billing active.
2. In **Credentials**, select the API key used by the ERP. Under API restrictions allow both services. Website restrictions must cover the actual ERP origin and paths, such as https://admingugulu.com/*; add localhost separately if local testing is needed.
3. No Places API or customer place ID is required. No additional environment variable or server key is needed.
4. Test on the actual allowed website: select a saved outlet pin, grant location access and request directions. A working base map alone does not verify access to Routes API.

The routes library loads on the first directions request. Requests use driving mode, one route, no traffic computations or waypoint optimization, and a limited field mask. There is no background GPS watch, automatic rerouting, or voice navigation. Browser location requires HTTPS or localhost. Permission failures, inaccurate fixes, no route, quota exhaustion and configuration failures leave the map usable with an actionable message. Cancellation or leaving the map ignores late GPS and route responses.

## Customer pins and landmarks

Keep the published Google Cloud style associated with NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID. Use the preset and publishing instructions in [README.md](README.md) to hide ordinary business POIs, retain landmark categories, and select sparse POI density.

Advanced customer markers require a map ID. Google controls basemap labels through its Cloud style; runtime MapOptions.styles cannot override that map ID. clickableIcons:false prevents incidental Google POI selection but does not itself hide their labels. Applying or publishing a Cloud style requires access to the Google Cloud project and has not been performed by this source change.

The customer map no longer automatically switches to OpenStreetMap on Google initialization failure. It shows the Google configuration/connection error and keeps customer records accessible in the surrounding list. This prevents an unstyled fallback from exposing unrelated business labels. Provider attribution and Google map controls are retained.

## Verification scope

Isolated tests cover exact outlet coordinates, ordered stops, fresh current-position requests, validation, permissions/timeouts, cancellation, stale results, API failures, polyline cleanup, and existing map/zone/GPS editing behavior. Offline browser fixtures run the real React map component, dialog and styles with synthetic Google/GPS transport. They verify phone/tablet sizing, route controls and one map instance across expansion.

Actual Google routing authorization, billing, Cloud label style and road coverage must be checked on the allowed live origin. No company records or Cloud configuration are changed by these fixtures.

References:
- https://developers.google.com/maps/documentation/javascript/reference/route
- https://developers.google.com/maps/documentation/javascript/routes/get-a-route
- https://developers.google.com/maps/documentation/routes/get-api-key
- https://developers.google.com/maps/documentation/javascript/cloud-customization

## Routing request and GPS diagnostics correction (28 October 2026)

The original browser request supplied `units: 'METRIC'`, the Routes REST value. Maps JavaScript uses `google.maps.UnitSystem.METRIC`, whose value is numeric zero. The quarterly JavaScript SDK v3.65.14a throws `Unknown UnitSystem: METRIC` while converting that string, before sending the request. The integration now supplies the SDK enum when present, retaining zero; otherwise it lets Google infer units from the origin. The app continues to display metres/kilometres.

Routing failures preserve whether GPS succeeded and distinguish request validation, configuration/access, quotas, no route, network failure and rendering failure. The small Directions diagnostics notice displays only an allowlisted status and failure stage. Raw provider messages, keys, URLs and GPS coordinates are not logged or exposed in that notice. Routes API must still be enabled and allowed on the existing browser key; a working basemap alone does not prove routing permission.

Customer names now appear in compact white labels above the YOLA icons. Long labels shorten visually; the full name remains in the marker title and selected-customer panel. Text is inserted with textContent, and the labels are absolutely positioned so they do not change the marker dimensions, bottom anchor or saved GPS. The linked Cloud map style is unchanged.

Regression coverage includes the JavaScript enum value, nested/numeric Google error formats, preserving a successful GPS fix on routing errors, partial-render cleanup, safe customer-name labels, unchanged anchors and existing customer/zone workflows. The production build and isolated tests run without company data or API keys. Live routing authorization and on-device GPS still need verification on the allowed local/live ERP origin after applying the source update.

Reference: https://developers.google.com/maps/documentation/javascript/routes/localized-values
