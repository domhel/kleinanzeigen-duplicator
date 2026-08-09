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
      shipping: readShipping(),
      imageUrls
    };
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
      "[data-testid*='shipping' i]",
      "#viewad-details-shipping",
      "[class*='shipping' i]"
    ];
    const lines = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
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
    const urls = [];
    const gallerySelectors = [
      "[data-testid*='gallery' i] a[href]",
      "[data-testid*='gallery' i] img",
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

    const socialImage = document.querySelector("meta[property='og:image']")?.content;
    if (socialImage) {
      urls.push(socialImage);
    }

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
      if (/^\$_\d+\.(?:jpe?g|png)$/i.test(rule || "")) {
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

  async function fillListingForm(listing) {
    const warnings = [];

    if (!listing.categoryPath.length) {
      warnings.push("Kategorie wurde im Original nicht erkannt.");
    } else if (!(await selectCategoryPath(listing.categoryPath))) {
      warnings.push("Kategorie bitte manuell wählen.");
    }

    setFieldValue(findField([
      "#ad-title",
      "#postad-title",
      "input[name='title']",
      "input[data-testid*='title' i]"
    ]), listing.title);
    await waitForDomUpdate(300);

    setFieldValue(findField([
      "#ad-description",
      "#postad-description",
      "textarea[name='description']",
      "textarea[data-testid*='description' i]"
    ]), listing.description);

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

    if (listing.shipping.options.length && !selectShipping(listing.shipping)) {
      warnings.push("Versand bitte prüfen.");
    }

    if (listing.images.length && !uploadImages(listing.images)) {
      warnings.push("Bilder konnten nicht eingefügt werden.");
    }

    return warnings;
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
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function selectPriceType(type) {
    const labels = {
      FIXED: ["Festpreis", "Fest"],
      NEGOTIABLE: ["VB", "Verhandlungsbasis"],
      GIVE_AWAY: ["Zu verschenken", "Verschenken"]
    }[type];

    const priceTypeInput = document.querySelector("input[name='priceType']");
    if (priceTypeInput?.value === type) {
      return true;
    }

    const combobox = document.querySelector("#ad-price-type[role='combobox']");
    if (combobox && isVisible(combobox)) {
      combobox.click();
      for (const label of labels) {
        const option = await waitForTextOption(label, 1500);
        if (option) {
          option.click();
          await waitForDomUpdate(100);
          return true;
        }
      }
      return false;
    }

    return selectLabeledControl(labels, ["priceType", "price-type", "price_type"]);
  }

  function selectShipping(shipping) {
    const terms = [...shipping.options, "Versand", "Lieferung", "Abholung"];
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

  async function selectCategoryPath(path) {
    const opener = findClickableBySelectors([
      "#ad-category-suggestions a",
      "[data-testid*='category' i] button",
      "button[id*='category' i]",
      "button[name*='category' i]"
    ]);
    if (!opener) {
      return false;
    }
    opener.click();

    let selected = 0;
    for (const part of path) {
      const option = await waitForTextOption(part, 1500);
      if (!option) {
        continue;
      }
      option.click();
      selected += 1;
      await waitForDomUpdate(200);
    }
    return selected === path.length;
  }

  function findClickableBySelectors(selectors) {
    for (const selector of selectors) {
      const element = [...document.querySelectorAll(selector)].find(isVisible);
      if (element) {
        return element;
      }
    }
    return null;
  }

  async function waitForTextOption(text, timeout) {
    const findOption = () => {
      const target = normalizeLabel(text);
      const candidates = document.querySelectorAll("button, [role='option'], [role='menuitem'], label, li a");
      return [...candidates].find((element) => isVisible(element) && normalizeLabel(element.textContent) === target) || null;
    };
    const existing = findOption();
    if (existing) {
      return existing;
    }
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const option = findOption();
        if (option) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(option);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function waitForDomUpdate(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  function uploadImages(images) {
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

    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const dropZone = input.closest("[data-testid*='drop' i], [class*='dropzone' i], .border-dashed")
      || input.parentElement;
    if (dropZone) {
      dropZone.dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
    }
    return true;
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