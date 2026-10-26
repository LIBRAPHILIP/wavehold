/**
 * Wavehold reads and writes. Every write waits for an accepted receipt
 * and polls validator rounds while it waits.
 */
import { TransactionStatus } from "genlayer-js/types";
import contractSource from "../../contracts/wavehold.py?raw";
import {
  getReadClient,
  getWriteClient,
  initializeConsensus,
  getActiveNetworkKey,
} from "./client.js";
import { getNetwork } from "./networks.js";

export { contractSource };

const ADDRESS_KEY = "wavehold.contract";

export function loadSavedAddress() {
  try {
    return localStorage.getItem(ADDRESS_KEY) || "";
  } catch {
    return "";
  }
}

export function saveAddress(address) {
  try {
    if (address) localStorage.setItem(ADDRESS_KEY, address);
    else localStorage.removeItem(ADDRESS_KEY);
  } catch {
    /* private mode */
  }
}

function requireAddress(address) {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("Set the Wavehold contract address first.");
  }
  return address;
}

function parseMaybeJson(value) {
  if (value == null) return value;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function extractContractAddress(receipt) {
  return (
    receipt?.data?.contract_address ||
    receipt?.to_address ||
    receipt?.txDataDecoded?.contractAddress ||
    receipt?.contractAddress ||
    receipt?.data?.contractAddress ||
    null
  );
}

function executionRows(receipt) {
  const rows = [];
  const data = receipt?.consensus_data;
  const leaders = data?.leader_receipt || [];
  for (const row of Array.isArray(leaders) ? leaders : [leaders]) {
    if (row) rows.push(row);
  }
  for (const row of data?.validators || []) rows.push(row);
  if (receipt?.genvm_result) {
    rows.push({
      execution_result: receipt.genvm_result.execution_result,
      vote: "agree",
      genvm_result: receipt.genvm_result,
    });
  }
  return rows;
}

export function executionError(receipt) {
  const rows = executionRows(receipt);
  let success = false;
  let stderr = "";
  for (const row of rows) {
    if (String(row?.execution_result || "").toUpperCase() === "SUCCESS") success = true;
    const text = String(row?.genvm_result?.stderr || "").trim();
    if (!text || /cancelled after quorum/i.test(text)) continue;
    if (String(row?.vote || "") === "idle") continue;
    if (!stderr) stderr = text;
  }
  if (!stderr || success) return "";
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.slice(-4).join(" ");
}

export function receiptLooksFailed(receipt) {
  if (executionError(receipt)) return true;
  const status = String(receipt?.statusName || receipt?.status || "").toUpperCase();
  const result = String(
    receipt?.result_name || receipt?.resultName || receipt?.txExecutionResultName || ""
  ).toUpperCase();
  if (status.includes("REJECT") || status.includes("ERROR") || status.includes("UNDETERMINED")) return true;
  if (result.includes("ERROR") || result.includes("REVERT") || result.includes("REJECT")) return true;
  return false;
}

async function writeMethod(address, functionName, args, { onProgress, value = 0n, label } = {}) {
  const client = getWriteClient();
  await initializeConsensus();
  onProgress?.({ phase: "submitting", message: `Submitting ${label || functionName}…` });
  const tx = { address: requireAddress(address), functionName, args };
  if (value && value !== 0n) tx.value = value;
  const txHash = await client.writeContract(tx);
  onProgress?.({
    phase: "consensus",
    message: "Transaction is in flight. Watching Optimistic Democracy rounds.",
    txHash,
  });
  const receipt = await waitWithConsensus(txHash, {
    onRound: (info) => onProgress?.({ phase: "consensus", ...info, txHash }),
  });
  if (receiptLooksFailed(receipt)) {
    const detail = executionError(receipt) || receipt?.statusName || receipt?.result_name || "execution failed";
    throw new Error(`${label || functionName} reverted: ${detail}`);
  }
  onProgress?.({ phase: "accepted", message: `${label || functionName} accepted`, txHash, receipt });
  return { txHash, receipt };
}

export function deployWavehold({ onProgress } = {}) {
  return (async () => {
    const client = getWriteClient();
    await initializeConsensus();
    onProgress?.({ phase: "submitting", message: "Submitting Wavehold deployContract…" });
    const txHash = await client.deployContract({ code: contractSource, args: [] });
    onProgress?.({ phase: "consensus", message: "Waiting for the deploy to be accepted…", txHash });
    const receipt = await waitWithConsensus(txHash, {
      onRound: (info) => onProgress?.({ phase: "consensus", ...info, txHash }),
    });
    const address = extractContractAddress(receipt);
    if (!address) throw new Error("Deploy was accepted but the receipt has no contract address.");
    saveAddress(address);
    onProgress?.({ phase: "accepted", message: "Wavehold deployed", txHash, address, receipt });
    return { address, txHash, receipt };
  })();
}

export function openPurse(address, fields, opts) {
  return writeMethod(
    address,
    "open_purse",
    [fields.authority, fields.game, fields.note || "", fields.subjects, fields.payee, String(fields.holdSecs)],
    { ...opts, value: fields.valueWei, label: "open_purse" }
  );
}

export function cancelOpen(address, purseId, opts) {
  return writeMethod(address, "cancel_open", [String(purseId)], { ...opts, label: "cancel_open" });
}

export function lockBaseline(address, purseId, opts) {
  return writeMethod(address, "lock_baseline", [String(purseId)], { ...opts, label: "lock_baseline" });
}

export function fileProtest(address, purseId, valueWei, opts) {
  return writeMethod(address, "file_protest", [String(purseId)], {
    ...opts,
    value: valueWei,
    label: "file_protest",
  });
}

export function recheck(address, purseId, opts) {
  return writeMethod(address, "recheck", [String(purseId)], { ...opts, label: "recheck" });
}

export function release(address, purseId, opts) {
  return writeMethod(address, "release", [String(purseId)], { ...opts, label: "release" });
}

export function recoverUnreadable(address, purseId, opts) {
  return writeMethod(address, "recover_unreadable", [String(purseId)], {
    ...opts,
    label: "recover_unreadable",
  });
}

export async function readMeta(address) {
  return getReadClient().readContract({
    address: requireAddress(address),
    functionName: "get_meta",
    args: [],
  });
}

export async function readPurse(address, purseId) {
  const raw = await getReadClient().readContract({
    address: requireAddress(address),
    functionName: "get_purse",
    args: [String(purseId)],
  });
  return parseMaybeJson(raw);
}

export async function readPurses(address) {
  const client = getReadClient();
  const contract = requireAddress(address);
  const rawCount = await client.readContract({
    address: contract,
    functionName: "get_purse_count",
    args: [],
  });
  const total = Number(rawCount ?? 0);
  if (!Number.isFinite(total) || total <= 0) return [];
  const raw = await client.readContract({
    address: contract,
    functionName: "list_purses",
    args: [0n, 20n],
  });
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return rows.map(parseMaybeJson).filter((row) => row && !row.error);
}

export async function readPreview(address, authority, subjects) {
  const raw = await getReadClient().readContract({
    address: requireAddress(address),
    functionName: "preview_sources",
    args: [authority, subjects],
  });
  return parseMaybeJson(raw);
}

export async function waitWithConsensus(txHash, { onRound } = {}) {
  const client = getReadClient();
  let stopped = false;
  const poll = (async () => {
    let ticks = 0;
    while (!stopped && ticks < 240) {
      ticks += 1;
      try {
        onRound?.(await fetchConsensusSnapshot(txHash));
      } catch {
        /* round data appears after the tx is known */
      }
      await sleep(2500);
    }
  })();
  try {
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      status: TransactionStatus.ACCEPTED,
      retries: 360,
      interval: 5000,
      fullTransaction: true,
    });
    try {
      onRound?.({ ...(await fetchConsensusSnapshot(txHash)), terminal: true, receiptStatus: receipt.statusName });
    } catch {
      /* snapshot is optional once the receipt exists */
    }
    try {
      const tx = await client.getTransaction({ hash: txHash });
      if (tx && typeof tx === "object") return { ...receipt, ...tx, statusName: tx.statusName || receipt.statusName };
    } catch {
      /* the receipt still carries the accepted status */
    }
    return receipt;
  } finally {
    stopped = true;
    await poll.catch(() => {});
  }
}

