# Bursdagsbingo (live)

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
