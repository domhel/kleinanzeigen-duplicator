const duplicateButton = document.querySelector("#duplicate-listing");
const statusElement = document.querySelector("#status");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const hostName = tab?.url ? new URL(tab.url).hostname : "";
  if (!tab?.id || (hostName !== "kleinanzeigen.de" && !hostName.endsWith(".kleinanzeigen.de"))) {
    throw new Error("Bitte zuerst eine Kleinanzeigen-Seite öffnen.");
  }
  return tab;
}

function setBusy(isBusy) {
  duplicateButton.disabled = isBusy;
}

function setStatus(message, type = "") {
  statusElement.textContent = message;
  statusElement.className = `status ${type}`.trim();
}

async function duplicateListing() {
  setBusy(true);
  setStatus("Inserat und Bilder werden kopiert …");

  try {
    const tab = await getActiveTab();
    const copyResponse = await chrome.tabs.sendMessage(tab.id, { action: "COPY_LISTING" });
    if (!copyResponse?.ok) {
      throw new Error(copyResponse?.error || "Das Inserat konnte nicht kopiert werden.");
    }

    setStatus("Neues Inserat wird geöffnet und ausgefüllt …");
    const pasteResponse = await chrome.runtime.sendMessage({ action: "OPEN_AND_PASTE_LISTING" });
    if (!pasteResponse?.ok) {
      throw new Error(pasteResponse?.error || "Das neue Inserat konnte nicht ausgefüllt werden.");
    }
    setStatus(pasteResponse.message, pasteResponse.warnings?.length ? "" : "success");
  } catch (error) {
    const message = error.message.includes("Receiving end does not exist")
      ? "Seite neu laden, damit die Erweiterung aktiv wird."
      : error.message;
    setStatus(message, "error");
  } finally {
    setBusy(false);
  }
}

duplicateButton.addEventListener("click", duplicateListing);