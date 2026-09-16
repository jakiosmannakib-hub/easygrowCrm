// lib/mutation.ts
//
// The transaction port. §12.6 / §16.2.
//
// Flat layout: §12 sketches `lib/db/tx.ts`; this project keeps one file per concern in
// `lib/` (CLAUDE.md §4 "File layout (as built)"), so `withTx` lives here.

import { db } from '../db';

/**
 * The Drizzle transaction handle — the callback argument of `db.transaction(...)`.
 *
 * `writeAudit` (PUL-102) derives an identical local `Tx`; the two are structurally the
 * same type, so the handle `withTx` hands out is accepted by `writeAudit` unchanged.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Anything a query can run against: the global `db` or a transaction handle.
 *
 * A read that a guard depends on takes this as its FIRST argument so the action can call it
 * with `tx` — the check and the write then share one snapshot. A guard read against the global
 * `db` from inside `withTx` sits outside the transaction (see §17.7 #2).
 */
export type Executor = typeof db | Tx;

/**
 * Every multi-table mutation runs inside `withTx` (§12.6). Rolls back on throw,
 * commits on return. `writeAudit(tx)` must run inside it (§9.8) — an audit row has to
 * roll back with the work it records.
 *
 * Drizzle's `db.transaction` already gives the rollback-on-throw / commit-on-return
 * behaviour; `withTx` pins the isolation level (§12.6) and gives the codebase one named
 * entry point, so "did this write happen in a transaction?" is answerable by grep.
 *
 * Notifications are enqueued *after* this call returns, never inside `fn` — work that
 * rolls back must not notify anyone.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn, { isolationLevel: 'read committed' });
}
