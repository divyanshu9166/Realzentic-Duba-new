# Implementation Plan: Real Estate CRM (16 Modules / 5 Phases)

## Overview

This plan implements 16 new modules additively on top of the existing Next.js (App Router) + Prisma/PostgreSQL Realzentic codebase. Work is organized by phase and module. Each module first lands its pure, property-testable helpers in `lib/`, then its server actions in `app/actions/*.ts` (with Zod validation in `lib/validations/*`), then its UI and integration wiring. Property-based tests (using `fast-check`) implement the 69 correctness properties from the design and are placed next to the code they validate. Optional test sub-tasks are marked with `*`. Correctness is the top priority: the schema must `prisma db push` cleanly and the app must `npm run build` with zero errors.

## Tasks

- [x] 1. Foundation: schema, test infra, money helpers, and build gate
  - [x] 1.1 Add all new Prisma models, enums, and existing-model extensions to `prisma/schema.prisma`
    - Add enums (ProjectType, ProjectStatus, UnitType, UnitFacing, UnitStatus, CommissionType, PartnerType, PartnerStatus, CommissionStatus, PayoutBatchStatus, MilestoneStatus, BookingStatus, DocumentStatus, SupportTicketStatus)
    - Add Phase 1–5 models (Project, Tower, Floor, Unit, UnitPriceHistory, CostSheet, PaymentPlan, PaymentSchedule, DealStage, Deal, DealActivity, Booking, BookingMilestone, DemandLetter, ChannelPartner, CPLead, CPCommission, CPPayoutBatch, Document, KYCRecord, DocumentTemplate, AgentScore, Badge, AgentBadge, PortalConfig, PortalLead, BuyerSession, ConstructionUpdate, SupportTicket, PossessionChecklist, ReferralProgram, Referral)
    - Extend existing `FieldVisit` model and add back-relations to `Contact`, `Staff`, `Lead` without duplicating existing models
    - Run `npx prisma generate` and `npx prisma db push` against a dev database
    - _Requirements: 20.1, 20.2, 20.8_
  - [x] 1.2 Create shared money helper and validation scaffolding
    - Implement `lib/money.ts` with `roundMoney(n)` (round-half-up to 2 dp) and `assertMoneyRange(n)` (0.00–999,999,999.99)
    - Create `lib/validations/` module structure and shared Zod primitives (money range, enums, rating 1–5, percentage 0–100)
    - _Requirements: 20.4_
  - [x]* 1.3 Set up property-based testing infrastructure
    - Install/configure `fast-check` with the existing test runner; add money/coordinate/score generators
    - Configure `fc.assert(..., { numRuns: 100 })` default and the property-tag comment convention
    - _Requirements: 20.4_

- [x] 2. Module 1 — Inventory pure helpers
  - [x] 2.1 Implement inventory pure functions in `lib/inventory.ts`
    - `computeTotalPrice`, `computePercentSold`, `canTransition` (transition table), `computeAnalytics`, and a pure `filterUnits` predicate
    - _Requirements: 1.5, 1.6, 1.8, 2.1, 2.2, 2.8_
  - [x]* 2.2 Property test: unit total price composition
    - **Property 1: Unit total price composition**
    - **Validates: Requirements 1.5**
  - [x]* 2.3 Property test: percentage sold bounded and well-defined
    - **Property 2: Percentage sold is bounded and well-defined**
    - **Validates: Requirements 1.6**
  - [x]* 2.4 Property test: unit filtering soundness and completeness
    - **Property 3: Unit filtering soundness and completeness**
    - **Validates: Requirements 1.8**
  - [x]* 2.5 Property test: unit status transition table
    - **Property 6: Unit status transition table**
    - **Validates: Requirements 2.1, 2.2**
  - [x]* 2.6 Property test: inventory analytics aggregation
    - **Property 11: Inventory analytics aggregation**
    - **Validates: Requirements 2.8**

