# Study Buddy document standard

The canonical, production-facing Typst design system lives in:

`src/custom-skills/moodle/typst/study-buddy-components.typ`

Every generated study document receives that component library and the real
Study Buddy logo through `src/custom-skills/moodle/typstAssets.ts`. Generated
documents must use the `sb-document` shell and must not replace or override its
page branding.

## Approved visual identity

- Navy (`#19254b`) is the primary structural color.
- Blue (`#323a61`) and petrol (`#397f93`) establish hierarchy and technical
  accents.
- Gold (`#dfbb63`) is reserved for restrained Study Buddy brand details.
- Amber and red are semantic colors for warnings and errors, not decoration.
- The real Study Buddy logo appears at the top of the title page and in every
  interior-page header.
- The interior-page logo is vertically centered with the document and course
  labels.

The files in this documentation directory are examples and audit fixtures. If
an example conflicts with the production component library, the production
component library is authoritative.
