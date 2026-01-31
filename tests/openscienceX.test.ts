
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

describe("OpenScienceX Contract Tests", () => {

    it("should initialize with correct counters", () => {
        // Check test counter starts at 0
        const { result } = simnet.callReadOnlyFn("openscienceX", "utility-get-counter", [], deployer);
        expect(result).toBeOk(Cl.uint(0));
    });

    describe("Researcher Registration", () => {
        it("should allow a user to register as a researcher", () => {
            const { result } = simnet.callPublicFn(
                "openscienceX",
                "register-researcher",
                [Cl.stringUtf8("Alice"), Cl.stringUtf8("MIT")],
                wallet1
            );
            expect(result).toBeOk(Cl.bool(true));

            // Verify profile
            const profile = simnet.callReadOnlyFn("openscienceX", "get-researcher-profile", [Cl.standardPrincipal(wallet1)], deployer);
            expect(profile.result).toBeSome(Cl.tuple({
                name: Cl.stringUtf8("Alice"),
                institution: Cl.stringUtf8("MIT"),
                "is-verified": Cl.bool(false),
                "reputation-score": Cl.uint(0)
            }));
        });

        it("should fail if researcher already exists", () => {
            // Register once
            simnet.callPublicFn("openscienceX", "register-researcher", [Cl.stringUtf8("Bob"), Cl.stringUtf8("Stanford")], wallet2);

            // Register again
            const { result } = simnet.callPublicFn("openscienceX", "register-researcher", [Cl.stringUtf8("Bob2"), Cl.stringUtf8("Stanford")], wallet2);
            expect(result).toBeErr(Cl.uint(102)); // ERR-ALREADY-EXISTS
        });
    });

    describe("Proposal Management", () => {
        it("should allow a registered researcher to submit a proposal", () => {
            // Register first
            simnet.callPublicFn("openscienceX", "register-researcher", [Cl.stringUtf8("Alice"), Cl.stringUtf8("MIT")], wallet1);

            const { result } = simnet.callPublicFn(
                "openscienceX",
                "submit-proposal",
                [
                    Cl.stringUtf8("Cancer Cure"),
                    Cl.stringUtf8("Researching..."),
                    Cl.stringAscii("Health"),
                    Cl.uint(1000)
                ],
                wallet1
            );
            expect(result).toBeOk(Cl.uint(1)); // First proposal ID should be 1
        });

        it("should track proposal details correctly", () => {
            // Setup state for this test
            simnet.callPublicFn("openscienceX", "register-researcher", [Cl.stringUtf8("Alice"), Cl.stringUtf8("MIT")], wallet1);
            simnet.callPublicFn("openscienceX", "submit-proposal", [Cl.stringUtf8("Title"), Cl.stringUtf8("Abstract"), Cl.stringAscii("Health"), Cl.uint(1000)], wallet1);

            const proposal = simnet.callReadOnlyFn("openscienceX", "get-proposal", [Cl.uint(1)], deployer);
            // Checking if result is Ok/Some
            expect(proposal.result).toBeSome(expect.anything());
        });
    });

    describe("Voting Mechanics", () => {
        it("should allow users to vote on a proposal", () => {
            // Setup
            simnet.callPublicFn("openscienceX", "register-researcher", [Cl.stringUtf8("Alice"), Cl.stringUtf8("MIT")], wallet1);
            simnet.callPublicFn("openscienceX", "submit-proposal", [Cl.stringUtf8("Title"), Cl.stringUtf8("Abstract"), Cl.stringAscii("Health"), Cl.uint(1000)], wallet1);

            // Vote YES
            const { result } = simnet.callPublicFn("openscienceX", "vote-on-proposal", [Cl.uint(1), Cl.bool(true)], wallet2);
            expect(result).toBeOk(Cl.bool(true));
        });
    });

    describe("Funding & NFTs", () => {
        it("should allow contribution and mint NFT", () => {
            // Setup
            simnet.callPublicFn("openscienceX", "register-researcher", [Cl.stringUtf8("Alice"), Cl.stringUtf8("MIT")], wallet1);
            simnet.callPublicFn("openscienceX", "submit-proposal", [Cl.stringUtf8("Title"), Cl.stringUtf8("Abstract"), Cl.stringAscii("Health"), Cl.uint(1000)], wallet1);

            const contributionAmount = 500;
            const { result } = simnet.callPublicFn(
                "openscienceX",
                "contribute",
                [Cl.uint(1), Cl.uint(contributionAmount)],
                wallet3
            );

            expect(result).toBeOk(Cl.uint(1)); // Contribution ID 1

            // Verify NFT ownership
            const owner = simnet.callReadOnlyFn("openscienceX", "get-owner", [Cl.uint(1)], deployer);
            expect(owner.result).toBeOk(Cl.some(Cl.standardPrincipal(wallet3)));
        });
    });

    describe("Milestone Flow", () => {
        it("should allow researcher to add a milestone", () => {
            // Setup
            simnet.callPublicFn("openscienceX", "register-researcher", [Cl.stringUtf8("Alice"), Cl.stringUtf8("MIT")], wallet1);
            simnet.callPublicFn("openscienceX", "submit-proposal", [Cl.stringUtf8("Title"), Cl.stringUtf8("Abstract"), Cl.stringAscii("Health"), Cl.uint(1000)], wallet1);

            const { result } = simnet.callPublicFn(
                "openscienceX",
                "add-milestone",
                [Cl.uint(1), Cl.stringUtf8("Phase 1"), Cl.uint(200)],
                wallet1
            );
            expect(result).toBeOk(Cl.uint(1));
        });

        it("should allow researcher to submit milestone deliverable", () => {
            // Setup
            simnet.callPublicFn("openscienceX", "register-researcher", [Cl.stringUtf8("Alice"), Cl.stringUtf8("MIT")], wallet1);
            simnet.callPublicFn("openscienceX", "submit-proposal", [Cl.stringUtf8("Title"), Cl.stringUtf8("Abstract"), Cl.stringAscii("Health"), Cl.uint(1000)], wallet1);
            simnet.callPublicFn("openscienceX", "add-milestone", [Cl.uint(1), Cl.stringUtf8("Phase 1"), Cl.uint(200)], wallet1);

            // dummy hash 32 bytes
            const hash = "0x" + "00".repeat(32);
            const { result } = simnet.callPublicFn(
                "openscienceX",
                "submit-milestone-deliverable",
                [Cl.uint(1), Cl.bufferFromHex(hash)],
                wallet1
            );
            expect(result).toBeOk(Cl.bool(true));
        });

        it("should approve milestone and release funds", () => {
            // Setup
            simnet.callPublicFn("openscienceX", "register-researcher", [Cl.stringUtf8("Alice"), Cl.stringUtf8("MIT")], wallet1);
            simnet.callPublicFn("openscienceX", "submit-proposal", [Cl.stringUtf8("Title"), Cl.stringUtf8("Abstract"), Cl.stringAscii("Health"), Cl.uint(1000)], wallet1);
            simnet.callPublicFn("openscienceX", "add-milestone", [Cl.uint(1), Cl.stringUtf8("Phase 1"), Cl.uint(200)], wallet1);
            const hash = "0x" + "00".repeat(32);
            simnet.callPublicFn("openscienceX", "submit-milestone-deliverable", [Cl.uint(1), Cl.bufferFromHex(hash)], wallet1);

            // Fund the proposal so contract has funds
            simnet.callPublicFn("openscienceX", "contribute", [Cl.uint(1), Cl.uint(500)], wallet3);

            // Approve
            const { result } = simnet.callPublicFn("openscienceX", "approve-milestone", [Cl.uint(1)], wallet2);
            expect(result).toBeOk(Cl.bool(true));
        });
    });

    describe("Test Counter Utility", () => {
        it("should increment test counter", () => {
            const { result } = simnet.callPublicFn("openscienceX", "utility-increment-counter", [], deployer);
            expect(result).toBeOk(Cl.uint(1));
        });

        it("should decrement test counter", () => {
            simnet.callPublicFn("openscienceX", "utility-increment-counter", [], deployer); // make it 1
            const { result } = simnet.callPublicFn("openscienceX", "utility-decrement-counter", [], deployer);
            expect(result).toBeOk(Cl.uint(0));
        });

        it("should not decrement below zero", () => {
            // Default 0
            const { result } = simnet.callPublicFn("openscienceX", "utility-decrement-counter", [], deployer);
            expect(result).toBeErr(Cl.uint(0)); // ERR u0 from logic
        });
    });

});