- [ ] 3. Module 1 — Inventory service and UI
  - [x] 3.1 Implement inventory validation schemas in `lib/validations/properties.ts`
    - Zod schemas for Project, Tower, Floor, Unit with required-field, enum, and range checks
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.10, 20.4_
  - [x] 3.2 Implement core inventory server actions in `app/actions/properties.ts`
    - `createProject`, `createTower`, `createFloor`, `createUnit`, `bulkCreateUnits` (single transaction, all-or-nothing), `listProjects`, `getProjectDetail`, `filterUnits`, `getInventoryAnalytics`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.8, 20.6_
  - [x] 3.3 Implement unit status, holds, and price-revision actions in `app/actions/properties.ts`
    - `changeUnitStatus` (transition table inside tx with row lock), `blockUnit` (Timed_Hold 1–168h, default 48h), `revisePrice` (UnitPriceHistory), hold-expiry sweep
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 20.5, 20.7_
  - [ ]* 3.4 Property test: bulk unit creation is all-or-nothing
    - **Property 4: Bulk unit creation is all-or-nothing**
    - **Validates: Requirements 1.9**
  - [ ]* 3.5 Property test: record validation rejects invalid input by field
    - **Property 5: Record validation rejects invalid input by field**
    - **Validates: Requirements 1.10, 20.4**
  - [ ]* 3.6 Property test: block/book requires Available
    - **Property 7: Block/book requires Available**
    - **Validates: Requirements 2.3**
  - [ ]* 3.7 Property test: timed hold expiry bounds
    - **Property 8: Timed hold expiry bounds**
    - **Validates: Requirements 2.5**
  - [ ]* 3.8 Property test: expired holds revert to Available
    - **Property 9: Expired holds revert to Available**
    - **Validates: Requirements 2.6**
  - [ ]* 3.9 Property test: price revision records history
    - **Property 10: Price revision records history**
    - **Validates: Requirements 2.7**
  - [ ]* 3.10 Integration test: concurrent block/booking serialization
    - Two simultaneous transactions against a test DB; only the first succeeds
    - _Requirements: 2.4_
  - [x] 3.11 Build inventory UI under `app/(dashboard)/properties`
    - Project cards (photo, name, location, RERA badge, unit count, % sold), project detail with tower tabs and color-coded floor grid, unit filter panel with empty-state, analytics view
    - _Requirements: 1.6, 1.7, 1.8, 2.8_
  - [ ]* 3.12 Unit/component tests for inventory persistence and floor grid
    - Persistence round-trips for Project/Tower/Floor/Unit and floor-grid color-coding snapshot
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7_

- [x] 4. Module 2 — Cost Sheet pure helpers
  - [x] 4.1 Implement cost-sheet pure functions in `lib/cost-sheet.ts`
    - `computeNetPayable`, `validateDiscount`, `computeStampDuty` (state rate, Maharashtra default), `gstRateForProject`, `splitMilestones`
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.11_
  - [x]* 4.2 Property test: net payable composition
    - **Property 12: Net payable composition**
    - **Validates: Requirements 3.3**
  - [x]* 4.3 Property test: discount never makes net payable negative
    - **Property 13: Discount never makes net payable negative**
    - **Validates: Requirements 3.4**
  - [x]* 4.4 Property test: stamp duty uses state rate with Maharashtra default
    - **Property 14: Stamp duty uses state rate with Maharashtra default**
    - **Validates: Requirements 3.5, 10.3**
  - [x]* 4.5 Property test: GST rate is total over project status
    - **Property 15: GST rate is total over project status**
    - **Validates: Requirements 3.6, 3.7, 3.8**
  - [x]* 4.6 Property test: milestone amounts sum to the basis amount
    - **Property 16: Milestone amounts sum to the basis amount**
    - **Validates: Requirements 3.11, 5.5**

- [ ] 5. Module 2 — Cost Sheet service and UI
  - [x] 5.1 Implement cost-sheet server actions in `app/actions/properties.ts`
    - `buildCostSheet` (auto-populate from unit, validate discount), `upsertPaymentPlan` (≤1 default per project), PaymentSchedule generation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.11, 20.4_
  - [x] 5.2 Implement cost-sheet PDF generation and sharing
    - `generateCostSheetPdf` (branded via StoreSettings, preserve old URL on failure), `shareCostSheet` (WhatsApp/Email with observable delivery status)
    - _Requirements: 3.9, 3.10_
  - [ ]* 5.3 Integration test: cost-sheet PDF generation success and failure
    - Real `jspdf` path; on failure the existing PDF URL is preserved and an error returned
    - _Requirements: 3.9_
  - [x] 5.4 Build cost-sheet UI in properties module
    - Cost-sheet builder form with itemized breakdown, PDF preview, share actions, payment-plan editor
    - _Requirements: 3.1, 3.10, 3.11_
  - [ ]* 5.5 Unit tests for cost-sheet persistence and payment-plan default constraint
    - Persistence round-trip and at-most-one-default-per-project enforcement
    - _Requirements: 3.2, 3.11_

