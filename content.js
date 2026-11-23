(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const LISTING_PATH = "/s-anzeige/";
  const EDIT_PATH = "/p-anzeige-bearbeiten.html";
  const OWN_LISTINGS_ONLY = "Nur eigene Inserate können dupliziert werden. Bitte anmelden und ein eigenes Inserat öffnen.";
  const CREATE_PATHS = new Set([
    "/p-anzeige-aufgeben-schritt2.html",
    "/p-anzeige-aufgeben.html"
  ]);

  extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "COPY_LISTING") {
      copyListing()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.action === "PASTE_LISTING") {
      pasteListing()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    return false;
  });

  // Copy: the listing's own edit page holds the saved ad as structured data, the
  // same form the create page uses. It is read from the open edit page, or
  // fetched in the background when the listing view is open.

  async function copyListing() {
    const listing = parseEditData(await loadEditData());
    const response = await extensionApi.runtime.sendMessage({ action: "SAVE_LISTING", listing });
    if (!response?.ok) {
      throw new Error(response?.error || "Das Inserat konnte nicht gespeichert werden.");
    }

    return {
      ok: true,
      message: `Inserat mit ${response.imageCount} Bild${response.imageCount === 1 ? "" : "ern"} kopiert.`
    };
  }

  async function loadEditData() {
    if (location.pathname === EDIT_PATH) {
      return readFormProps(document);
    }
    if (!location.pathname.startsWith(LISTING_PATH)) {
      throw new Error("Bitte ein eigenes Inserat oder dessen Bearbeiten-Seite öffnen.");
    }

    const adId = findAdId();
    if (!adId) {
      throw new Error("Die Anzeigennummer wurde auf dieser Seite nicht gefunden.");
    }
    // For other people's ads, or when logged out, the edit page redirects away.
    const response = await fetch(`${EDIT_PATH}?adId=${adId}`, { credentials: "include", redirect: "manual" })
      .catch(() => null);
    if (!response || response.type === "opaqueredirect") {
      throw new Error(OWN_LISTINGS_ONLY);
    }
    if (!response.ok) {
      throw new Error(`Die Bearbeiten-Seite konnte nicht geladen werden (${response.status}).`);
    }
    const html = await response.text();
    return readFormProps(new DOMParser().parseFromString(html, "text/html"));
  }

  // Own listings link to their edit page; the URL ends in "<adId>-<category>-<location>".
  function findAdId() {
    const editLink = document.querySelector(`a[href*='${EDIT_PATH}?adId=']`);
    const fromLink = editLink && new URL(editLink.href, location.href).searchParams.get("adId");
    return fromLink || location.pathname.match(/\/(\d+)-\d+-\d+\/?$/)?.[1] || null;
  }

  function readFormProps(doc) {
    const island = [...doc.querySelectorAll("astro-island")]
      .find((element) => /PostListingForm/.test(element.getAttribute("component-url") || ""));
    const page = island && reviveAstroProps(JSON.parse(island.getAttribute("props"))).postListingPage;
    if (!page?.editMode || !page.adData) {
      throw new Error(OWN_LISTINGS_ONLY);
    }
    return page;
  }

  // Astro serializes island props as [type, value] pairs: 0 is a plain value or
  // object whose entries are pairs again, 1 is an array of pairs.
  function reviveAstroProps(props) {
    const revive = (entry) => {
      if (!Array.isArray(entry)) {
        return entry;
      }
      const [type, value] = entry;
      if (type === 1) {
        return value.map(revive);
      }
      if (type === 0 && value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, revive(child)]));
      }
      return value;
    };
    return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, revive(value)]));
  }

  function parseEditData(page) {
    const ad = page.adData;
    const definitions = page.category?.attributes || {};
    const priceTypes = page.category?.priceConfig?.priceTypeOptions || [];

    // Follow the form's field order, so that e.g. "Marke" is set before "Modell",
    // whose options depend on it. Values the category no longer defines can't
    // be set on a new listing and are left out.
    const attributes = Object.entries(definitions)
      .filter(([key]) => ad.attributes?.[key]?.value && !isShippingAttribute(key))
      .map(([key, definition]) => {
        const value = ad.attributes[key].value;
        const option = definition.localizedOptions?.find((candidate) => candidate.value === value);
        return { key, value, label: definition.localizedName || key, text: option?.localizedValue || value };
      });

    const shippingKey = Object.keys(ad.attributes || {}).find(isShippingAttribute);
    const shippingValue = shippingKey ? ad.attributes[shippingKey].value : null;

    return {
      sourceUrl: location.href,
      adId: String(ad.id),
      adType: ad.adType,
      title: ad.title,
      description: ad.description,
      categoryId: String(ad.categoryId),
      price: {
        amount: ad.priceAmount ?? null,
        type: ad.priceType,
        text: priceTypes.find((option) => option.value === ad.priceType)?.text || null
      },
      attributes,
      shipping: {
        enabled: shippingValue ? shippingValue === "ja" : (ad.shippingOptions || []).length > 0,
        options: ad.shippingOptions || [],
        individualFeeInEuroCent: ad.individualShippingFeeInEuroCent ?? null
      },
      imageUrls: (ad.images || [])
        .map((image) => image.dynamicRuleXXLargeUrl || image.dynamicRuleThumbnailUrl)
        .filter(Boolean)
    };
  }

  // Every category has a "<category>.versand" attribute ("ja" / "nein") that
  // the shipping radio buttons set.
  function isShippingAttribute(key) {
    return /\.versand$/.test(key);
  }

  // Paste: the background opens the create page with ?categoryId=…, so the
  // category and its detail fields are already in place.

  async function pasteListing() {
    if (!CREATE_PATHS.has(location.pathname)) {
      throw new Error("Bitte die Seite „Anzeige aufgeben“ öffnen.");
    }

    const response = await extensionApi.runtime.sendMessage({ action: "GET_LISTING" });
    if (!response?.ok) {
      throw new Error(response?.error || "Gespeichertes Inserat konnte nicht geladen werden.");
    }
    if (!response.listing?.categoryId) {
      throw new Error("Noch kein Inserat kopiert. Bitte das Inserat erneut kopieren.");
    }

    const warnings = await fillListingForm(response.listing);
    const suffix = warnings.length ? ` ${warnings.join(" ")}` : "";
    return {
      ok: true,
      warnings,
      message: `Formular ausgefüllt. Bitte alle Angaben vor dem Veröffentlichen prüfen.${suffix}`
    };
  }

  async function fillListingForm(listing) {
    const warnings = [];
    const descriptionField = document.querySelector("#ad-description");

    await waitForFormReady(descriptionField, listing.description);

    const adTypeRadio = document.getElementById(`ad-type-${listing.adType}`);
    if (adTypeRadio && !adTypeRadio.checked) {
      adTypeRadio.click();
    }

    setFieldValue(document.querySelector("#ad-title"), listing.title);

    if (!(await selectCategory(listing.categoryId))) {
      warnings.push("Kategorie bitte manuell wählen.");
    }

    const skipped = [];
    for (const attribute of listing.attributes) {
      if (!(await setAttribute(attribute))) {
        skipped.push(attribute.label);
      }
    }
    if (skipped.length) {
      warnings.push(`Nicht übernommen: ${skipped.join(", ")}.`);
    }

    if (descriptionField.value !== listing.description) {
      setFieldValue(descriptionField, listing.description);
    }

    if (listing.price.type !== "GIVE_AWAY" && listing.price.amount !== null) {
      setFieldValue(document.querySelector("#ad-price-amount"), String(listing.price.amount));
    }
    if (!(await selectPriceType(listing.price))) {
      warnings.push("Preistyp bitte prüfen.");
    }

    if (!(await selectShipping(listing.shipping.enabled))) {
      warnings.push("Versand bitte prüfen.");
    } else if (listing.shipping.enabled) {
      // Carrier and package choices have not been automated yet.
      warnings.push("Versandoptionen bitte prüfen.");
    }

    if (listing.images.length && !(await uploadImages(listing.images))) {
      warnings.push("Bilder konnten nicht eingefügt werden.");
    }

    return warnings;
  }

  // The form is a server-rendered Astro island that React hydrates later. Before
  // hydration its controls have no event handlers, so every interaction is lost.
  // The description counter only updates once React handles input events.
  async function waitForFormReady(descriptionField, description) {
    if (!descriptionField) {
      throw new Error("Ein erforderliches Formularfeld wurde nicht gefunden.");
    }
    const island = descriptionField.closest("astro-island");
    if (!island) {
      return;
    }
    if (!(await waitFor(() => !island.hasAttribute("ssr"), 30000))) {
      throw new Error("Das Formular wurde nicht rechtzeitig geladen.");
    }

    const counter = document.querySelector("#ad-description-character-count");
    if (!counter) {
      await waitForDomUpdate(1000);
      return;
    }
    const isReady = await waitFor(() => {
      setFieldValue(descriptionField, description);
      return !/^0\s*\//.test(counter.textContent.trim());
    }, 15000, 500);
    if (!isReady) {
      throw new Error("Das Formular reagiert nicht auf Eingaben.");
    }
  }

  // Normally preset through the URL. Otherwise the title suggests categories as
  // radio buttons whose value is the category id.
  async function selectCategory(categoryId) {
    const readCategory = () => document.querySelector("input[name='categoryId']")?.value;
    if (readCategory() === categoryId) {
      return true;
    }
    const suggestion = await waitFor(() => document.getElementById(`ad-category-picker-${categoryId}`), 8000);
    if (!suggestion) {
      return false;
    }
    suggestion.click();
    return Boolean(await waitFor(() => readCategory() === categoryId, 3000));
  }

  // Each detail field has the attribute key as its id (or, for dialog pickers,
  // none) and keeps its value in a hidden input "attributeMap[<key>]" that the
  // form submits. The option labels come from the copied listing, and the hidden
  // value must end up equal to the copied value.
  async function setAttribute({ key, value, text }) {
    if (readAttributeValue(key) === value) {
      return true;
    }
    // Dependent fields such as "Modell" appear once their parent is set.
    const control = await waitFor(() => document.getElementById(key) || findDialogOpener(key), 3000);
    if (!control) {
      return false;
    }
    if (control.matches("button[role='combobox']")) {
      await chooseComboboxOption(control, text);
    } else if (control.matches("input[role='combobox']")) {
      await chooseSearchOption(control, text);
    } else if (control.matches("button[aria-haspopup='dialog']")) {
      await chooseDialogOption(control, value);
    } else if (control.matches("input, textarea")) {
      setFieldValue(control, value);
    }
    return Boolean(await waitFor(() => readAttributeValue(key) === value, 1500));
  }

  function readAttributeValue(key) {
    return document.querySelector(`input[name="attributeMap[${CSS.escape(key)}]"]`)?.value;
  }

  function findDialogOpener(key) {
    return document.querySelector(`input[name="attributeMap[${CSS.escape(key)}]"]`)
      ?.parentElement?.querySelector("button[aria-haspopup='dialog']") || null;
  }

  // Dropdown button whose options live in "<id>-menu". Options stay "invisible"
  // until the menu is positioned, so they are matched regardless.
  async function chooseComboboxOption(combobox, text) {
    if (combobox.getAttribute("aria-expanded") !== "true") {
      combobox.click();
    }
    const option = await waitFor(() => findOption(`${combobox.id}-menu`, text), 3000);
    if (!option) {
      if (combobox.getAttribute("aria-expanded") === "true") {
        combobox.click();
      }
      return false;
    }
    option.click();
    return true;
  }

  // Text input that filters its options while typing, e.g. "Modell".
  async function chooseSearchOption(input, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    input.focus();
    input.click();
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const option = await waitFor(() => findOption(input.getAttribute("aria-controls") || `${input.id}-menu`, text), 3000);
    if (!option) {
      setter?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
      return false;
    }
    option.click();
    return true;
  }

  // Button that opens a dialog with one radio button per value, e.g. "Zustand".
  async function chooseDialogOption(opener, value) {
    opener.click();
    const dialog = await waitFor(() => [...document.querySelectorAll("dialog[open]")].find(isVisible), 3000);
    if (!dialog) {
      return false;
    }
    const findButton = (pattern) => [...dialog.querySelectorAll("button")]
      .find((button) => pattern.test(normalizeLabel(button.getAttribute("aria-label") || button.textContent)));
    const radio = [...dialog.querySelectorAll("input[type='radio']")].find((element) => element.value === value);
    const confirm = findButton(/^(bestatigen|ubernehmen|fertig)$/);
    if (!radio || !confirm) {
      findButton(/^(abbrechen|schliessen)$/)?.click();
      return false;
    }
    radio.click();
    await waitForDomUpdate(100);
    confirm.click();
    await waitFor(() => !dialog.isConnected || !dialog.open, 2000);
    return true;
  }

  function findOption(menuId, text) {
    const target = normalizeLabel(text);
    const options = document.getElementById(menuId)?.querySelectorAll("[role='option']") || [];
    return [...options].find((option) => normalizeLabel(option.textContent) === target) || null;
  }

  async function selectPriceType(price) {
    const readPriceType = () => document.querySelector("input[name='priceType']")?.value;
    if (readPriceType() === price.type) {
      return true;
    }
    const combobox = document.querySelector("#ad-price-type[role='combobox']");
    if (!combobox || !price.text || !(await chooseComboboxOption(combobox, price.text))) {
      return false;
    }
    return Boolean(await waitFor(() => readPriceType() === price.type, 1500));
  }

  async function selectShipping(enabled) {
    const radio = await waitFor(
      () => document.querySelector(enabled ? "#ad-shipping-enabled-yes" : "#ad-shipping-enabled-no"),
      3000
    );
    if (!radio) {
      return false;
    }
    if (!radio.checked) {
      radio.click();
    }
    return Boolean(await waitFor(() => radio.checked, 1500));
  }

  async function uploadImages(images) {
    const input = document.querySelector("main form input[type='file'][accept*='image']")
      || document.querySelector("input[type='file'][accept*='image']")
      || document.querySelector("input[type='file']");
    if (!input) {
      return false;
    }

    const transfer = new DataTransfer();
    for (const image of images) {
      const blob = dataUrlToBlob(image.dataUrl);
      transfer.items.add(new File([blob], image.fileName, {
        type: image.type || blob.type,
        lastModified: Date.now()
      }));
    }

    // The file input and the drop zone both hand files to the same uploader, so
    // only use one of them to avoid duplicate uploads.
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const uploadStarted = await waitFor(
      () => document.querySelector("[aria-label$='wird hochgeladen'], [aria-label='Bild entfernen'], #ad-images-error"),
      10000
    );
    return Boolean(uploadStarted) && !document.querySelector("#ad-images-error");
  }

  function setFieldValue(field, value) {
    if (!field) {
      throw new Error("Ein erforderliches Formularfeld wurde nicht gefunden.");
    }
    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    // Clear first so React sees a change even if the DOM already holds the value.
    setter?.call(field, "");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    field.dispatchEvent(new FocusEvent("blur"));
  }

  async function waitFor(predicate, timeout, interval = 100) {
    const deadline = Date.now() + timeout;
    while (true) {
      const result = predicate();
      if (result) {
        return result;
      }
      if (Date.now() >= deadline) {
        return null;
      }
      await waitForDomUpdate(interval);
    }
  }

  function waitForDomUpdate(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  function dataUrlToBlob(dataUrl) {
    const [header, encoded] = dataUrl.split(",", 2);
    const type = header.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
    const binary = header.includes(";base64") ? atob(encoded) : decodeURIComponent(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type });
  }

  function normalizeLabel(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
})();
