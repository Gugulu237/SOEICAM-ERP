# Mobile navigation and brassé 250g photos

18 November 2026

The mobile floating Plus button and bottom More button now open the existing off-canvas module drawer. The drawer lists the modules permitted for the signed-in employee, keeps profile access, closes after the selected route commits, and restores keyboard focus without scrolling. Desktop New actions remain in the top bar. The mobile menu button stays available on role home screens and moves above fixed form actions.

Back now returns one verified ERP history entry at a time instead of skipping intermediate pages to find an older module menu. Direct links use a safe parent page. Back/Forward reject stale or foreign session markers. Payroll, invoice and mobile sales return controls use the shared behavior. Existing URL tab/filter history and saved list/scroll state remain in use; drawer navigation consumes its temporary overlay entry rather than adding an extra page.

## Product photos

The official website's Nature, Fraise and Vanille brassé 250g images are bundled with the ERP and available in the shared image picker. Matching YOLA product rows without an explicit photo use them automatically in inventory, sales and item views. Existing explicit/custom image selections stay authoritative. Unsupported flavors and drinkable products do not borrow a mismatched cup image.

The website was unreachable from this environment. The available local originals were verified byte-for-byte using the Git blob hashes in the official [website repository](https://github.com/Gugulu237/SOEICAM/tree/main/public/brand/products). The website catalog calls these products 250g; the source artwork's printed 250ml labels were preserved. No artwork was relabeled and no product or accounting records were modified.

| Flavor | ERP original | Official website source filename |
| --- | --- | --- |
| Nature | `/products/yola/brasse-nature-250g.png` | `stirred-250g-nature.png` |
| Fraise | `/products/yola/brasse-fraise-250g.png` | `stirred-250g-strawberry.png` |
| Vanille | `/products/yola/brasse-vanille-250g.png` | `stirred-250g-vanilla.png` |

Responsive transparent WebP versions are provided at 96, 256, 512 and 960 pixels. The 512px photos are approximately 40–44 KB each instead of 1.18–1.52 MB originals. The preparation script normalizes Windows line endings when hashing its recipe, preserving the previous image URLs.

## Validation and release status

- Mobile drawer/history checks: 10 passed.
- Navigation-related workflow checks: 64 passed; additional navigation/sales checks: 41 passed.
- Image matching/delivery checks: 28 passed, including rendering the shared thumbnail from actual product-shaped props.
- Source lint and production build passed.
- The browser regression includes section-by-section Back and drawer-to-module Back/Forward, but neither Chrome nor Edge started its debugging endpoint in this environment. Authenticated live workflows remain unverified.

These changes are saved in the local ERP working copy. They have not been pushed or deployed.