- [x] 6. Module 3 — Deal & Booking pure helpers
  - [x] 6.1 Implement deal/booking pure functions in `lib/deals.ts`
    - `validateStageMove` (lost-reason rule, target existence), `milestonesFromPlan`, `milestoneStatus`, `applyMilestonePayment`, deal-analytics aggregator
    - _Requirements: 4.4, 4.8, 4.9, 5.5, 5.8, 9.7, 9.8_
  - [x]* 6.2 Property test: valid stage move logs an activity
    - **Property 17: Valid stage move logs an activity**
    - **Validates: Requirements 4.3**
  - [x]* 6.3 Property test: invalid stage move is rejected
    - **Property 18: Invalid stage move is rejected**
    - **Validates: Requirements 4.4**
  - [x]* 6.4 Property test: lost stage requires a lost reason
    - **Property 19: Lost stage requires a lost reason**
    - **Validates: Requirements 4.9**
  - [x]* 6.5 Property test: deal analytics aggregation
    - **Property 20: Deal analytics aggregation**
    - **Validates: Requirements 4.8**
  - [x]* 6.6 Property test: milestone status reflects payment and due date
    - **Property 23: Milestone status reflects payment and due date**
    - **Validates: Requirements 5.8, 9.7**
  - [x]* 6.7 Property test: invalid milestone payments are rejected
    - **Property 24: Invalid milestone payments are rejected**
    - **Validates: Requirements 9.8**

- [ ] 7. Module 3 — Deal & Booking service and Kanban UI
  - [x] 7.1 Implement deal pipeline actions in `app/actions/deals.ts`
    - DealStage CRUD/reorder, `createDeal`, `moveDeal` (logs DealActivity), `getDealDetail`, `getDealAnalytics`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7, 4.8, 4.9, 20.7_
  - [x] 7.2 Implement booking engine actions in `app/actions/deals.ts`
    - `convertDealToBooking` (single tx; unit→Booked with row lock), `recordTokenPayment` (via DailyPayment), `cancelBooking` (unit→Available in tx), milestone generation
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 20.5, 20.6, 20.7_
  - [ ]* 7.3 Property test: booking conversion requires Available or Blocked unit
    - **Property 21: Booking conversion requires Available or Blocked unit**
    - **Validates: Requirements 5.2, 5.3**
  - [ ]* 7.4 Property test: booking cancellation restores the unit
    - **Property 22: Booking cancellation restores the unit**
    - **Validates: Requirements 5.7**
  - [ ]* 7.5 Integration test: concurrent deal-to-booking conversion serialization
    - Two simultaneous conversions on the same unit; only the first succeeds
    - _Requirements: 5.4_
  - [x] 7.6 Build deal Kanban board and deal-detail UI under `app/(dashboard)/deals`
    - `@dnd-kit` Kanban with optimistic move, revert-on-failure with error message; deal detail with activity timeline, documents, milestone tracker, cost-sheet viewer
    - _Requirements: 4.5, 4.6, 4.7_
  - [ ]* 7.7 Unit test: deal-card drag revert on failed update
    - Mocked failing `moveDeal` returns card to original column with error
    - _Requirements: 4.6_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Module 4 — Channel Partner pure helpers
  - [x] 9.1 Implement commission pure function in `lib/commission.ts`
    - `computeCommission(type, rate, fixedAmount, slabs, agreementValue)` for Percentage/Fixed/Slab, rounded 2 dp
    - _Requirements: 6.4, 6.5, 6.8_
  - [x]* 9.2 Property test: percentage commission computation
    - **Property 25: Percentage commission computation**
    - **Validates: Requirements 6.4**
  - [x]* 9.3 Property test: slab commission selects the matching slab
    - **Property 26: Slab commission selects the matching slab**
    - **Validates: Requirements 6.5**
  - [x]* 9.4 Property test: fixed commission is value-independent
    - **Property 27: Fixed commission is value-independent**
    - **Validates: Requirements 6.8**

