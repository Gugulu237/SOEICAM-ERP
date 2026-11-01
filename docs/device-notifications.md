# Device notifications and sounds

My profile → Notifications and sounds offers device opt-in, disable, sound toggle, test alert and three lightweight in-app chimes. Permission is requested only from the Enable button. Android uses its normal notification sound; iPhone/iPad must install the app on the home screen first. Phone/browser sound settings, Focus and Do Not Disturb can silence alerts. Web Push does not provide a portable custom-ringtone API. In-app chimes require a browser interaction to unlock audio and are not played on top of an enabled native notification.

The initial automatic source is the existing fermentation warning/completion feed. Only active General Managers and Production Managers with current manufacturing access receive those alerts. Other staff can enable and test their device, but have no automatic topic yet. This change does not invent new sales/payment notification rules or broaden employee access. The existing in-app bell and read acknowledgments continue to work.

## Production activation

1. Deploy the source and pinned `web-push` dependency on the existing HTTPS Next.js Node.js service. Development and preview servers do not send push. Keep at least one production server process running; a sleeping/serverless host will not run the polling worker reliably.
2. Review and apply `supabase/migrations/202611010001_device_notifications.sql` through the normal authorized migration process. It adds two private notification tables and no company-record changes. It is **not** applied by build, startup or this local update.
3. Generate one long-lived key pair, for example `node scripts/prepare-push-keys.mjs https://YOUR-ACTUAL-ERP-DOMAIN`. The script writes ignored `.env.push.local` without printing keys and refuses to overwrite existing material. Use the actual domain or a real `mailto:` contact. Copy `SOEICAM_PUSH_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` into the server's private environment settings. Do not put the private key in a `NEXT_PUBLIC_` variable or commit the file. Retain the pair across deployments; rotation requires device re-enrollment.
4. Confirm `NEXT_PUBLIC_APP_URL` is the public HTTPS ERP origin, `SOEICAM_PUSH_ENABLED=true`, and background jobs are enabled on that server. Restart/redeploy. No additional mobile app-store service or Firebase account is needed.
5. On the installed app, sign in, open My profile, enable device alerts, accept the system permission, then Send test alert. A successful request means the provider accepted delivery; it does not prove the phone displayed or sounded it.
6. Test an actual fermentation reminder with an authorized non-business fixture/staging order. Check background/locked-screen delivery, silent preference, device mute/DND, iOS installation, role removal, sign-out and shared-device account changes. Never create company transactions solely to test notifications.

## Delivery and privacy

The service stores endpoint encryption keys only in `erp_private`, revoked from public/anon/authenticated roles and inaccessible through generic ERP entities. Five active devices per account are allowed. Subscription ownership comes from the authenticated server context, never a client-supplied user ID. Tests target only an owned device and are limited to one per minute. Only known HTTPS browser push-provider hosts are allowed, preventing arbitrary outbound requests.

The existing audit event is the source of truth. A database outbox deduplicates event/device/revision pairs and claims ten jobs with expiring leases. The worker polls every 30 seconds, rechecks the current active employee, role and module access before sending, and uses bounded retries. External provider calls occur outside business transactions. Errors never log endpoint tokens or encryption keys. Expired endpoints are disabled and their keys cleared. Failed/finished delivery metadata is pruned after seven days. Device disabling deletes its subscriptions/delivery metadata; it never deletes production audit history.

Enrollment does not replay old notifications. Events older than one hour are skipped; provider TTL is five minutes. Notification delivery is best effort and can be delayed by connectivity or platform limits; the in-app production history remains authoritative. Stable tags plus a bounded worker list of opaque event IDs suppress retries. Lock-screen text is generic and contains no amounts, product/customer names, GPS or document IDs.

The worker stores only an opaque device binding and up to 100 deduplication identifiers in a separate metadata cache. It never caches ERP records. Signing out or switching accounts clears this binding before asynchronous revocation and unsubscribes the browser. Notification clicks close the notification, verify the current binding, and open only a fixed in-app route; they never approve, acknowledge or post a transaction, and do not navigate an unrelated open form. Cached asset version `v2` retains the PWA's network-only business-data rules.

## Verification limits

Automated fixtures exercise provider validation, role revocation, SQL ownership and leases, private schema access, subscription lifecycle, sound preferences, worker notification display, deduplication and safe clicks. A real device, configured production keys and the reviewed migration are still required to verify delivery and audible sound. No live push, database migration or production key creation is performed by the tests.

References: [Next.js web push guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [Web Push Node library](https://github.com/web-push-libs/web-push), [Apple notification sounds and settings](https://developer.apple.com/videos/play/wwdc2023/10120/), [Notification options](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).
