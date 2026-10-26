/**
 * Client-side mirror of the contract's public rules.
 * The contract ignores any URL the browser builds. These helpers only
 * explain a purse and stop the form from submitting a subject the
 * contract will reject.
 */

export const AUTHORITIES = ["steam_vac", "steam_roster", "lichess"];
export const MIN_PURSE_WEI = 10n ** 16n;
export const MIN_HOLD_SECS = 60;
export const MAX_HOLD_SECS = 30 * 24 * 3600;
export const FINDER_FEE_BPS = 1000;
export const UNREADABLE_GRACE_SECS = 86400;

const STEAM_ID = /^7656\d{13}$/;
const LICHESS_ID = /^[a-z0-9_-]{2,20}$/;

export function parseSubjects(authority, raw) {
  if (!AUTHORITIES.includes(authority)) throw new Error("bad_authority");
  const parts = String(raw || "")
    .replace(/\n/g, ",")
    .replace(/ /g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error("no_subjects");
  if (parts.length > 5) throw new Error("too_many_subjects");
  const out = [];
  for (const item of parts) {
    const norm = authority === "lichess" ? item.toLowerCase() : item;
    if (authority === "lichess" && !LICHESS_ID.test(norm)) throw new Error("bad_lichess_id");
    if (authority !== "lichess" && !STEAM_ID.test(norm)) throw new Error("bad_steam_id");
    if (out.includes(norm)) throw new Error("duplicate_subject");
    out.push(norm);
  }
  return out;
}

export function steamXmlUrl(subject) {
  return `https://steamcommunity.com/profiles/${subject}/?xml=1`;
}

export function steamHtmlUrl(subject) {
  return `https://steamcommunity.com/profiles/${subject}/`;
}

export function lichessUrl(subject) {
  return `https://lichess.org/api/user/${subject}`;
}

export function sourceUrls(authority, subjects) {
  const urls = [];
  for (const subject of subjects) {
    if (authority === "lichess") urls.push(lichessUrl(subject));
    else if (authority === "steam_roster") {
      urls.push(steamXmlUrl(subject));
      urls.push(steamHtmlUrl(subject));
    } else urls.push(steamXmlUrl(subject));
  }
  return urls;
}

export function safeHref(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    const path = parsed.pathname;
    if (parsed.hostname === "steamcommunity.com" && /^\/profiles\/7656\d{13}\/?$/.test(path)) {
      if (parsed.search && parsed.search !== "?xml=1") return "";
      return parsed.toString();
    }
    if (parsed.hostname === "lichess.org" && /^\/api\/user\/[a-z0-9_-]{2,20}$/.test(path) && !parsed.search) {
      return parsed.toString();
    }
    return "";
  } catch {
    return "";
  }
}

export function parseGenToWei(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(text)) {
    throw new Error("Enter GEN as a positive decimal with up to 18 places.");
  }
  const [whole, frac = ""] = text.split(".");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  const wei = BigInt(whole) * 10n ** 18n + BigInt(padded);
  if (wei <= 0n) throw new Error("GEN amount must be positive.");
  return wei;
}

export function formatGen(wei) {
  const value = BigInt(wei);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10n ** 18n;
  const frac = (abs % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function protestBondWei(purse) {
  return BigInt(purse) / 10n;
}

export function splitFinder(purse, bps = FINDER_FEE_BPS) {
  const escrow = BigInt(purse);
  const fee = (escrow * BigInt(bps)) / 10000n;
  return { fee, rest: escrow - fee };
}

export function outcomeFor(authority, before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
    return "unreadable";
  }
  const earlier = new Map(before.map((rec) => [rec.subject, rec]));
  for (const rec of after) {
    const prev = earlier.get(rec.subject);
    if (!prev || !rec.readable || !prev.readable) return "unreadable";
    if (authority === "lichess") {
      if (Number(rec.tos_violation) > Number(prev.tos_violation)) return "ban_delta";
      continue;
    }
    if (Number(rec.vac_banned) > Number(prev.vac_banned)) return "ban_delta";
    if (authority === "steam_roster") {
      if (Number(rec.vac_count) < 0 || Number(prev.vac_count) < 0) return "unreadable";
      if (Number(rec.game_count) < 0 || Number(prev.game_count) < 0) return "unreadable";
      if (Number(rec.vac_count) > Number(prev.vac_count)) return "ban_delta";
      if (Number(rec.game_count) > Number(prev.game_count)) return "ban_delta";
    }
  }
  return "clean";
}

export function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || "").trim());
}

export function short(value) {
  const text = String(value || "");
  if (text.length < 14) return text;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

export function errorText(error) {
  const raw = String(error?.message || error || "");
  const known = [
    ["purse_too_small", "Purse must be at least 0.01 GEN."],
    ["baseline_unreadable", "Validators could not read every ban record. The purse stays open."],
    ["source_unreadable", "A source was unreadable, so the prize stayed in the contract."],
    ["too_early", "The hold has not ended."],
    ["protest_bond_exact", "The protest bond must match the amount stored on the purse."],
    ["only_organizer", "Only the organizer can cancel an open purse."],
    ["not_open", "That action is only available before the baseline is locked."],
    ["not_holding", "A protest can only be filed while the purse is holding."],
    ["grace_open", "Recovery waits 24 hours after the hold, and only if the source is still unreadable."],
    ["source_is_readable", "The source is readable. Use release or recheck."],
    ["bad_steam_id", "Use a 17-digit SteamID64 that starts with 7656."],
    ["bad_lichess_id", "Use a Lichess id: 2–20 letters, numbers, _ or -."],
    ["bad_address", "Payee must be a non-zero 0x address."],
    ["unexpected_value", "That call does not accept a GEN transfer."],
  ];
  for (const [code, text] of known) {
    if (raw.includes(code)) return text;
  }
  return raw;
}
