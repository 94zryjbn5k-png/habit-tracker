# Plán check-inu — návod pro úpravu

Soubor `checkin-plans.json` ve větvi **`data`** řídí, jak vypadá záložka Check-in v aplikaci
a jak vypadá text, který se kopíruje trenérovi. Aplikace si ho sama stahuje (při startu,
při otevření Check-inu a každých 10 minut), takže po commitu se změna projeví bez zásahu uživatele.

## Nejdůležitější pravidlo

**Nikdy nemazat ani neupravovat starší plány.** Každý plán platí od svého `from` (pondělí)
do začátku dalšího plánu. Minulé týdny se vykreslují i exportují podle plánu, který tehdy platil,
takže historie zůstává přesná. Nový blok = **přidat další položku do pole `plans`**, nic jiného.

Data uživatele (`habit-tracker.json`) se nikdy nepřepisují změnou plánu. Aplikace uchová i hodnoty
cviků, které z plánu zmizely — jen je přestane zobrazovat.

## Struktura

```json
{
  "plans": [
    {
      "from": "2026-09-21",
      "name": "Blok 2 — síla",
      "topics": [ ... ],
      "export": [ ... ]
    }
  ]
}
```

### `topics` — co appka ukáže jako otázky

Každé téma je jedna karta průvodce. Uživatel jimi prochází tlačítkem „Další".

```json
{
  "id": "ex-hip",
  "day": 2,
  "icon": "dumbbell",
  "title": "Hip thrust",
  "sub": "Síla · Lower A",
  "fields": [
    { "p": "strength.hip.w",   "q": "Váha (kg)",        "kind": "num",  "ph": "100" },
    { "p": "strength.hip.r",   "q": "Opakování sérií",  "kind": "txt",  "ph": "10/9/8" },
    { "p": "strength.hip.rir", "q": "RIR",              "kind": "num",  "ph": "2" }
  ]
}
```

- `day`: 0 = pondělí … 6 = neděle
- `icon`: `dumbbell`, `run`, `waves`, `moon`, `target2`, `heart`, `clipboard`, `book`, `bed`, `plane`, `check2`
- `fields[].kind`:
  - `num` — číselné pole (váha, RIR, tep)
  - `txt` — krátký text (např. `10/9/8`)
  - `text` — víceřádkové pole (pocit, poznámka)
  - `chips` — tlačítkové volby, vyžaduje `vals`, např. `"vals": ["pás", "venku"]`
- `fields[].p` je **cesta, kam se hodnota uloží**. Používej stejné cesty pro stejnou věc napříč bloky,
  ať jde progres porovnávat v čase (např. dřep zůstane `strength.sq.*`, i když se změní série).

### `export` — text pro trenéra

Pole řádků. V každém řádku lze použít zástupné značky:

- `{no}` — číslo týdne (počítá se automaticky od 3. 8. 2026)
- `{cesta}` nebo `{cesta|náhrada}` — hodnota pole; když je prázdné, doplní se náhrada
  (např. `St: {weight.st|__}` nebo `Co + 0–10 + kdy: {pain.note|nic}`)
- `{s:klic}` — složí sílu do jedné věty z `strength.klic.w`, `.r`, `.rir` → `90: 8/8/8, RIR 2`;
  když je vše prázdné, vypíše `__`

Prázdný řetězec `""` znamená prázdný řádek.

## Postup při změně plánu (typicky v neděli)

1. Stáhni aktuální `checkin-plans.json` z větve `data`.
2. **Přidej** novou položku do `plans` s `from` = pondělí, odkdy má platit (formát `YYYY-MM-DD`).
3. Commitni zpět do větve `data` (Contents API, stejný soubor, se `sha` z kroku 1).
4. Hotovo — aplikace si plán stáhne sama.

## Kam se dívat na data

- Data uživatele: `habit-tracker.json` ve větvi `data` (jen číst; zapisuje je aplikace).
- Historie check-inů je v `checkins["<pondělí týdne>"]`, sestavená podle cest z plánu.

### Zadani a predvyplneni

- `topics[].pre` — text zadani, ktery se uzivateli ukaze nahore v karte (co ma ten den odcvicit).
- `fields[].kind: "sets"` + `"sets": 4` — misto jedne kolonky se vykresli kolonka na kazdou serii
  (`strength.klic.s1` … `s4`). Do exportu je slozi `{s:klic}` jako `60: 12/11/10/9, RIR 2`.
- Tlacitko "Vyplnit podle zadani" predvyplni prazdne kolonky. Hodnoty bere:
  1. z `fields[].def` (jedna hodnota) nebo `fields[].defs` (pole hodnot pro jednotlive serie),
  2. jinak je odvodi z textu `pre` — `po 8-10` -> 8, `RIR 2` -> 2, `26 kg` -> 26.
  Co uz uzivatel zapsal, tlacitko nikdy neprepise.

Priklad cviku se ctyrmi seriemi a presnym zadanim:

```json
{
  "id": "ex-row", "day": 0, "icon": "dumbbell", "title": "Chest-supported row",
  "pre": "4 serie po 10-12 opakovanich · RIR 2 · vaha 60 kg",
  "fields": [
    { "p": "strength.row.w",   "q": "Vaha (kg)", "kind": "num",  "def": "60" },
    { "p": "strength.row",     "q": "Opakovani jednotlivych serii", "kind": "sets", "sets": 4, "defs": ["12","12","11","10"] },
    { "p": "strength.row.rir", "q": "RIR posledni serie", "kind": "num", "def": "2" }
  ]
}
```

### Cviky bez vah (jen odskrtnuti)

Pro cviky, kde se nezapisuji vahy ani opakovani (core, mobilita, rozcvicka, doplnky na konci treninku),
pouzij pole `"kind": "done"`. Vykresli se jako velke tlacitko, ktere Jan jednim tuknutim odskrtne.
Do jedne karty jich muzes dat kolik chces - projdou se na jedne strance.

```json
{
  "id": "extras-a", "day": 0, "icon": "dumbbell", "title": "Doplnky na konec",
  "pre": "Po hlavni casti, bez vah.",
  "fields": [
    { "p": "extras.plank.done",    "q": "Plank 3x45 s",            "kind": "done" },
    { "p": "extras.deadbug.done",  "q": "Dead bug 3x10",           "kind": "done" },
    { "p": "extras.calf.done",     "q": "Vypony na schodu 2x20",   "kind": "done" }
  ]
}
```

V exportu se hodnota vypise jako `v` (fajfka) kdyz je splneno; pouzij fallback pro nesplneno:
`- plank: {extras.plank.done|-}`

Cesty zacinajici `extras.` se v aplikaci pocitaji jako soucast siloveho treninku, takze odskrtnuti
doplnku take odskrtne navyk "Silovy trenink" v zalozce Dnes.
