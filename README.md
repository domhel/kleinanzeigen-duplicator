# Kleinanzeigen Inserat-Duplikator

Browser-Erweiterung für Chrome und Firefox (Manifest V3), die Daten und Bilder eines bestehenden
Kleinanzeigen-Inserats lokal speichert und in ein neues Inserat einfügt.

Unterstützt werden Chrome ab Version 121 und Firefox ab Version 140.

## Installation in Chrome

1. `chrome://extensions` in Chrome öffnen.
2. Den **Entwicklermodus** aktivieren.
3. **Entpackte Erweiterung laden** wählen und diesen Projektordner auswählen.
4. Bereits geöffnete Kleinanzeigen-Tabs einmal neu laden.

## Installation in Firefox

1. `about:debugging#/runtime/this-firefox` in Firefox öffnen.
2. **Temporäres Add-on laden** wählen.
3. Die Datei `manifest.json` aus diesem Projektordner auswählen.
4. Bereits geöffnete Kleinanzeigen-Tabs einmal neu laden.

Temporär geladene Firefox-Erweiterungen werden beim Beenden von Firefox entfernt
und müssen für die Entwicklung anschließend erneut geladen werden.

## Verwendung

1. Ein eigenes Inserat unter `kleinanzeigen.de/s-anzeige/...` öffnen.
2. Die Erweiterung öffnen und **Inserat duplizieren** wählen.
3. Die Erweiterung kopiert das Inserat, öffnet einen neuen Tab und füllt das neue
  Inserat automatisch aus – einschließlich der Details der Kategorie wie Marke,
  Modell, Farbe oder Zustand. Details, für die das Formular kein passendes Feld
  bietet, nennt die Erweiterung als „Nicht übernommen“.
4. Kategorie, Versand, Bilder und alle weiteren Angaben kontrollieren, bevor das
   Inserat veröffentlicht wird.

Die kopierten Daten einschließlich der Bilder bleiben ausschließlich in
der lokalen Erweiterungs-Speicherung des Browsers. Beim nächsten Kopieren werden
sie ersetzt.

## Hinweise

- Kleinanzeigen kann sein DOM jederzeit ändern. Die Erweiterung verwendet mehrere
  semantische Selektoren und meldet Felder, die nicht sicher gesetzt werden konnten.
- Browser blockieren mitunter programmgesteuerte Dateiübergaben, wenn eine Seite
  zusätzliche Sicherheitsprüfungen nutzt. In diesem Fall müssen Bilder manuell
  hochgeladen werden.
- Die Erweiterung veröffentlicht kein Inserat automatisch.