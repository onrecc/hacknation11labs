/** Which MiniERP field a held save should point at (the block banner's "Go to …" button). */

/** Editable invoice fields: element id → label. Everything else on the form is read-only. */
export const EDITABLE = { costCenter: "Cost center", assetNo: "Asset no.", approver: "2nd approver", comment: "Comment" } as const;
export type EditableField = keyof typeof EDITABLE;

const isEditable = (k: string): k is EditableField => Object.hasOwn(EDITABLE, k);

/** First editable field among the guardrail's fact paths ("invoice.assetNo" → "assetNo"), or null. */
export function fieldToFix(paths: readonly string[] | undefined): EditableField | null {
  for (const p of paths ?? []) {
    const [entity, key] = p.split(".");
    if (entity === "invoice" && key && isEditable(key)) return key;
  }
  return null;
}
