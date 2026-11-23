import React, { useState, useEffect, useMemo, useRef } from "react";
import { BLOCK_HELP, PALETTE as C } from "./dstv.js";

export default function SourceTab({ model, filename, selected, onSelect }) {
  const [query, setQuery] = useState("");
  const listRef = useRef(null);

  const holeByLine = useMemo(() => {
    const m = new Map();
    model.holes.forEach((h) => m.set(h.line, h));
    return m;
  }, [model]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return model.lines
      .map((text, i) => ({
        n: i + 1,
        text,
        meta: model.lineMeta[i],
        hole: holeByLine.get(i) || null,
        match: q ? text.toLowerCase().includes(q) : false,
      }))
      .filter((r) => (q ? r.match : true));
  }, [model, query, holeByLine]);

  // Selecting a hole anywhere in the app scrolls its source line into view.
  useEffect(() => {
    if (selected == null || !listRef.current) return;
    listRef.current.querySelector(`[data-hole="${selected}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selected]);

  const blockCounts = useMemo(() => {
    const c = {};
    model.blocks.forEach((b) => { c[b.code] = (c[b.code] || 0) + 1; });
    return c;
  }, [model]);

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(model.lines.join("\n")); } catch { /* clipboard denied */ }
  };

  return (
    <div className="source">
      <div className="source-bar">
        <div className="file-chip">
          <span className="dot" />
          <span className="fname" title={filename}>{filename}</span>
          <span className="muted">{model.lines.length} lines</span>
        </div>
        <input className="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter lines…" aria-label="Filter lines" />
        <button className="ghost small" onClick={copyAll}>Copy all</button>
      </div>

      <div className="block-legend">
        {Object.keys(blockCounts).map((code) => (
          <span key={code} className={`chip chip-${code}`} title={BLOCK_HELP[code] || "Block"}>
            <b>{code}</b> ×{blockCounts[code]}
            <em>{BLOCK_HELP[code] || ""}</em>
          </span>
        ))}
      </div>

      <div className="code" ref={listRef}>
        {rows.length === 0 && (
          <div className="empty">No lines match “{query}”. Clear the filter to see the whole file.</div>
        )}
        {rows.map((r) => {
          const kind = r.meta?.kind;
          const cls = [
            "line",
            kind === "block" ? `is-block b-${r.meta.code}` : "",
            kind === "comment" ? "is-comment" : "",
            r.hole ? "is-hole" : "",
            r.hole && r.hole.id === selected ? "is-selected" : "",
            r.match ? "is-match" : "",
          ].filter(Boolean).join(" ");
          return (
            <div key={r.n} className={cls}
              data-hole={r.hole ? r.hole.id : undefined}
              onClick={r.hole ? () => onSelect(r.hole.id) : undefined}
              role={r.hole ? "button" : undefined}
              tabIndex={r.hole ? 0 : undefined}
              onKeyDown={r.hole ? (e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(r.hole.id); }
              } : undefined}>
              <span className="ln">{r.n}</span>
              <span className="src">{r.text || " "}</span>
              {r.hole && (
                <span className="tag" style={{ color: r.hole.slotted ? C.mill : C.punch }}>
                  {r.hole.slotted ? "slot" : "hole"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="hint">Click any highlighted BO line to select that hole — it lights up in the model.</p>
    </div>
  );
}
