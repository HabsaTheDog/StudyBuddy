# Support

Study Buddy is maintained on a best-effort basis; there is no support SLA.

- Use GitHub Discussions for setup questions and ideas once Discussions are
  enabled.
- Use a GitHub issue for reproducible bugs and bounded feature requests.
- Use GitHub private vulnerability reporting for security issues.

Before requesting help, run:

```bash
npm run moodle:doctor -- --version-only --json
npm run typecheck
npm test
```

Share the smallest useful error excerpt and platform/tool versions. Never attach
an `.env` file, browser storage state, cookies, a private calendar URL,
authenticated screenshots, full diagnostics, student records, or copyrighted
course downloads. Replace portal hosts, account names, course names, IDs, query
parameters, paths, and tokens with synthetic values.

The maintainers cannot provide portal credentials, bypass institutional access
controls, guarantee compatibility with arbitrary Moodle customizations, or give
legal advice about course-content redistribution.