- [ ] 10. Module 4 — Channel Partner admin and portal
  - [x] 10.1 Implement channel-partner admin actions in `app/actions/channel-partners.ts`
    - `onboardPartner` (RERA required + unique), `createCpLead`, `createCommission`/`approveCommission`, `createPayoutBatch`, `completePayoutBatch` (included commissions→Paid), `getPartnerMetrics`
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.7, 6.9, 20.7_
  - [ ]* 10.2 Property test: completing a payout batch marks commissions paid
    - **Property 28: Completing a payout batch marks commissions paid**
    - **Validates: Requirements 6.6**
  - [ ]* 10.3 Property test: RERA broker number required and unique
    - **Property 29: RERA broker number required and unique**
    - **Validates: Requirements 6.9**
  - [x] 10.4 Implement channel-partner admin UI under `app/(dashboard)/channel-partners`
    - Partner listings + metrics, onboarding form requiring RERA, commission ledger, payout-batch management
    - _Requirements: 6.7_
  - [x] 10.5 Implement Channel Portal auth and guard in `app/channel-portal/`
    - Independent `cp_session` signed cookie, Active-only login, rate limit (5 fails/15 min → 15 min block) via `lib/rate-limit.ts`, unauthenticated redirect to login
    - _Requirements: 7.1, 7.2, 7.8, 21.1_
  - [x] 10.6 Implement Channel Portal data actions scoped by partner
    - `cpBrowseInventory` (live Available units, error state if unavailable), `cpSubmitLead` (required-field validation), `cpCommissionStatements` (own data only) + statement PDF
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7, 21.2_
  - [ ]* 10.7 Property test: channel partner data isolation
    - **Property 30: Channel partner data isolation**
    - **Validates: Requirements 7.3, 7.4, 21.2**
  - [ ]* 10.8 Property test: channel portal browses only Available units
    - **Property 31: Channel portal browses only Available units**
    - **Validates: Requirements 7.5**
  - [ ]* 10.9 Property test: channel partner lead submission validation
    - **Property 32: Channel partner lead submission validation**
    - **Validates: Requirements 7.6**

- [x] 11. Phase 1 checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Module 5 — Document Management & KYC
  - [x] 12.1 Implement document pure helpers in `lib/documents.ts`
    - `validateUpload(sizeBytes, mimeType)` (1B–25MB, type allow-list), `resolveMergeFields(templateBody, values)`, expiry-window predicate
    - _Requirements: 8.2, 8.3, 8.6, 8.7_
  - [x]* 12.2 Property test: upload accepted within size and type bounds
    - **Property 33: Upload accepted within size and type bounds**
    - **Validates: Requirements 8.2, 8.3**
  - [x]* 12.3 Property test: template generation requires all merge fields
    - **Property 34: Template generation requires all merge fields**
    - **Validates: Requirements 8.6**
  - [x]* 12.4 Property test: document expiry alert window
    - **Property 35: Document expiry alert window**
    - **Validates: Requirements 8.7**
  - [x] 12.5 Implement document server actions in `app/actions/documents.ts`
    - `uploadDocument` (store under `uploads/`, auto-categorize), `createKycRecord`, `upsertDocumentTemplate`, `generateFromTemplate` (reject unresolved field), `listExpiringDocuments`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 20.4_
  - [x] 12.6 Build documents UI under `app/(dashboard)/documents`
    - Tabs (All/Contact/Deal/Project), drag-and-drop upload with size/type validation, expiry alerts, KYC center, template manager
    - _Requirements: 8.7, 8.8_
  - [ ]* 12.7 Unit tests for document persistence and KYC records
    - Persistence round-trips and enum/status mapping
    - _Requirements: 8.1, 8.4, 8.5_

- [ ] 13. Module 6 — Demand Letter & Payment Automation
  - [x] 13.1 Implement demand-letter pure helpers in `lib/demand.ts`
    - `shouldGenerateDemand(milestone, now, windowDays, existingLetters)`, overdue-collections aggregator
    - _Requirements: 9.1, 9.6_
  - [x]* 13.2 Property test: demand letter generation and de-duplication
    - **Property 36: Demand letter generation and de-duplication**
    - **Validates: Requirements 9.1**
  - [x]* 13.3 Property test: overdue collections aggregation
    - **Property 37: Overdue collections aggregation**
    - **Validates: Requirements 9.6**
  - [x] 13.4 Implement demand-letter and milestone-payment actions in `app/actions/deals.ts`
    - `generateDemandLetters` (dedup), `sendDemandLetter` (WhatsApp+Email, retry ≤3, notify manager on failure), `sweepOverdueMilestones`, `recordMilestonePayment` (partial/paid; reject invalid), `getOverdueCollections`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.7, 9.8, 20.7_
  - [x] 13.5 Wire BullMQ jobs and cron routes for demand letters and overdue sweep
    - `app/api/cron/demand-letters` and `app/api/cron/overdue-sweep` trigger the respective actions
    - _Requirements: 9.1, 9.4_
  - [x] 13.6 Build milestone timeline UI and Overdue Collections dashboard widget
    - Per-milestone Send Demand / Mark Paid actions, demand-letter history, dashboard widget (count + sum unpaid)
    - _Requirements: 9.5, 9.6_
  - [ ]* 13.7 Integration test: demand-letter dispatch with mocked transports
    - WhatsApp/Email send with retry on failure and manager notification
    - _Requirements: 9.2, 9.3_

