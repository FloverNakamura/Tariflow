#!/usr/bin/env bash
set -e

# ─── Konfiguration ───────────────────────────────────────────────────────────
SOURCE_DIR="energie-kalkulationssuite/web-dashboard"
PARENT_DIR="energie-kalkulationssuite"

# ─── Schritt 1: Prüfe ob das Skript im richtigen Verzeichnis läuft ───────────
if [ ! -f "README.md" ] && [ ! -d ".git" ]; then
    echo "FEHLER: Bitte das Skript aus dem Hauptverzeichnis des Repositories ausführen."
    echo "       (da, wo sich README.md und .git/ befinden)"
    exit 1
fi

# ─── Schritt 2: Prüfe ob Quellordner existiert ───────────────────────────────
if [ ! -d "$SOURCE_DIR" ]; then
    echo "FEHLER: Ordner '$SOURCE_DIR' existiert nicht."
    echo "       Bitte überprüfe den Pfad und starte das Skript erneut."
    exit 1
fi

echo "✔ Quellordner '$SOURCE_DIR' gefunden."
echo ""

# ─── Schritt 3: Prüfe auf Konflikte im Zielverzeichnis ───────────────────────
KONFLIKT_GEFUNDEN=false
KONFLIKT_DATEIEN=()

while IFS= read -r -d '' datei; do
    # Relativer Pfad zur Datei (ohne SOURCE_DIR-Prefix)
    rel="${datei#$SOURCE_DIR/}"
    ziel="./$rel"
    if [ -e "$ziel" ]; then
        KONFLIKT_GEFUNDEN=true
        KONFLIKT_DATEIEN+=("$rel")
    fi
done < <(find "$SOURCE_DIR" -mindepth 1 -maxdepth 10 -print0)

if [ "$KONFLIKT_GEFUNDEN" = true ]; then
    echo "WARNUNG: Folgende Dateien/Ordner existieren bereits im Hauptverzeichnis:"
    for f in "${KONFLIKT_DATEIEN[@]}"; do
        echo "  - $f"
    done
    echo ""
    read -r -p "Sollen diese Dateien überschrieben werden? [j/N] " antwort
    case "$antwort" in
        [jJ][aA]|[jJ])
            echo "→ Dateien werden überschrieben."
            ;;
        *)
            echo "Abbruch. Keine Änderungen vorgenommen."
            exit 1
            ;;
    esac
    echo ""
fi

# ─── Schritt 4: Dateien verschieben ──────────────────────────────────────────
VERSCHOBENE_DATEIEN=()

echo "Verschiebe Dateien aus '$SOURCE_DIR/' ins Hauptverzeichnis..."
echo ""

# Alle Einträge (Dateien + Ordner) direkt im SOURCE_DIR verschieben
for eintrag in "$SOURCE_DIR"/.[!.]* "$SOURCE_DIR"/*; do
    # Globbing-Miss abfangen (falls kein Match)
    [ -e "$eintrag" ] || continue

    name="$(basename "$eintrag")"
    ziel="./$name"

    if [ -d "$eintrag" ]; then
        # Ordner: Inhalte zusammenführen (cp -r + rm -r statt mv, um Konflikte sauber zu behandeln)
        cp -r "$eintrag" "$ziel"
        rm -rf "$eintrag"
        VERSCHOBENE_DATEIEN+=("$name/ (Ordner)")
        echo "  [Ordner]  $SOURCE_DIR/$name  →  ./$name"
    else
        mv -f "$eintrag" "$ziel"
        VERSCHOBENE_DATEIEN+=("$name")
        echo "  [Datei]   $SOURCE_DIR/$name  →  ./$name"
    fi
done

echo ""

# ─── Schritt 5: Leere web-dashboard Ordner löschen ───────────────────────────
GELOESCHTE_ORDNER=()

if [ -d "$SOURCE_DIR" ]; then
    verbleibend=$(find "$SOURCE_DIR" -mindepth 1 | wc -l | tr -d ' ')
    if [ "$verbleibend" -eq 0 ]; then
        rmdir "$SOURCE_DIR"
        GELOESCHTE_ORDNER+=("$SOURCE_DIR")
        echo "✔ Leerer Ordner '$SOURCE_DIR' wurde gelöscht."
    else
        echo "HINWEIS: Ordner '$SOURCE_DIR' ist nicht leer ($(find "$SOURCE_DIR" -mindepth 1 | wc -l | tr -d ' ') Einträge verbleiben), wird nicht gelöscht."
    fi
fi

# ─── Schritt 6: Prüfe ob energie-kalkulationssuite leer ist ──────────────────
if [ -d "$PARENT_DIR" ]; then
    verbleibend_parent=$(find "$PARENT_DIR" -mindepth 1 | wc -l | tr -d ' ')
    if [ "$verbleibend_parent" -eq 0 ]; then
        rmdir "$PARENT_DIR"
        GELOESCHTE_ORDNER+=("$PARENT_DIR")
        echo "✔ Leerer Ordner '$PARENT_DIR' wurde ebenfalls gelöscht."
    else
        echo "HINWEIS: Ordner '$PARENT_DIR' enthält noch $(find "$PARENT_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ') Einträge und bleibt erhalten:"
        find "$PARENT_DIR" -mindepth 1 -maxdepth 1 | sed 's/^/  - /'
    fi
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ZUSAMMENFASSUNG"
echo "════════════════════════════════════════════════════════"
echo ""
echo "Verschobene Dateien/Ordner:"
for f in "${VERSCHOBENE_DATEIEN[@]}"; do
    echo "  ✔ $f"
done

echo ""
echo "Gelöschte Ordner:"
if [ ${#GELOESCHTE_ORDNER[@]} -eq 0 ]; then
    echo "  (keine)"
else
    for d in "${GELOESCHTE_ORDNER[@]}"; do
        echo "  ✔ $d"
    done
fi

echo ""
if [ -f "./index.html" ]; then
    echo "Neuer Pfad der index.html:"
    echo "  $(pwd)/index.html"
else
    echo "WARNUNG: index.html wurde nicht im Hauptverzeichnis gefunden!"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "  NÄCHSTE SCHRITTE (git)"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  git add -A"
echo "  git commit -m \"refactor: web-dashboard ins Stammverzeichnis verschoben (Netlify Deploy)\""
echo "  git push"
echo ""
echo "Danach in Netlify unter:"
echo "  Site settings → Build & deploy → Publish directory"
echo "  den Wert auf  \".\"  (Punkt) oder leer lassen."
echo ""
