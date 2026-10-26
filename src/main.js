import deployed from "./deployed.json";
import {
  setNetwork,
  useEphemeralAccount,
  connectInjectedWallet,
  fundStudioAccount,
  probeNetworkHealth,
  getActiveNetworkKey,
  getWalletMode,
} from "./genlayer/client.js";
import { explorerAddressUrl, explorerTxUrl, getNetwork } from "./genlayer/networks.js";
import {
  loadSavedAddress,
  saveAddress,
  deployWavehold,
  openPurse,
  cancelOpen,
  lockBaseline,
  fileProtest,
  recheck,
  release,
  recoverUnreadable,
  readMeta,
  readPurses,
  summarizeConsensus,
} from "./genlayer/wavehold.js";
import {
  parseSubjects,
  sourceUrls,
  safeHref,
  parseGenToWei,
  formatGen,
  protestBondWei,
  outcomeFor,
  isAddress,
  short,
  errorText,
  MIN_PURSE_WEI,
  MIN_HOLD_SECS,
  UNREADABLE_GRACE_SECS,
} from "./genlayer/rules.js";

const $ = (id) => document.getElementById(id);

const state = {
  address: "",
  account: "",
  busy: false,
  meta: null,
  metaError: "",
  purses: [],
  health: null,
  life: { phase: "idle", message: "No transaction yet.", txHash: "", facts: [] },
};

function net() {
  return getNetwork(getActiveNetworkKey());
}

function setLife(patch) {
  state.life = { ...state.life, ...patch };
  renderLife();
}

function renderLife() {
  const life = state.life;
  $("lifePhase").textContent = life.phase || "idle";
  $("lifeMessage").textContent = life.message || "";
  const link = $("lifeTx");
  const href = explorerTxUrl(net(), life.txHash);
  if (href) {
    link.hidden = false;
    link.href = href;
    link.textContent = short(life.txHash);
  } else {
    link.hidden = true;
  }
  const facts = $("lifeFacts");
  facts.replaceChildren();
  for (const [label, value] of life.facts || []) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    facts.append(dt, dd);
  }
}

function renderSession() {
  const mode = getWalletMode();
  const who = state.account ? `${short(state.account)} · ${mode}` : "No account yet.";
  const health = state.health?.ok ? `${net().label} responded` : state.health?.error || net().blurb;
  $("sessionLine").textContent = `${who} ${health}`;
  const meta = state.meta;
  if (meta?.version) {
    const llm = meta.llm_rule === "none" ? "LLM is not used." : `LLM rule ${meta.llm_rule}.`;
    $("metaLine").textContent = `${meta.title || "Wavehold"} ${meta.version} · ${meta.purse_count || 0} purses · ${llm} Decision: ${meta.decision_rule || ""}.`;
  } else if (state.metaError) {
    $("metaLine").textContent = state.metaError;
  } else if (state.address) {
    $("metaLine").textContent = "Address set. Meta has not loaded.";
  } else {
    $("metaLine").textContent = "Deploy Wavehold, or paste a deployed address.";
  }
  const explorer = explorerAddressUrl(net(), state.address);
  const link = $("explorerLink");
  link.href = explorer || "#";
  link.textContent = state.address ? `Explorer ${short(state.address)}` : "Explorer";
  const healthLine = $("healthLine");
  if (state.health && !state.health.ok) {
    healthLine.hidden = false;
    healthLine.textContent = state.health.error || "Network check failed.";
  } else {
    healthLine.hidden = true;
  }
  for (const id of ["btnOpen", "btnDeploy", "btnRefresh", "btnEphemeral", "btnWallet"]) {
    $(id).disabled = state.busy;
  }
}

