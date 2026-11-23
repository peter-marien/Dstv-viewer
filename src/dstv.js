/**
 * DSTV / NC1 parser.
 *
 * Block codes that matter here:
 *   ST  part header (profile, dimensions, header cut angles)
 *   BO  holes - round when the slot travel field is zero, slotted when it is not
 *   AK  outer contour of a face (this is where the real saw angles live)
 *   IK  inner contour - cut-outs
 *   SI  marking text
 *
 * Face codes: v = web front, h = web back, o = top flange, u = bottom flange.
 * A face code appears on the first row of a block and is inherited by the rows
 * below it, which is what real post-processor output does.
 */

export const BLOCK_CODES = [
  "ST", "BO", "AK", "IK", "SI", "SC", "PU", "KO",
  "KA", "UE", "VB", "BR", "TO", "EN",
];

export const FACE_NAMES = {
  v: "Web front",
  h: "Web back",
  o: "Top flange",
  u: "Bottom flange",
};

export const BLOCK_HELP = {
  ST: "Part header - profile, dimensions, cut angles",
  BO: "Holes - round and slotted",
  AK: "Outer contour - the sawn outline of a face",
  IK: "Inner contour - cut-outs",
  SI: "Marking text",
  SC: "Cut",
  PU: "Punch mark",
  KO: "Contour marking",
  EN: "End of part",
};

