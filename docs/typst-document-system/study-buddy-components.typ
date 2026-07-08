// Study Buddy 2.0 - corporate identity component library
// CeTZ is pinned so flowcharts use geometric anchors instead of text arrows.

#import "@preview/cetz:0.5.0"

#let sb-colors = (
  navy: rgb("#19254b"),
  blue: rgb("#323a61"),
  gold: rgb("#dfbb63"),
  gold-dark: rgb("#c3994d"),
  cyan: rgb("#397f93"),
  green: rgb("#23805A"),
  amber: rgb("#c3994d"),
  red: rgb("#B33A3A"),
  ink: rgb("#20263f"),
  muted: rgb("#66708f"),
  line: rgb("#d9ddea"),
  soft: rgb("#f6f7fb"),
  white: rgb("#FFFFFF"),
)

#let sb-space = (
  xs: 2pt,
  sm: 4pt,
  md: 8pt,
  lg: 14pt,
  xl: 24pt,
)

#let sb-tone-color(tone) = {
  if tone == "success" {
    sb-colors.green
  } else if tone == "warning" {
    sb-colors.amber
  } else if tone == "danger" {
    sb-colors.red
  } else if tone == "info" {
    sb-colors.cyan
  } else {
    sb-colors.blue
  }
}

#let sb-tone-fill(tone) = {
  if tone == "success" {
    rgb("#EAF6F0")
  } else if tone == "warning" {
    rgb("#FFF4E2")
  } else if tone == "danger" {
    rgb("#FCECEC")
  } else if tone == "info" {
    rgb("#EAF7FA")
  } else {
    rgb("#ECF3FD")
  }
}

#let sb-chip(label, tone: "primary") = {
  let color = sb-tone-color(tone)
  box(
    fill: sb-tone-fill(tone),
    stroke: 0.5pt + color,
    radius: 2.5pt,
    inset: (x: 5pt, y: 2.5pt),
  )[
    #text(8pt, weight: "semibold", fill: color)[#label]
  ]
}

#let sb-source-ref(label, target: none, url: none) = {
  let chip = sb-chip(label, tone: "info")
  let destination = if target != none { target } else { url }
  if destination == none {
    chip
  } else {
    link(destination)[#chip]
  }
}

#let sb-divider(label: none) = [
  #v(7pt)
  #line(length: 100%, stroke: 0.45pt + sb-colors.line)
  #if label != none [
    #v(-6pt)
    #align(center)[
      #box(fill: sb-colors.white, inset: (x: 6pt, y: 0pt))[
        #text(7.4pt, weight: "medium", fill: sb-colors.muted)[#label]
      ]
    ]
  ]
  #v(7pt)
]

