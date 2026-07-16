# DOCX Preview Worker

This worker converts uploaded DOCX files into PDF preview files for exact policy formatting review.

It is intentionally separate from the browser app because accurate Word-to-PDF rendering requires a server runtime with LibreOffice or an equivalent document renderer.

## Runtime requirements

- Node.js 20+
- LibreOffice installed and available as `soffice`
- Supabase service-role key in server-only environment variables

Never expose `SUPABASE_SERVICE_ROLE_KEY` to Vite or browser code.

## Environment

```text
SUPABASE_URL=https://sbhpbfoadltmjsziayum.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
LIBREOFFICE_BINARY=soffice
WORKER_POLL_INTERVAL_MS=15000
WORKER_MAX_ATTEMPTS=3
LIBREOFFICE_TIMEOUT_MS=120000
```

## Local run

```bash
npm install
npm run once
```

## Production behavior

1. The app uploads the original DOCX to `policy-originals`.
2. The app creates a `file_processing_jobs` row with `job_type = docx_to_pdf_preview`.
3. The worker claims queued jobs.
4. The worker downloads the DOCX using the service-role key.
5. LibreOffice converts the file to PDF.
6. The worker uploads the PDF to `policy-previews`.
7. The worker inserts/updates a `policy_files` row with `file_kind = preview`.
8. The app displays the PDF preview automatically.

## Recommended hosting

Use a worker-capable host where LibreOffice can be installed, such as Render, Fly.io, a VPS, or Cloud Run with a custom container. Supabase Edge Functions are usually not suitable for this because the conversion requires LibreOffice.
