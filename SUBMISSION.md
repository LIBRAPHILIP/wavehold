# Portal submission — Projects (type 41)

Form: https://portal.genlayer.foundation/submit-contribution?type=41

Primary tag: **Gaming**  
Tag 1: **Cheat Detection**

## Title

```
Wavehold
```

## Description / notes

```
Wavehold holds a tournament prize on GenLayer until a public ban record stays clean.

Community cups pay a winner, then a VAC wave or a Lichess closure shows up days later. The organizer was the custodian, and the evidence was a screenshot. The contract escrows GEN. The organizer names the roster and the payee. Wavehold does not decide who won the match.

Validators re-fetch a URL the contract builds. steam_vac reads Valve's <vacBanned> on https://steamcommunity.com/profiles/<steamid64>/?xml=1. steam_roster also reads VAC and game-ban counts inside the profile_ban_status element, and ignores the rest of the page. lichess reads tosViolation on https://lichess.org/api/user/<id>. That flag is how Lichess publishes fair-play closures; it also covers other Terms-of-Service closures.

No LLM is called. get_meta.llm_rule is none. A counter that was already set at lock does not forfeit. An increase pays 90% back to the organizer and 10% to the protester or the caller. A clean re-read after the hold pays the payee. An unreadable source does not release.

The page submits writeContract, shows the tx hash, polls getTransaction / getLastRoundData until ACCEPTED, then reloads the purse with readContract. A validator that stops after quorum is not treated as a revert. A GenVM traceback is.

Live app: run `npm run dev` in the repo (Studionet). A hosted URL is not attached yet.
GitHub: https://github.com/LIBRAPHILIP/wavehold
Explorer: https://explorer-studio.genlayer.com/address/0x32450Bf1af6538c80A5eE5142D2bE66fdD871dF0

Studionet contract 0x32450Bf1af6538c80A5eE5142D2bE66fdD871dF0, version 1.0.2-wavehold, chain 61999. Deploy tx 0x55be123960f852c3b196757684b8456ff25ae570eca6588ef60e9a5a23334f58.

Live read, not a fixture: opened 0.02 GEN, locked steam_vac for 76561197960287930, stored vacBanned 0 from https://steamcommunity.com/profiles/76561197960287930/?xml=1, waited the 120 second hold, and released. Purse 0 is RELEASED with settlement_basis released_clean and escrow 0. Open 0x1050814d586731c03333d5a24ddfcbc217c6de7f9d14e4e51afb86fef2215eb8. Lock 0x402f9ed1e7b1f9897f4b6c3b08ad1d68564a1fb0051b71204f2f578c71066206. Release 0xee3df56ac39a1126d6693feec7aa413133579212c890f131a81e7c539abd4f37. The same path also locked the official Lichess account `lichess` at tosViolation 0 on an earlier payable build and released that purse clean.
```

## Required evidence

**GitHub repository**

```
https://github.com/LIBRAPHILIP/wavehold
```

## Additional evidence

**GenLayer Explorer Contract**

```
https://explorer-studio.genlayer.com/address/0x32450Bf1af6538c80A5eE5142D2bE66fdD871dF0
```

**Live app** — the Vercel URL, evidence type Other.

Do not submit a unit-test fixture as a live ban. `deployments/live-check.json` is the on-chain read.

Retired deploy, not payable, do not submit: `0x90AA4Ef42e9d69AD9dA1bb64A4581422Ca200a0B`.
