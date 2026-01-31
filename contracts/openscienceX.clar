
;; title: openscienceX
;; version: 1.0.0
;; summary: Decentralized scientific funding platform
;; description: Allows researchers to submit proposals, community to vote and fund them, with milestone-based releases and Impact NFTs.

;; traits
;; implementation of SIP-009 NFT trait would go here if provided externally
;; (impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; token definitions
(define-non-fungible-token impact-nft uint)

;; constants
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-NOT-FOUND (err u101))
(define-constant ERR-ALREADY-EXISTS (err u102))
(define-constant ERR-INVALID-STATUS (err u103))
(define-constant ERR-INSUFFICIENT-FUNDS (err u104))
(define-constant ERR-VOTING-ENDED (err u105))
(define-constant ERR-MILESTONE-NOT-APPROVED (err u106))
(define-constant ERR-PROPOSAL-NOT-FUNDED (err u107))

;; Status Constants
(define-constant STATUS-PROPOSED "PROPOSED")
(define-constant STATUS-VOTING "VOTING")
(define-constant STATUS-FUNDED "FUNDED")
(define-constant STATUS-REJECTED "REJECTED")
(define-constant STATUS-COMPLETED "COMPLETED")

;; data vars
(define-data-var proposal-nonce uint u0)
(define-data-var milestone-nonce uint u0)
(define-data-var contribution-nonce uint u0)
(define-data-var nft-nonce uint u0)
(define-data-var test-counter uint u0) ;; For testing purposes

;; data maps
(define-map proposals
    uint
    {
        researcher: principal,
        title: (string-utf8 100),
        abstract: (string-utf8 500),
        category: (string-ascii 50),
        funding-requested: uint,
        funding-received: uint,
        status: (string-ascii 20),
        votes-for: uint,
        votes-against: uint,
        created-at: uint,
        voting-ends: uint
    }
)

(define-map milestones
    uint
    {
        proposal-id: uint,
        title: (string-utf8 100),
        funding-amount: uint,
        status: (string-ascii 20), ;; PENDING, APPROVED, REJECTED
        deliverable-hash: (optional (buff 32)),
        completed-at: (optional uint)
    }
)

(define-map contributions
    uint
    {
        donor: principal,
        proposal-id: uint,
        amount: uint,
        nft-id: uint, ;; 0 if not minted yet
        timestamp: uint
    }
)

(define-map researcher-profiles
    principal
    {
        name: (string-utf8 50),
        institution: (string-utf8 100),
        is-verified: bool,
        reputation-score: uint
    }
)

(define-map nft-metadata
    uint
    {
        owner: principal,
        token-uri: (string-ascii 256)
    }
)

;; private functions (Counter Logic)

(define-private (generate-proposal-id)
    (let
        (
            (current-id (+ (var-get proposal-nonce) u1))
        )
        (var-set proposal-nonce current-id)
        current-id
    )
)

(define-private (generate-milestone-id)
    (let
        (
            (current-id (+ (var-get milestone-nonce) u1))
        )
        (var-set milestone-nonce current-id)
        current-id
    )
)

(define-private (generate-contribution-id)
    (let
        (
            (current-id (+ (var-get contribution-nonce) u1))
        )
        (var-set contribution-nonce current-id)
        current-id
    )
)

(define-private (generate-nft-id)
    (let
        (
            (current-id (+ (var-get nft-nonce) u1))
        )
        (var-set nft-nonce current-id)
        current-id
    )
)

;; public functions

;; --------------------------------------------------------------------------
;; Test Counter Logic (Public)
;; --------------------------------------------------------------------------

(define-public (utility-increment-counter)
    (begin
        (var-set test-counter (+ (var-get test-counter) u1))
        (ok (var-get test-counter))
    )
)

(define-public (utility-decrement-counter)
    (begin
        (let ((current (var-get test-counter)))
            (if (> current u0)
                (begin
                    (var-set test-counter (- current u1))
                    (ok (var-get test-counter))
                )
                (err u0) ;; Cannot decrement below 0
            ) 
        )
    )
)

(define-read-only (utility-get-counter)
    (ok (var-get test-counter))
)

;; --------------------------------------------------------------------------
;; Researcher Management
;; --------------------------------------------------------------------------

(define-public (register-researcher (name (string-utf8 50)) (institution (string-utf8 100)))
    (begin
        (asserts! (is-none (map-get? researcher-profiles tx-sender)) ERR-ALREADY-EXISTS)
        (ok (map-set researcher-profiles tx-sender {
            name: name,
            institution: institution,
            is-verified: false,
            reputation-score: u0
        }))
    )
)

(define-read-only (get-researcher-profile (researcher principal))
    (map-get? researcher-profiles researcher)
)

;; --------------------------------------------------------------------------
;; Proposal Management
;; --------------------------------------------------------------------------

(define-public (submit-proposal (title (string-utf8 100)) (abstract (string-utf8 500)) (category (string-ascii 50)) (funding-requested uint))
    (let
        (
            (new-id (generate-proposal-id))
        )
        (map-set proposals new-id {
            researcher: tx-sender,
            title: title,
            abstract: abstract,
            category: category,
            funding-requested: funding-requested,
            funding-received: u0,
            status: STATUS-PROPOSED,
            votes-for: u0,
            votes-against: u0,
            created-at: block-height,
            voting-ends: (+ block-height u144) ;; Approx 1 day for simplicity / example
        })
        (ok new-id)
    )
)

(define-read-only (get-proposal (proposal-id uint))
    (map-get? proposals proposal-id)
)

