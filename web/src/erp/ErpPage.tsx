/**
 * MiniERP: the sandbox where the expert (capture) or new hire (teach) works. Instrumented:
 * every change → bridge "app" message, typing/clicks → "activity", Save/Approve → beforeSave(facts) first.
 * It never talks to Firestore; the hub tab owns the session.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CaseFacts } from "@shared/schema";
import { beforeSave, listen, send, type ErpMode } from "../lib/bridge";
import { startOverlay } from "../../../extension/src/overlay";
import { APPROVERS, COST_CENTERS, HISTORY, KNOWN_SUPPLIERS, SEED, type Invoice } from "./data";

const LS = "minierp.v1";
const load = (): Invoice[] => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? "") as Invoice[];
  } catch {
    return SEED;
  }
};

export function facts(inv: Invoice): CaseFacts {
  return {
    invoice: {
      key: inv.key, amount: inv.amount, currency: inv.currency, date: inv.date, month: Number(inv.date.slice(5, 7)), category: inv.category,
      costCenter: inv.costCenter, assetNo: inv.assetNo || null, status: inv.status, approver: inv.approver || null, comment: inv.comment,
      duplicateDeliveryNote: HISTORY.some((h) => h.dn === inv.dn && h.key !== inv.key && h.status === "paid"),
    },
    supplier: { name: inv.supplier, group: inv.group, isNew: !KNOWN_SUPPLIERS.has(inv.supplier) },
  };
}

export default function ErpPage() {
  const mode = (new URLSearchParams(location.search).get("mode") ?? "free") as ErpMode;
  const [rows, setRows] = useState<Invoice[]>(load);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "invoice" | "history">("list");
  const [query, setQuery] = useState("");
  const [banner, setBanner] = useState<{ tone: "block" | "info"; text: string } | null>(null);
  const [hub, setHub] = useState(false);
  const [offRecord, setOffRecord] = useState(false);
  const counts = useRef({ keystrokes: 0, clicks: 0, scrolls: 0, mouseMovePx: 0 });
  const dock = useRef<HTMLDivElement>(null);
  const inv = rows.find((r) => r.key === open) ?? null;
  const visible = useMemo(() => rows.filter((r) => (mode === "teach" ? r.set !== "demo" : r.set !== "teach")), [rows, mode]);

  useEffect(() => localStorage.setItem(LS, JSON.stringify(rows)), [rows]);
  useEffect(() => {
    const off = listen((m) => {
      if (m.kind === "hello" && m.from === "hub") setHub(true);
    });
    send({ kind: "hello", from: "erp", mode });
    const stopOverlay = mode === "free" ? () => {} : startOverlay({ send, listen }, { controls: false, mount: dock.current ?? undefined }); // tutor cards + Ada's captions
    // activity counts (no content) every 2 s
    const onKey = (e: KeyboardEvent) => {
      counts.current.keystrokes++;
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "o") toggleOffRecord();
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "b") send({ kind: "marker", marker: "bookmark", at: Date.now() });
    };
    const onClick = () => counts.current.clicks++;
    const onScroll = () => counts.current.scrolls++;
    let last: [number, number] | null = null;
    const onMove = (e: MouseEvent) => {
      if (last) counts.current.mouseMovePx += Math.abs(e.clientX - last[0]) + Math.abs(e.clientY - last[1]);
      last = [e.clientX, e.clientY];
    };
    addEventListener("keydown", onKey);
    addEventListener("click", onClick);
    addEventListener("wheel", onScroll);
    addEventListener("mousemove", onMove);
    const timer = setInterval(() => {
      const c = counts.current;
      if (c.keystrokes || c.clicks || c.scrolls || c.mouseMovePx) send({ kind: "activity", ...c, mouseMovePx: Math.round(c.mouseMovePx), windowMs: 2000, at: Date.now() });
      counts.current = { keystrokes: 0, clicks: 0, scrolls: 0, mouseMovePx: 0 };
    }, 2000);
    return () => {
      off();
      stopOverlay();
      clearInterval(timer);
      removeEventListener("keydown", onKey);
      removeEventListener("click", onClick);
      removeEventListener("wheel", onScroll);
      removeEventListener("mousemove", onMove);
    };
  }, []);

  function toggleOffRecord() {
    setOffRecord((o) => {
      send({ kind: "marker", marker: o ? "off_record_end" : "off_record_start", at: Date.now() });
      return !o;
    });
  }

  const caseRef = (i: Invoice) => ({ id: `case_${i.key}`, kind: "invoice", key: i.key, label: i.supplier });
  const entity = (i: Invoice) => ({ kind: "invoice", key: i.key });

  function openInvoice(key: string) {
    const i = rows.find((r) => r.key === key)!;
    setOpen(key);
    setView("invoice");
    setBanner(null);
    send({ kind: "case", state: "start", case: caseRef(i), facts: facts(i), at: Date.now() });
    send({ kind: "app", payload: { action: "view", entity: entity(i), route: `/ap/invoices/${key}` }, verb: "open", description: `Opened invoice INV-${key} (${i.supplier}, ${i.amount.toLocaleString("en", { minimumFractionDigits: 2 })} EUR, ${i.category})`, facts: facts(i), at: Date.now() });
  }

  function back() {
    if (inv) send({ kind: "case", state: "end", case: caseRef(inv), outcome: inv.status, at: Date.now() });
    send({ kind: "app", payload: { action: "navigate", entity: { kind: "open_items_list" }, route: "/ap/list" }, at: Date.now() });
    setOpen(null);
    setView("list");
    setBanner(null);
  }

  /** Commit a field change (on blur / select) and report it. */
  function change(field: keyof Invoice, value: string, verb = "edit") {
    if (!inv || inv[field] === value) return;
    const next = { ...inv, [field]: value } as Invoice;
    setRows((rs) => rs.map((r) => (r.key === inv.key ? next : r)));
    send({
      kind: "app", payload: { action: "change", entity: entity(inv), field, oldValue: inv[field], newValue: value, selector: `#${field}`, route: `/ap/invoices/${inv.key}` },
      verb, description: `Set ${field} on INV-${inv.key}: ${JSON.stringify(inv[field])} -> ${JSON.stringify(value)}`, facts: facts(next), at: Date.now(),
    });
  }

  async function save(status?: Invoice["status"]) {
    if (!inv) return;
    const next: Invoice = { ...inv, ...(status ? { status } : inv.status === "open" ? { status: "coded" as const } : {}) };
    const verdict = await beforeSave(facts(next));
    if (!verdict.allow) {
      setBanner({ tone: "block", text: verdict.message ?? "Held by the tutor. Check the guardrail first." });
      send({ kind: "app", payload: { action: "validation_error", entity: entity(inv), snapshot: { ...next, iban: undefined } }, at: Date.now() });
      return;
    }
    setRows((rs) => rs.map((r) => (r.key === inv.key ? next : r)));
    setBanner({ tone: "info", text: `Saved INV-${inv.key} (${next.status})` });
    const verb = status === "approved" ? "approve" : status === "on_hold" ? "hold" : status === "awaiting_approval" ? "route" : status === "rejected" ? "reject" : "save";
    send({ kind: "app", payload: { action: "save", entity: entity(inv), snapshot: { ...next, iban: undefined } }, verb, description: `Saved INV-${inv.key}: status ${inv.status} -> ${next.status}`, facts: facts(next), at: Date.now() });
  }

  function search(q: string) {
    setView("history");
    send({ kind: "app", payload: { action: "submit", entity: { kind: "supplier_search" }, field: "query", newValue: q, route: "/ap/search" }, verb: "search", description: `Searched supplier history for '${q}': ${HISTORY.filter((h) => h.supplier.toLowerCase().includes(q.toLowerCase())).map((h) => `INV-${h.key} ${h.amount} EUR ${h.dn} ${h.status}`).join("; ") || "no results"}`, at: Date.now() });
  }

  return (
    <div className="erp">
      <header className="erp-bar">
        <b>MiniERP · Accounts Payable</b>
        <span className={`pill ${hub ? "ok" : ""}`}>{hub ? `connected to ${mode} hub` : mode === "free" ? "standalone" : "waiting for hub tab…"}</span>
        <span style={{ flex: 1 }} />
        {mode !== "free" && (
          <>
            <button className={offRecord ? "danger" : ""} onClick={toggleOffRecord} title="Ctrl+Shift+O">{offRecord ? "● Off the record: resume" : "Off the record"}</button>
            <button onClick={() => send({ kind: "marker", marker: "bookmark", at: Date.now() })} title="Ctrl+Shift+B">Bookmark</button>
          </>
        )}
        <button onClick={() => { if (confirm("Reset all invoices to seed data?")) setRows(SEED); }}>Reset data</button>
      </header>

      {banner && <div className={`banner ${banner.tone}`}>{banner.text}</div>}
      <div ref={dock} className="apprentice-dock" />

      {view === "list" && (
        <main>
          <h2>Open items · month-end close</h2>
          <table className="grid">
            <thead><tr><th>Invoice</th><th>Supplier</th><th>Date</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.key} onClick={() => openInvoice(r.key)}>
                  <td>INV-{r.key}</td><td>{r.supplier}</td><td>{r.date}</td><td className="num">{r.amount.toLocaleString("en", { minimumFractionDigits: 2 })}</td><td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      )}

      {view === "history" && (
        <main>
          <button onClick={() => setView(inv ? "invoice" : "list")}>← Back</button>
          <h2>Supplier history: “{query}”</h2>
          <table className="grid">
            <thead><tr><th>Invoice</th><th>Supplier</th><th>Date</th><th className="num">Amount</th><th>Delivery note</th><th>Status</th></tr></thead>
            <tbody>
              {HISTORY.filter((h) => h.supplier.toLowerCase().includes(query.toLowerCase())).map((h) => (
                <tr key={h.key}><td>INV-{h.key}</td><td>{h.supplier}</td><td>{h.date}</td><td className="num">{h.amount.toFixed(2)}</td><td>{h.dn}</td><td>{h.status}</td></tr>
              ))}
            </tbody>
          </table>
        </main>
      )}

      {view === "invoice" && inv && (
        <main>
          <button onClick={back}>← Open items</button>
          <h2>Invoice INV-{inv.key}</h2>
          <div className="form">
            <Field label="Supplier" value={inv.supplier} readOnly />
            <Field label="Supplier group" value={inv.group} readOnly />
            <Field label="Invoice date" value={inv.date} readOnly />
            <Field label="Amount (EUR)" value={inv.amount.toLocaleString("en", { minimumFractionDigits: 2 })} readOnly />
            <Field label="Description" value={inv.desc} readOnly />
            <Field label="Category" value={inv.category} readOnly />
            <Field label="Delivery note" value={inv.dn} readOnly />
            <Field label="IBAN" value="•••• •••• •••• (masked)" readOnly />
            <label>Cost center
              <select id="costCenter" value={inv.costCenter} onChange={(e) => change("costCenter", e.target.value)}>
                {Object.entries(COST_CENTERS).map(([k, v]) => <option key={k} value={k}>{k}: {v}</option>)}
              </select>
            </label>
            <Field label="Asset no." id="assetNo" value={inv.assetNo} onCommit={(v) => change("assetNo", v)} />
            <label>2nd approver
              <select id="approver" value={inv.approver} onChange={(e) => change("approver", e.target.value, "route")}>
                {APPROVERS.map((a) => <option key={a} value={a}>{a || "-"}</option>)}
              </select>
            </label>
            <Field label="Comment" id="comment" value={inv.comment} onCommit={(v) => change("comment", v, "comment")} wide />
            <Field label="Status" value={inv.status} readOnly />
          </div>
          <div className="actions">
            <input placeholder="Search supplier history…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search(query)} />
            <button onClick={() => search(query || inv.supplier)}>Search history</button>
            <span style={{ flex: 1 }} />
            <button onClick={() => save()}>Save</button>
            <button onClick={() => save("on_hold")}>Hold</button>
            <button onClick={() => save("awaiting_approval")}>Send for approval</button>
            <button className="primary" onClick={() => save("approved")}>Approve</button>
          </div>
        </main>
      )}
    </div>
  );
}

function Field(p: { label: string; value: string; id?: string; readOnly?: boolean; wide?: boolean; onCommit?: (v: string) => void }) {
  const [v, setV] = useState(p.value);
  useEffect(() => setV(p.value), [p.value]);
  return (
    <label className={p.wide ? "wide" : ""}>{p.label}
      <input id={p.id} value={v} readOnly={p.readOnly} onChange={(e) => setV(e.target.value)} onBlur={() => p.onCommit?.(v)} onKeyDown={(e) => e.key === "Enter" && p.onCommit?.(v)} />
    </label>
  );
}
