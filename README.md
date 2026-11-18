# Bursdagsbingo (live)

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
