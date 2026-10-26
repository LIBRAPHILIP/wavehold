# Consensus

`lock_baseline`, `recheck`, `release`, and `recover_unreadable` call `gl.vm.run_nondet_unsafe`.

The leader fetches the contract-built URL and returns one small record per subject. Steam reads use `gl.nondet.web.render` in HTML mode so the `<vacBanned>` tag survives; the Lichess read uses `gl.nondet.web.get` because that JSON body arrives intact. The record contains the subject, the source URL, `readable`, and the counters. It does not contain the page.

The validator fetches the same URL and accepts the leader only when, for every subject:

- `readable` matches
- if both sides are readable, `vac_banned`, `vac_count`, `game_count`, `tos_violation`, and `html_readable` match

Persona names, hours, ratings, comments, and the rest of the HTML are not compared. Two unreadable reads match each other even when the error strings differ. A readable read does not match an unreadable one, so a single successful validator cannot paper over a failed fetch, and a single failed fetch cannot force an unreadable result.

After the validators agree, ordinary code applies the rule:

- any unreadable subject → the prize stays, or `release` reverts with `source_unreadable`
- any counter increased → `FORFEITED`
- every counter unchanged and the hold has ended → `RELEASED`

No method calls `gl.nondet.exec_prompt` or an equivalence prompt. `get_meta.llm_rule` is `none`.

`open_purse`, `cancel_open`, and `file_protest` do not fetch. They only move GEN and record the roster the organizer named.

The pure comparison lives in `contracts/wavehold.py` between `RULES_START` and `RULES_END`. `tests/test_rules.py` executes that section.