export async function fetchConsensusSnapshot(txHash) {
  const client = getReadClient();
  const snapshot = {
    txHash,
    network: getActiveNetworkKey(),
    at: new Date().toISOString(),
    transaction: null,
    lastRound: null,
    canAppeal: null,
    rawErrors: [],
  };
  try {
    if (typeof client.getTransaction === "function") {
      snapshot.transaction = await client.getTransaction({ hash: txHash });
    }
  } catch (error) {
    snapshot.rawErrors.push(`getTransaction: ${error.message}`);
  }
  try {
    if (typeof client.getLastRoundData === "function") {
      snapshot.lastRound = await client.getLastRoundData({ txId: txHash });
    }
  } catch (error) {
    snapshot.rawErrors.push(`getLastRoundData: ${error.message}`);
  }
  try {
    if (typeof client.canAppeal === "function") {
      snapshot.canAppeal = await client.canAppeal({ txId: txHash });
    }
  } catch (error) {
    snapshot.rawErrors.push(`canAppeal: ${error.message}`);
  }
  return snapshot;
}

export function summarizeConsensus(snapshot) {
  if (!snapshot) return [];
  const details = [];
  const tx = snapshot.transaction;
  if (tx) {
    details.push(["Tx status", String(tx.statusName || tx.status || "pending")]);
    const resultName = tx.result_name || tx.resultName;
    if (resultName) details.push(["Result", String(resultName)]);
    const votes = tx.consensus_data?.votes;
    if (votes && typeof votes === "object") {
      const entries = Object.entries(votes);
      if (entries.length) {
        details.push(["Validators", String(entries.length)]);
        details.push(["Votes", entries.map(([addr, vote]) => `${addr.slice(0, 6)}:${vote}`).join(" · ")]);
      }
    }
    if (tx.num_of_rounds != null) details.push(["Rounds", String(tx.num_of_rounds)]);
  }
  const round = snapshot.lastRound?.round ?? snapshot.lastRound?.roundData?.round;
  if (round != null) details.push(["Consensus round", String(round)]);
  if (snapshot.canAppeal != null) details.push(["Appealable", snapshot.canAppeal ? "yes" : "no"]);
  if (snapshot.receiptStatus) details.push(["Receipt", String(snapshot.receiptStatus)]);
  return details;
}

export function explorerForActive() {
  return getNetwork(getActiveNetworkKey());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
