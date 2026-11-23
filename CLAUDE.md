# Kleinanzeigen Inserat-Duplikator

A Manifest V3 browser extension for Chrome and Firefox. It copies one of the user's own Kleinanzeigen listings into a new, unsent "Anzeige aufgeben" form. It is plain JavaScript with no build step, dependencies or tests. User-facing strings (popup, warnings, README) are in German.

## Hard rule

When testing against the live site with the user's account, **never submit anything**: no "Anzeige aufgeben", "Entwurf speichern" or edit-page save. Filling forms, uploading images into a form, opening dialogs and "Vorschau" are fine. Leave the filled tab open for the user to look at and discard.

## How it works

- `popup.js` sends `COPY_LISTING` to the active tab's content script, then `OPEN_AND_PASTE_LISTING` to the background.
- `content.js`, copy step: reads the saved ad from the listing's **edit page** (`/p-anzeige-bearbeiten.html?adId=…`), either the open one or fetched in the background from the listing view (`/s-anzeige/…`). It does not scrape the public listing page; that was dropped on purpose because it kept breaking.
- `background.js`: downloads the images as data URLs into `storage.local` (`copiedListing`), then opens `/p-anzeige-aufgeben-schritt2.html?categoryId=<id>` in a background tab and sends `PASTE_LISTING`.
- `content.js`, paste step: waits for hydration, then fills the title, details, description, price, price type, shipping and images. It returns German warnings for anything it could not set and verify.

## Kleinanzeigen internals (as of 2026-11)

**Edit page data:**
- Lives in the `props` attribute of the `PostListingForm` `astro-island`. It is Astro-serialized: `[0, value]` is a plain value or an object of pairs, `[1, [...]]` is an array.
- `postListingPage.adData`: `categoryId`, `priceType` (`FIXED` / `NEGOTIABLE` / `GIVE_AWAY`), `attributes` (`{key: {value}}`), `shippingOptions`, `images[].dynamicRuleXXLargeUrl` (signed, loadable without cookies).
- `postListingPage.category.attributes`: the field definitions in form order, with `localizedName` and `localizedOptions` (value → display text). `category.priceConfig.priceTypeOptions` holds the price type texts.
- For other people's ads, or when logged out, the edit page redirects cross-origin. Hence `fetch(..., { redirect: "manual" })` and the `opaqueredirect` check.

**Create form:**
- `?categoryId=` preselects the category and renders its detail fields and the shipping radios. `?parentAdId=` does nothing useful.
- It is server-rendered and then hydrated. Before hydration (`astro-island[ssr]`) input is lost. After it, `element.click()` and the native value setter plus an `input` event work for every widget so far; no real mouse or keyboard input is needed.
- Every detail field has a hidden `input[name="attributeMap[<key>]"]` holding the submitted value, which the extension uses to verify each pick. The controls:
  - `button#<key>[role=combobox]`: options in `#<key>-menu [role=option]`, matched by display text (they carry no value).
  - `input#<key>[role=combobox]`: filters while typing (e.g. Modell). Dependent fields appear only once their parent (Marke) is set, which is why details are set in definition order.
  - `button[aria-haspopup=dialog]` next to the hidden input (Zustand): opens a `<dialog open>` whose radios carry the stored value, plus a "Bestätigen" button.
- `attributeMap[<cat>.versand]` (`ja` / `nein`) is the pair of radios `#ad-shipping-enabled-yes/no` itself.

**Not yet handled or tested:** carrier and package size for shipping-enabled ads (the extension only warns), free-text or numeric attributes (cars, real estate), "Ich suche" (WANTED) ads, and Firefox since the edit-page migration.

## Testing against the live site

There are no automated tests; verify in a real browser.
1. Launch Chrome for Testing from Playwright's cache. Branded Chrome ignores `--load-extension`. Run it in the background so it keeps running:
   ```sh
   "$HOME/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
     --remote-debugging-port=9222 --user-data-dir=<scratch>/profile --no-first-run \
     --disable-extensions-except="$PWD" --load-extension="$PWD" https://www.kleinanzeigen.de/m-einloggen.html
   ```
   The user logs in themselves; the profile keeps the login.
2. Drive it with `playwright-core` (installed in a scratch directory) via `chromium.connectOverCDP("http://127.0.0.1:9222")`. If the first tab is stuck on `about:blank`, navigate it with raw CDP `Page.navigate` first, or the connection hangs.
3. For a real end-to-end run, open `chrome-extension://<id>/popup.html` as a page. Then call `chrome.tabs.sendMessage(listingTabId, {action: "COPY_LISTING"})` and `chrome.runtime.sendMessage({action: "OPEN_AND_PASTE_LISTING"})` from it, exactly as `popup.js` does. Playwright does not see the idle MV3 service worker. To test variants (Zustand, shipping on, invalid values), edit `copiedListing` in `chrome.storage.local` from that page, paste, then restore it.
4. Check the hidden `attributeMap[...]` values, `input[name=categoryId]`, `input[name=priceType]` and the image count. Image uploads take several seconds to finish.
5. Reload the extension after code changes with `chrome.developerPrivate.reload(id)`, called from a `chrome://extensions` page. **Don't use `chrome.runtime.reload()`**: it left the unpacked extension disabled ("unsupportedDeveloperExtension") even across restarts. To recover, call `developerPrivate.updateProfileConfiguration({inDeveloperMode: true})` and then `chrome.management.setEnabled(id, true)`.

Check syntax with `node --check content.js background.js popup.js`.