- [x] 14. Module 7 — EMI & Affordability Calculator
  - [x] 14.1 Implement EMI pure functions in `lib/emi.ts`
    - `computeEmi`, `amortizationSchedule`, `validateDownPayment`; reuse `computeStampDuty`
    - _Requirements: 10.1, 10.3, 10.6_
  - [x]* 14.2 Property test: EMI computation and amortization consistency
    - **Property 38: EMI computation and amortization consistency**
    - **Validates: Requirements 10.1**
  - [x]* 14.3 Property test: down payment must be below property value
    - **Property 39: Down payment must be below property value**
    - **Validates: Requirements 10.6**
  - [x] 14.4 Build EMI calculator tool at `app/(dashboard)/tools/emi-calculator/page.js`
    - Inputs + results, bank-rate comparison (SBI/HDFC/ICICI/Axis/Kotak/PNB), save-to-deal as `Deal.metadata` JSON, shareable link + WhatsApp share, down-payment validation error
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6_
  - [ ]* 14.5 Unit test: bank-rate table rendering and save-to-deal metadata
    - Bank-rate table render and JSON persisted to `Deal.metadata` without a new model
    - _Requirements: 10.2, 10.4_

- [ ] 15. Module 8 — Duplicate Lead Detection
  - [x] 15.1 Implement dedup pure functions in `lib/dedup.ts`
    - `levenshtein`, `normalizePhone`, `isDuplicate`, `duplicateConfidence` (0–100), dedup-grouping function
    - _Requirements: 11.1, 11.2, 11.6_
  - [x]* 15.2 Property test: duplicate detection criteria
    - **Property 40: Duplicate detection criteria**
    - **Validates: Requirements 11.1**
  - [x]* 15.3 Property test: duplicate confidence is bounded
    - **Property 41: Duplicate confidence is bounded**
    - **Validates: Requirements 11.2**
  - [x]* 15.4 Property test: dedup report groups are valid
    - **Property 43: Dedup report groups are valid**
    - **Validates: Requirements 11.6**
  - [x] 15.5 Extend `app/actions/leads.ts` with detection, merge, and report actions
    - `findDuplicates`, `mergeContacts` (tx; reassign all linked records), `dedupReport`, extend `createLead` to link existing phone to existing Contact
    - _Requirements: 11.1, 11.3, 11.4, 11.6, 11.7, 20.6_
  - [ ]* 15.6 Property test: merge preserves all linked records
    - **Property 42: Merge preserves all linked records**
    - **Validates: Requirements 11.3**
  - [ ]* 15.7 Property test: existing phone reuses contact
    - **Property 44: Existing phone reuses contact**
    - **Validates: Requirements 11.7**
  - [ ]* 15.8 Integration test: merge transactional rollback
    - A failing merge leaves source and target contacts in pre-merge state
    - _Requirements: 11.4_
  - [x] 15.9 Build duplicate-warning UI and badges in leads pages
    - Warning modal listing matches with confidence + Merge/Create New actions, duplicate badge on leads
    - _Requirements: 11.2, 11.5_

- [x] 16. Phase 2 checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Module 9 — Site Visit 2.0
  - [x] 17.1 Implement geo and visit-analytics pure helpers in `lib/geo.ts`
    - `haversineMeters`, `withinGeofence(radiusM=500)`, visit-analytics aggregator
    - _Requirements: 12.4, 12.6_
  - [x]* 17.3 Property test: geofence check-in threshold
    - **Property 46: Geofence check-in threshold**
    - **Validates: Requirements 12.4**
  - [x]* 17.4 Property test: visit analytics aggregation
    - **Property 47: Visit analytics aggregation**
    - **Validates: Requirements 12.6**
  - [x] 17.5 Extend `app/actions/field-visits.ts` for Site Visit 2.0
    - Geo check-in validation, structured feedback capture, follow-up/deal creation, analytics
    - _Requirements: 12.1, 12.4, 12.5, 12.6_
  - [x] 17.6 Build Site Visit 2.0 UI (check-in, feedback, analytics)
    - Geo check-in flow, structured feedback form, analytics view
    - _Requirements: 12.4, 12.5, 12.6_
  - [ ]* 17.7 Integration test: OTP dispatch with mocked transport
    - OTP sent via WhatsApp with SMS fallback
    - _Requirements: 12.2_

