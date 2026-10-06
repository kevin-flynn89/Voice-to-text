# VoiceToText V3 — GitHub Pages Ready

1. Crea un repository GitHub pubblico.
2. Carica tutto il contenuto di questa cartella nella root.
3. Vai in **Settings → Pages**.
4. Seleziona **GitHub Actions**.
5. Fai push sul branch `main`: il workflow compilerà e pubblicherà automaticamente la PWA.
6. URL: `https://TUO-USERNAME.github.io/NOME-REPOSITORY/`

La configurazione Vite usa `base: "./"` per funzionare su GitHub Pages anche in un repository con sottopercorso.

La PWA include Web Share Target: dopo l'installazione su Android puoi usare **WhatsApp → Condividi → VoiceToText**.

Nessun backend proprietario e nessuna API key. I modelli AI vengono scaricati al primo utilizzo e l'inferenza avviene localmente.
