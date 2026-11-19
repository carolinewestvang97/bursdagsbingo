# Bursdagsbingo + Quiz (live)

To leker i samme server:
- Bingo:  `/`  (storskjerm: `/#storskjerm`)
- Quiz:   `/quiz`  (storskjerm: `/quiz#storskjerm`)

## Quiz
1. Åpne `/quiz#storskjerm` på storskjermen. Der står adressen og rundekoden.
2. Hvert lag (3–4 personer) deler én telefon, åpner `/quiz`, skriver lagnavn + kode.
3. Du starter quizen (knappen, eller mellomrom). Spørsmålet vises på storskjermen og på telefonene.
4. Lagene svarer (trykker på alternativ, eller skriver svaret). Når alle har svart, trykker du «Vis svar» (mellomrom).
5. Fasit vises, og maskinen retter svarene (tåler småfeil som «vombat»/«wombat»). Du kan trykke ✓/✗ ved et lag for å overstyre.
6. «Neste spørsmål» (mellomrom). Poengtavlen oppdateres underveis, og til slutt kommer sluttresultatet.
7. «Start på nytt» nullstiller poengene og tar alle tilbake til lobbyen.

### Rediger spørsmålene
Alt ligger i `questions.json`. Der kan du endre, legge til og fjerne spørsmål.
- `type: "choice"` = flervalg. `correct` er en liste med riktige alternativer, talt fra 0 (`[0, 3]` = første og fjerde).
- `type: "text"` = fritekst. `accept` er godkjente svar. `regex` er valgfritt. `answerText` vises som fasit.
- `"todo": true` betyr at spørsmålet hoppes over. De to «2 sannheter og en løgn»-spørsmålene ligger der med `todo`.
  Fyll inn påstandene og fjern linjen `"todo": true` (og sett `correct` til nummeret på løgnen).
Husk å deploye på nytt etter at du har endret filen.

---

# Bingo

Slik spilles en runde:
1. Åpne `/#storskjerm` – der står rundekoden. Gjestene åpner lenken og skriver inn navn + kode.
2. Første som får 4 på rad roper bingo automatisk. Alle brett fryses (grået ut), og du får en gul knapp på storskjermen.
3. Trykk på knappen, se svarene, og trykk Godkjenn eller Avslå.
   - Avslag: spillet fortsetter, og personen kan rette opp og rope igjen.
   - Godkjent: personen får 👑 og spillet fortsetter mot «hele brettet».
4. Samme prosess for hele brettet. Når begge er godkjent er runden over, og alle ser vinnerne.
5. «Ny runde» på storskjermen nullstiller brettene til alle.

Liten Node-server (ingen avhengigheter) som viser bingosiden og holder styr på spillerne i sanntid.

## Kjør lokalt
    npm start        # åpner på http://localhost:3000
Storskjerm: http://localhost:3000/#storskjerm

## Legg ut gratis (Render)
1. Legg mappen i et nytt GitHub-repo (github.com/new → last opp filene).
2. På render.com: New → Web Service → velg repoet.
3. Runtime: Node. Build Command: `npm install`. Start Command: `npm start`. Plan: Free.
4. Når den er ferdig får du en lenke, f.eks. https://bursdagsbingo.onrender.com
   - Gjester: lenken. Storskjerm: lenken + `#storskjerm`.

Gratisnivået sovner etter en stund uten trafikk og bruker ca. ett minutt på å våkne.
Åpne storskjermen en halvtime før gjestene kommer. Rundene ligger i minnet, så de nullstilles hvis serveren restarter.
Fungerer også på Railway, Fly.io og lignende. Vercel og andre «serverless»-tjenester passer ikke, fordi serveren må holde tilkoblinger åpne.