#let sb-meta-row(label, value) = grid(
  columns: (30mm, 1fr),
  gutter: 3mm,
  [#text(8.5pt, fill: sb-colors.muted)[#label]],
  [#text(9pt, weight: "medium")[#value]],
)

#let sb-title-page(
  title: "Study Buddy",
  subtitle: none,
  course: none,
  kind: "Lernunterlage",
  semester: none,
  author: "Study Buddy 2.0",
  status: "Arbeitsstand",
  date: datetime.today().display("[day].[month].[year]"),
) = [
  #set page(header: none, footer: none)
  #block(
    width: 100%,
    height: 100%,
    inset: 0pt,
  )[
    #rect(width: 100%, height: 4mm, fill: sb-colors.navy)
    #v(14mm)
    #grid(
      columns: (1fr, auto),
      align: (left, top),
      [
        #text(10pt, weight: "bold", tracking: 1.2pt, fill: sb-colors.blue)[
          STUDY BUDDY 2.0
        ]
        #v(2mm)
        #text(8.5pt, fill: sb-colors.muted)[FH Technikum Wien · Engineering Study Documents]
      ],
      [#sb-chip(kind, tone: "success")],
    )

    #v(1fr)
    #text(30pt, weight: "bold", fill: sb-colors.navy)[#title]
    #if subtitle != none [
      #v(4mm)
      #text(13pt, fill: sb-colors.muted)[#subtitle]
    ]
    #v(8mm)
    #line(length: 42mm, stroke: 2pt + sb-colors.gold)
    #v(10mm)

    #block(
      width: 100%,
      fill: sb-colors.soft,
      stroke: 0.6pt + sb-colors.line,
      radius: 4pt,
      inset: 10pt,
    )[
      #if course != none [#sb-meta-row("Lehrveranstaltung", course) #v(4pt)]
      #if semester != none [#sb-meta-row("Semester", semester) #v(4pt)]
      #sb-meta-row("Dokumenttyp", kind)
      #v(4pt)
      #sb-meta-row("Erstellt von", author)
      #v(4pt)
      #sb-meta-row("Stand", date)
      #v(4pt)
      #sb-meta-row("Status", status)
    ]

    #v(1fr)
    #grid(
      columns: (1fr, auto),
      align: (left, bottom),
      [#text(8pt, fill: sb-colors.muted)[
        Standardisiertes Study Buddy Dokument · Typst · Corporate Identity
      ]],
      [
        #box(
          width: 13mm,
          height: 13mm,
          fill: sb-colors.navy,
          radius: 2pt,
          inset: 2pt,
        )[
          #align(center + horizon)[
            #text(7pt, weight: "bold", fill: white)[SB 2.0]
          ]
        ]
      ],
    )
  ]
]

#let sb-header(short-title, course: none) = context {
  grid(
    columns: (1fr, auto),
    align: (left, bottom),
    [
      #text(8pt, weight: "medium", fill: sb-colors.navy)[#short-title]
      #if course != none [
        #text(8pt, fill: sb-colors.muted)[ · #course]
      ]
    ],
    [#text(7.5pt, weight: "bold", fill: sb-colors.blue)[STUDY BUDDY]],
  )
  v(2pt)
  line(length: 100%, stroke: 0.55pt + sb-colors.line)
}

#let sb-footer() = context {
  line(length: 100%, stroke: 0.45pt + sb-colors.line)
  v(2pt)
  grid(
    columns: (1fr, auto),
    [
      #text(7.5pt, fill: sb-colors.muted)[
        Lernunterlage · Angaben und Quellen vor Verwendung prüfen
      ]
    ],
    [
      #text(8pt, fill: sb-colors.muted)[
        Seite #counter(page).display("1")
      ]
    ],
  )
}

#let sb-callout(title: none, tone: "primary", body) = {
  let color = sb-tone-color(tone)
  block(
    width: 100%,
    breakable: true,
    fill: sb-tone-fill(tone),
    stroke: (left: 2.4pt + color, rest: 0.45pt + sb-colors.line),
    radius: 3pt,
    inset: 8pt,
  )[
    #if title != none [
      #text(9pt, weight: "bold", fill: color)[#title]
      #v(3pt)
    ]
    #body
  ]
}

#let sb-definition(term, body) = sb-callout(
  title: [Definition · #term],
  tone: "info",
  body,
)

#let sb-sequence(value) = if type(value) == str { (value,) } else { value }

#let sb-formula(
  name: "Formel",
  variables: (),
  units: (),
  source: none,
  note: none,
  body,
) = {
  let normalized-variables = sb-sequence(variables)
  let normalized-units = sb-sequence(units)
  block(
    width: 100%,
    breakable: true,
    fill: sb-colors.white,
    stroke: (bottom: 0.55pt + sb-colors.line),
    inset: (x: 3pt, y: 7pt),
  )[
    #grid(
      columns: (31mm, 1fr),
      gutter: 7pt,
      align: (left, horizon),
      [#text(8.6pt, weight: "bold", fill: sb-colors.green)[#name]],
      [#align(center)[#text(12.5pt)[#body]]],
    )
    #if note != none [
      #v(4pt)
      #text(8.5pt, fill: sb-colors.ink)[#note]
    ]
    #if normalized-variables.len() > 0 or normalized-units.len() > 0 or source != none [
      #v(3pt)
      #text(7.5pt, fill: sb-colors.muted)[
        #if normalized-variables.len() > 0 [
          *Variablen:* #normalized-variables.join("; ")
        ]
        #if normalized-units.len() > 0 [
          #if normalized-variables.len() > 0 [#h(6pt)]
          *Einheiten:* #normalized-units.join("; ")
        ]
        #if source != none [
          #h(6pt)
          *Quelle:* #source
        ]
      ]
    ]
  ]
}

