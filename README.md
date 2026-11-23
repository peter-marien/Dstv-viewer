# DSTV Viewer

Standalone desktop viewer for DSTV / NC1 steel part files. Renders the beam in 3D
with its drilled holes, slotted holes and saw angles, and shows the raw file
alongside it.

## Running it

```bash
npm install

npm run dev     # Vite dev server + Electron with hot reload
npm start       # production build, then run Electron against it
npm run dist    # build installers into release/
```

`npm run dist:win`, `dist:mac` and `dist:linux` target one platform. Cross-building
a Windows installer from Linux needs Wine; building on the target OS is simpler.

`npx vite` on its own serves the renderer at http://127.0.0.1:5173 in any browser.
Without the Electron shell, **Open part** uses the browser's file picker and the
native menu and file associations are not available.

### If Electron fails to start

`Electron failed to install correctly` means the Electron binary was never
downloaded into `node_modules/electron/dist`. The `electron` package fetches it in
an install script, which does not run when:

- dependencies were installed with `--ignore-scripts`, or
- your npm only runs install scripts for allowed packages (`allowScripts`) and
  `electron` is not on that list — `npm install-scripts ls` shows what is waiting.

Allow the script, or run it by hand with `node node_modules/electron/install.js`.
If `dist/` then holds only a `locales` folder, the download worked but the unzip
stopped early; this happened on Node 26. Use Node 22 LTS, or unzip the cached
archive from `%LOCALAPPDATA%\electron\Cache` into `node_modules/electron/dist` and
write `electron.exe` (no newline) to `node_modules/electron/path.txt`.

## What it shows

**Model tab** — the part in 3D. Drag to orbit, shift-drag to pan, scroll to zoom,
click a hole to select it. `iso` / `front` / `top` / `end` are preset views;
`notes` toggles the angle and dimension callouts. The sidebar lists the profile
dimensions, the web and flange saw angles at each end, the `SI` markings and every
hole. Clicking a hole in the list selects it in the model.

**Source tab** — the raw file with line numbers and colour-coded block keywords.
Every `BO` data line is clickable: clicking it selects that hole, and selecting a
hole anywhere in the app scrolls the source to its line.

## How the file is read

| Block | Meaning | Used for |
|---|---|---|
| `ST` | Part header | Profile name, grade, piece mark, length, height, flange width, flange and web thickness; web and flange cut angles for faces without an `AK` contour |
| `BO` | Holes | Round and slotted holes on any face |
| `AK` | Outer contour | The sawn outline of each face — the preferred source of saw angles |
| `IK` | Inner contour | Cut-outs, rendered as holes in the plate |
| `SI` | Marking text | Text drawn flat on the outside of its face, listed in the sidebar |

Face codes are `v` (web front), `h` (web back), `o` (top flange), `u` (bottom
flange). A face code appears on the first row of a block and is inherited by the
rows below it, which is what real post-processor output does.

### Holes vs slotted holes

A `BO` row is `face x y diameter depth slotTravel slotWidth slotAngle`. The row is
treated as a **slot** when `slotTravel` is non-zero, with overall length
`slotTravel + slotWidth` and width `slotWidth` (falling back to the diameter when
that field is zero), rotated by `slotAngle` in the plane of the face. Post-processors
disagree about whether `slotTravel` is centre-to-centre travel or overall length —
this reads it as travel. If your files use the other convention, change
`totalLength` in `src/dstv.js`.

Round holes render red, slots amber.

### Saw angles

The sidebar shows web and flange start and end angles, measured off the **outer
contours** (`AK`) rather than read from the `ST` header. If the two disagree, the
contour is what the saw actually cuts. Each face is extruded from its own `AK`
contour — web at web thickness, flanges at flange thickness — so mitres and copes
appear in the geometry rather than being drawn on top of a rectangular block.

When a face has no `AK` contour, its outline is built from the `ST` header cut
angles instead (web start/end, flange start/end), treating each end as one plane
cut. A positive angle shortens the part at web y = 0 and flange y = 0, with x = 0
at the outermost point. If your files lean the other way, flip the sign in
`headerCutOutlines` in `src/dstv.js`.

The sidebar note under the angles says which source was used.

### Markings

An `SI` row is `face x y … angle height text`. Post-processors put either four or
five numbers before the text, so the parser reads the run of numbers and takes the
angle and letter height from its end. These are both read the same way:

```
  u  737.88u  40.00  0.00  20  PR64          4 numbers: x y angle height
  v 1150.00  210.00  0.00  0.00  10.00  B-101  5 numbers: x y ? angle height
```

A reference suffix on a coordinate (`737.88u`) is ignored, text may contain
spaces, and a marking that is only a number (`101`) is still read as text. Each
marking is drawn flat on the outside of its face at its letter height, starting at
`x y` and turned by `angle`, so it reads correctly when that face is viewed from
outside the part. Markings render mint.

## Known limits

- Arc radii on contour vertices are drawn as straight chords. You get a warning
  banner when a file uses them.
- Holes are drawn as coloured solids sitting in the plate, not boolean-subtracted
  bores. Real subtraction needs a CSG pass — `three-bvh-csg` would slot in at the
  hole loop in `src/Viewport.jsx`.
- Only open profiles (`I`, `U`, `H`, `M`, `C`) get flanges. Plates, tubes and
  angles render as the web plate alone.
- The header saw-angle sign convention is checked against real files only for a
  positive web start cut. Flange and end cuts follow the same rule by assumption.
- The orbit stops just short of looking straight up, so markings on the underside
  of the bottom flange are only visible at a shallow angle.
- Markings and `SI` lines are not selectable; only holes are linked between the
  model, the sidebar and the Source tab.

## Layout

```
electron/
  main.cjs        main process: window, menu, dialogs, file associations, argv
  preload.cjs     contextBridge - open dialog, read path, save PNG, event subscriptions
src/
  main.jsx        React entry
  App.jsx         shell: tabs, sidebar, native wiring
  Viewport.jsx    three.js scene, geometry build, picking
  SourceTab.jsx   raw file view
  dstv.js         parser and geometry helpers - no React, no three.js
  sample.js       built-in demo part
  index.css       all styling
```

`src/dstv.js` has no dependency on React or three.js, so it can be reused in a
CLI or test harness directly.

## Security posture

`contextIsolation` on, `nodeIntegration` off, `sandbox` on. The renderer reaches
the filesystem only through the `window.dstv` bridge in `preload.cjs` — open
dialog, read a path, save a PNG, app info, and two event subscriptions for opened
files and menu commands; there is no `fs` or `ipcRenderer` on `window`. A CSP in `index.html` restricts script
sources to the bundle. External links open in the system browser rather than in an
Electron window.

## Desktop integration

- `.nc1`, `.nc` and `.dstv` are registered as file associations by the installer,
  so double-clicking a part opens it.
- A path passed on the command line opens on launch; a second launch hands the
  file to the running instance instead of opening a second window.
- Recent documents appear under File → Open Recent.
- File → Export view as PNG (`Ctrl/Cmd+E`) writes the current 3D view.
- `Ctrl/Cmd+1` / `2` switch tabs; `Ctrl/Cmd+I`, `F`, `T`, `R` snap to preset views.

## Notes for packaging

`build/` is where electron-builder looks for icons. Drop in `icon.ico` (256×256),
`icon.icns` and a 512×512 `icon.png` before running `npm run dist`, or it falls
back to the default Electron icon.
