import "server-only";

/**
 * Tally integration boundary — docs/SYSTEM_ARCHITECTURE.md §8 (Tally). NOT IMPLEMENTED.
 *
 *     PTCC platform      customers, leads, quotations, work, collections (operational records)
 *           │            only through this module
 *     Tally integration  this boundary
 *           │
 *     Tally              PTCC's accounting system of record: invoices, receipts, ledgers, GST
 *
 * - Tally stays the source of truth for accounting. The platform does not issue invoices,
 *   compute tax or keep balances of its own; quotation amounts are before tax.
 * - Nothing outside this folder may talk to Tally or assume how Tally is set up.
 * - Nothing is connected. Known so far (PTCC): the Tally version is unknown, it runs on an
 *   office computer / the local network, and the data exchange is not decided. Until that is
 *   decided this module reports "not connected" and no screen may show Tally data.
 *   No Tally API, data format, connector or workflow is assumed here.
 */

export type TallyStatus = { connected: false; reason: string };

export interface TallyGateway {
  /** Whether the platform can reach Tally. */
  status(): TallyStatus;
}

const NOT_CONNECTED: TallyStatus = {
  connected: false,
  reason: "Tally is not connected to the platform. Invoices, payments and balances are kept in Tally.",
};

export const tally: TallyGateway = {
  status: () => NOT_CONNECTED,
};
