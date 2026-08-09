const STORAGE_KEY = "copiedListing";
const CREATE_LISTING_URL = "https://www.kleinanzeigen.de/p-anzeige-aufgeben-schritt2.html";
const extensionApi = globalThis.browser ?? globalThis.chrome;

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "SAVE_LISTING") {
    saveListing(message.listing)
      .then((listing) => sendResponse({ ok: true, imageCount: listing.images.length }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === "GET_LISTING") {
    extensionApi.storage.local.get(STORAGE_KEY)
      .then((result) => sendResponse({ ok: true, listing: result[STORAGE_KEY] || null }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === "CLEAR_LISTING") {
    extensionApi.storage.local.remove(STORAGE_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === "OPEN_AND_PASTE_LISTING") {
    openAndPasteListing()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function openAndPasteListing() {
  const tab = await extensionApi.tabs.create({
    url: CREATE_LISTING_URL,
    active: false
  });

  if (!tab.id) {
    throw new Error("Der neue Tab konnte nicht geöffnet werden.");
  }

  try {
    const response = await sendMessageWhenReady(tab.id, { action: "PASTE_LISTING" });
    if (!response?.ok) {
      throw new Error(response?.error || "Das Formular konnte nicht ausgefüllt werden.");
    }

    await extensionApi.tabs.update(tab.id, { active: true });
    return response;
  } catch (error) {
    throw new Error(`Der neue Tab wurde geöffnet, aber nicht ausgefüllt: ${error.message}`);
  }
}

async function sendMessageWhenReady(tabId, message) {
  const deadline = Date.now() + 20000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await extensionApi.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw lastError || new Error("Zeitüberschreitung beim Laden des Formulars.");
}

function delay(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function saveListing(listing) {
  if (!listing?.title || !listing?.description) {
    throw new Error("Titel oder Beschreibung konnten nicht gelesen werden.");
  }

  const images = [];
  for (const [index, url] of listing.imageUrls.entries()) {
    images.push(await downloadImage(url, index));
  }

  const storedListing = {
    ...listing,
    imageUrls: undefined,
    images,
    copiedAt: new Date().toISOString()
  };

  await extensionApi.storage.local.set({ [STORAGE_KEY]: storedListing });
  return storedListing;
}

async function downloadImage(url, index) {
  if (url.startsWith("data:")) {
    const response = await fetch(url);
    const blob = await response.blob();
    return {
      dataUrl: url,
      fileName: createFileName(url, blob.type, index),
      type: blob.type || "image/jpeg"
    };
  }

  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Bild ${index + 1} konnte nicht geladen werden (${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`Bild ${index + 1} lieferte keinen gültigen Bildinhalt.`);
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    fileName: createFileName(url, blob.type, index),
    type: blob.type
  };
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}

function createFileName(url, mimeType, index) {
  const extensionByType = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  const extension = extensionByType[mimeType] || "jpg";

  try {
    const pathName = new URL(url).pathname;
    const sourceName = decodeURIComponent(pathName.split("/").pop() || "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .slice(0, 60);
    return `${String(index + 1).padStart(2, "0")}-${sourceName || "anzeige"}.${extension}`;
  } catch {
    return `${String(index + 1).padStart(2, "0")}-anzeige.${extension}`;
  }
}