# Wavehold

Wavehold is a GenLayer project for tournament prizes that should wait out a ban wave.

A community cup pays the winning roster, then Valve publishes a VAC ban or Lichess publishes a Terms-of-Service closure. The prize has already left. The organizer was the custodian, and the evidence was a screenshot.

Wavehold keeps the prize inside one Intelligent Contract. The organizer names the roster and the payee. The contract does not decide who won the match. It decides whether the public ban counters for that roster increased while the prize was held.

## Authorities

The contract builds the URL. A caller cannot substitute a page they host.

| Authority | Record | Decision fields |
| --- | --- | --- |
| `steam_vac` | `https://steamcommunity.com/profiles/<steamid64>/?xml=1` | `<vacBanned>` is 0 or 1 |
| `steam_roster` | that XML, plus the profile HTML | the VAC flag, and the VAC and game-ban counts inside Valve’s `profile_ban_status` element |
| `lichess` | `https://lichess.org/api/user/<id>` | `tosViolation: true` |

`tosViolation` is how Lichess publishes fair-play closures. The same flag covers other Terms-of-Service closures. Wavehold does not claim it can tell those apart. A closed Lichess account without `tosViolation` does not forfeit the purse, because a player could close an account to force the forfeit.

Steam’s XML flag is a VAC ban. A CS game ban that never flips `vacBanned` is outside `steam_vac`. `steam_roster` reads the banner Valve is currently rendering. Text outside `profile_ban_status` is ignored, so a profile comment cannot invent a ban. If that element is missing, the read fails closed.

An account that is already banned at lock can still be paid. The organizer accepted that history. Only an increase during the hold forfeits.

## Money

- Open escrows at least 0.01 GEN. Cancel before lock returns it to the organizer.
- A protest locks exactly 10% of the prize. It does not ask anyone to judge a demo.
- A higher counter pays 90% back to the organizer and 10% to the protestor, or to the caller when nobody protested. The protest bond is returned.
- A clean re-read at or after the hold pays the payee. A protest bond from a clean hold is paid to the payee.
- An unreadable source does not release and is not a cheat finding. Twenty-four hours after the hold, `recover_unreadable` can return the prize if the source is still unreadable.

## What you do

1. Connect on Studionet, or use an ephemeral account. The page can fund an ephemeral account through the Studio faucet method.
2. Choose an authority, paste SteamID64s or a Lichess id, name the payee, and set the hold. A week is 604800 seconds. The demo hold is 120 seconds.
3. Open the purse and wait until the transaction is accepted.
4. Lock the baseline. Validators fetch the authority URL. The desk shows the counters they stored.
5. Recheck during the hold, or release after it. File a protest if you want the finder fee reserved for you.

The transaction panel shows the hash, the explorer link, and the validator rounds returned by the RPC. It does not invent votes.

## Tags

Primary: Gaming. Tag 1: Cheat Detection.
