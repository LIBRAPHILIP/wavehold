# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Wavehold — tournament prize escrow gated on a public ban record.

Community cups pay winners before a VAC wave or a Lichess fair-play closure
lands. The organizer is then both the custodian and the only witness. A
screenshot of a Steam profile is not a record.

Wavehold keeps the prize in this contract. Validators independently re-fetch
a URL the contract builds itself:

  steam_vac     https://steamcommunity.com/profiles/<steamid64>/?xml=1
                Decision field: Valve's <vacBanned> 0 or 1.
  steam_roster  that XML, plus the profile HTML.
                Extra decision fields: the VAC count and game-ban count
                inside Valve's profile_ban_status element only.
  lichess       https://lichess.org/api/user/<id>
                Decision field: tosViolation. Absence means false.
                Lichess publishes fair-play closures on this flag. The flag
                also covers other Terms-of-Service closures. The contract
                does not claim it can tell those apart.

The LLM is not called. Persona names, hours, ratings, and comments are not
consensus fields. A ban counter that was already set at lock is history the
organizer accepted. Only an increase during the hold forfeits the purse.
Unreadable sources do not release and do not count as a cheat.

Entitlement: the organizer names the roster and the payee. This contract
does not decide who won the match.
"""

from genlayer import *

import json
import time
import typing


VERSION = "1.0.2-wavehold"

# RULES_START
import json
import re

AUTHORITIES = ("steam_vac", "steam_roster", "lichess")
FINDER_FEE_BPS = 1000
MIN_PURSE_WEI = 10**16
MIN_HOLD_SECS = 60
MAX_HOLD_SECS = 30 * 24 * 3600
UNREADABLE_GRACE_SECS = 24 * 3600
MAX_SUBJECTS = 5
MAX_GAME = 80
MAX_NOTE = 280
DECISION_RULE = "ban_counter_increase_only"
LLM_RULE = "none"
SOURCE_RULE = "contract_built_https_only"
RELEASE_RULE = "fail_closed_until_readable"

_STEAM_ID = re.compile(r"^7656\d{13}$")
_LICHESS_ID = re.compile(r"^[a-z0-9_-]{2,20}$")
_HOLD = re.compile(r"^[0-9]{1,8}$")


def steam_xml_url(subject: str) -> str:
    return "https://steamcommunity.com/profiles/" + subject + "/?xml=1"


def steam_html_url(subject: str) -> str:
    return "https://steamcommunity.com/profiles/" + subject + "/"


def lichess_url(subject: str) -> str:
    return "https://lichess.org/api/user/" + subject


def source_urls(authority: str, subjects: list) -> list:
    urls = []
    for subject in subjects:
        if authority == "lichess":
            urls.append(lichess_url(subject))
        elif authority == "steam_roster":
            urls.append(steam_xml_url(subject))
            urls.append(steam_html_url(subject))
        else:
            urls.append(steam_xml_url(subject))
    return urls


def parse_subjects(authority: str, raw: str) -> list:
    if authority not in AUTHORITIES:
        raise ValueError("bad_authority")
    text = raw or ""
    if len(text) > 400:
        raise ValueError("subjects_too_long")
    parts = []
    for chunk in text.replace("\n", ",").replace(" ", ",").split(","):
        item = chunk.strip()
        if item:
            parts.append(item)
    if not parts:
        raise ValueError("no_subjects")
    if len(parts) > MAX_SUBJECTS:
        raise ValueError("too_many_subjects")
    out = []
    for item in parts:
        if authority == "lichess":
            norm = item.strip().lower()
            if not _LICHESS_ID.match(norm):
                raise ValueError("bad_lichess_id")
        else:
            norm = item.strip()
            if not _STEAM_ID.match(norm):
                raise ValueError("bad_steam_id")
        if norm in out:
            raise ValueError("duplicate_subject")
        out.append(norm)
    return out


def parse_hold_secs(raw: str) -> int:
    text = (raw or "").strip()
    if not _HOLD.match(text):
        raise ValueError("bad_hold")
    secs = int(text)
    if secs < MIN_HOLD_SECS:
        raise ValueError("hold_too_short")
    if secs > MAX_HOLD_SECS:
        raise ValueError("hold_too_long")
    return secs


def clip_text(raw: str, limit: int, code: str, required: bool) -> str:
    text = "".join(ch for ch in (raw or "") if ch >= " " and ch != "\x7f")
    text = " ".join(text.split())
    if required and len(text) < 2:
        raise ValueError(code)
    if len(text) > limit:
        raise ValueError(code)
    return text


def protest_bond_wei(purse: int) -> int:
    return int(purse) // 10


def split_finder(purse: int, bps: int = FINDER_FEE_BPS) -> tuple:
    fee = int(purse) * int(bps) // 10000
    if fee < 0:
        fee = 0
    if fee > int(purse):
        fee = int(purse)
    return fee, int(purse) - fee


def _xml_tag(body: str, name: str):
    match = re.search(
        r"<" + name + r">\s*(?:<!\[CDATA\[(.*?)\]\]>|(.*?))\s*</" + name + r">",
        body or "",
        re.I | re.S,
    )
    if not match:
        return None
    value = match.group(1) if match.group(1) is not None else match.group(2)
    return (value or "").strip()


def parse_steam_xml(body: str, expected_id: str) -> dict:
    raw = body or ""
    if not raw.strip():
        return {"ok": False, "reason": "empty_body", "vac_banned": -1}
    text = raw[:12000]
    low = text.lower()
    if "&lt;vacbanned&gt;" in low or "&lt;profile" in low:
        text = (
            text.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
        )
        low = text.lower()
    if "<profile" not in low or "<vacbanned>" not in low:
        kind = "xml_missing_vac"
        if (
            "just a moment" in low
            or "cloudflare" in low
            or "access denied" in low
            or "captcha" in low
        ):
            kind = "steam_blocked"
        return {"ok": False, "reason": kind, "vac_banned": -1}
    found = _xml_tag(text, "steamID64")
    if found != expected_id:
        return {"ok": False, "reason": "steam_id_mismatch", "vac_banned": -1}
    flag = _xml_tag(text, "vacBanned")
    if flag not in ("0", "1"):
        return {"ok": False, "reason": "vac_flag_not_binary", "vac_banned": -1}
    return {"ok": True, "reason": "ok", "vac_banned": int(flag)}


def _div_inner(html: str, class_name: str):
    match = re.search(
        r'<div\b[^>]*class="[^"]*\b' + class_name + r'\b[^"]*"[^>]*>',
        html or "",
        re.I,
    )
    if not match:
        return None
    start = match.end()
    depth = 1
    i = start
    low = html.lower()
    while i < len(html):
        next_open = low.find("<div", i)
        next_close = low.find("</div>", i)
        if next_close < 0:
            return None
        if next_open != -1 and next_open < next_close:
            depth += 1
            i = next_open + 4
        else:
            depth -= 1
            if depth == 0:
                return html[start:next_close]
            i = next_close + 6
    return None


def _phrase_count(text: str, label: str):
    match = re.search(r"(\d+)\s+" + label + r"\s+bans?\s+on record", text or "", re.I)
    if not match:
        return 0
    return int(match.group(1))


def parse_profile_bans(body: str, expected_id: str) -> dict:
    html = (body or "")[:200000]
    low = html.lower()
    if expected_id not in html:
        return {"ok": False, "reason": "html_missing_steam_id", "vac_count": -1, "game_count": -1}
    if "birth date" in low and "agecheck" in low:
        return {"ok": False, "reason": "age_gate", "vac_count": -1, "game_count": -1}
    block = _div_inner(html, "profile_ban_status")
    if block is None:
        loaded = ("profile_header" in low) or ("g_rgprofiledata" in low)
        if not loaded:
            return {"ok": False, "reason": "html_not_a_profile", "vac_count": -1, "game_count": -1}
        return {"ok": False, "reason": "ban_element_missing", "vac_count": -1, "game_count": -1}
    visible = re.sub(r"<[^>]+>", " ", block)
    visible = " ".join(visible.split())
    return {
        "ok": True,
        "reason": "ok",
        "vac_count": _phrase_count(visible, "vac"),
        "game_count": _phrase_count(visible, "game"),
    }


def parse_lichess_user(body: str, expected_id: str) -> dict:
    try:
        data = json.loads(body or "")
    except Exception:
        return {"ok": False, "reason": "not_json", "tos_violation": -1}
    if not isinstance(data, dict):
        return {"ok": False, "reason": "not_object", "tos_violation": -1}
    found = str(data.get("id") or "").lower()
    if found != expected_id:
        return {"ok": False, "reason": "lichess_id_mismatch", "tos_violation": -1}
    # Only an explicit true counts. A closed account without tosViolation
    # is not a cheat finding: a player can close an account to force a forfeit.
    flag = 1 if data.get("tosViolation") is True else 0
    return {"ok": True, "reason": "ok", "tos_violation": flag}


def _base_record(subject: str, source: str, readable: bool, reason: str) -> dict:
    return {
        "subject": subject,
        "source": source,
        "readable": readable,
        "reason": reason if readable else reason,
        "vac_banned": -1,
        "vac_count": -1,
        "game_count": -1,
        "html_readable": False,
        "tos_violation": -1,
    }


def record_steam_vac(subject: str, xml_body: str) -> dict:
    parsed = parse_steam_xml(xml_body, subject)
    rec = _base_record(subject, steam_xml_url(subject), parsed["ok"], parsed["reason"])
    if parsed["ok"]:
        rec["vac_banned"] = parsed["vac_banned"]
    return rec


def record_steam_roster(subject: str, xml_body: str, html_body: str) -> dict:
    xml_parsed = parse_steam_xml(xml_body, subject)
    html_parsed = parse_profile_bans(html_body, subject)
    rec = _base_record(subject, steam_xml_url(subject), False, "roster_unread")
    if not xml_parsed["ok"]:
        rec["reason"] = xml_parsed["reason"]
        return rec
    if not html_parsed["ok"]:
        rec["reason"] = html_parsed["reason"]
        rec["vac_banned"] = xml_parsed["vac_banned"]
        return rec
    rec["readable"] = True
    rec["reason"] = "ok"
    rec["vac_banned"] = xml_parsed["vac_banned"]
    rec["vac_count"] = html_parsed["vac_count"]
    rec["game_count"] = html_parsed["game_count"]
    rec["html_readable"] = True
    return rec


def record_lichess(subject: str, body: str) -> dict:
    parsed = parse_lichess_user(body, subject)
    rec = _base_record(subject, lichess_url(subject), parsed["ok"], parsed["reason"])
    if parsed["ok"]:
        rec["tos_violation"] = parsed["tos_violation"]
    return rec


def outcome_for(authority: str, before: list, after: list) -> str:
    earlier = {}
    for rec in before:
        earlier[rec.get("subject")] = rec
    if len(after) != len(before):
        return "unreadable"
    for rec in after:
        prev = earlier.get(rec.get("subject"))
        if prev is None or not rec.get("readable") or not prev.get("readable"):
            return "unreadable"
        if authority == "lichess":
            if int(rec["tos_violation"]) > int(prev["tos_violation"]):
                return "ban_delta"
            continue
        if int(rec["vac_banned"]) > int(prev["vac_banned"]):
            return "ban_delta"
        if authority == "steam_roster":
            if int(rec["vac_count"]) < 0 or int(prev["vac_count"]) < 0:
                return "unreadable"
            if int(rec["game_count"]) < 0 or int(prev["game_count"]) < 0:
                return "unreadable"
            if int(rec["vac_count"]) > int(prev["vac_count"]):
                return "ban_delta"
            if int(rec["game_count"]) > int(prev["game_count"]):
                return "ban_delta"
    return "clean"


def records_equivalent(left: list, right: list) -> bool:
    if not isinstance(left, list) or not isinstance(right, list):
        return False
    if len(left) != len(right):
        return False
    a = sorted(left, key=lambda rec: str(rec.get("subject")))
    b = sorted(right, key=lambda rec: str(rec.get("subject")))
    keys = ("vac_banned", "vac_count", "game_count", "tos_violation", "html_readable")
    for x, y in zip(a, b):
        if x.get("subject") != y.get("subject"):
            return False
        if bool(x.get("readable")) != bool(y.get("readable")):
            return False
        if not x.get("readable"):
            continue
        for key in keys:
            if x.get(key) != y.get(key):
                return False
    return True


def records_match_subjects(records: list, subjects: list) -> bool:
    if not isinstance(records, list) or len(records) != len(subjects):
        return False
    got = sorted(str(rec.get("subject")) for rec in records)
    return got == sorted(subjects)

# RULES_END


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


class Wavehold(gl.Contract):
    purse_count: u256
    purses: TreeMap[str, str]
    version: str

    def __init__(self):
        self.purse_count = u256(0)
        self.version = VERSION

    @gl.public.view
    def get_meta(self) -> dict[str, str]:
        return {
            "title": "Wavehold",
            "version": self.version,
            "purse_count": str(self.purse_count),
            "primitive": "ban-wave-prize-escrow",
            "decision_rule": DECISION_RULE,
            "llm_rule": LLM_RULE,
            "source_rule": SOURCE_RULE,
            "release_rule": RELEASE_RULE,
            "finder_fee_bps": str(FINDER_FEE_BPS),
            "min_purse_wei": str(MIN_PURSE_WEI),
            "min_hold_secs": str(MIN_HOLD_SECS),
            "max_hold_secs": str(MAX_HOLD_SECS),
            "unreadable_grace_secs": str(UNREADABLE_GRACE_SECS),
            "authorities": ",".join(AUTHORITIES),
            "entitlement": "organizer_names_roster_and_payee",
            "not_decided": "match_winner",
        }

    @gl.public.view
    def describe(self) -> dict[str, str]:
        return {
            "name": "Wavehold",
            "problem": "A tournament prize is paid before Valve or Lichess publishes a new ban, and the organizer is the only custodian of both the funds and the screenshot.",
            "leader": "Fetch the contract-built authority URL and parse the ban counters.",
            "validator": "Re-fetch the same URL and accept the leader only when the counters match.",
            "compared": "readable, vac_banned, vac_count, game_count, tos_violation",
            "ignored": "persona, hours, ratings, comments, page HTML outside profile_ban_status",
            "pays_on": "clean re-read at or after release_at",
            "forfeits_on": "a ban counter increased since the locked baseline",
            "llm": "not used",
        }

    @gl.public.view
    def get_purse_count(self) -> u256:
        return self.purse_count

    @gl.public.view
    def get_purse(self, purse_id: str) -> str:
        rec = self._read(purse_id)
        if rec is None:
            return json.dumps({"error": "purse_not_found", "purse_id": str(purse_id)})
        return json.dumps(rec, sort_keys=True)

    @gl.public.view
    def list_purses(self, offset: u256, limit: u256) -> typing.Any:
        off = max(0, int(offset))
        lim = int(limit)
        if lim <= 0:
            lim = 10
        if lim > 20:
            lim = 20
        total = int(self.purse_count)
        out = []
        idx = total - 1 - off
        while idx >= 0 and len(out) < lim:
            key = str(idx)
            if key in self.purses:
                out.append(self.purses[key])
            idx -= 1
        return out

    @gl.public.view
    def preview_sources(self, authority: str, subjects: str) -> str:
        try:
            ids = parse_subjects((authority or "").strip(), subjects or "")
        except ValueError as exc:
            return json.dumps({"error": str(exc)})
        return json.dumps(
            {"authority": authority.strip(), "subjects": ids, "sources": source_urls(authority.strip(), ids)},
            sort_keys=True,
        )

    @gl.public.write.payable
    def open_purse(
        self,
        authority: str,
        game: str,
        note: str,
        subjects: str,
        payee: str,
        hold_secs: str,
    ) -> str:
        try:
            auth = (authority or "").strip()
            ids = parse_subjects(auth, subjects or "")
            hold = parse_hold_secs(hold_secs)
            game_text = clip_text(game, MAX_GAME, "bad_game", True)
            note_text = clip_text(note, MAX_NOTE, "bad_note", False)
            payee_addr = self._normalize_address(payee)
        except ValueError as exc:
            raise Exception(str(exc))
        purse = int(gl.message.value)
        if purse < MIN_PURSE_WEI:
            raise Exception("purse_too_small")
        organizer = self._sender()
        purse_id = str(int(self.purse_count))
        now = _now_ts()
        rec = {
            "purse_id": purse_id,
            "status": "OPEN",
            "authority": auth,
            "game": game_text,
            "note": note_text,
            "organizer": organizer,
            "payee": payee_addr,
            "subjects": ids,
            "sources": source_urls(auth, ids),
            "purse_wei": str(purse),
            "escrow_wei": str(purse),
            "protest_bond_wei": str(protest_bond_wei(purse)),
            "protest_bond_locked": "0",
            "protestor": "",
            "finder_fee_bps": str(FINDER_FEE_BPS),
            "hold_secs": str(hold),
            "opened_at": str(now),
            "release_at": "0",
            "baseline": [],
            "latest": [],
            "last_reason": "opened",
            "settlement_basis": "",
            "last_checked_at": "0",
        }
        self._write(rec)
        self.purse_count = u256(int(self.purse_count) + 1)
        return json.dumps({"purse_id": purse_id, "status": "OPEN", "escrow_wei": str(purse)}, sort_keys=True)

    @gl.public.write
    def cancel_open(self, purse_id: str) -> str:
        self._reject_value()
        rec = self._require(purse_id)
        if rec["status"] != "OPEN":
            raise Exception("not_open")
        if rec["organizer"] != self._sender():
            raise Exception("only_organizer")
        amount = int(rec["escrow_wei"])
        rec["escrow_wei"] = "0"
        rec["status"] = "CANCELLED"
        rec["settlement_basis"] = "cancelled_before_lock"
        rec["last_reason"] = "cancelled_before_lock"
        self._write(rec)
        self._pay(rec["organizer"], amount)
        return rec["status"]

    @gl.public.write
    def lock_baseline(self, purse_id: str) -> str:
        self._reject_value()
        rec = self._require(purse_id)
        if rec["status"] != "OPEN":
            raise Exception("not_open")
        records = self._consensus_records(rec["authority"], rec["subjects"])
        if outcome_for(rec["authority"], records, records) == "unreadable":
            reason = "unreadable"
            if records:
                reason = str(records[0].get("reason") or reason)
            raise Exception("baseline_unreadable:" + reason)
        now = _now_ts()
        rec["baseline"] = records
        rec["latest"] = records
        rec["status"] = "HOLDING"
        rec["release_at"] = str(now + int(rec["hold_secs"]))
        rec["last_checked_at"] = str(now)
        rec["last_reason"] = "baseline_locked"
        self._write(rec)
        return json.dumps({"purse_id": rec["purse_id"], "status": rec["status"], "release_at": rec["release_at"]}, sort_keys=True)

    @gl.public.write.payable
    def file_protest(self, purse_id: str) -> str:
        rec = self._require(purse_id)
        if rec["status"] != "HOLDING":
            raise Exception("not_holding")
        if rec["protestor"]:
            raise Exception("protest_exists")
        due = int(rec["protest_bond_wei"])
        sent = int(gl.message.value)
        if due <= 0 or sent != due:
            raise Exception("protest_bond_exact")
        rec["protestor"] = self._sender()
        rec["protest_bond_locked"] = str(due)
        rec["status"] = "PROTESTED"
        rec["last_reason"] = "protest_filed"
        self._write(rec)
        return rec["status"]

    @gl.public.write
    def recheck(self, purse_id: str) -> str:
        self._reject_value()
        rec = self._require(purse_id)
        if rec["status"] not in ("HOLDING", "PROTESTED"):
            raise Exception("not_recheckable")
        return self._apply_read(rec, allow_release=False)

    @gl.public.write
    def release(self, purse_id: str) -> str:
        self._reject_value()
        rec = self._require(purse_id)
        if rec["status"] not in ("HOLDING", "PROTESTED"):
            raise Exception("not_releasable")
        if _now_ts() < int(rec["release_at"]):
            raise Exception("too_early")
        return self._apply_read(rec, allow_release=True)

    @gl.public.write
    def recover_unreadable(self, purse_id: str) -> str:
        """Liveness escape. A failed read is not a cheat finding."""
        self._reject_value()
        rec = self._require(purse_id)
        if rec["status"] not in ("HOLDING", "PROTESTED"):
            raise Exception("not_recoverable")
        if _now_ts() < int(rec["release_at"]) + UNREADABLE_GRACE_SECS:
            raise Exception("grace_open")
        records = self._consensus_records(rec["authority"], rec["subjects"])
        verdict = outcome_for(rec["authority"], rec["baseline"], records)
        now = _now_ts()
        rec["latest"] = records
        rec["last_checked_at"] = str(now)
        if verdict == "ban_delta":
            self._forfeit(rec, "forfeited_ban_delta")
            return rec["status"]
        if verdict == "clean":
            raise Exception("source_is_readable")
        self._refund_stuck(rec)
        return rec["status"]

    def _apply_read(self, rec: dict, allow_release: bool) -> str:
        records = self._consensus_records(rec["authority"], rec["subjects"])
        verdict = outcome_for(rec["authority"], rec["baseline"], records)
        now = _now_ts()
        rec["latest"] = records
        rec["last_checked_at"] = str(now)
        if verdict == "ban_delta":
            self._forfeit(rec, "forfeited_ban_delta")
            return rec["status"]
        if verdict == "unreadable":
            if allow_release:
                raise Exception("source_unreadable")
            rec["last_reason"] = "unreadable"
            self._write(rec)
            return json.dumps({"purse_id": rec["purse_id"], "status": rec["status"], "verdict": "unreadable"}, sort_keys=True)
        rec["last_reason"] = "clean"
        if allow_release:
            self._release_clean(rec)
            return rec["status"]
        self._write(rec)
        return json.dumps({"purse_id": rec["purse_id"], "status": rec["status"], "verdict": "clean"}, sort_keys=True)

    def _forfeit(self, rec: dict, basis: str) -> None:
        escrow = int(rec["escrow_wei"])
        bond = int(rec["protest_bond_locked"])
        fee, rest = split_finder(escrow, int(rec["finder_fee_bps"]))
        finder = rec["protestor"] or self._sender()
        organizer = rec["organizer"]
        protestor = rec["protestor"]
        rec["escrow_wei"] = "0"
        rec["protest_bond_locked"] = "0"
        rec["status"] = "FORFEITED"
        rec["settlement_basis"] = basis
        rec["last_reason"] = basis
        self._write(rec)
        self._pay(finder, fee)
        self._pay(organizer, rest)
        if protestor:
            self._pay(protestor, bond)

    def _release_clean(self, rec: dict) -> None:
        escrow = int(rec["escrow_wei"])
        bond = int(rec["protest_bond_locked"])
        payee = rec["payee"]
        rec["escrow_wei"] = "0"
        rec["protest_bond_locked"] = "0"
        rec["status"] = "RELEASED"
        rec["settlement_basis"] = "released_clean"
        rec["last_reason"] = "released_clean"
        self._write(rec)
        self._pay(payee, escrow)
        if bond:
            self._pay(payee, bond)

    def _refund_stuck(self, rec: dict) -> None:
        escrow = int(rec["escrow_wei"])
        bond = int(rec["protest_bond_locked"])
        organizer = rec["organizer"]
        protestor = rec["protestor"]
        rec["escrow_wei"] = "0"
        rec["protest_bond_locked"] = "0"
        rec["status"] = "RECOVERED"
        rec["settlement_basis"] = "source_unavailable"
        rec["last_reason"] = "source_unavailable"
        self._write(rec)
        self._pay(organizer, escrow)
        if protestor:
            self._pay(protestor, bond)

    def _consensus_records(self, authority: str, subjects: list) -> list:
        auth = authority
        ids = list(subjects)

        def leader_fn():
            return _fetch_records(auth, ids)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            proposed = leader_result.calldata
            if not records_match_subjects(proposed, ids):
                return False
            try:
                mine = leader_fn()
            except Exception:
                return False
            return records_equivalent(proposed, mine)

        payload = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        if not records_match_subjects(payload, ids):
            raise Exception("invalid_consensus_payload")
        return payload

    def _read(self, purse_id: str):
        key = str(purse_id).strip()
        if key not in self.purses:
            return None
        try:
            rec = json.loads(self.purses[key])
        except Exception:
            return None
        if not isinstance(rec, dict):
            return None
        return rec

    def _require(self, purse_id: str) -> dict:
        rec = self._read(purse_id)
        if rec is None:
            raise Exception("purse_not_found")
        return rec

    def _write(self, rec: dict) -> None:
        self.purses[str(rec["purse_id"])] = json.dumps(rec, sort_keys=True)

    def _sender(self) -> str:
        return gl.message.sender_address.as_hex.lower()

    def _reject_value(self) -> None:
        if int(gl.message.value) != 0:
            raise Exception("unexpected_value")

    def _normalize_address(self, raw: str) -> str:
        text = (raw or "").strip()
        if not re.fullmatch(r"0x[0-9a-fA-F]{40}", text):
            raise ValueError("bad_address")
        if text.lower() == "0x" + ("0" * 40):
            raise ValueError("bad_address")
        try:
            return Address(text).as_hex.lower()
        except Exception:
            raise ValueError("bad_address")

    def _pay(self, to_hex: str, amount: int) -> None:
        if int(amount) <= 0 or not to_hex:
            return
        _Recipient(Address(to_hex)).emit_transfer(value=u256(int(amount)))


def _now_ts() -> int:
    return int(time.time())


def _fetch_records(authority: str, subjects: list) -> list:
    records = []
    for subject in subjects:
        if authority == "lichess":
            status, body = _http_get(lichess_url(subject))
            if status >= 400 or not body:
                records.append(record_lichess(subject, ""))
            else:
                records.append(record_lichess(subject, body))
        elif authority == "steam_roster":
            xml_status, xml_body = _http_get(steam_xml_url(subject), prefer_markup=True)
            html_status, html_body = _http_get(steam_html_url(subject), prefer_markup=True)
            if xml_status >= 400:
                xml_body = ""
            if html_status >= 400:
                html_body = ""
            records.append(record_steam_roster(subject, xml_body, html_body))
        else:
            status, body = _http_get(steam_xml_url(subject), prefer_markup=True)
            if status >= 400:
                body = ""
            records.append(record_steam_vac(subject, body))
    return records


def _http_get(url: str, prefer_markup: bool = False) -> tuple:
    # Studio's web.get body is plain text. Steam's decision flag lives in an
    # XML tag, so the VAC read asks the renderer for HTML and keeps that body
    # when the tags are still present. Lichess stays on web.get: that JSON
    # body is what Studionet already returned intact.
    if prefer_markup:
        try:
            rendered = gl.nondet.web.render(url, mode="html")
            text = str(rendered or "")
            if "<" in text and ">" in text:
                return 200, text
        except Exception:
            pass
    try:
        res = gl.nondet.web.get(url)
    except Exception:
        return 0, ""
    status = int(getattr(res, "status_code", 200) or 200)
    raw = getattr(res, "body", b"")
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    text = str(raw or "")
    if status >= 400 and "<" not in text and '"id"' not in text.lower():
        return status, ""
    return status, text
