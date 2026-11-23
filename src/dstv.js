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

  /* --- header cut angles: synthesize AK outlines for faces that have none --- */
  const headerAngles = [header.webStartCut, header.webEndCut, header.flangeStartCut, header.flangeEndCut];
  if (headerAngles.some((a) => Math.abs(a) > 1e-6)) {
    const synth = headerCutOutlines(header);
    ["v", "o", "u"].forEach((face) => {
      if (contours.some((c) => c.face === face && c.kind === "AK")) return;
      contours.push({ face, kind: "AK", pts: synth[face], line: st ? st.headerLine : 0, fromHeader: true });
    });
  }

  /* --- SI: markings --- */
  // Row layout: [face] x y [extra...] angle height text
  // Post-processors differ in how many numeric fields sit between y and the
  // text (4 or 5 in practice), so read the numbers up front and take angle and
  // height from the end of that run. Coordinates may carry a reference suffix
  // such as "737.88u".
  const markings = [];
  const NUM = /^-?\d+(?:[.,]\d+)?[a-z]?$/i;
  blocks.filter((b) => b.code === "SI").forEach((b) => {
    let face = "v";
    b.rows.forEach((row) => {
      const parts = row.text.split(/\s+/).filter(Boolean);
      let p = 0;
      if (/^[a-z]$/i.test(parts[0])) { face = parts[0].toLowerCase(); p = 1; }
      const rest = parts.slice(p);
      let n = 0;
      while (n < rest.length && NUM.test(rest[n])) n++;
      // a purely numeric marking such as "101": the last number is the text
      if (n === rest.length && n > 2) n--;
      const nums = rest.slice(0, n).map(toNum);
      const text = rest.slice(n).join(" ");
      if (nums.length < 2 || !text) return;
      markings.push({
        id: markings.length,
        face,
        x: nums[0],
        y: nums[1],
        angle: nums.length >= 4 ? nums[nums.length - 2] : 0,
        size: (nums.length >= 3 && nums[nums.length - 1] > 0) ? nums[nums.length - 1] : 10,
        text,
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
 * Outlines of the web (v) and flanges (o, u) cut by the ST header saw angles.
 *
 * Each end is treated as one plane cut. The web angle tilts the cut over the
 * profile height, the flange angle over the flange width. A positive angle
 * shortens the part at web y = 0 and flange y = 0; x = 0 stays at the
 * outermost point of the part, which is how hole positions are measured.
 */
export function headerCutOutlines(header) {
  const { length: L, height: H, width: W } = header;
  const tan = (deg) => (Math.abs(deg) >= 89 ? 0 : Math.tan((deg * Math.PI) / 180));
  // setback of the cut from the part end at web height y and flange position z
  const plane = (webDeg, flangeDeg) => {
    const tw = tan(webDeg), tf = tan(flangeDeg);
    const raw = (y, z) => tw * (H - y) + tf * (W - z);
    const min = Math.min(raw(0, 0), raw(0, W), raw(H, 0), raw(H, W));
    return (y, z) => raw(y, z) - min;
  };
  const sb = plane(header.webStartCut, header.flangeStartCut);
  const eb = plane(header.webEndCut, header.flangeEndCut);
  const s = (y, z) => sb(y, z);
  const e = (y, z) => L - eb(y, z);
  const flange = (y) => [
    { x: s(y, 0), y: 0 }, { x: e(y, 0), y: 0 }, { x: e(y, W), y: W }, { x: s(y, W), y: W },
  ];
  return {
    v: [{ x: s(0, W / 2), y: 0 }, { x: e(0, W / 2), y: 0 }, { x: e(H, W / 2), y: H }, { x: s(H, W / 2), y: H }],
    u: flange(0),
    o: flange(H),
  };
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
  mark: "#7FE3C8",   // SI marking text
};