function renderPreview() {
  const list = $("sourcePreview");
  list.replaceChildren();
  const authority = $("authority").value;
  $("subjectHelp").textContent =
    authority === "lichess"
      ? "Lichess id, 2–20 characters. The contract calls /api/user/<id>."
      : "17-digit SteamID64 starting with 7656. A profile URL is rejected.";
  let subjects = [];
  try {
    subjects = parseSubjects(authority, $("subjects").value);
  } catch {
    return;
  }
  for (const url of sourceUrls(authority, subjects)) {
    const li = document.createElement("li");
    const href = safeHref(url);
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = href;
      li.append(a);
    } else {
      li.textContent = url;
    }
    list.append(li);
  }
}

function pill(status) {
  const span = document.createElement("span");
  span.className = "pill";
  const bad = ["FORFEITED", "CANCELLED"];
  const ok = ["RELEASED", "HOLDING"];
  const wait = ["OPEN", "PROTESTED", "RECOVERED"];
  if (bad.includes(status)) span.classList.add("bad");
  else if (ok.includes(status)) span.classList.add("ok");
  else if (wait.includes(status)) span.classList.add("wait");
  span.textContent = status || "UNKNOWN";
  return span;
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function renderDesk() {
  const root = $("purseList");
  root.replaceChildren();
  if (!state.purses.length) {
    const p = document.createElement("p");
    p.className = "fine";
    p.textContent = state.address ? "No purses on this contract yet." : "Set a contract address to load purses.";
    root.append(p);
    return;
  }
  const me = (state.account || "").toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  for (const purse of state.purses) {
    const article = document.createElement("article");
    article.className = "purse";
    const title = document.createElement("h3");
    title.textContent = `${purse.game || "Purse"} · #${purse.purse_id}`;
    const line = document.createElement("p");
    line.append(pill(purse.status));
    const note = document.createElement("span");
    note.textContent = ` ${purse.authority} · ${formatGen(purse.escrow_wei || purse.purse_wei || 0)} GEN escrowed · payee ${short(purse.payee)}`;
    line.append(note);
    article.append(title, line);
    if (purse.note) {
      const p = document.createElement("p");
      p.className = "fine";
      p.textContent = purse.note;
      article.append(p);
    }
    const verdict = purse.baseline?.length && purse.latest?.length
      ? outcomeFor(purse.authority, purse.baseline, purse.latest)
      : purse.last_reason || "";
    const reason = document.createElement("p");
    reason.className = "fine";
    const releaseAt = Number(purse.release_at || 0);
    const releaseText = releaseAt ? new Date(releaseAt * 1000).toLocaleString() : "not locked";
    reason.textContent = `Release ${releaseText}. Last read: ${purse.last_reason || "none"}. Local reading of stored counters: ${verdict || "n/a"}. Basis: ${purse.settlement_basis || "unset"}.`;
    article.append(reason);

    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const label of ["Subject", "Source", "Baseline", "Latest"]) {
      const th = document.createElement("th");
      th.textContent = label;
      head.append(th);
    }
    table.append(head);
    const subjects = purse.subjects || [];
    for (const subject of subjects) {
      const base = (purse.baseline || []).find((row) => row.subject === subject);
      const latest = (purse.latest || []).find((row) => row.subject === subject);
      const tr = document.createElement("tr");
      tr.append(cell(subject));
      const sourceCell = document.createElement("td");
      const href = safeHref((base || latest)?.source || "");
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = "authority";
        sourceCell.append(a);
      } else {
        sourceCell.textContent = "—";
      }
      tr.append(sourceCell, cell(counterText(purse.authority, base)), cell(counterText(purse.authority, latest)));
      table.append(tr);
    }
    article.append(table);

    const row = document.createElement("div");
    row.className = "row";
    const actions = [
      ["Cancel", "cancel", purse.status === "OPEN" && purse.organizer === me],
      ["Lock baseline", "lock", purse.status === "OPEN"],
      ["File protest", "protest", purse.status === "HOLDING"],
      ["Recheck", "recheck", purse.status === "HOLDING" || purse.status === "PROTESTED"],
      ["Release", "release", (purse.status === "HOLDING" || purse.status === "PROTESTED") && now >= releaseAt && releaseAt > 0],
      ["Recover unreadable", "recover", (purse.status === "HOLDING" || purse.status === "PROTESTED") && now >= releaseAt + UNREADABLE_GRACE_SECS && releaseAt > 0],
    ];
    for (const [label, action, enabled] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action === "release" || action === "lock" ? "solid" : "ghost";
      button.textContent = label;
      button.disabled = state.busy || !enabled;
      button.addEventListener("click", () => act(action, purse));
      row.append(button);
    }
    article.append(row);
    root.append(article);
  }
}