;; --------------------------------------------------------------------------
;; Voting
;; --------------------------------------------------------------------------

(define-public (vote-on-proposal (proposal-id uint) (vote bool))
    (let
        (
            (proposal (unwrap! (map-get? proposals proposal-id) ERR-NOT-FOUND))
        )
        ;; In a real quadratic voting system, we would track user votes individually
        ;; For this simplified version, we just increment based on sender
        ;; Simplification: One vote per call, no cost for now (requires token locking in full spec)
        (begin
            (asserts! (< block-height (get voting-ends proposal)) ERR-VOTING-ENDED)
            
            (map-set proposals proposal-id
                (merge proposal {
                    votes-for: (if vote (+ (get votes-for proposal) u1) (get votes-for proposal)),
                    votes-against: (if vote (get votes-against proposal) (+ (get votes-against proposal) u1))
                })
            )
            (ok true)
        )
    )
)

;; --------------------------------------------------------------------------
;; Funding
;; --------------------------------------------------------------------------

(define-public (contribute (proposal-id uint) (amount uint))
    (let
        (
            (proposal (unwrap! (map-get? proposals proposal-id) ERR-NOT-FOUND))
            (contribution-id (generate-contribution-id))
        )
        (begin
            (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
            
            ;; Mint NFT
            (let ((nft-id (generate-nft-id)))
                (begin
                    (try! (nft-mint? impact-nft nft-id tx-sender))
                    (map-set nft-metadata nft-id {
                        owner: tx-sender,
                        token-uri: "https://opensciencex.io/metadata/impact-nft.json"
                    })
                    
                    (map-set contributions contribution-id {
                        donor: tx-sender,
                        proposal-id: proposal-id,
                        amount: amount,
                        nft-id: nft-id,
                        timestamp: block-height
                    })
                    
                    (map-set proposals proposal-id
                        (merge proposal {
                            funding-received: (+ (get funding-received proposal) amount),
                            status: (if (>= (+ (get funding-received proposal) amount) (get funding-requested proposal)) STATUS-FUNDED (get status proposal))
                        })
                    )
                    (ok contribution-id)
                )
            )
        )
    )
)

;; --------------------------------------------------------------------------
;; Milestones
;; --------------------------------------------------------------------------

(define-public (add-milestone (proposal-id uint) (title (string-utf8 100)) (funding-amount uint))
    (let
        (
            (proposal (unwrap! (map-get? proposals proposal-id) ERR-NOT-FOUND))
            (milestone-id (generate-milestone-id))
        )
        (begin
            (asserts! (is-eq tx-sender (get researcher proposal)) ERR-NOT-AUTHORIZED)
            (map-set milestones milestone-id {
                proposal-id: proposal-id,
                title: title,
                funding-amount: funding-amount,
                status: "PENDING",
                deliverable-hash: none,
                completed-at: none
            })
            (ok milestone-id)
        )
    )
)

(define-public (submit-milestone-deliverable (milestone-id uint) (deliverable-hash (buff 32)))
    (let
        (
            (milestone (unwrap! (map-get? milestones milestone-id) ERR-NOT-FOUND))
            (proposal (unwrap! (map-get? proposals (get proposal-id milestone)) ERR-NOT-FOUND))
        )
        (begin
            (asserts! (is-eq tx-sender (get researcher proposal)) ERR-NOT-AUTHORIZED)
            (map-set milestones milestone-id
                (merge milestone {
                    deliverable-hash: (some deliverable-hash),
                    status: "SUBMITTED"
                })
            )
            (ok true)
        )
    )
)

(define-public (approve-milestone (milestone-id uint))
    (let
        (
            (milestone (unwrap! (map-get? milestones milestone-id) ERR-NOT-FOUND))
            (proposal (unwrap! (map-get? proposals (get proposal-id milestone)) ERR-NOT-FOUND))
            (amount (get funding-amount milestone))
            (researcher (get researcher proposal))
        )
        (begin
            ;; Simplified: Anyone can approve for now (in reality, should be governance or specific voters)
            (asserts! (is-eq (get status milestone) "SUBMITTED") ERR-INVALID-STATUS)
            
            ;; Release funds
            ;; We use as-contract to switch context to the contract principal
            ;; checks checks if the contract has enough funds and sends to researcher
            (try! (as-contract (stx-transfer? amount tx-sender researcher)))
            
            (map-set milestones milestone-id
                (merge milestone {
                    status: "APPROVED",
                    completed-at: (some block-height)
                })
            )
            (ok true)
        )
    )
)


;; --------------------------------------------------------------------------
;; NFT Standard Functions (SIP-009)
;; --------------------------------------------------------------------------

(define-read-only (get-last-token-id)
    (ok (var-get nft-nonce))
)

(define-read-only (get-token-uri (token-id uint))
    (ok (get token-uri (map-get? nft-metadata token-id)))
)

(define-read-only (get-owner (token-id uint))
    (ok (nft-get-owner? impact-nft token-id))
)

(define-public (transfer (token-id uint) (sender principal) (recipient principal))
    (begin
        (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
        (try! (nft-transfer? impact-nft token-id sender recipient))
        ;; Update internal map if needed? No, built-in map handles ownership, metadata map is fine.
        ;; However, strict consistent metadata map owner update:
        (let ((metadata (unwrap! (map-get? nft-metadata token-id) ERR-NOT-FOUND)))
             (map-set nft-metadata token-id (merge metadata { owner: recipient }))
        )
        (ok true)
    )
)
