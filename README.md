# Logic Lab

Learn programming, flowcharts and logic by controlling real-world scenarios.

## Running it

Double-click `index.html` to open it in your browser — no install needed.
(Or serve the folder, e.g. `python3 -m http.server 8765`, and visit http://localhost:8765.)

## How it works

- Pick a scenario. The screen splits: **program** on the left, **simulation** on the right.
- Switch the program panel between **Code** and **Flowchart**. Both show the same program.
  In the flowchart, click **+** on any arrow to pick a new step from a palette of shapes
  (action, wait, wait until, if/else, while, repeat, forever, variable) and fill in a small
  form. Click any existing step to edit it the same way.
- Press **Run**. The current step lights up in the code and the flowchart while the
  animation plays. Get the logic wrong and vehicles crash, with an explanation of why.

## The language

```
forever:                  repeat 3 times:        while car waiting west:
    set beacon on             wait 1                 wait 1
    wait 0.5
if dark:                  wait until bridge clear
    set floodlight on
else:
    set floodlight off
```

Indent with Tab (4 spaces). `#` starts a comment. Conditions can use `not`, `and`, `or`,
and `else if`. Variables: `set count to 0`, `change count by 1`, `if count > 3:`.
Number sensors (like `queue south`) can be compared too.

## Scenarios

Beginner: Zebra Crossing, Lighthouse, Car Park Barrier, Shop Doors.
Intermediate: Single-Lane Bridge, Pelican Crossing, Level Crossing, Canal Lock, Fire Station.
Advanced: Crossroads, Smart Roundabout (variables), Airport Runway.

## Files

- `js/language.js` – parser and step-by-step interpreter
- `js/flowchart.js` – turns a program into an SVG flowchart
- `js/editor.js` – code editor with highlighting
- `js/stepbuilder.js` – the visual shape picker and step forms for the flowchart
- `js/sim-kit.js` – shared simulation base class and drawing helpers (cars, trains, boats, planes…)
- `js/scenarios/*.js` – one file per scenario (devices, sensors, goals, simulation)
- `js/app.js` – screens, controls and the run loop

## Adding a scenario

Copy `js/scenarios/zebra.js`, change its devices, sensors, goals and drawing, push it onto
`FL.scenarios`, and add a `<script>` tag for it in `index.html` before `js/app.js`.
If you change any `.js` file, bump the `?v=` number on the script tags so browsers load the new version.
