import React, { useState, useEffect, useRef } from "react";
import * as THREE from "three";
import { polygonArea, rect, endCutAngles, PALETTE as C } from "./dstv.js";

/* ------------------------------------------------------------------ */
/*  Shape helpers                                                      */
/* ------------------------------------------------------------------ */

function shapeFrom(pts, holes) {
  const s = new THREE.Shape();
  s.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i].x, pts[i].y);
  s.closePath();
  (holes || []).forEach((hp) => {
    const p = new THREE.Path();
    p.moveTo(hp[0].x, hp[0].y);
    for (let i = 1; i < hp.length; i++) p.lineTo(hp[i].x, hp[i].y);
    p.closePath();
    s.holes.push(p);
  });
  return s;
}

/** Slot outline centred on the origin, long axis along +X. */
function slotShape(len, wid) {
  const r = wid / 2;
  const half = Math.max(0, (len - wid) / 2);
  const s = new THREE.Shape();
  s.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.absarc(-half, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  s.closePath();
  return s;
}

function makeLabel(text, color, worldHeight) {
  const pad = 22, fontSize = 52;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = `600 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const hgt = fontSize + pad;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(11,23,35,0.88)";
  ctx.fillRect(0, 0, w, hgt);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, w - 3, hgt - 3);
  ctx.font = `600 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, hgt / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  sprite.renderOrder = 999;
  sprite.scale.set((w / hgt) * worldHeight, worldHeight, 1);
  return sprite;
}

/* ------------------------------------------------------------------ */

export default function Viewport({ model, selected, onSelect, view, showLabels, onApi }) {
  const mountRef = useRef(null);
  const stateRef = useRef({});
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  /* --- scene setup, once --- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(C.ink);

    const camera = new THREE.PerspectiveCamera(38, 1, 1, 40000);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      // required so the PNG export can read the canvas back
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.style.touchAction = "none";

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(1, 2, 1.4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc4e8, 0.45);
    fill.position.set(-1.2, -0.6, -1);
    scene.add(fill);

    const root = new THREE.Group();
    scene.add(root);

    const orbit = { theta: -0.72, phi: 1.18, radius: 3000, target: new THREE.Vector3() };
    const applyCamera = () => {
      const { theta, phi, radius, target } = orbit;
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(target);
    };

    stateRef.current = { scene, camera, renderer, root, orbit, applyCamera, holeMeshes: [], mount };

    onApi?.({
      snapshot: () => {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL("image/png");
      },
      fit: () => { orbit.theta = -0.72; orbit.phi = 1.18; applyCamera(); },
    });

    /* --- interaction --- */
    let dragging = null, lastX = 0, lastY = 0;
    const down = (e) => {
      dragging = e.shiftKey || e.button === 2 ? "pan" : "orbit";
      lastX = e.clientX; lastY = e.clientY;
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (dragging === "orbit") {
        orbit.theta -= dx * 0.006;
        orbit.phi = Math.max(0.08, Math.min(Math.PI - 0.08, orbit.phi - dy * 0.006));
      } else {
        const s = orbit.radius * 0.0011;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        orbit.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
      }
      applyCamera();
    };
    const up = () => { dragging = null; renderer.domElement.style.cursor = "grab"; };
    const wheel = (e) => {
      e.preventDefault();
      orbit.radius = Math.max(120, Math.min(30000, orbit.radius * (1 + Math.sign(e.deltaY) * 0.12)));
      applyCamera();
    };
    const menu = (e) => e.preventDefault();

    renderer.domElement.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", menu);

    /* --- picking --- */
    const raycaster = new THREE.Raycaster();
    const click = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(stateRef.current.holeMeshes, false);
      if (hits.length) onSelectRef.current(hits[0].object.userData.holeId);
    };
    renderer.domElement.addEventListener("click", click);

    /* --- resize + render loop --- */
    const resize = () => {
      const w = mount.clientWidth, hh = mount.clientHeight;
      if (!w || !hh) return;
      renderer.setSize(w, hh, false);
      camera.aspect = w / hh;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let raf;
    const loop = () => { raf = requestAnimationFrame(loop); renderer.render(scene, camera); };
    loop();
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("wheel", wheel);
      renderer.domElement.removeEventListener("contextmenu", menu);
      renderer.domElement.removeEventListener("click", click);
      renderer.dispose();
      renderer.domElement.parentNode?.removeChild(renderer.domElement);
    };
  }, []);

  /* --- (re)build the part --- */
  useEffect(() => {
    const s = stateRef.current;
    if (!ready || !s.root || !model) return;
    const { header, holes, contours } = model;
    const { length: L, height: H, width: W, flangeThk: TF, webThk: TW } = header;

    while (s.root.children.length) {
      const c = s.root.children.pop();
      c.traverse?.((o) => {
        o.geometry?.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    }
    s.holeMeshes = [];

    const steelMat = new THREE.MeshStandardMaterial({
      color: C.steel, metalness: 0.55, roughness: 0.45,
      transparent: true, opacity: 0.9,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x2c4f6e });

    const byFace = {};
    contours.forEach((c) => { (byFace[c.face] = byFace[c.face] || []).push(c); });

    const outlineFor = (face, fallback) => {
      const list = (byFace[face] || []).filter((c) => c.kind === "AK");
      if (!list.length) return { outer: fallback, holes: [] };
      const sorted = [...list].sort((a, b) => polygonArea(b.pts) - polygonArea(a.pts));
      const cutouts = sorted.slice(1).map((c) => c.pts)
        .concat((byFace[face] || []).filter((c) => c.kind === "IK").map((c) => c.pts));
      return { outer: sorted[0].pts, holes: cutouts };
    };

    const plate = (outline, transform) => {
      const geo = new THREE.ExtrudeGeometry(shapeFrom(outline.outer, outline.holes), {
        depth: transform.depth, bevelEnabled: false, curveSegments: 24,
      });
      transform.apply(geo);
      s.root.add(new THREE.Mesh(geo, steelMat));
      s.root.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat));
    };

    const web = outlineFor("v", rect(0, 0, L, H));
    plate(web, { depth: TW, apply: (g) => g.translate(0, 0, -TW / 2) });

    const isOpen = ["I", "U", "H", "M", "C"].includes(header.profileCode);
    if (isOpen) {
      plate(outlineFor("o", rect(0, 0, L, W)), {
        depth: TF,
        apply: (g) => { g.rotateX(-Math.PI / 2); g.translate(0, H - TF, W / 2); },
      });
      plate(outlineFor("u", rect(0, 0, L, W)), {
        depth: TF,
        apply: (g) => { g.rotateX(-Math.PI / 2); g.translate(0, 0, W / 2); },
      });
    }

    /* --- holes --- */
    const holeMat = new THREE.MeshStandardMaterial({
      color: C.punch, metalness: 0.2, roughness: 0.35,
      emissive: new THREE.Color(C.punch).multiplyScalar(0.28),
    });
    const slotMat = new THREE.MeshStandardMaterial({
      color: C.mill, metalness: 0.2, roughness: 0.35,
      emissive: new THREE.Color(C.mill).multiplyScalar(0.28),
    });

    holes.forEach((hole) => {
      const onWeb = hole.face === "v" || hole.face === "h";
      const thk = onWeb ? TW : TF;
      const over = thk * 1.6;
      let geo;

      if (hole.slotted) {
        geo = new THREE.ExtrudeGeometry(slotShape(hole.totalLength, hole.slotWidth), {
          depth: over, bevelEnabled: false, curveSegments: 24,
        });
        geo.translate(0, 0, -over / 2);
        // flange faces get mirrored by the -90 deg X rotation below, so flip the angle there
        geo.rotateZ(((onWeb ? 1 : -1) * hole.slotAngle * Math.PI) / 180);
      } else {
        geo = new THREE.CylinderGeometry(hole.diameter / 2, hole.diameter / 2, over, 28);
        geo.rotateX(Math.PI / 2);
      }

      if (onWeb) {
        geo.translate(hole.x, hole.y, 0);
      } else {
        geo.rotateX(-Math.PI / 2);
        const yPos = hole.face === "o" ? H - TF / 2 : TF / 2;
        geo.translate(hole.x, yPos, hole.y - W / 2);
      }

      const mesh = new THREE.Mesh(geo, hole.slotted ? slotMat : holeMat);
      mesh.userData.holeId = hole.id;
      mesh.renderOrder = 2;
      s.root.add(mesh);
      s.holeMeshes.push(mesh);
    });

    /* --- saw angle callouts and overall dimension --- */
    const labelSize = Math.max(H * 0.14, L * 0.018);
    if (showLabels) {
      const { start, end } = endCutAngles(web.outer, L);
      const callout = (cut) => {
        const square = cut.angle < 0.05;
        const spr = makeLabel(square ? "90.0 deg square" : `${cut.angle.toFixed(1)} deg saw`,
          square ? C.graph : C.chalk, labelSize);
        spr.position.set(cut.at, H + labelSize * 1.6, 0);
        s.root.add(spr);
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(cut.at, H + labelSize * 0.9, 0),
          new THREE.Vector3(cut.at, H * 0.5, 0),
        ]);
        s.root.add(new THREE.Line(g, new THREE.LineBasicMaterial({
          color: C.chalk, transparent: true, opacity: 0.5,
        })));
      };
      callout(start);
      callout(end);

      const dim = makeLabel(`${L.toFixed(0)} mm`, C.graph, labelSize * 0.9);
      dim.position.set(L / 2, -labelSize * 2.2, 0);
      s.root.add(dim);
      s.root.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, -labelSize * 1.1, 0),
          new THREE.Vector3(L, -labelSize * 1.1, 0),
        ]),
        new THREE.LineBasicMaterial({ color: C.graph, transparent: true, opacity: 0.6 })
      ));
    }

    /* --- blueprint grid --- */
    const step = 100;
    const gridSize = Math.ceil((L * 1.3) / step) * step;
    const grid = new THREE.GridHelper(gridSize, gridSize / step, 0x2a4a68, 0x1a3149);
    grid.position.set(L / 2, -H * 0.55, 0);
    grid.material.opacity = 0.5;
    grid.material.transparent = true;
    s.root.add(grid);

    s.root.position.set(-L / 2, -H / 2, 0);
    s.orbit.target.set(0, 0, 0);
    s.orbit.radius = Math.max(L, H, W) * 1.5;
    s.applyCamera();
  }, [ready, model, showLabels]);

  /* --- preset views --- */
  useEffect(() => {
    const s = stateRef.current;
    if (!ready || !s.orbit || !view) return;
    const presets = {
      iso: { theta: -0.72, phi: 1.18 },
      front: { theta: 0, phi: Math.PI / 2 },
      top: { theta: 0, phi: 0.12 },
      end: { theta: Math.PI / 2, phi: Math.PI / 2 },
    };
    const p = presets[view.name];
    if (p) { s.orbit.theta = p.theta; s.orbit.phi = p.phi; s.applyCamera(); }
  }, [ready, view]);

  /* --- selection highlight --- */
  useEffect(() => {
    const s = stateRef.current;
    if (!ready || !s.holeMeshes) return;
    s.holeMeshes.forEach((m) => {
      const on = m.userData.holeId === selected;
      m.scale.setScalar(on ? 1.05 : 1);
      m.material.emissiveIntensity = on ? 2.4 : 1;
    });
  }, [ready, selected]);

  return <div ref={mountRef} className="viewport" />;
}
