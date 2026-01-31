
/**
 * OpenScienceX driver script
 *      -- run the script with --
 *  npx tsx scripts/openscienceX-driver.ts
 *
 * or with options:
 *
 *  npx tsx scripts/openscienceX-driver.ts --fast
 *  npx tsx scripts/openscienceX-driver.ts --mode=counter (test counter increment)
 *  npx tsx scripts/openscienceX-driver.ts --mode=decrement (test counter decrement)
 *  npx tsx scripts/openscienceX-driver.ts --mode=register (register researcher)
 *  npx tsx scripts/openscienceX-driver.ts --mode=proposal (submit proposal)
 *  npx tsx scripts/openscienceX-driver.ts --mode=vote (vote on latest proposal)
 *  npx tsx scripts/openscienceX-driver.ts --mode=fund (fund latest proposal)
 *
 * - Reads the deployer "mnemonic" from settings/Mainnet.toml
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createNetwork, TransactionVersion } from "@stacks/network";
import {
    AnchorMode,
    PostConditionMode,
    makeContractCall,
    broadcastTransaction,
    fetchCallReadOnlyFunction,
    cvToString,
    uintCV,
    stringUtf8CV,
    stringAsciiCV,
    boolCV,
    tupleCV,
} from "@stacks/transactions";
import { generateWallet, getStxAddress } from "@stacks/wallet-sdk";
import * as TOML from "toml";

type NetworkSettings = {
    network?: {
        name?: string;
        stacks_node_rpc_address?: string;
        deployment_fee_rate?: number;
    };
    accounts?: {
        deployer?: {
            mnemonic?: string;
        };
    };
};

// DEPLOYED CONTRACT DETAILS
const CONTRACT_ADDRESS = "SP1GNDB8SXJ51GBMSVVXMWGTPRFHGSMWNNBEY25A4";
const CONTRACT_NAME = "openscienceX";

// Function names
const FN_INCREMENT = "utility-increment-counter";
const FN_DECREMENT = "utility-decrement-counter";
const FN_GET_COUNTER = "utility-get-counter";

const FN_REGISTER = "register-researcher";
const FN_SUBMIT_PROPOSAL = "submit-proposal";
const FN_VOTE = "vote-on-proposal";
const FN_CONTRIBUTE = "contribute";
const FN_GET_PROPOSAL = "get-proposal";

// Reasonable default fee in microstacks for contract-call
const DEFAULT_FEE_USTX = 10000;

// Parse command-line arguments
const FAST = process.argv.includes("--fast");
const MODE =
    process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ||
    "counter";

console.log(`OpenScienceX Driver starting in mode: ${MODE}`);

// Random delay choices (milliseconds)
let DELAY_CHOICES_MS = [
    10_000, 20_000, 30_000
];
if (FAST) {
    DELAY_CHOICES_MS = [1_000, 2_000];
}

// Helper to get current file dir (ESM-compatible)
function thisDirname(): string {
    const __filename = fileURLToPath(import.meta.url);
    return path.dirname(__filename);
}

async function readMainnetMnemonic(): Promise<string> {
    const baseDir = thisDirname();
    // Resolve ../settings/Mainnet.toml relative to scripts/
    const settingsPath = path.resolve(baseDir, "../settings/Mainnet.toml");

    try {
        const raw = await fs.readFile(settingsPath, "utf8");
        const parsed = TOML.parse(raw) as NetworkSettings;

        const mnemonic = parsed?.accounts?.deployer?.mnemonic;
        if (!mnemonic || mnemonic.includes("<YOUR PRIVATE MAINNET MNEMONIC HERE>")) {
            console.warn(`WARNING: Mnemonic not found or default in ${settingsPath}.`);
            // Fallback for testing/CI environments if needed, or error out
            throw new Error(`Mnemonic not found in ${settingsPath}.`);
        }
        return mnemonic.trim();
    } catch (err) {
        console.error(`Error reading settings file: ${(err as Error).message}`);
        throw err;
    }
}

async function deriveSenderFromMnemonic(mnemonic: string) {
    const wallet = await generateWallet({
        secretKey: mnemonic,
        password: "",
    });
    const account = wallet.accounts[0];

    function normalizeSenderKey(key: string): string {
        let k = (key || "").trim();
        if (k.startsWith("0x") || k.startsWith("0X")) k = k.slice(2);
        return k;
    }

    const rawKey = account.stxPrivateKey || "";
    const senderKey = normalizeSenderKey(rawKey);

    const senderAddress = getStxAddress({
        account,
        transactionVersion: TransactionVersion.Mainnet,
    });

    console.log(`Derived sender address: ${senderAddress}`);
    return { senderKey, senderAddress };
}

function pickRandomDelayMs(): number {
    const i = Math.floor(Math.random() * DELAY_CHOICES_MS.length);
    return DELAY_CHOICES_MS[i];
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        if (signal?.aborted) {
            clearTimeout(timer);
            return reject(new Error("aborted"));
        }
        signal?.addEventListener("abort", onAbort);
    });
}

// Read Functions
async function readCounter(network: any, senderAddress: string) {
    const res = await fetchCallReadOnlyFunction({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: FN_GET_COUNTER,
        functionArgs: [],
        network,
        senderAddress,
    });
    return cvToString(res);
}

// Transaction Helper
async function contractCall(
    network: any,
    senderKey: string,
    functionName: string,
    functionArgs: any[] = []
) {
    console.log(`Preparing tx for: ${functionName}`);
    const tx = await makeContractCall({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName,
        functionArgs,
        network,
        senderKey,
        fee: DEFAULT_FEE_USTX,
        anchorMode: AnchorMode.Any,
        postConditionMode: PostConditionMode.Allow,
    });

    try {
        const resp = await broadcastTransaction({ transaction: tx, network });
        const txid = typeof resp === "string" ? resp : (resp as any).txid || "unknown-txid";
        console.log(`Broadcast success: ${txid}`);
        return txid;
    } catch (e: any) {
        throw new Error(`Broadcast failed: ${e.message}`);
    }
}

// ============================================================================
// MODES
// ============================================================================

async function runCounterMode(network: any, senderKey: string, senderAddress: string, stopSignal: AbortSignal) {
    console.log("Mode: COUNTER (Incrementing)");
    while (!stopSignal.aborted) {
        await delay(pickRandomDelayMs(), stopSignal);
        try {
            await contractCall(network, senderKey, FN_INCREMENT);
            const val = await readCounter(network, senderAddress);
            console.log(`Counter value: ${val}`);
        } catch (e) { console.error(e); }
    }
}

async function runDecrementMode(network: any, senderKey: string, senderAddress: string, stopSignal: AbortSignal) {
    console.log("Mode: DECREMENT");
    while (!stopSignal.aborted) {
        await delay(pickRandomDelayMs(), stopSignal);
        try {
            await contractCall(network, senderKey, FN_DECREMENT);
            const val = await readCounter(network, senderAddress);
            console.log(`Counter value: ${val}`);
        } catch (e) { console.error(e); }
    }
}

async function runRegisterMode(network: any, senderKey: string, senderAddress: string, stopSignal: AbortSignal) {
    console.log("Mode: REGISTER");
    // Just run once or loop? Logic suggests registering once, but loop allows retries or multiple identities if we changed keys.
    // For this driver using single key, we try once.
    try {
        const name = `Researcher-${Math.floor(Math.random() * 1000)}`;
        console.log(`Registering as ${name}...`);
        await contractCall(network, senderKey, FN_REGISTER, [
            stringUtf8CV(name),
            stringUtf8CV("Drivers Institute")
        ]);
    } catch (e) { console.error(e); }
}

async function runProposalMode(network: any, senderKey: string, senderAddress: string, stopSignal: AbortSignal) {
    console.log("Mode: PROPOSAL");
    while (!stopSignal.aborted) {
        await delay(pickRandomDelayMs(), stopSignal);
        try {
            const id = Math.floor(Math.random() * 10000);
            await contractCall(network, senderKey, FN_SUBMIT_PROPOSAL, [
                stringUtf8CV(`Project ${id}`),
                stringUtf8CV(`Abstract for project ${id}`),
                stringAsciiCV("Science"),
                uintCV(1000)
            ]);
        } catch (e) { console.error(e); }
    }
}

async function runVoteMode(network: any, senderKey: string, senderAddress: string, stopSignal: AbortSignal) {
    console.log("Mode: VOTE");
    // Hardcoded proposal ID 1 for test driver simplicity, or random
    const proposalId = 1;
    while (!stopSignal.aborted) {
        await delay(pickRandomDelayMs(), stopSignal);
        try {
            console.log(`Voting on proposal ${proposalId}...`);
            await contractCall(network, senderKey, FN_VOTE, [
                uintCV(proposalId),
                boolCV(true)
            ]);
        } catch (e) { console.error(e); }
    }
}

async function runFundMode(network: any, senderKey: string, senderAddress: string, stopSignal: AbortSignal) {
    console.log("Mode: FUND");
    const proposalId = 1;
    while (!stopSignal.aborted) {
        await delay(pickRandomDelayMs(), stopSignal);
        try {
            console.log(`Funding proposal ${proposalId} with 100 uSTX...`);
            await contractCall(network, senderKey, FN_CONTRIBUTE, [
                uintCV(proposalId),
                uintCV(100)
            ]);
        } catch (e) { console.error(e); }
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    const network = createNetwork("mainnet");
    const mnemonic = await readMainnetMnemonic();
    const { senderKey, senderAddress } = await deriveSenderFromMnemonic(mnemonic);

    const stopController = new AbortController();
    const stopSignal = stopController.signal;
    process.on("SIGINT", () => {
        console.log("\nStopping...");
        stopController.abort();
    });

    try {
        switch (MODE) {
            case "counter": await runCounterMode(network, senderKey, senderAddress, stopSignal); break;
            case "decrement": await runDecrementMode(network, senderKey, senderAddress, stopSignal); break;
            case "register": await runRegisterMode(network, senderKey, senderAddress, stopSignal); break;
            case "proposal": await runProposalMode(network, senderKey, senderAddress, stopSignal); break;
            case "vote": await runVoteMode(network, senderKey, senderAddress, stopSignal); break;
            case "fund": await runFundMode(network, senderKey, senderAddress, stopSignal); break;
            default: console.error(`Unknown mode: ${MODE}`);
        }
    } catch (e) {
        if ((e as Error).message !== "aborted") throw e;
    }
}

main().catch(console.error);