- [ ] 18. Module 10 — Team Leaderboard & Gamification
  - [x] 18.1 Implement gamification pure helpers in `lib/gamification.ts`
    - Leaderboard ranking sort over selected metric, badge-criteria evaluation
    - _Requirements: 13.3, 13.4_
  - [x]* 18.2 Property test: leaderboard ranking order
    - **Property 48: Leaderboard ranking order**
    - **Validates: Requirements 13.3**
  - [x] 18.3 Implement gamification actions in `app/actions/gamification.ts`
    - AgentScore/Badge persistence, `awardBadges` (exactly once per period via unique constraint), leaderboard query, visibility gating
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  - [ ]* 18.4 Property test: badges awarded once per period
    - **Property 49: Badges awarded once per period**
    - **Validates: Requirements 13.4**
  - [x] 18.5 Build leaderboard UI and Top Performers widget
    - Ranked table, agent scorecard, badges panel, dashboard Top Performers widget with visibility gating
    - _Requirements: 13.3, 13.5, 13.6_

- [ ] 19. Module 11 — Unified Contact Timeline
  - [x] 19.1 Implement timeline pure helpers in `lib/timeline.ts`
    - `mergeTimeline(sources)` (union + reverse-chronological sort), type filter, pagination partition
    - _Requirements: 14.1, 14.2, 14.4, 14.5_
  - [x]* 19.2 Property test: timeline merge and ordering
    - **Property 50: Timeline merge and ordering**
    - **Validates: Requirements 14.1, 14.2**
  - [x]* 19.3 Property test: timeline type filter
    - **Property 51: Timeline type filter**
    - **Validates: Requirements 14.4**
  - [x]* 19.4 Property test: timeline pagination partitions entries
    - **Property 52: Timeline pagination partitions entries**
    - **Validates: Requirements 14.5**
  - [x] 19.5 Implement timeline action in `app/actions/timeline.ts`
    - `getContactTimeline(contactId, cursor, type?)` aggregating calls, messages, emails, visits, payments, documents, deal-stage changes, notes
    - _Requirements: 14.1, 14.2, 14.5_
  - [x] 19.6 Build timeline UI with infinite scroll and type filter
    - Entry rendering (icon, badge, description, timestamp, performed-by), type filter, infinite scroll
    - _Requirements: 14.3, 14.4, 14.5_

- [ ] 20. Module 12 — Property Portal Integration
  - [x] 20.1 Implement portal-payload pure helper in `lib/portal.ts`
    - `validatePortalPayload(payload)`, source-attribution mapping
    - _Requirements: 15.5, 15.6_
  - [x]* 20.2 Property test: disabled portals ignore webhooks
    - **Property 53: Disabled portals ignore webhooks**
    - **Validates: Requirements 15.4**
  - [x]* 20.3 Property test: invalid webhook payloads create no records
    - **Property 54: Invalid webhook payloads create no records**
    - **Validates: Requirements 15.6**
  - [x] 20.4 Implement portal integration actions in `app/actions/portal-integration.ts`
    - PortalConfig/PortalLead persistence, dedup against contacts, create Contact+Lead, auto-assign per config, notify assignee, ignore disabled portals
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x] 20.5 Implement webhook handler route `app/api/webhooks/portals/[portal]`
    - Validate payload, route to ingestion, return errors without creating records on invalid input
    - _Requirements: 15.3, 15.6_
  - [ ]* 20.6 Integration test: portal webhook end-to-end ingestion
    - Valid webhook creates Contact+Lead, auto-assigns, and notifies assignee
    - _Requirements: 15.3_

