# Wavehold

Tournament prize escrow for public ban records, on GenLayer.

A cup pays the winner before Valve or Lichess publishes a new ban. Wavehold keeps the GEN in an Intelligent Contract. Validators re-fetch a URL the contract builds. The prize is released when the ban counters are unchanged, and forfeited when a counter has increased. An LLM is not called.

Primary portal tag: Gaming. Tag 1: Cheat Detection.

## Use it

```
npm install
npm test
python -m unittest tests.test_rules
npm run dev
```

Studionet is chain 61999. The deployed contract is `0x32450Bf1af6538c80A5eE5142D2bE66fdD871dF0` ([explorer](https://explorer-studio.genlayer.com/address/0x32450Bf1af6538c80A5eE5142D2bE66fdD871dF0)). The app can create an ephemeral account and fund it there. Bradbury needs a wallet that already holds testnet GEN.

Deploy:

```
npm run deploy:studionet
node scripts/verify-live.mjs --release
```

The deploy script writes `src/deployed.json` and a gitignored `deploy/deployer.local.json`.

## Read

- [docs/PROJECT.md](docs/PROJECT.md) — the problem, the authorities, and the money
- [docs/CONSENSUS.md](docs/CONSENSUS.md) — what validators compare
- [HOW_TO_DEMO.md](HOW_TO_DEMO.md) — the click path
- [SUBMISSION.md](SUBMISSION.md) — Season 2 portal notes

## Rule

`steam_vac` uses `<vacBanned>` from the Steam community profile XML. `steam_roster` adds the counts inside Valve’s `profile_ban_status` element. `lichess` uses `tosViolation` on the official user API. A pasted link cannot replace those URLs. A profile comment cannot create a ban. A closed Lichess account without `tosViolation` does not forfeit the purse.

The organizer names the roster and the payee. Wavehold does not decide the match.
