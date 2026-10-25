# SOEICAM customer delivery map style

The preset in [SOEICAM-Delivery-Map-Style.json](SOEICAM-Delivery-Map-Style.json) hides ordinary Google points of interest and transit-stop labels. It retains landmark, historic-site, tourist-attraction and airport labels as muted navigation references. Roads, neighbourhood names, water and the base geography keep their normal appearance.

SOEICAM customer and outlet pins and delivery polygons are application overlays. The style changes the Google basemap; it does not filter or publish ERP records.

## Apply to the existing Google Map ID

1. In the Google Cloud project containing the current map ID, open [Map styles](https://console.cloud.google.com/google/maps-apis/studio/styles).
2. Choose **Create style**, open the **JSON** tab and upload `SOEICAM-Delivery-Map-Style.json`.
3. Choose **Customize** and preview Yaoundé around the working delivery areas at street and city zoom levels.
4. In **Map features**, open the gear for **Map Settings** and reduce **POI Density** to a sparse setting. Density is a separate Cloud setting and cannot be included in the JSON.
5. Save the style as **SOEICAM Delivery** and publish it. An existing style's edits stay drafts until **Publish**.
6. Associate the published light style with the existing JavaScript map ID used by `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Keep the same map ID.
7. Reload `https://admingugulu.com/customers?view=map`. Cloud styles can take time to propagate.

Using the same map ID applies the style to both the local and production Google maps without rebuilding the ERP. A replacement map ID would require updating the environment and rebuilding production.

Google selects which landmarks have labels at each zoom. The preset keeps the relevant landmark categories; it does not provide a hand-picked list of named landmarks. Preview the actual Yaoundé coverage before publishing. Public place labels supplied by the OpenStreetMap fallback are part of its raster tiles and are not affected by Google styles.

## Implementation

The map uses a Google map ID with Advanced Markers. Its basemap styles must be configured through Cloud styling; `MapOptions.styles` is unsupported with a map ID. Do not remove the map ID or replace the working API key to apply this preset.

No new API, dependency, API key or database change is required. The preset and these instructions are prepared locally; importing, associating and publishing require access to the Google Cloud project.

References:

- [Import a JSON style](https://developers.google.com/maps/documentation/javascript/cloud-customization/json)
- [Cloud style JSON reference](https://developers.google.com/maps/documentation/javascript/cloud-customization/json-reference)
- [Associate and publish styles](https://developers.google.com/maps/documentation/javascript/cloud-customization/map-styles)
- [POI density](https://developers.google.com/maps/documentation/javascript/cloud-customization/poi-behavior-customization)

## Dark theme

[SOEICAM-Delivery-Dark-Map-Style.json](SOEICAM-Delivery-Dark-Map-Style.json) uses a dark navy basemap, readable roads, muted green parks and the same landmark-only POI filters as the light preset. Import and publish it as a dark style, then associate it with the existing map ID's **Dark mode** slot. The current ERP map uses Google's default light color scheme; displaying the dark style also requires initializing the map with **colorScheme: "DARK"**. Linking a dark style alone does not switch the app into dark mode. POI density is inherited from the map ID's light style settings.