#let sb-math-panel(title, note: none, body) = block(
  width: 100%,
  breakable: false,
  fill: sb-colors.white,
  stroke: 0.55pt + sb-colors.line,
  radius: 3pt,
  inset: 9pt,
)[
  #text(9pt, weight: "bold", fill: sb-colors.navy)[#title]
  #if note != none [
    #h(4pt)
    #text(8pt, fill: sb-colors.muted)[#note]
  ]
  #v(6pt)
  #align(center)[#body]
]

#let sb-example(title: "Rechenbeispiel", result: none, breakable: false, body) = block(
  width: 100%,
  breakable: breakable,
  fill: sb-colors.white,
  stroke: (left: 2.4pt + sb-colors.gold-dark, rest: 0.55pt + sb-colors.line),
  radius: 3pt,
  inset: 0pt,
)[
  #block(width: 100%, fill: sb-colors.soft, inset: (x: 9pt, y: 7pt))[
    #text(9pt, weight: "bold", fill: sb-colors.navy)[#title]
  ]
  #block(width: 100%, inset: 9pt)[#body]
  #if result != none [
    #block(
      width: 100%,
      fill: rgb("#FFF8E8"),
      inset: (x: 9pt, y: 7pt),
    )[
      #text(8.5pt, weight: "bold", fill: sb-colors.gold-dark)[Ergebnis]
      #h(5pt)
      #text(9pt, weight: "semibold", fill: sb-colors.ink)[#result]
    ]
  ]
]

#let sb-source-note(source, coverage: none) = block(
  width: 100%,
  breakable: true,
  fill: sb-colors.white,
  stroke: 0.45pt + sb-colors.line,
  radius: 2.5pt,
  inset: 6pt,
)[
  #text(8pt, weight: "bold", fill: sb-colors.navy)[Quelle]
  #h(4pt)
  #text(8pt, fill: sb-colors.muted)[#source]
  #if coverage != none [
    #linebreak()
    #text(7.8pt, fill: sb-colors.muted)[*Quellenlage:* #coverage]
  ]
]

#let sb-figure(caption: none, label-text: none, body) = [
  #block(
    width: 100%,
    breakable: false,
    fill: sb-colors.white,
    stroke: 0.55pt + sb-colors.line,
    radius: 3pt,
    inset: 9pt,
  )[
    #align(center)[#body]
  ]
  #if caption != none [
    #v(3pt)
    #align(center)[
      #text(8pt, fill: sb-colors.muted)[
        #if label-text != none [*#label-text:* ]
        #caption
      ]
    ]
  ]
]

#let sb-table(
  columns: (1fr,),
  header: (),
  rows: (),
  compact: false,
) = {
  let padding = if compact { 3pt } else { 5pt }
  block(width: 100%, breakable: false)[
    #table(
      columns: columns,
      stroke: 0.45pt + sb-colors.line,
      inset: padding,
      align: (left, horizon),
      ..header.map(cell => table.cell(fill: sb-colors.navy)[
        #box(height: 4.5mm)[
          #align(left + horizon)[
            #text(8.3pt, weight: "bold", fill: white)[#cell]
          ]
        ]
      ]),
      ..rows.enumerate().map(pair => {
        let index = pair.first()
        let row = pair.last()
        row.map(cell => table.cell(
          fill: if calc.even(index) { sb-colors.white } else { sb-colors.soft },
        )[
          #box(height: 5.5mm)[
            #align(left + horizon)[#text(8.5pt)[#cell]]
          ]
        ])
      }).flatten(),
    )
  ]
}

