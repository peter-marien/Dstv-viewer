import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Viewport from "./Viewport.jsx";
import SourceTab from "./SourceTab.jsx";
import { parseDSTV, endCutAngles, rect, FACE_NAMES, PALETTE as C } from "./dstv.js";
import { SAMPLE } from "./sample.js";

/** Present only when running inside the Electron shell. */
const shell = typeof window !== "undefined" ? window.dstv : undefined;
const isDesktop = Boolean(shell);

export default function App() {
  const [raw, setRaw] = useState(SAMPLE);
  const [filename, setFilename] = useState("sample-IPE300.nc1");
  const [filepath, setFilepath] = useState(null);
  const [tab, setTab] = useState("model");
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState({ name: "iso", t: 0 });
  const [showLabels, setShowLabels] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);
  const apiRef = useRef(null);
  const fileRef = useRef(null);

  const model = useMemo(() => parseDSTV(raw), [raw]);

  const flash = useCallback((msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const applyPart = useCallback((payload) => {
    if (!payload) return;
    setRaw(payload.text);
    setFilename(payload.name);
    setFilepath(payload.path || null);
    setSelected(null);
  }, []);

  /* --- opening files --- */
  const openFile = useCallback(async () => {
    if (isDesktop) {
      try {
        applyPart(await shell.openDialog());
      } catch (err) {
        flash(`Could not open the file: ${err.message}`);
      }
    } else {
      fileRef.current?.click();
    }
  }, [applyPart, flash]);

  const readBrowserFile = useCallback((file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => applyPart({ text: String(r.result), name: file.name, path: file.path || null });
    r.onerror = () => flash(`Could not read ${file.name}.`);
    r.readAsText(file);
  }, [applyPart, flash]);

  /* --- exporting --- */
  const exportPng = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    if (tab !== "model") {
      setTab("model");
      flash("Switch to the Model tab finished - press export again.");
      return;
    }
    const dataUrl = api.snapshot();
    const suggested = filename.replace(/\.[^.]+$/, "") + ".png";
    if (isDesktop) {
      const written = await shell.savePng(dataUrl, suggested);
      if (written) flash(`Saved ${written}`);
    } else {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = suggested;
      a.click();
    }
  }, [filename, tab, flash]);

  /* --- native shell wiring --- */
  useEffect(() => {
    if (!isDesktop) return;
    const offOpen = shell.onOpenFile(applyPart);
    const offMenu = shell.onMenuAction((action) => {
      if (action === "export-png") exportPng();
      else if (action === "tab-model") setTab("model");
      else if (action === "tab-source") setTab("source");
      else if (action.startsWith("view-")) {
        setTab("model");
        setView({ name: action.slice(5), t: Date.now() });
      }
    });
    return () => { offOpen?.(); offMenu?.(); };
  }, [applyPart, exportPng]);

  /* --- derived summary --- */
  const roundCount = model.holes.filter((h) => !h.slotted).length;
  const slotCount = model.holes.filter((h) => h.slotted).length;
  const { length: L, height: H, width: W } = model.header;
  const outerOf = (face, fallback) =>
    model.contours.find((c) => c.face === face && c.kind === "AK") || { pts: fallback };
  const webContour = outerOf("v", rect(0, 0, L, H));
  const flangeContour = outerOf("u", rect(0, 0, L, W));
  const webCuts = endCutAngles(webContour.pts, L);
  const flangeCuts = endCutAngles(flangeContour.pts, L);
  const cutsFromHeader = Boolean(webContour.fromHeader || flangeContour.fromHeader);
  const fmtCut = (c) => (c.angle < 0.05 ? "square" : `${c.angle.toFixed(1)}°`);
  const sel = model.holes.find((h) => h.id === selected) || null;

  return (
    <div
      className="app"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); readBrowserFile(e.dataTransfer.files[0]); }}
    >
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="26" height="26">
              <path d="M3 6h26v4H20v12h9v4H3v-4h9V10H3z" fill={C.mill} />
            </svg>
          </span>
          <div className="brandtext">
            <h1>DSTV Part Viewer</h1>
            <p title={filepath || filename}>
              {model.header.profile} · {model.header.grade} · piece {model.header.piece}
            </p>
          </div>
        </div>

        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "model"} className={tab === "model" ? "on" : ""} onClick={() => setTab("model")}>Model</button>
          <button role="tab" aria-selected={tab === "source"} className={tab === "source" ? "on" : ""} onClick={() => setTab("source")}>Source</button>
        </nav>

        <div className="actions">
          <button className="ghost" onClick={() => { setRaw(SAMPLE); setFilename("sample-IPE300.nc1"); setFilepath(null); setSelected(null); }}>Sample</button>
          <button className="ghost" onClick={exportPng}>Export PNG</button>
          <button className="primary" onClick={openFile}>Open part</button>
          {!isDesktop && (
            <input ref={fileRef} type="file" accept=".nc,.nc1,.dstv,.txt" hidden
              onChange={(e) => readBrowserFile(e.target.files[0])} />
          )}
        </div>
      </header>

      {model.warnings.length > 0 && (
        <div className="warn">{model.warnings.map((w, i) => <span key={i}>{w}</span>)}</div>
      )}

      <main className={tab === "model" ? "body split" : "body"}>
        {tab === "model" ? (
          <>
            <aside className="panel">
              <section>
                <h2>Profile</h2>
                <dl className="specs">
                  <div><dt>Section</dt><dd>{model.header.profile}</dd></div>
                  <div><dt>Length</dt><dd>{model.header.length.toFixed(1)} mm</dd></div>
                  <div><dt>Height</dt><dd>{model.header.height.toFixed(1)} mm</dd></div>
                  <div><dt>Flange width</dt><dd>{model.header.width.toFixed(1)} mm</dd></div>
                  <div><dt>Flange thk</dt><dd>{model.header.flangeThk.toFixed(1)} mm</dd></div>
                  <div><dt>Web thk</dt><dd>{model.header.webThk.toFixed(1)} mm</dd></div>
                </dl>
              </section>

              <section>
                <h2>Saw angles</h2>
                <div className="cutrow"><span>Web start</span><b>{fmtCut(webCuts.start)}</b></div>
                <div className="cutrow"><span>Web end</span><b>{fmtCut(webCuts.end)}</b></div>
                <div className="cutrow"><span>Flange start</span><b>{fmtCut(flangeCuts.start)}</b></div>
                <div className="cutrow"><span>Flange end</span><b>{fmtCut(flangeCuts.end)}</b></div>
                <p className="note">
                  {cutsFromHeader
                    ? "Taken from the ST header - the file has no outer contour (AK) for these faces."
                    : "Measured off the outer contours (AK), not the ST header value."}
                </p>
              </section>

              <section className="grow">
                <h2>
                  Holes
                  <span className="counts">
                    <i style={{ background: C.punch }} />{roundCount}
                    <i style={{ background: C.mill }} />{slotCount}
                  </span>
                </h2>
                <div className="holelist">
                  {model.holes.length === 0 && <p className="note">No BO block in this file.</p>}
                  {model.holes.map((h) => (
                    <button key={h.id}
                      className={`holerow ${h.id === selected ? "on" : ""}`}
                      onClick={() => setSelected(h.id === selected ? null : h.id)}>
                      <span className="swatch" style={{ background: h.slotted ? C.mill : C.punch }} />
                      <span className="hmain">
                        {h.slotted
                          ? `⌀${h.slotWidth} slot ${h.totalLength.toFixed(0)} @ ${h.slotAngle}°`
                          : `⌀${h.diameter}`}
                      </span>
                      <span className="hpos">{FACE_NAMES[h.face] || h.face} · x{h.x.toFixed(0)} y{h.y.toFixed(0)}</span>
                    </button>
                  ))}
                </div>
              </section>
            </aside>

            <div className="stage">
              <Viewport model={model} selected={selected} onSelect={setSelected}
                view={view} showLabels={showLabels}
                onApi={(api) => { apiRef.current = api; }} />

              <div className="overlay-tl">
                {["iso", "front", "top", "end"].map((v) => (
                  <button key={v} className={view.name === v ? "vbtn on" : "vbtn"}
                    onClick={() => setView({ name: v, t: Date.now() })}>{v}</button>
                ))}
                <button className={showLabels ? "vbtn on" : "vbtn"} onClick={() => setShowLabels((s) => !s)}>notes</button>
              </div>

              {sel && (
                <div className="overlay-br">
                  <b style={{ color: sel.slotted ? C.mill : C.punch }}>{sel.slotted ? "Slotted hole" : "Round hole"}</b>
                  <span>{FACE_NAMES[sel.face] || sel.face}</span>
                  <span>x {sel.x.toFixed(1)} · y {sel.y.toFixed(1)}</span>
                  <span>⌀ {sel.diameter.toFixed(1)}{sel.slotted ? ` · length ${sel.totalLength.toFixed(1)} · ${sel.slotAngle}°` : ""}</span>
                  <span className="muted">line {sel.line + 1}</span>
                </div>
              )}

              <div className="overlay-bl muted">Drag to orbit · shift-drag to pan · scroll to zoom · click a hole</div>
            </div>
          </>
        ) : (
          <SourceTab model={model} filename={filepath || filename}
            selected={selected} onSelect={setSelected} />
        )}
      </main>

      <footer className="status">
        <span>{filepath || filename}</span>
        <span className="muted">
          {model.blocks.length} blocks · {model.holes.length} holes ({roundCount} round, {slotCount} slotted)
        </span>
      </footer>

      {dragOver && <div className="dropzone">Drop a .nc1 / .dstv file to load it</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