export function toNum(token) {
  if (token == null) return 0;
  const m = String(token).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

export function parseDSTV(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  const lineMeta = new Array(lines.length).fill(null);
  const warnings = [];
  let arcWarned = false;
  let current = null;

  lines.forEach((raw, idx) => {
    const t = raw.trim();
    if (!t) return;
    if (t.startsWith("**")) {
      lineMeta[idx] = { kind: "comment" };
      return;
    }
    const up = t.toUpperCase();
    if (BLOCK_CODES.includes(up)) {
      current = { code: up, headerLine: idx, rows: [] };
      blocks.push(current);
      lineMeta[idx] = { kind: "block", code: up };
      return;
    }
    if (current) {
      current.rows.push({ idx, text: t });
      lineMeta[idx] = { kind: "data", code: current.code };
    } else {
      lineMeta[idx] = { kind: "other" };
    }
  });

  /* --- ST: header --- */
  const st = blocks.find((b) => b.code === "ST");
  const h = st ? st.rows.map((r) => r.text) : [];
  const header = {
    order: h[0] || "-",
    drawing: h[1] || "-",
    phase: h[2] || "-",
    piece: h[3] || "-",
    grade: h[4] || "-",
    quantity: toNum(h[5]) || 1,
    profile: h[6] || "UNKNOWN",
    profileCode: (h[7] || "I").toUpperCase(),
    length: toNum(h[8]),
    height: toNum(h[9]),
    width: toNum(h[10]),
    flangeThk: toNum(h[11]),
    webThk: toNum(h[12]),
    radius: toNum(h[13]),
    weightPerM: toNum(h[14]),
    webStartCut: toNum(h[16]),
    webEndCut: toNum(h[17]),
    flangeStartCut: toNum(h[18]),
    flangeEndCut: toNum(h[19]),
  };

  if (!st) warnings.push("No ST header block found - using fallback dimensions.");
  if (!header.length) { header.length = 2000; warnings.push("Length missing in ST header; defaulted to 2000 mm."); }
  if (!header.height) { header.height = 300; warnings.push("Profile height missing; defaulted to 300 mm."); }
  if (!header.width) { header.width = 150; warnings.push("Flange width missing; defaulted to 150 mm."); }
  if (!header.flangeThk) header.flangeThk = 10;
  if (!header.webThk) header.webThk = 7;

  /* --- BO: holes and slotted holes --- */
  const holes = [];
  blocks.filter((b) => b.code === "BO").forEach((b) => {
    let face = "v";
    b.rows.forEach((row) => {
      const parts = row.text.split(/\s+/).filter(Boolean);
      let p = 0;
      if (/^[a-z]$/i.test(parts[0])) { face = parts[0].toLowerCase(); p = 1; }
      const diameter = toNum(parts[p + 2]);
      if (!diameter) return;
      const slotTravel = toNum(parts[p + 4]);
      const slotWidth = toNum(parts[p + 5]);
      const width = slotWidth > 0 ? slotWidth : diameter;
      const slotted = slotTravel > 0;
      holes.push({
        id: holes.length,
        face,
        x: toNum(parts[p]),
        y: toNum(parts[p + 1]),
        diameter,
        depth: toNum(parts[p + 3]),
        slotTravel,
        slotWidth: width,
        slotAngle: toNum(parts[p + 6]),
        slotted,
        totalLength: slotted ? slotTravel + width : diameter,
        line: row.idx,
        text: row.text,
      });
    });
  });

  /* --- AK / IK: contours --- */
  const contours = [];
  blocks.filter((b) => b.code === "AK" || b.code === "IK").forEach((b) => {
    let face = "v";
    const pts = [];
    let hasArc = false;
    b.rows.forEach((row) => {
      const parts = row.text.split(/\s+/).filter(Boolean);
      let p = 0;
      if (/^[a-z]$/i.test(parts[0])) { face = parts[0].toLowerCase(); p = 1; }
      if (toNum(parts[p + 2]) !== 0) hasArc = true;
      pts.push({ x: toNum(parts[p]), y: toNum(parts[p + 1]) });
    });
    if (pts.length >= 3) {
      const first = pts[0], last = pts[pts.length - 1];
      if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) pts.pop();
      contours.push({ face, kind: b.code, pts, line: b.headerLine });
      if (hasArc && !arcWarned) {
        warnings.push("Contour contains arc radii - arcs are drawn as straight chords.");
        arcWarned = true;
      }
    }
  });

  /* --- SI: markings --- */
  const markings = [];
  blocks.filter((b) => b.code === "SI").forEach((b) => {
    let face = "v";
    b.rows.forEach((row) => {
      const parts = row.text.split(/\s+/).filter(Boolean);
      let p = 0;
      if (/^[a-z]$/i.test(parts[0])) { face = parts[0].toLowerCase(); p = 1; }
      markings.push({
        face,
        x: toNum(parts[p]),
        y: toNum(parts[p + 1]),
        size: toNum(parts[p + 4]) || 10,
        text: parts[parts.length - 1],
        line: row.idx,
      });
    });
  });

  return { header, holes, contours, markings, blocks, lineMeta, lines, warnings };
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers shared by the viewport and the sidebar            */
/* ------------------------------------------------------------------ */

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function rect(x0, y0, x1, y1) {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/**
 * Derive the saw angle at each end from the web outer contour, rather than
 * trusting the ST header. If the two disagree the geometry is what the saw cuts.
 * Returns degrees off square, and the x position of the cut.
 */
export function endCutAngles(webPts, length) {
  const mid = length / 2;
  let start = { angle: 0, at: 0 };
  let end = { angle: 0, at: length };
  let bestS = 0, bestE = 0;
  for (let i = 0; i < webPts.length; i++) {
    const a = webPts[i], b = webPts[(i + 1) % webPts.length];
    const dy = b.y - a.y, dx = b.x - a.x;
    if (Math.abs(dy) < 1) continue; // horizontal run, not an end cut
    const span = Math.abs(dy);
    const angle = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
    const cx = (a.x + b.x) / 2;
    if (cx < mid && span > bestS) { bestS = span; start = { angle, at: cx }; }
    if (cx >= mid && span > bestE) { bestE = span; end = { angle, at: cx }; }
  }
  return { start, end };
}

export const PALETTE = {
  ink: "#0B1723",
  paper: "#122333",
  rule: "#1E3549",
  chalk: "#DDE8F2",
  graph: "#7593B2",
  mill: "#F2A03D",   // slotted holes
  punch: "#E0524F",  // round holes
  steel: "#8FA6BC",  // beam body
};