#let sb-table-section(title, body) = block(
  width: 100%,
  breakable: false,
)[
  #heading(level: 2, outlined: true)[#title]
  #body
]

#let sb-key-value-table(rows) = sb-table(
  columns: (0.34fr, 0.66fr),
  header: ("Merkmal", "Angabe"),
  rows: rows,
)

#let sb-comparison-table(rows) = sb-table(
  columns: (0.26fr, 0.37fr, 0.37fr),
  header: ("Kriterium", "Variante A", "Variante B"),
  rows: rows,
)

#let sb-schedule-table(rows) = sb-table(
  columns: (17mm, 24mm, 1fr, 23mm),
  header: ("Zeit", "Phase", "Aktivität", "Ergebnis"),
  rows: rows,
  compact: true,
)

#let sb-flow-node(title, subtitle: none, tone: "primary", width: 44mm) = {
  let color = sb-tone-color(tone)
  box(
    width: width,
    fill: sb-tone-fill(tone),
    stroke: 0.75pt + color,
    radius: 3pt,
    inset: 6pt,
  )[
    #align(center)[
      #text(8.5pt, weight: "bold", fill: color)[#title]
      #if subtitle != none [
        #linebreak()
        #text(7.5pt, fill: sb-colors.muted)[#subtitle]
      ]
    ]
  ]
}

#let sb-flow-label(
  title,
  subtitle: none,
  color: sb-colors.blue,
  width: 58mm,
  height: 11mm,
) = {
  assert(title.len() <= 36, message: "Flowchart title exceeds 36 characters: " + title)
  if subtitle != none {
    assert(subtitle.len() <= 48, message: "Flowchart subtitle exceeds 48 characters: " + subtitle)
  }
  box(width: width, height: height, inset: 2pt)[
    #align(center + horizon)[
      #text(8.3pt, weight: "bold", fill: color)[#title]
      #if subtitle != none [
        #linebreak()
        #text(7.2pt, fill: sb-colors.muted)[#subtitle]
      ]
    ]
  ]
}

#let sb-flowchart-linear(steps, debug: false) = {
  assert(steps.len() >= 2, message: "A linear flowchart needs at least two steps.")
  assert(steps.len() <= 6, message: "A linear flowchart supports at most six steps per figure.")
  align(center)[
    #cetz.canvas(length: 1cm, debug: debug, {
      import cetz.draw: *

      let node-width = 7.2
      let node-height = 1.15
      let gap = 0.8
      let color-for(tone) = sb-tone-color(tone)
      let fill-for(tone) = sb-tone-fill(tone)

      for (index, step) in steps.enumerate() {
        let y = (steps.len() - index - 1) * (node-height + gap)
        let tone = step.at("tone", default: "primary")
        let color = color-for(tone)
        let name = "step-" + str(index)
        rect(
          (-node-width / 2, y),
          (node-width / 2, y + node-height),
          name: name,
          fill: fill-for(tone),
          stroke: 0.8pt + color,
          radius: 3pt,
        )
        content(
          (0, y + node-height / 2),
          sb-flow-label(
            step.at("title"),
            subtitle: step.at("subtitle", default: none),
            color: color,
            width: 68mm,
            height: 10mm,
          ),
        )
        if index > 0 {
          line(
            "step-" + str(index - 1),
            name,
            stroke: 0.9pt + sb-colors.blue,
            mark: (end: ">"),
          )
        }
      }
    })
  ]
}

