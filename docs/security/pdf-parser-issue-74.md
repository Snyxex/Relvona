# PDF parser security and ingestion limits

Issue: [#74](https://github.com/Snyxex/Relvona/issues/74)

The previous pdf-parse 1.1.4 package bundled obsolete PDF.js versions,
including releases within the advisory range of CVE-2024-4367. It was
actively used for tenant-uploaded knowledge PDFs, so simply removing it
would break ingestion.

The backend now pins pdf-parse 2.4.5, which depends on pdfjs-dist 5.4.296.
The obsolete @types/pdf-parse declarations and the old bundled v1 package
are removed from the lockfile. Both package manifests and lockfile must be
reviewed together; npm ci is the authoritative reproducibility gate.

The actual extraction runs in a new Node worker thread:
- No network URL, file path or database connection is passed to the parser.
- PDF.js is configured with isEvalSupported: false and stopAtErrors: true.
- Ingestion stops streaming at 10 MiB, before assembling an oversized Buffer.
- The parser rejects zero-page or over-100-page PDFs, as well as extracted
  text exceeding 500,000 UTF-16 code units.
- A 20-second deadline terminates the worker on timeout.
- Worker V8 heaps have limits (192 MiB old / 32 MiB young). Native allocations
  and workers spawned by dependencies are NOT covered by this guarantee; the
  host or Podman deployment still needs cgroup memory/CPU limits.
- Finally, the PDFParse instance is destroyed even after extraction fails.

The parser keeps the existing title, extracted text, page-count metadata,
embedding, RAG poisoning checks and tenant-bound object lookup behavior.

The PDF regression test creates a real, correctly cross-referenced PDF and
covers text extraction, invalid headers, truncated PDFs, oversized input,
over-100-page files and a forced timeout. The test belongs to the Jenkins AI
group and runs against compiled Node.js output.

Deployment requirements: container images must include the binary package
for the target architecture / libc (via npm ci optional dependencies). This
worker is a resource boundary within one Node process, NOT an operating-system
sandbox. Strong isolation against malicious native code requires a separate,
unprivileged PDF parser process/container, with restricted syscall, network,
and filesystem privileges.