function counterText(authority, rec) {
  if (!rec) return "—";
  if (!rec.readable) return `unreadable (${rec.reason || "fetch"})`;
  if (authority === "lichess") return `tosViolation ${rec.tos_violation}`;
  if (authority === "steam_roster") return `vac ${rec.vac_banned} · banner vac ${rec.vac_count} · game ${rec.game_count}`;
  return `vacBanned ${rec.vac_banned}`;
}

async function refresh() {
  renderSession();
  if (!state.address) {
    state.purses = [];
    state.meta = null;
    renderDesk();
    return;
  }
  try {
    state.metaError = "";
    state.meta = await readMeta(state.address);
    if (state.meta && String(state.meta.llm_rule) !== "none") {
      throw new Error("This address is not Wavehold: llm_rule is not none.");
    }
    state.purses = await readPurses(state.address);
  } catch (error) {
    state.meta = null;
    state.purses = [];
    state.metaError = errorText(error);
  }
  renderSession();
  renderDesk();
}

async function connectEphemeral() {
  const account = useEphemeralAccount();
  state.account = account.address;
  if (!$("payee").value) $("payee").value = account.address;
  setLife({ phase: "funding", message: "Requesting Studionet funds for the ephemeral account…", facts: [] });
  try {
    const fundTx = await fundStudioAccount(account.address);
    setLife({
      phase: "funded",
      message: fundTx ? "Ephemeral account funded on Studionet." : "Account ready. Fund it from the faucet on this network.",
      txHash: fundTx || "",
      facts: [],
    });
  } catch (error) {
    setLife({ phase: "error", message: errorText(error), facts: [] });
  }
  await refresh();
}

async function connectWallet() {
  const account = await connectInjectedWallet();
  state.account = account.address;
  if (!$("payee").value) $("payee").value = account.address;
  setLife({ phase: "connected", message: "Wallet connected.", txHash: "", facts: [] });
  await refresh();
}

function progress(label) {
  return (info) => {
    const facts = summarizeConsensus(info);
    if (info.txHash) facts.unshift(["Hash", info.txHash]);
    setLife({
      phase: info.phase || "consensus",
      message: info.message || label,
      txHash: info.txHash || state.life.txHash,
      facts,
    });
  };
}

async function runTx(label, fn) {
  if (state.busy) return;
  state.busy = true;
  renderSession();
  renderDesk();
  $("formError").textContent = "";
  try {
    const result = await fn(progress(label));
    const facts = summarizeConsensus(result.receipt ? { transaction: result.receipt, receiptStatus: result.receipt.statusName } : null);
    setLife({
      phase: "accepted",
      message: `${label} accepted. The desk reloaded from the contract.`,
      txHash: result.txHash,
      facts,
    });
    await refresh();
  } catch (error) {
    setLife({ phase: "error", message: errorText(error), txHash: state.life.txHash, facts: state.life.facts });
    $("formError").textContent = errorText(error);
  } finally {
    state.busy = false;
    renderSession();
    renderDesk();
  }
}

