# ARES-Reflect · Terminal Placement System

ARES-Reflect, TEKNOFEST Mobil Uydu Terminali yarismasi icin gelistirilmis bir afet haberlesmesi yerlesim aracidir. Sistem, depremzedeleri ve enkaz binalarini harita uzerinde isaretledikten sonra:

- 3 terminal bolgesi cikarir,
- bu 3 terminali tek tek degil birlikte optimize eder,
- her terminal icin fiziksel olarak gecerli 1-3 IRS onerir,
- bina blokajini cizgilerle dogrular,
- yerlesim sonucunu acik Turkce ile aciklar.

## Hızlı baslangic

```bash
npm install
npm run dev
```

Uygulama temel yerlesim analizini tamamen yerel olarak calistirir. Gemini yalnizca aciklama ve gorsel dogrulama icin istege baglidir.

```bash
npm run build
npm run preview
```

## Davranis ozeti

1. `Depremzede Ekle` ile depremzede ekleyin.
2. `Enkaz Sec` ile cokmus binalari isaretleyin.
3. Gerekirse `Kaldir` modu ile depremzede veya enkaz isaretini silin.
4. En az 3 depremzede ve 1 enkaz oldugunda `Analiz Et` aktif olur.
5. Sonuclar once yerel motorla gelir; Gemini varsa aciklamalar sonradan iyilestirilir.

## Mimari

### Yerlesim motoru

- `src/lib/algorithm.js`
  - deterministik k-means ile 3 bolge cikarir
  - terminalleri IRS setleriyle birlikte ve birbirlerinden ayri kalacak sekilde ortak optimize eder
  - IRS adaylari geometri-temelli uretilir
  - `terminal -> IRS` ve `IRS -> depremzede` hatlarinda sadece ayakta binalar engel sayilir
  - 3 zorunlu gostermek yerine en iyi gecerli 1-3 IRS setini secer

### Gemini rolu

- `src/lib/gemini.js`
  - konum secmez
  - `gemini-3.5-flash` kullanir
  - gecerli yerel cozumleri sadece sunum sirasi icin rerank eder
  - aciklama uretir
  - istege bagli gorsel dogrulama yapar

### UI

- `src/components/Map.jsx`
  - harita cizgileri ile ayni bina blokaj kuralini gosterir
  - `Kaldir` modunu destekler

## Ortam degiskeni

Gemini kullanmak isterseniz:

```bash
VITE_GEMINI_API_KEY=...
```

Anahtar verilmezse uygulama yerel modda eksiksiz calisir.
