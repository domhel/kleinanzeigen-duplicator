# Kleinanzeigen Inserat-Duplikator

Chrome Extension (Manifest V3), die Daten und Bilder eines bestehenden
Kleinanzeigen-Inserats lokal speichert und in ein neues Inserat einfügt.

## Installation

1. `chrome://extensions` in Chrome öffnen.
2. Den **Entwicklermodus** aktivieren.
3. **Entpackte Erweiterung laden** wählen und diesen Projektordner auswählen.
4. Bereits geöffnete Kleinanzeigen-Tabs einmal neu laden.

## Verwendung

1. Ein eigenes Inserat unter `kleinanzeigen.de/s-anzeige/...` öffnen.
2. Die Erweiterung öffnen und **Inserat duplizieren** wählen.
3. Die Erweiterung kopiert das Inserat, öffnet einen neuen Tab und füllt das neue
  Inserat automatisch aus.
4. Kategorie, Versand, Bilder und alle weiteren Angaben kontrollieren, bevor das
   Inserat veröffentlicht wird.

Die kopierten Daten einschließlich der Bilder bleiben ausschließlich in
`chrome.storage.local`. Beim nächsten Kopieren werden sie ersetzt.

## Hinweise

- Kleinanzeigen kann sein DOM jederzeit ändern. Die Erweiterung verwendet mehrere
  semantische Selektoren und meldet Felder, die nicht sicher gesetzt werden konnten.
- Browser blockieren mitunter programmgesteuerte Dateiübergaben, wenn eine Seite
  zusätzliche Sicherheitsprüfungen nutzt. In diesem Fall müssen Bilder manuell
  hochgeladen werden.
- Die Erweiterung veröffentlicht kein Inserat automatisch.