#let sb-flowchart-branch(
  start,
  decision,
  yes,
  no,
  finish,
  debug: false,
) = {
  for label in (start, decision, yes, no, finish) {
    assert(label.len() <= 32, message: "Branch flowchart label exceeds 32 characters: " + label)
  }
  align(center)[
    #cetz.canvas(length: 1cm, debug: debug, {
      import cetz.draw: *

      let process-width = 5.0
      let process-height = 1.05
      let branch-x = 3.8
      let start-y = 8.3
      let decision-y = 5.8
      let branch-y = 2.6
      let merge-y = 1.75
      let finish-y = 0.0

      assert(
        2 * branch-x - process-width >= 2.0,
        message: "Branch nodes need at least 2 cm horizontal clearance.",
      )
      assert(
        decision-y - branch-y >= 2.2,
        message: "Decision and branch nodes need at least 2.2 cm vertical clearance.",
      )

      rect(
        (-process-width / 2, start-y),
        (process-width / 2, start-y + process-height),
        name: "start",
        fill: sb-tone-fill("primary"),
        stroke: 0.8pt + sb-colors.blue,
        radius: 3pt,
      )
      content(
        (0, start-y + process-height / 2),
        sb-flow-label(start, width: 47mm, height: 9mm),
      )

      line(
        (0, decision-y + 1.35),
        (1.75, decision-y),
        (0, decision-y - 1.35),
        (-1.75, decision-y),
        close: true,
        name: "decision",
        fill: sb-tone-fill("warning"),
        stroke: 0.8pt + sb-colors.amber,
      )
      content(
        (0, decision-y),
        sb-flow-label(
          decision,
          color: sb-colors.amber,
          width: 28mm,
          height: 9mm,
        ),
      )

      rect(
        (-branch-x - process-width / 2, branch-y),
        (-branch-x + process-width / 2, branch-y + process-height),
        name: "yes",
        fill: sb-tone-fill("success"),
        stroke: 0.8pt + sb-colors.green,
        radius: 3pt,
      )
      content(
        (-branch-x, branch-y + process-height / 2),
        sb-flow-label(
          yes,
          color: sb-colors.green,
          width: 47mm,
          height: 9mm,
        ),
      )

      rect(
        (branch-x - process-width / 2, branch-y),
        (branch-x + process-width / 2, branch-y + process-height),
        name: "no",
        fill: sb-tone-fill("danger"),
        stroke: 0.8pt + sb-colors.red,
        radius: 3pt,
      )
      content(
        (branch-x, branch-y + process-height / 2),
        sb-flow-label(
          no,
          color: sb-colors.red,
          width: 47mm,
          height: 9mm,
        ),
      )

      rect(
        (-process-width / 2, finish-y),
        (process-width / 2, finish-y + process-height),
        name: "finish",
        fill: sb-tone-fill("info"),
        stroke: 0.8pt + sb-colors.cyan,
        radius: 3pt,
      )
      content(
        (0, finish-y + process-height / 2),
        sb-flow-label(
          finish,
          color: sb-colors.cyan,
          width: 47mm,
          height: 9mm,
        ),
      )

      line(
        "start",
        "decision",
        stroke: 0.9pt + sb-colors.blue,
        mark: (end: ">"),
      )

      line(
        (-1.75, decision-y),
        (-branch-x, decision-y),
        (-branch-x, branch-y + process-height),
        stroke: 0.9pt + sb-colors.green,
        mark: (end: ">"),
      )
      content(
        (-2.55, decision-y + 0.28),
        text(7.5pt, weight: "bold", fill: sb-colors.green)[JA],
      )

      line(
        (1.75, decision-y),
        (branch-x, decision-y),
        (branch-x, branch-y + process-height),
        stroke: 0.9pt + sb-colors.red,
        mark: (end: ">"),
      )
      content(
        (2.55, decision-y + 0.28),
        text(7.5pt, weight: "bold", fill: sb-colors.red)[NEIN],
      )

      line(
        (-branch-x, branch-y),
        (-branch-x, merge-y),
        (0, merge-y),
        stroke: 0.9pt + sb-colors.blue,
      )
      line(
        (branch-x, branch-y),
        (branch-x, merge-y),
        (0, merge-y),
        stroke: 0.9pt + sb-colors.blue,
      )
      circle((0, merge-y), radius: 0.07, fill: sb-colors.blue, stroke: none)
      line(
        (0, merge-y),
        (0, finish-y + process-height),
        stroke: 0.9pt + sb-colors.blue,
        mark: (end: ">"),
      )
    })
  ]
}

