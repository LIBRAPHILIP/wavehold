/**
 * Open a purse and lock a live ban baseline.
 *
 *   node scripts/verify-live.mjs
 *   node scripts/verify-live.mjs --release
 *
 * Uses deploy/deployer.local.json and src/deployed.json from the deploy script.
 * The Steam subject is a public Valve profile used only as a clean XML fixture.
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLEAN_STEAM = "76561197960287930";
const RELEASE = process.argv.includes("--release");
const USE_LICHESS = process.argv.includes("--lichess");

function asJson(value) {
  if (value && typeof value === "object") return value;
  return JSON.parse(value);
}

function load(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

function nestedError(tx) {
  const data = tx?.consensus_data || {};
  const leaders = data.leader_receipt || [];
  const rows = [...(Array.isArray(leaders) ? leaders : [leaders]), ...(data.validators || [])];
  let success = false;
  let stderr = "";
  for (const row of rows) {
    if (String(row?.execution_result || "").toUpperCase() === "SUCCESS") success = true;
    const text = String(row?.genvm_result?.stderr || "").trim();
    if (!text || /cancelled after quorum/i.test(text)) continue;
    if (String(row?.vote || "") === "idle") continue;
    if (!stderr) stderr = text;
  }
  if (success) return "";
  return stderr;
}

async function wait(client, hash) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 400,
    interval: 4000,
    fullTransaction: true,
  });
  const tx = typeof client.getTransaction === "function" ? await client.getTransaction({ hash }) : receipt;
  const stderr = nestedError(tx) || nestedError(receipt);
  if (stderr) {
    const tail = stderr.split("\n").slice(-6).join("\n");
    throw new Error("Contract reverted:\n" + tail);
  }
  const status = String(receipt.statusName || receipt.status || tx?.statusName || "");
  if (/reject|undetermined/i.test(status)) {
    throw new Error("Transaction not accepted: " + status);
  }
  return receipt;
}

async function main() {
  const deployed = load("src/deployed.json");
  const deployer = load("deploy/deployer.local.json");
  if (!deployed.address) throw new Error("No deployed address");
  const account = createAccount(deployer.privateKey);
  const client = createClient({ chain: studionet, account });
  await client.initializeConsensusSmartContract();

  if (USE_LICHESS) {
    try {
      const stuck = asJson(await client.readContract({
        address: deployed.address,
        functionName: "get_purse",
        args: ["0"],
      }));
      if (stuck?.status === "OPEN") {
        console.log("Cancelling stuck OPEN purse 0");
        const cancelHash = await client.writeContract({
          address: deployed.address,
          functionName: "cancel_open",
          args: ["0"],
        });
        console.log(" cancel", cancelHash);
        await wait(client, cancelHash);
      }
    } catch (error) {
      console.log("Cancel skipped:", error.message);
    }
  }

  const value = 2n * 10n ** 16n;
  const authority = USE_LICHESS ? "lichess" : "steam_vac";
  const subject = USE_LICHESS ? "lichess" : CLEAN_STEAM;
  const expectSource = USE_LICHESS
    ? "https://lichess.org/api/user/lichess"
    : "https://steamcommunity.com/profiles/" + CLEAN_STEAM + "/?xml=1";
  console.log("Opening", authority, "purse on", subject);
  const openHash = await client.writeContract({
    address: deployed.address,
    functionName: "open_purse",
    args: [authority, "Live fetch", "Studionet verification purse", subject, account.address, "120"],
    value,
  });
  console.log(" open", openHash);
  await wait(client, openHash);

  const count = Number(await client.readContract({
    address: deployed.address,
    functionName: "get_purse_count",
    args: [],
  }));
  const purseId = String(count - 1);
  console.log("Locking baseline for purse", purseId);
  const lockHash = await client.writeContract({
    address: deployed.address,
    functionName: "lock_baseline",
    args: [purseId],
  });
  console.log(" lock", lockHash);
  await wait(client, lockHash);

  const purse = asJson(await client.readContract({
    address: deployed.address,
    functionName: "get_purse",
    args: [purseId],
  }));
  const row = purse.baseline?.[0];
  if (purse.status !== "HOLDING") throw new Error("status " + purse.status + " " + JSON.stringify(row));
  if (!row?.readable) throw new Error("baseline unreadable " + JSON.stringify(row));
  if (USE_LICHESS) {
    if (row.tos_violation !== 0) throw new Error("expected tosViolation 0, got " + row.tos_violation);
  } else if (row.vac_banned !== 0) {
    throw new Error("expected vacBanned 0, got " + row.vac_banned);
  }
  if (!String(row.source).startsWith(expectSource)) {
    throw new Error("source was not the contract-built URL: " + row.source);
  }
  console.log("Baseline", USE_LICHESS ? "tosViolation" : "vacBanned", USE_LICHESS ? row.tos_violation : row.vac_banned, "source", row.source);

  let releaseHash = "";
  if (RELEASE) {
    const waitMs = Math.max(0, Number(purse.release_at) * 1000 - Date.now() + 5000);
    console.log("Waiting", Math.ceil(waitMs / 1000), "s for the hold");
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    releaseHash = await client.writeContract({
      address: deployed.address,
      functionName: "release",
      args: [purseId],
    });
    console.log(" release", releaseHash);
    await wait(client, releaseHash);
    const settled = asJson(await client.readContract({
      address: deployed.address,
      functionName: "get_purse",
      args: [purseId],
    }));
    if (settled.status !== "RELEASED" || settled.settlement_basis !== "released_clean") {
      throw new Error("release did not pay clean: " + settled.status + " " + settled.settlement_basis);
    }
    console.log("Released clean. Escrow left", settled.escrow_wei);
  }

  const report = {
    address: deployed.address,
    purseId,
    authority,
    subject,
    vacBanned: row.vac_banned,
    tosViolation: row.tos_violation,
    source: row.source,
    status: RELEASE ? "RELEASED" : purse.status,
    openHash,
    lockHash,
    releaseHash,
    checkedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(root, "deployments", "live-check.json"), JSON.stringify(report, null, 2));
  console.log("Wrote deployments/live-check.json");
}

main().catch((error) => {
  console.error("Live verify failed:", error);
  process.exit(1);
});
