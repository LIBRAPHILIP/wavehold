# How to demo Wavehold

Network: Studionet, chain 61999. RPC `https://studio.genlayer.com/api`. Explorer `https://explorer-studio.genlayer.com`.

## In the app

1. Open the deployed site, or run `npm run dev` and open the local URL.
2. Leave the network on Studionet.
3. Click **Ephemeral account**. The page funds it with `sim_fundAccount`.
4. Authority: **Steam VAC flag**.
5. Game: `Friday cup`. Roster: a 17-digit SteamID64. Payee: the ephemeral address. Check **Demo hold of 120 seconds**. Prize: `0.05`.
6. Click **Open purse**. Wait until the transaction panel says accepted and the desk shows `OPEN`.
7. Click **Lock baseline**. This is the slow step. Validators fetch `https://steamcommunity.com/profiles/<id>/?xml=1`.
8. The desk should show `vacBanned` as 0 or 1, and the source link should be that XML URL.
9. After the hold, click **Release**. A clean re-read moves the escrow to the payee and the status becomes `RELEASED` with basis `released_clean`.

A profile that is already VAC banned at lock still releases if the flag does not rise. That is the rule: the hold catches a new ban, not history.

## From the repo

```
npm install
npm test
python -m unittest tests.test_rules
npm run deploy:studionet
node scripts/verify-live.mjs --release
```

`verify-live.mjs` opens 0.02 GEN against SteamID64 `76561197960287930`, locks the baseline, and with `--release` waits out the 120 second hold. The account is a public Valve profile used as a clean XML example. The script writes `deployments/live-check.json`.

Do not treat a unit-test fixture as a live ban. The forfeit path is covered by `tests/test_rules.py` with a `vacBanned` change from 0 to 1 and a game-ban banner change from 0 to 1. Those fixtures are not fetched from Steam during the test.