async function act(action, purse) {
  const address = currentAddress();
  if (action === "cancel") return runTx("cancel_open", (onProgress) => cancelOpen(address, purse.purse_id, { onProgress }));
  if (action === "lock") return runTx("lock_baseline", (onProgress) => lockBaseline(address, purse.purse_id, { onProgress }));
  if (action === "recheck") return runTx("recheck", (onProgress) => recheck(address, purse.purse_id, { onProgress }));
  if (action === "release") return runTx("release", (onProgress) => release(address, purse.purse_id, { onProgress }));
  if (action === "recover") return runTx("recover_unreadable", (onProgress) => recoverUnreadable(address, purse.purse_id, { onProgress }));
  if (action === "protest") {
    const bond = protestBondWei(purse.purse_wei);
    return runTx("file_protest", (onProgress) => fileProtest(address, purse.purse_id, bond, { onProgress }));
  }
}

function currentAddress() {
  const address = $("contractAddress").value.trim();
  if (!isAddress(address)) throw new Error("Set a valid Wavehold address.");
  state.address = address;
  saveAddress(address);
  return address;
}

function holdSeconds() {
  if ($("demoHold").checked) return 120;
  const secs = Number($("holdSecs").value);
  if (!Number.isInteger(secs) || secs < MIN_HOLD_SECS) {
    throw new Error("Hold must be a whole number of seconds, at least 60. A week is 604800.");
  }
  return secs;
}

async function onOpen(event) {
  event.preventDefault();
  try {
    const authority = $("authority").value;
    const subjects = parseSubjects(authority, $("subjects").value).join(",");
    const payee = $("payee").value.trim();
    if (!isAddress(payee) || payee === "0x" + "0".repeat(40)) throw new Error("bad_address");
    const valueWei = parseGenToWei($("amount").value);
    if (valueWei < MIN_PURSE_WEI) throw new Error("purse_too_small");
    const fields = {
      authority,
      game: $("game").value,
      note: $("note").value,
      subjects,
      payee,
      holdSecs: holdSeconds(),
      valueWei,
    };
    await runTx("open_purse", (onProgress) => openPurse(currentAddress(), fields, { onProgress }));
  } catch (error) {
    $("formError").textContent = errorText(error);
  }
}

async function onDeploy() {
  await runTx("deploy", async (onProgress) => {
    const result = await deployWavehold({ onProgress });
    $("contractAddress").value = result.address;
    state.address = result.address;
    saveAddress(result.address);
    return result;
  });
}

function useDeployed() {
  if (!deployed.address) {
    $("formError").textContent = "This build does not have a deployed address yet.";
    return;
  }
  $("contractAddress").value = deployed.address;
  state.address = deployed.address;
  saveAddress(deployed.address);
  refresh();
}

async function boot() {
  const saved = loadSavedAddress();
  state.address = saved || deployed.address || "";
  $("contractAddress").value = state.address;
  $("networkSelect").addEventListener("change", async () => {
    setNetwork($("networkSelect").value);
    state.health = await probeNetworkHealth();
    renderPreview();
    await refresh();
  });
  $("btnEphemeral").addEventListener("click", () => connectEphemeral().catch((error) => {
    $("formError").textContent = errorText(error);
  }));
  $("btnWallet").addEventListener("click", () => connectWallet().catch((error) => {
    $("formError").textContent = errorText(error);
  }));
  $("btnDeploy").addEventListener("click", () => onDeploy());
  $("btnUseDeployed").addEventListener("click", useDeployed);
  $("btnRefresh").addEventListener("click", () => refresh());
  $("contractAddress").addEventListener("change", () => {
    state.address = $("contractAddress").value.trim();
    if (isAddress(state.address)) saveAddress(state.address);
    refresh();
  });
  $("open").addEventListener("submit", onOpen);
  $("authority").addEventListener("change", renderPreview);
  $("subjects").addEventListener("input", renderPreview);
  $("demoHold").addEventListener("change", () => {
    $("holdSecs").disabled = $("demoHold").checked;
  });
  state.health = await probeNetworkHealth();
  renderPreview();
  renderLife();
  await refresh();
}

boot();
