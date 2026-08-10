# Spine Frame Exporter

Aplikacja webowa do eksportowania klatek animacji z plików Spine (`.json`).

## Funkcje

- Import wielu plików `.json` jednocześnie
- Osobny folder w ZIP dla każdego JSON
- Wybór nazwy klatek (wzorzec lub własny)
- Skala klatek i rozmiar canvasu
- Wybór animacji źródłowej
- Eksport tylko pierwszej (początkowej) klatki
- Lokalizacja assetów: folder obrazów PNG **albo** `.atlas` + tekstury

## Wymagania

- Eksport Spine **4.x**
- Typowe setupy:
  - JSON + folder `images/` (bez atlasu)
  - JSON + `.atlas` + PNG (spakowany atlas)
- Przeglądarka z WebGL

## Uruchomienie

```bash
npm install
npm run dev
```

Build produkcyjny:

```bash
npm run build
npm run preview
```

## Użycie

1. Zaimportuj jeden lub wiele plików `.json`
2. Wskaż folder z obrazami PNG (lub atlasem)
3. Dla każdego JSON wybierz animację
4. Ustaw canvas, skalę, FPS / pierwszą klatkę oraz nazewnictwo
5. Kliknij **Eksportuj klatki (ZIP)**

Placeholdery nazw: `{name}`, `{anim}`, `{frame}`, `{####}`, `{index}`.
