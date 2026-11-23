(() => {
  const LISTING_PATH = "/s-anzeige/";
  const extensionApi = globalThis.browser ?? globalThis.chrome;
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

  async function copyListing() {
    if (!location.pathname.startsWith(LISTING_PATH)) {
      throw new Error("Bitte ein einzelnes Inserat öffnen.");
    }

    const listing = scrapeListing();
    const response = await extensionApi.runtime.sendMessage({ action: "SAVE_LISTING", listing });
    if (!response?.ok) {
      throw new Error(response?.error || "Das Inserat konnte nicht gespeichert werden.");
    }

    return {
      ok: true,
      message: `Inserat mit ${response.imageCount} Bild${response.imageCount === 1 ? "" : "ern"} kopiert.`
    };
  }

  function scrapeListing() {
    const structuredData = findProductData();
    const title = readText([
      "#viewad-title",
      "[data-testid='ad-title']",
      "main h1"
    ]) || structuredData?.name || "";
    const description = readDescription() || structuredData?.description || "";
    const priceText = readText([
      "#viewad-price",
      "[data-testid='ad-price']",
      "[class*='price']"
    ]) || String(structuredData?.offers?.price || "");
    const categoryPath = readCategoryPath();
    const imageUrls = readImageUrls(structuredData);

    if (!title || !description) {
      throw new Error("Titel oder Beschreibung wurden auf dieser Seite nicht gefunden.");
    }

    return {
      sourceUrl: location.href,
      title,
      description,
      price: {
        value: parsePrice(priceText),
        type: detectPriceType(priceText),
        raw: priceText
      },
      categoryPath,
      details: readDetails(),
      shipping: readShipping(),
      imageUrls
    };
  }

  // Category-specific details such as "Marke: Apple" or "Zustand: Gut", shown
  // as one list item per detail with the value in the last element.
  function readDetails() {
    return [...document.querySelectorAll("#viewad-details li")]
      .map((item) => {
        const value = item.lastElementChild?.textContent.replace(/\s+/g, " ").trim() || "";
        const text = item.textContent.replace(/\s+/g, " ").trim();
        const label = text.endsWith(value) ? text.slice(0, text.length - value.length).trim() : "";
        return { label, value };
      })
      .filter((detail) => detail.label && detail.value);
  }

  function findProductData() {
    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        const value = JSON.parse(script.textContent);
        const product = findTypedNode(value, new Set(["Product"]));
        if (product) {
          return product;
        }
      } catch {
        // Ignore unrelated or malformed structured data blocks.
      }
    }
    return null;
  }

  function findTypedNode(value, types) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const nodeTypes = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (nodeTypes.some((type) => types.has(type))) {
      return value;
    }
    for (const child of Object.values(value)) {
      const result = findTypedNode(child, types);
      if (result) {
        return result;
      }
    }
    return null;
  }

  function readText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = element?.innerText?.trim();
      if (text) {
        return text;
      }
    }
    return "";
  }

  function readDescription() {
    const selectors = [
      "#viewad-description-text",
      "[data-testid='ad-description']",
      "[itemprop='description']"
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return (element.innerText || element.textContent || "")
          .replace(/\r\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
    }
    return "";
  }

  function parsePrice(text) {
    if (/zu verschenken/i.test(text)) {
      return 0;
    }
    const match = text.match(/\d[\d.\s]*/);
    return match ? Number.parseInt(match[0].replace(/\D/g, ""), 10) : null;
  }

  function detectPriceType(text) {
    if (/zu verschenken|verschenken/i.test(text)) {
      return "GIVE_AWAY";
    }
    if (/\bVB\b|verhandlungsbasis/i.test(text)) {
      return "NEGOTIABLE";
    }
    return "FIXED";
  }

  function readCategoryPath() {
    const containers = [
      "#vap-brdcrmb",
      "[itemtype*='BreadcrumbList']",
      "#viewad-breadcrumb",
      "[data-testid='breadcrumbs']",
      "nav[aria-label*='readcrumb' i]"
    ];
    for (const selector of containers) {
      const container = document.querySelector(selector);
      if (!container) {
        continue;
      }
      const parts = [...container.querySelectorAll("a, li, [itemprop='name']")]
        .map((element) => element.textContent.trim())
        .filter((part) => part && !/kleinanzeigen|startseite/i.test(part));
      const uniqueParts = [...new Set(parts)];
      if (uniqueParts.length) {
        return uniqueParts;
      }
    }
    return [];
  }

  function readShipping() {
    const selectors = [
      // The shipping note ("Nur Abholung", "Versand möglich", …) sits next to the price.
      "#viewad-price ~ *",
      "[data-testid*='shipping' i]",
      "#viewad-details-shipping",
      "[class*='shipping' i]"
    ];
    const lines = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        // Similar ads further down the page carry their own shipping notes.
        if (element.closest("#vip-similar-ads-list, [id*='similar' i]")) {
          continue;
        }
        const text = element.innerText?.replace(/\s+/g, " ").trim();
        if (text && /versand|abholung|lieferung/i.test(text)) {
          lines.push(text);
        }
      }
      if (lines.length) {
        break;
      }
    }
    const options = [...new Set(lines)];
    const combined = options.join(" · ");
    const costMatch = combined.match(/(\d+[,.]\d{2})\s*€/);
    return {
      enabled: /versand|lieferung/i.test(combined),
      options,
      cost: costMatch ? Number.parseFloat(costMatch[1].replace(",", ".")) : null
    };
  }

  function readImageUrls(structuredData) {
    const galleryUrls = readGalleryImageUrls();
    if (galleryUrls.length) {
      return normalizeImageUrls(galleryUrls);
    }

    const urls = [];
    const gallerySelectors = [
      "[data-testid*='gallery' i] a[href]",
      "[data-testid*='gallery' i] img",
      "img#viewad-image",
      "#viewad-image img",
      "#viewad-image source",
      "[class*='gallery' i] img",
      "[class*='gallery' i] source"
    ];

    for (const selector of gallerySelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const url = bestImageUrl(element);
        if (url) {
          urls.push(url);
        }
      }
    }

    const structuredImages = structuredData?.image;
    for (const image of Array.isArray(structuredImages) ? structuredImages : [structuredImages]) {
      const url = typeof image === "string" ? image : image?.url || image?.contentUrl;
      if (url) {
        urls.push(url);
      }
    }

    // og:image can be the generic Kleinanzeigen logo rather than an ad photo.
    const socialImage = document.querySelector("meta[property='og:image']")?.content;
    if (socialImage && !/logo/i.test(socialImage)) {
      urls.push(socialImage);
    }

    return normalizeImageUrls(urls);
  }

  // The gallery is an Astro island ("GalleryInBody") that renders every ad
  // photo as an <img>, the first one with id "viewad-image". Reading only inside
  // it keeps photos of similar ads on the same page out.
  function readGalleryImageUrls() {
    const gallery = document.querySelector("#viewad-image")?.closest("astro-island")
      || document.querySelector("astro-island[component-url*='Gallery' i]");
    if (!gallery) {
      return [];
    }
    return [...gallery.querySelectorAll("img, source")]
      .map(bestImageUrl)
      .filter(Boolean);
  }

  function normalizeImageUrls(urls) {
    const seen = new Set();
    return urls
      .map(toAbsoluteUrl)
      .filter(Boolean)
      .map(preferFullResolution)
      .filter((url) => {
        const key = imageIdentity(url);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function bestImageUrl(element) {
    if (element.matches("a[href]")) {
      const linkedImage = element.querySelector("img, source");
      if (isLikelyImageUrl(element.href)) {
        return element.href;
      }
      return linkedImage ? bestImageUrl(linkedImage) : null;
    }
    const srcset = element.getAttribute("srcset") || element.getAttribute("data-srcset");
    if (srcset) {
      return srcset
        .split(",")
        .map((candidate) => candidate.trim().split(/\s+/))
        .sort((left, right) => Number.parseInt(right[1], 10) - Number.parseInt(left[1], 10))[0]?.[0];
    }
    return element.currentSrc || element.getAttribute("data-src") || element.getAttribute("src");
  }

  function isLikelyImageUrl(url) {
    return /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(url)
      || /\/images?\//i.test(url)
      || /[?&]rule=\$_\d+/i.test(url);
  }

  function toAbsoluteUrl(url) {
    if (!url || url.startsWith("blob:")) {
      return null;
    }
    try {
      return new URL(url, location.href).href;
    } catch {
      return null;
    }
  }

  function preferFullResolution(url) {
    try {
      const parsed = new URL(url);
      const rule = parsed.searchParams.get("rule");
      if (/^\$_\d+\.(?:jpe?g|png|auto)$/i.test(rule || "")) {
        parsed.searchParams.set("rule", "$_57.JPG");
      }
      parsed.pathname = parsed.pathname.replace(/\$_\d+(?=\.(?:jpe?g|png)$)/i, "$_57");
      return parsed.href;
    } catch {
      return url;
    }
  }

  function imageIdentity(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`
        .replace(/\$_\d+(?=\.[a-z]+$)/i, "")
        .replace(/\/(?:thumbs?|small|medium)\//i, "/");
    } catch {
      return url;
    }
  }

  async function pasteListing() {
    if (!CREATE_PATHS.has(location.pathname)) {
      throw new Error("Bitte die Seite „Anzeige aufgeben“ öffnen.");
    }

    const response = await extensionApi.runtime.sendMessage({ action: "GET_LISTING" });
    if (!response?.ok) {
      throw new Error(response?.error || "Gespeichertes Inserat konnte nicht geladen werden.");
    }
    if (!response.listing) {
      throw new Error("Noch kein Inserat kopiert.");
    }

    const warnings = await fillListingForm(response.listing);
    const suffix = warnings.length ? ` ${warnings.join(" ")}` : "";
    return {
      ok: true,
      warnings,
      message: `Formular ausgefüllt. Bitte alle Angaben vor dem Veröffentlichen prüfen.${suffix}`
    };
  }

  const TITLE_SELECTORS = [
    "#ad-title",
    "#postad-title",
    "input[name='title']",
    "input[data-testid*='title' i]"
  ];
  const DESCRIPTION_SELECTORS = [
    "#ad-description",
    "#postad-description",
    "textarea[name='description']",
    "textarea[data-testid*='description' i]"
  ];

  async function fillListingForm(listing) {
    const warnings = [];
    const descriptionField = findField(DESCRIPTION_SELECTORS);

    await waitForFormReady(descriptionField, listing.description);

    setFieldValue(findField(TITLE_SELECTORS), listing.title);

    if (!listing.categoryPath.length) {
      warnings.push("Kategorie wurde im Original nicht erkannt.");
    } else if (!(await selectCategoryPath(listing.categoryPath))) {
      warnings.push("Kategorie bitte manuell wählen.");
    }

    // Detail fields only appear once a category is chosen.
    const details = listing.details || [];
    if (details.length) {
      const skipped = await fillDetails(details);
      if (skipped.length) {
        warnings.push(`Nicht übernommen: ${skipped.join(", ")}.`);
      }
    }

    if (descriptionField.value !== listing.description) {
      setFieldValue(descriptionField, listing.description);
    }

    if (listing.price.type !== "GIVE_AWAY" && listing.price.value !== null) {
      setFieldValue(findField([
        "#ad-price-amount",
        "input[name='priceAmount']",
        "#postad-price",
        "input[name='price']",
        "input[inputmode='numeric']"
      ]), String(listing.price.value));
    }

    if (!(await selectPriceType(listing.price.type))) {
      warnings.push("Preistyp bitte prüfen.");
    }

    // The form defaults to "Versand möglich", so an unknown shipping mode must be flagged.
    if (!listing.shipping.options.length || !(await selectShipping(listing.shipping))) {
      warnings.push("Versand bitte prüfen.");
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

  function findField(selectors) {
    for (const selector of selectors) {
      const field = [...document.querySelectorAll(selector)].find(isVisible);
      if (field) {
        return field;
      }
    }
    return null;
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

  async function selectPriceType(type) {
    const labels = {
      FIXED: ["Festpreis", "Fest"],
      NEGOTIABLE: ["VB", "Verhandlungsbasis"],
      GIVE_AWAY: ["Zu verschenken", "Verschenken"]
    }[type];

    const readPriceType = () => document.querySelector("input[name='priceType']")?.value;
    if (readPriceType() === type) {
      return true;
    }

    const combobox = document.querySelector("#ad-price-type[role='combobox']");
    if (combobox && isVisible(combobox)) {
      if (!(await chooseComboboxOption(combobox, labels))) {
        return false;
      }
      return Boolean(await waitFor(() => readPriceType() === type, 1500));
    }

    return selectLabeledControl(labels, ["priceType", "price-type", "price_type"]);
  }

  // Each detail field is labelled like the listing shows it ("Farbe", "Zustand")
  // via <label for="<key>">, e.g. key "handy_telekom.color", and keeps its value
  // in a hidden input "attributeMap[<key>]" that the form submits. The visible
  // control is a dropdown button, a searchable input, or a button opening a
  // dialog with radio buttons. Returns the labels of details that were not set.
  async function fillDetails(details) {
    if (!(await waitFor(() => document.querySelector("input[name^='attributeMap[']"), 5000))) {
      return details.map((detail) => detail.label);
    }
    const skipped = [];
    for (const detail of details) {
      const key = findDetailKey(detail.label);
      if (!key || !(await setDetail(key, detail.value))) {
        skipped.push(detail.label);
      }
    }
    return skipped;
  }

  function findDetailKey(label) {
    const target = compactLabel(label);
    for (const element of document.querySelectorAll("label[for]")) {
      // Required fields read "Marke*" followed by a screen-reader hint.
      if (compactLabel(element.textContent.split("*")[0]) === target) {
        const key = element.getAttribute("for");
        if (readDetailValue(key) !== undefined) {
          return key;
        }
      }
    }
    return null;
  }

  function readDetailValue(key) {
    return document.querySelector(`input[name="attributeMap[${CSS.escape(key)}]"]`)?.value;
  }

  async function setDetail(key, value) {
    const control = document.getElementById(key);
    let chosen = false;
    if (control?.matches("button[role='combobox']")) {
      chosen = await chooseComboboxOption(control, [value]);
    } else if (control?.matches("input[role='combobox']")) {
      chosen = await chooseSearchOption(control, value);
    } else if (!control) {
      chosen = await chooseDialogOption(key, value);
    } else if (control.matches("input, textarea")) {
      const isNumeric = control.inputMode === "numeric" || control.type === "number";
      setFieldValue(control, isNumeric ? value.replace(/[^\d,]/g, "") : value);
      chosen = true;
    }
    return chosen && Boolean(await waitFor(() => readDetailValue(key), 1500));
  }

  // Dropdown button whose options live in "<id>-menu". Options stay "invisible"
  // until the menu is positioned, so they are matched regardless.
  async function chooseComboboxOption(combobox, labels) {
    if (combobox.getAttribute("aria-expanded") !== "true") {
      combobox.click();
    }
    const option = await waitFor(() => findOption(`${combobox.id}-menu`, labels), 3000);
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
  async function chooseSearchOption(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    input.focus();
    input.click();
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const menuId = input.getAttribute("aria-controls") || `${input.id}-menu`;
    const option = await waitFor(() => findOption(menuId, [value]), 3000);
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
  async function chooseDialogOption(key, value) {
    const opener = document.querySelector(`input[name="attributeMap[${CSS.escape(key)}]"]`)
      ?.parentElement?.querySelector("button[aria-haspopup='dialog']");
    if (!opener) {
      return false;
    }
    opener.click();
    const dialog = await waitFor(() => [...document.querySelectorAll("dialog[open]")].find(isVisible), 3000);
    if (!dialog) {
      return false;
    }
    const findButton = (pattern) => [...dialog.querySelectorAll("button")]
      .find((button) => pattern.test(normalizeLabel(button.getAttribute("aria-label") || button.textContent)));
    const target = compactLabel(value);
    const radio = [...dialog.querySelectorAll("input[type='radio']")]
      .find((element) => compactLabel(element.labels?.[0]?.textContent) === target);
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

  function findOption(menuId, labels) {
    const targets = labels.map(compactLabel);
    const options = document.getElementById(menuId)?.querySelectorAll("[role='option']") || [];
    return [...options].find((option) => targets.includes(compactLabel(option.textContent))) || null;
  }

  // Ignores case, accents, spacing and punctuation: "Gut (85 – 94%)" → "gut8594".
  function compactLabel(value) {
    return normalizeLabel(value).replace(/[^a-z0-9]/g, "");
  }

  async function selectShipping(shipping) {
    const radio = await waitFor(
      () => document.querySelector(shipping.enabled ? "#ad-shipping-enabled-yes" : "#ad-shipping-enabled-no"),
      3000
    );
    if (radio) {
      if (!radio.checked) {
        radio.click();
      }
      return true;
    }
    const terms = shipping.enabled
      ? [...shipping.options, "Versand", "Lieferung"]
      : [...shipping.options, "Abholung"];
    return selectLabeledControl(terms, ["shipping", "delivery", "pickup", "versand"]);
  }

  function selectLabeledControl(terms, nameHints) {
    const normalizedTerms = terms.map(normalizeLabel);
    for (const control of document.querySelectorAll("input[type='radio'], input[type='checkbox']")) {
      const label = control.labels?.[0]?.innerText || control.closest("label")?.innerText || "";
      const controlIdentity = normalizeLabel(`${control.name} ${control.id}`);
      const controlChoice = normalizeLabel(`${control.value} ${label}`);
      const nameMatches = nameHints.some((hint) => controlIdentity.includes(normalizeLabel(hint)));
      const termMatches = normalizedTerms.some((term) => term && (
        controlChoice.includes(term)
        || term.includes(controlChoice)
        || significantWords(term).some((word) => controlChoice.includes(word))
      ));
      if (nameMatches && termMatches && !control.checked) {
        control.click();
        control.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      if (nameMatches && termMatches) {
        return true;
      }
    }
    return false;
  }

  function significantWords(value) {
    return value.split(" ").filter((word) => word.length >= 4 && !/^\d/.test(word));
  }

  // Entering the title makes Kleinanzeigen suggest categories as radio buttons
  // labelled with their breadcrumb, e.g. "Auto, Rad & Boot > Fahrräder & Zubehör".
  async function selectCategoryPath(path) {
    const parts = path.map(normalizeLabel);
    const suggestion = await waitFor(() => {
      const radios = document.querySelectorAll("input[type='radio'][name='category-suggestions']");
      return radios.length ? bestCategorySuggestion([...radios], parts) : null;
    }, 8000);
    if (suggestion) {
      if (!suggestion.checked) {
        suggestion.click();
      }
      await waitForDomUpdate(500);
      return true;
    }
    return isCategoryModalEnabled() && selectCategoryInModal(parts);
  }

  function bestCategorySuggestion(radios, parts) {
    const mostSpecific = parts[parts.length - 1];
    let best = null;
    let bestScore = 0;
    for (const radio of radios) {
      const label = normalizeLabel(radio.closest("label")?.textContent || radio.labels?.[0]?.textContent);
      if (!label.includes(mostSpecific)) {
        continue;
      }
      const score = parts.filter((part) => label.includes(part)).length;
      if (score > bestScore) {
        best = radio;
        bestScore = score;
      }
    }
    return best;
  }

  // Without the category modal, the category link submits the form to a separate
  // page, which would discard everything filled in so far.
  function isCategoryModalEnabled() {
    const props = document.querySelector("#ad-title")?.closest("astro-island")?.getAttribute("props") || "";
    return /"isCategoryPickerModalEnabled":\[0,true\]/.test(props);
  }

  async function selectCategoryInModal(parts) {
    const opener = document.querySelector("#ad-category-suggestions a");
    if (!opener) {
      return false;
    }
    opener.click();
    const dialog = await waitFor(() => document.querySelector("#category-search-input")?.closest("[role='dialog'], dialog"), 3000);
    if (!dialog) {
      return false;
    }

    const findButton = (text) => [...dialog.querySelectorAll("button")]
      .find((button) => normalizeLabel(button.querySelector("span.flex-1")?.textContent || button.textContent) === text);
    for (const part of parts) {
      const item = await waitFor(() => findButton(part), 3000);
      if (!item) {
        findButton("abbrechen")?.click();
        return false;
      }
      item.click();
      await waitForDomUpdate(300);
    }

    const confirm = findButton("ubernehmen");
    if (!confirm || confirm.disabled) {
      findButton("abbrechen")?.click();
      return false;
    }
    confirm.click();
    await waitForDomUpdate(500);
    return true;
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

  async function uploadImages(images) {
    const input = findFileInput([
      "main form input[type='file'][multiple][accept*='image']",
      "input[type='file'][accept*='image']",
      "input[type='file'][multiple]",
      "input[type='file']"
    ]);
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

  function findFileInput(selectors) {
    for (const selector of selectors) {
      const input = document.querySelector(selector);
      if (input) {
        return input;
      }
    }
    return null;
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
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
})();