- [x] 21. Phase 3 checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 22. Module 13 — AI Property Matching
  - [x] 22.1 Implement match scorer in `lib/matching.ts`
    - `scoreMatch(preferences, unit)` (0–100), ranking and Available-only filter
    - _Requirements: 16.1, 16.2_
  - [x]* 22.2 Property test: match scoring is bounded and ranked
    - **Property 55: Match scoring is bounded and ranked**
    - **Validates: Requirements 16.1**
  - [x]* 22.3 Property test: matching considers only Available units
    - **Property 56: Matching considers only Available units**
    - **Validates: Requirements 16.2**
  - [x] 22.4 Implement matching actions in `app/actions/ai-matching.ts`
    - `matchUnits(preferences)`, `notifyMatchingAgents(unit)` on new inventory
    - _Requirements: 16.1, 16.2, 16.3_
  - [x] 22.5 Build AI Match UI in leads and deal views
    - "AI Match" action + matched-properties panel with WhatsApp send; AI-suggested units in deal view
    - _Requirements: 16.4, 16.5_
  - [ ]* 22.6 Integration test: matching-agent notification on new inventory
    - New matching unit notifies agents of matching buyers
    - _Requirements: 16.3_

- [ ] 23. Module 14 — AI Deal Predictor
  - [x] 23.1 Implement deal scorer in `lib/deal-score.ts`
    - `computeDealScore(deal, signals)` (weighted, clamped 0–100; token forces 90–100), hot/at-risk classifiers
    - _Requirements: 17.1, 17.2, 17.4, 17.6_
  - [x]* 23.2 Property test: deal score is bounded and clamped
    - **Property 57: Deal score is bounded and clamped**
    - **Validates: Requirements 17.1**
  - [x]* 23.3 Property test: token payment forces a high score
    - **Property 58: Token payment forces a high score**
    - **Validates: Requirements 17.2**
  - [x]* 23.4 Property test: hot deal threshold
    - **Property 59: Hot deal threshold**
    - **Validates: Requirements 17.4**
  - [x]* 23.5 Property test: at-risk classification
    - **Property 60: At-risk classification**
    - **Validates: Requirements 17.6**
  - [x] 23.6 Implement predictor actions in `app/actions/ai-deal-predictor.ts`
    - `scoreAndPersistDeal` (store score + timestamp, mark hot/at-risk, notify/auto-nurture), `recalcAllDeals` (daily, retain last score on per-deal failure)
    - _Requirements: 17.3, 17.4, 17.5, 17.6, 17.7, 17.8_
  - [ ]* 23.7 Property test: failed recalculation retains last score
    - **Property 61: Failed recalculation retains last score**
    - **Validates: Requirements 17.8**
  - [x] 23.8 Wire daily recalculation cron and deals-page badges/sorting
    - BullMQ/cron daily recalc; probability badge, score sort/filter, At Risk panel on deals page
    - _Requirements: 17.7, 17.9, 17.10_
  - [ ]* 23.9 Integration test: Hot-deal and At-risk notification timing
    - Notifications/auto-nurture fire within the specified window
    - _Requirements: 17.5_

- [x] 24. Phase 4 checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 25. Module 15 — Buyer Self-Service Portal
  - [x] 25.1 Implement buyer-auth pure helpers in `lib/buyer-auth.ts`
    - `otpExpired(generatedAt, now, ttl=300)`, 6-digit OTP check, `sessionExpired(createdAt, now, ttl=86400)`, support-ticket required-field validation
    - _Requirements: 18.2, 18.3, 18.7, 18.9, 21.3_
  - [x]* 25.2 Property test: OTP expiry window
    - **Property 62: OTP expiry window**
    - **Validates: Requirements 18.2, 21.3**
  - [x]* 25.3 Property test: OTP login rejection
    - **Property 63: OTP login rejection**
    - **Validates: Requirements 18.3**
  - [x]* 25.4 Property test: buyer session expiry
    - **Property 65: Buyer session expiry**
    - **Validates: Requirements 18.7**
  - [x]* 25.5 Property test: support ticket required-field validation
    - **Property 66: Support ticket required-field validation**
    - **Validates: Requirements 18.9**
  - [x] 25.6 Implement buyer-portal auth and session in `app/actions/buyer-portal.ts` and `app/buyer-portal/`
    - OTP login (WhatsApp→SMS fallback, 300s expiry), 5-attempt/15-min lockout, 24-hour session token, unauthenticated redirect, all queries scoped to session `contactId`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 21.1, 21.2_
  - [ ]* 25.7 Property test: buyer data isolation
    - **Property 64: Buyer data isolation**
    - **Validates: Requirements 18.5, 18.6, 21.2**
  - [x] 25.8 Implement buyer-facing data features and persistence
    - ConstructionUpdate timeline, SupportTicket create/track, PossessionChecklist view/snag/sign-off, Pay Now vs manual UPI/bank instructions
    - _Requirements: 18.8, 18.9, 18.10, 18.11_
  - [x] 25.9 Build buyer-portal UI (bookings, payments, documents, updates, tickets, possession)
    - Dashboard scoped to buyer; payment tracker; document downloads; construction timeline; ticket and possession views
    - _Requirements: 18.5, 18.8, 18.10, 18.11_

