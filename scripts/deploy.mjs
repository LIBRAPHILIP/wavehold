/**
 * Deploy Wavehold to Studionet, Bradbury, or localnet.
 *
 *   node scripts/deploy.mjs studionet
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, createAccount } from "genlayer-js";
import { studionet, testnetBradbury, localnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { generatePrivateKey } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const NETWORKS = { studionet, bradbury: testnetBradbury, localnet };

function pickAddress(receipt) {
  return (
    receipt?.data?.contract_address ||
    receipt?.to_address ||
    receipt?.txDataDecoded?.contractAddress ||
    receipt?.contractAddress ||
    receipt?.data?.contractAddress ||
    null
  );
}

async function main() {
  const netName = (process.argv[2] || "studionet").toLowerCase();
  const chain = NETWORKS[netName];
  if (!chain) {
    console.error("Use: studionet | bradbury | localnet");
    process.exit(1);
  }

  const privateKey = process.env.PRIVATE_KEY || process.env.GENLAYER_PRIVATE_KEY || generatePrivateKey();
  const account = createAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
  console.log("Account:", account.address);

  mkdirSync(path.join(root, "deploy"), { recursive: true });
  writeFileSync(
    path.join(root, "deploy", "deployer.local.json"),
    JSON.stringify({ address: account.address, privateKey, network: netName }, null, 2)
  );

  const client = createClient({ chain, account });
  await client.initializeConsensusSmartContract();

  if (netName === "studionet" || netName === "localnet") {
    const rpc = chain.rpcUrls?.default?.http?.[0] || "https://studio.genlayer.com/api";
    console.log("Funding", account.address);
    const fundRes = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sim_fundAccount",
        params: [account.address, 100 * 10 ** 18],
      }),
    });
    const fundJson = await fundRes.json();
    if (fundJson.error) throw new Error("sim_fundAccount failed: " + JSON.stringify(fundJson.error));
    console.log("Fund tx:", fundJson.result);
    if (fundJson.result) {
      try {
        await client.waitForTransactionReceipt({
          hash: fundJson.result,
          status: TransactionStatus.ACCEPTED,
          retries: 60,
          interval: 2000,
        });
      } catch (error) {
        console.log("Fund wait skipped:", error.message);
      }
    }
  }

  const code = new Uint8Array(readFileSync(path.join(root, "contracts", "wavehold.py")));
  console.log("Deploying Wavehold…");
  const txHash = await client.deployContract({ code, args: [] });
  console.log("  tx:", txHash);
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.ACCEPTED,
    retries: 400,
    interval: 4000,
    fullTransaction: true,
  });
  const address = pickAddress(receipt);
  console.log("  status:", receipt.statusName || receipt.status);
  if (!address) {
    console.error(JSON.stringify(receipt, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2));
    throw new Error("no contract address");
  }
  console.log("  address:", address);

  const meta = await client.readContract({ address, functionName: "get_meta", args: [] });
  console.log("get_meta:", meta);
  if (!String(meta?.version || "").includes("1.0.2-wavehold")) {
    throw new Error("Deployed version is not 1.0.2-wavehold: " + JSON.stringify(meta));
  }
  if (String(meta?.llm_rule) !== "none") throw new Error("llm_rule is not none");
  if (String(meta?.decision_rule) !== "ban_counter_increase_only") {
    throw new Error("decision_rule mismatch: " + JSON.stringify(meta));
  }

  const explorerHost =
    netName === "bradbury"
      ? "https://explorer-bradbury.genlayer.com"
      : netName === "studionet"
        ? "https://explorer-studio.genlayer.com"
        : "";
  const payload = {
    primitive: "Wavehold",
    version: "1.0.2-wavehold",
    address,
    chainId: chain.id,
    network: netName,
    deployTx: txHash,
    explorer: explorerHost ? `${explorerHost}/address/${address}` : "",
    deployedAt: new Date().toISOString(),
    deployer: account.address,
  };
  const json = JSON.stringify(payload, null, 2);
  mkdirSync(path.join(root, "deployments"), { recursive: true });
  writeFileSync(path.join(root, "deployments", `wavehold-${chain.id}.json`), json);
  writeFileSync(path.join(root, "src", "deployed.json"), json);
  writeFileSync(path.join(root, "deployed.json"), json);
  console.log("Wrote deployments and src/deployed.json");
}

main().catch((error) => {
  console.error("Deploy failed:", error);
  process.exit(1);
});
