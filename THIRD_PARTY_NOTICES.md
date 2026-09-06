# Third-party notices

This file records the third-party licensing review for software used by the
iROC API. It is part of the source distribution and must be kept with any
source or runtime distribution of this project.

## `@stackforge-eu/factur-x` 1.2.0

- **License:** European Union Public Licence, version 1.2 (EUPL-1.2)
- **Copyright/licensor notice:** StackForge UG
- **Source repository:** <https://github.com/StackForge-EU/factur-x/tree/v1.2.0>
- **License text:** <https://github.com/StackForge-EU/factur-x/blob/v1.2.0/LICENSE>
- **Package metadata:** `artifacts/api-server/package.json` and `pnpm-lock.yaml`

The dependency is used unchanged by the server-side API to embed validated
Factur-X XML in invoice PDFs. The API build intentionally keeps this package
as an external runtime dependency; it is not copied into the browser
applications and the invoice PDF/XML output is not a copy of the library.

### Distribution decision

**Approved for the current hosted iROC deployment model, subject to the
conditions below.** The API is a private package deployed server-side through
Replit autoscale. Customers receive invoice documents and API results, not a
copy of the Factur-X library or an installable iROC runtime. The project does
not modify or relicense the dependency.

This is a project licensing review, not a substitute for advice from iROC's
legal counsel. The approval is not blanket approval for an on-premise,
self-hosted, SDK, or other software distribution.

### Required controls for any software distribution

If iROC later distributes the API/runtime, a container, an installer, an SDK,
or a self-hosted package that contains this dependency, the release must:

1. Include a copy of the dependency's complete `LICENSE` file and this notice
   with every copy of the Factur-X work.
2. Preserve all copyright, patent, trademark, licence, and warranty-disclaimer
   notices.
3. Provide a machine-readable copy of the exact `@stackforge-eu/factur-x`
   1.2.0 source, or keep the tagged source repository above freely accessible
   for as long as that release is distributed.
4. If the dependency is modified or vendored, mark the modification and date,
   provide the corresponding modified source, and distribute the Factur-X
   work under EUPL-1.2 (or a later EUPL version when permitted). Do not add
   terms that restrict the EUPL rights.
5. Re-run the dependency and notice review whenever the package version,
   build mode, or distribution model changes.

The current checkout has no local modifications to the library. The package's
transitive runtime dependencies are `libxml2-wasm` 0.6.0 and `pdf-lib` 1.17.1;
their package metadata identifies them as MIT-licensed and their notices must
also be preserved if those packages are redistributed.

## EUPL-1.2 reference

The authoritative licence text is the `LICENSE` file distributed with
`@stackforge-eu/factur-x` 1.2.0. The European Commission's EUPL collection,
including compatibility guidance and FAQs, is available at
<https://joinup.ec.europa.eu/collection/eupl>.