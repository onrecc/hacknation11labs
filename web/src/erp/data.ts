/** MiniERP seed data: the 3 demo invoices, filler, Teach's T1–T4, supplier history. All fictional. */
export interface Invoice {
  key: string;
  supplier: string;
  group: string;
  date: string;
  amount: number;
  currency: string;
  desc: string;
  category: "equipment" | "consumables" | "spare_parts" | "services";
  dn: string;
  iban: string;
  costCenter: string;
  assetNo: string;
  status: "open" | "coded" | "on_hold" | "approved" | "awaiting_approval" | "rejected";
  approver: string;
  comment: string;
  /** which set it belongs to (UI filter only) */
  set: "demo" | "teach" | "filler";
}

const base = { currency: "EUR", costCenter: "4711", assetNo: "", status: "open" as const, approver: "", comment: "" };

export const SEED: Invoice[] = [
  { ...base, set: "demo", key: "4471", supplier: "Krauss Maschinenteile GmbH", group: "External", date: "2026-11-27", amount: 7850, desc: "CNC spindle replacement, machine hall 2", category: "equipment", dn: "DN-77104", iban: "DE89 3704 0044 0532 0130 00" },
  { ...base, set: "demo", key: "4472", supplier: "Hofmann Industriebedarf", group: "External", date: "2026-12-01", amount: 1240, desc: "Lubricants & filters, monthly delivery", category: "consumables", dn: "DN-88213", iban: "DE44 5001 0517 5407 3249 31" },
  { ...base, set: "demo", key: "4473", supplier: "Brno Precision s.r.o.", group: "Intercompany CZ", date: "2026-11-30", amount: 3100, desc: "Spare parts, gearbox housings", category: "spare_parts", dn: "DN-CZ-5530", iban: "CZ65 0800 0000 1920 0014 5399" },
  { ...base, set: "filler", key: "4474", supplier: "Schreiber Logistik", group: "External", date: "2026-11-26", amount: 860, desc: "Freight Nov", category: "services", dn: "DN-SL-2201", iban: "DE12 5001 0517 0000 1111 22" },
  { ...base, set: "filler", key: "4475", supplier: "Würth", group: "External", date: "2026-11-25", amount: 312.4, desc: "Screws, fasteners", category: "consumables", dn: "DN-W-9910", iban: "DE02 6005 0101 0002 0343 41" },
  { ...base, set: "teach", key: "4490", supplier: "Gerätebau Schmidt KG", group: "External", date: "2026-12-02", amount: 7200, desc: "Hydraulic press tooling", category: "equipment", dn: "DN-GS-0042", iban: "DE75 5121 0800 1245 1261 99" },
  { ...base, set: "teach", key: "4491", supplier: "Brno Precision s.r.o.", group: "Intercompany CZ", date: "2026-12-01", amount: 9800, desc: "Gearbox test bench", category: "equipment", dn: "DN-CZ-5561", iban: "CZ65 0800 0000 1920 0014 5399" },
  { ...base, set: "teach", key: "4492", supplier: "Hofmann Industriebedarf", group: "External", date: "2026-12-03", amount: 1240, desc: "Lubricants & filters, monthly delivery", category: "consumables", dn: "DN-88213", iban: "DE44 5001 0517 5407 3249 31" },
  { ...base, set: "teach", key: "4493", supplier: "Würth", group: "External", date: "2026-12-03", amount: 312.4, desc: "Screws, fasteners", category: "consumables", dn: "DN-W-9944", iban: "DE02 6005 0101 0002 0343 41" },
];

/** Already paid invoices (supplier history search). */
export const HISTORY = [
  { key: "4431", supplier: "Hofmann Industriebedarf", date: "2026-11-28", amount: 1240, dn: "DN-88213", status: "paid" },
  { key: "4310", supplier: "Hofmann Industriebedarf", date: "2026-10-30", amount: 1180, dn: "DN-87650", status: "paid" },
  { key: "4402", supplier: "Krauss Maschinenteile GmbH", date: "2026-11-12", amount: 940, dn: "DN-77001", status: "paid" },
  { key: "4388", supplier: "Brno Precision s.r.o.", date: "2026-11-05", amount: 2750, dn: "DN-CZ-5491", status: "paid" },
];

export const COST_CENTERS: Record<string, string> = { "4711": "Opex (default)", "0400": "Capex", "4720": "Opex maintenance" };
export const APPROVERS = ["", "M. Weber (Controlling)", "Jonas (AP lead)"];
export const KNOWN_SUPPLIERS = new Set(HISTORY.map((h) => h.supplier).concat(["Schreiber Logistik", "Würth"]));
