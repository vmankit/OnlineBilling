import type { PoolClient } from 'pg';
import { badRequest } from '../utils/errors.js';

export type DocType =
  | 'SALES_INVOICE'
  | 'PURCHASE_INVOICE'
  | 'SALES_RETURN'
  | 'PAYMENT'
  | 'QUOTATION'
  | 'EXPENSE';

interface SequenceRow {
  prefix: string;
  next_number: number;
  padding: number;
  suffix: string;
}

/**
 * Allocates the next document number.
 *
 * MUST be called inside the same transaction that writes the document.
 * `UPDATE ... RETURNING` takes a row lock, so two concurrent bills queue up
 * and can never be handed the same number; if the outer transaction rolls
 * back the number is returned to the pool as well.
 *
 * Tokens allowed in `prefix` / `suffix`: {YYYY} {YY} {MM}
 */
export async function nextDocumentNumber(client: PoolClient, docType: DocType): Promise<string> {
  const { rows } = await client.query<SequenceRow>(
    `UPDATE invoice_sequences
        SET next_number = next_number + 1,
            updated_at  = now()
      WHERE doc_type = $1
      RETURNING prefix, next_number - 1 AS next_number, padding, suffix`,
    [docType],
  );

  const seq = rows[0];
  if (!seq) throw badRequest(`No numbering series configured for ${docType}.`);

  const now = new Date();
  const tokens: Record<string, string> = {
    '{YYYY}': String(now.getFullYear()),
    '{YY}': String(now.getFullYear()).slice(-2),
    '{MM}': String(now.getMonth() + 1).padStart(2, '0'),
  };
  const expand = (s: string) =>
    Object.entries(tokens).reduce((acc, [k, v]) => acc.split(k).join(v), s);

  return `${expand(seq.prefix)}${String(seq.next_number).padStart(seq.padding, '0')}${expand(seq.suffix)}`;
}