#let sb-block-diagram(blocks, debug: false) = {
  assert(blocks.len() >= 2, message: "A block diagram needs at least two blocks.")
  assert(blocks.len() <= 5, message: "A block diagram supports at most five blocks per row.")
  for label in blocks {
    assert(label.len() <= 22, message: "Block label exceeds 22 characters: " + label)
  }
  align(center)[
    #cetz.canvas(length: 1cm, debug: debug, {
      import cetz.draw: *

      let node-width = 3.2
      let node-height = 1.05
      let gap = 1.15

      for (index, label) in blocks.enumerate() {
        let x = index * (node-width + gap)
        let name = "block-" + str(index)
        rect(
          (x, 0),
          (x + node-width, node-height),
          name: name,
          fill: sb-tone-fill("info"),
          stroke: 0.8pt + sb-colors.cyan,
          radius: 3pt,
        )
        content(
          (x + node-width / 2, node-height / 2),
          sb-flow-label(
            label,
            color: sb-colors.cyan,
            width: 29mm,
            height: 9mm,
          ),
        )
        if index > 0 {
          line(
            "block-" + str(index - 1),
            name,
            stroke: 0.9pt + sb-colors.blue,
            mark: (end: ">"),
          )
        }
      }
    })
  ]
}

#let sb-wire(width: 12mm) = line(length: width, stroke: 0.9pt + sb-colors.ink)

#let sb-vwire(height: 7mm) = box(
  width: 0.9pt,
  height: height,
  fill: sb-colors.ink,
)

#let sb-resistor(label: "R") = stack(
  dir: ttb,
  spacing: 2pt,
  box(
    width: 20mm,
    height: 6mm,
    stroke: 0.9pt + sb-colors.ink,
    inset: 1pt,
  )[#align(center + horizon)[#text(7.5pt)[#label]]],
)

#let sb-capacitor(label: "C") = stack(
  dir: ttb,
  spacing: 1pt,
  align(center)[
    #line(length: 12mm, stroke: 1pt + sb-colors.ink)
    #v(1.5pt)
    #line(length: 12mm, stroke: 1pt + sb-colors.ink)
  ],
  text(7.5pt)[#label],
)

#let sb-ground() = align(center)[
  #line(length: 11mm, stroke: 0.9pt + sb-colors.ink)
  #v(1.5pt)
  #line(length: 7mm, stroke: 0.8pt + sb-colors.ink)
  #v(1.5pt)
  #line(length: 3mm, stroke: 0.7pt + sb-colors.ink)
]

#let sb-rc-schematic(debug: false) = align(center)[
  #cetz.canvas(length: 1cm, debug: debug, {
    import cetz.draw: *

    let wire = 1pt + sb-colors.ink
    let component = 1pt + sb-colors.navy
    let signal = 0.8pt + sb-colors.blue
    let y = 4.0
    let node-x = 6.2

    circle((0.5, y), radius: 0.09, fill: white, stroke: wire)
    line((0.59, y), (2.25, y), stroke: wire)

    rect(
      (2.25, y - 0.38),
      (4.35, y + 0.38),
      fill: white,
      stroke: component,
      radius: 1pt,
    )
    line((4.35, y), (node-x, y), stroke: wire)

    circle((node-x, y), radius: 0.09, fill: sb-colors.ink, stroke: none)
    line((node-x, y), (8.65, y), stroke: wire)
    circle((8.75, y), radius: 0.09, fill: white, stroke: wire)

    line((node-x, y), (node-x, 2.82), stroke: wire)
    line((node-x - 0.65, 2.82), (node-x + 0.65, 2.82), stroke: component)
    line((node-x - 0.65, 2.40), (node-x + 0.65, 2.40), stroke: component)
    line((node-x, 2.40), (node-x, 1.32), stroke: wire)

    line((node-x - 0.72, 1.32), (node-x + 0.72, 1.32), stroke: component)
    line((node-x - 0.47, 1.05), (node-x + 0.47, 1.05), stroke: component)
    line((node-x - 0.22, 0.78), (node-x + 0.22, 0.78), stroke: component)

    line(
      (2.55, 4.92),
      (4.05, 4.92),
      stroke: signal,
      mark: (end: ">"),
    )
    content((3.30, 5.18), text(8pt, fill: sb-colors.blue)[$i_R(t)$])
    content((3.30, y), text(8.5pt, weight: "bold", fill: sb-colors.navy)[$R_1$])
    content((node-x + 1.0, 2.61), text(8.5pt, weight: "bold", fill: sb-colors.navy)[$C_1$])
    content((0.5, 4.50), text(8.5pt, fill: sb-colors.blue)[$u_"in"(t)$])
    content((8.75, 4.50), text(8.5pt, fill: sb-colors.green)[$u_"out"(t)$])
    content((3.30, 3.45), text(7.5pt, fill: sb-colors.muted)[$10 k Omega$])
    content((node-x + 1.0, 2.16), text(7.5pt, fill: sb-colors.muted)[$100 n F$])
    content((node-x, 0.35), text(7.5pt, fill: sb-colors.muted)[GND])
  })
]