- [ ] 26. Module 16 — Referral Program Engine
  - [x] 26.1 Implement referral pure helpers in `lib/referrals.ts`
    - `isSelfReferral(referrerId, referredId)`, `computeReward(program)`
    - _Requirements: 19.3, 19.7_
  - [x]* 26.2 Property test: won referred deal computes reward
    - **Property 67: Won referred deal computes reward**
    - **Validates: Requirements 19.3**
  - [x]* 26.3 Property test: self-referral is rejected
    - **Property 68: Self-referral is rejected**
    - **Validates: Requirements 19.7**
  - [x] 26.4 Implement referral actions in `app/actions/referrals.ts`
    - ReferralProgram/Referral persistence, `createReferral` (reject self-referral), `markReferralEligible` on won deal, reward payout (paid flag + date)
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.7_
  - [x] 26.5 Build referrals UI and buyer-portal "Refer a Friend" section
    - Programs list with create/edit, referral tracking, shareable link; buyer-portal refer-a-friend linked to active program
    - _Requirements: 19.5, 19.6_

- [ ] 27. Cross-cutting integrity and final gate
  - [ ]* 27.1 Property test: audit entry on status and financial actions
    - **Property 69: Audit entry on status and financial actions**
    - **Validates: Requirements 20.7**
  - [x]* 27.2 Smoke test: schema sync, build, and referential integrity gate
    - `npx prisma db push` applies cleanly, `npm run build` completes with zero errors, referential-integrity check on seeded data, existing `(dashboard)` auth unchanged
    - _Requirements: 20.2, 20.3, 20.8, 21.4_

- [x] 28. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (property tests, unit tests, integration tests, smoke tests) and can be skipped for a faster MVP, though they enforce the correctness priority.
- Each task references specific requirements for traceability; property test sub-tasks reference their design property number and the requirement clause they validate.
- Pure, property-testable logic lands in `lib/` first; server actions in `app/actions/*.ts` (Zod-validated) build on it; UI and integration wiring come last so there is no orphaned code.
- Property-based tests use `fast-check` at a minimum of 100 iterations and are tagged `// Feature: real-estate-crm, Property {number}: {property_text}`.
- Multi-record writes (booking conversion, merge, bulk create) run inside `prisma.$transaction`; concurrency is validated by integration tests.
- Checkpoints occur at each phase boundary to validate incrementally.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1", "6.1", "9.1", "12.1", "13.1", "14.1", "15.1", "17.1", "18.1", "19.1", "20.1", "22.1", "23.1", "25.1", "26.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "4.2", "4.3", "4.4", "4.5", "4.6", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "9.2", "9.3", "9.4", "12.2", "12.3", "12.4", "13.2", "13.3", "14.2", "14.3", "14.4", "15.2", "15.3", "15.4", "17.2", "17.3", "17.4", "18.2", "19.2", "19.3", "19.4", "20.2", "20.3", "22.2", "22.3", "23.2", "23.3", "23.4", "23.5", "25.2", "25.3", "25.4", "25.5", "26.2", "26.3", "3.2", "7.1", "10.1", "12.5", "15.5", "17.5", "18.3", "19.5", "20.4", "22.4", "23.6", "25.6", "26.4"] },
    { "id": 4, "tasks": ["3.3", "7.2", "25.8", "10.2", "10.3", "15.6", "15.7", "18.4", "23.7", "25.7", "10.4", "10.5", "12.6", "15.8", "15.9", "17.6", "17.7", "18.5", "19.6", "20.5", "22.5", "22.6", "23.8", "23.9", "26.5", "14.5"] },
    { "id": 5, "tasks": ["5.1", "13.4", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "7.3", "7.4", "7.5", "7.6", "10.6", "12.7", "20.6", "25.9"] },
    { "id": 6, "tasks": ["5.2", "3.12", "7.7", "10.7", "10.8", "10.9", "13.5", "13.6", "13.7", "27.1"] },
    { "id": 7, "tasks": ["5.3", "5.4", "5.5"] },
    { "id": 8, "tasks": ["27.2"] }
  ]
}
```