#let sb-checklist(items) = [
  #for item in items [
    #grid(
      columns: (5mm, 1fr),
      gutter: 2mm,
      align: (left, top),
      [#box(width: 3.4mm, height: 3.4mm, stroke: 0.7pt + sb-colors.blue, radius: 0.6pt)],
      [#item],
    )
    #v(3pt)
  ]
]

#let sb-exercise(
  number: "1",
  title: "Übung",
  difficulty: "mittel",
  points: none,
  body,
) = block(
  width: 100%,
  breakable: true,
  stroke: 0.65pt + sb-colors.line,
  radius: 3pt,
  inset: 8pt,
)[
  #grid(
    columns: (1fr, auto),
    [
      #text(9.5pt, weight: "bold", fill: sb-colors.navy)[
        Aufgabe #number · #title
      ]
    ],
    [
      #sb-chip(difficulty, tone: "warning")
      #if points != none [ #h(3pt) #sb-chip([#points P.])]
    ],
  )
  #v(5pt)
  #body
]

#let sb-page-rules() = [
  #set text(
    font: "New Computer Modern",
    size: 10.2pt,
    lang: "de",
    region: "AT",
    fill: sb-colors.ink,
  )
  #set par(justify: true, leading: 0.68em)
  #set heading(numbering: "1.1", outlined: true)
  #show heading.where(level: 1): it => [
    #pagebreak(weak: true)
    #v(2mm)
    #text(18pt, weight: "bold", fill: sb-colors.navy)[#it.body]
    #v(2pt)
    #line(length: 22mm, stroke: 1.8pt + sb-colors.cyan)
    #v(5mm)
  ]
  #show heading.where(level: 2): it => [
    #v(5mm)
    #text(12pt, weight: "bold", fill: sb-colors.blue)[#it.body]
    #v(2mm)
  ]
  #show heading.where(level: 3): it => [
    #v(3mm)
    #text(10pt, weight: "bold", fill: sb-colors.navy)[#it.body]
    #v(1mm)
  ]
  #show link: underline
  #show raw: set text(font: "DejaVu Sans Mono", size: 8.5pt)
]

#let sb-document(
  title: "Study Buddy",
  short-title: none,
  subtitle: none,
  course: none,
  kind: "Lernunterlage",
  semester: none,
  author: "Study Buddy 2.0",
  status: "Arbeitsstand",
  date: datetime.today().display("[day].[month].[year]"),
  body: [],
) = [
  #set document(title: title, author: author)
  #set page(
    paper: "a4",
    margin: (left: 18mm, right: 18mm, top: 17mm, bottom: 17mm),
  )
  #sb-page-rules()
  #sb-title-page(
    title: title,
    subtitle: subtitle,
    course: course,
    kind: kind,
    semester: semester,
    author: author,
    status: status,
    date: date,
  )
  #pagebreak()
  #counter(page).update(1)
  #set page(
    header: sb-header(
      if short-title == none { title } else { short-title },
      course: course,
    ),
    footer: sb-footer(),
  )
  #body
]
