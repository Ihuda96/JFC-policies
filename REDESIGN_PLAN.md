# JFC Policies Platform Redesign Plan

## Phase 0 Status

This document is the required discovery output before any redesign implementation. No UI code should be changed until this plan is reviewed and approved.

## Project Inventory

### Stack

- Framework: Vite + React 18 + TypeScript.
- Routing: `react-router-dom` with public routes and protected `/app` routes.
- Styling: one global stylesheet at `src/styles.css`.
- Icons: `lucide-react`.
- Data: browser Supabase client from `src/lib/supabase.ts`.
- Forms and validation: light local state plus `zod` in `src/lib/policyWorkflow.ts`.
- Backend artifacts: Supabase SQL under `supabase/migrations/`, consolidated deploy file `supabase/DEPLOY_TO_SUPABASE.sql`, hotfix `supabase/DEPLOY_ARCHIVE_POLICY_FIX.sql`.
- Environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, optional `VITE_ENABLE_OFFICE_DOCX_PREVIEW`.

### Route Map

- `/`: `LandingPage`
  - Public informational entry screen. Currently more marketing-like than internal tool.
- `/login`: `LoginPage`
  - Supabase auth login/signup.
- `/app`: `DashboardPage`
  - Role-aware operational summary and recent policies.
- `/app/upload`: `UploadPolicyPage`
  - Upload DOCX/PDF and submit draft.
- `/app/workspace`: `WorkspacePage`
  - User-visible policy work queue.
- `/app/approvals`: `ApprovalsPage`
  - Manager review queue, approve/return actions.
- `/app/library`: `LibraryPage`
  - Approved policy library with simple client-side search.
- `/app/notifications`: `NotificationsPage`
  - Notifications list and read actions.
- `/app/policies/:policyId`: `PolicyDetailPage`
  - Main policy preview/review page: version tabs, document preview, action panel, comments, audit timeline, archive action.
- `/app/reports`: `ReportsPage`
  - Basic policy status metrics.
- `/app/admin/users`: `AdminUsersPage`
  - User activation/role management.
- `/app/admin/audit`: `AuditLogPage`
  - Audit log table.
- `/app/settings`: `SettingsPage`
  - Static settings placeholders.

### Component Inventory

- `AppShell`
  - Sidebar, topbar, account chip, mobile drawer.
  - Repeated navigation item pattern should become a configurable navigation component.
- `ProtectedRoute`
  - Auth gate.
- `DocumentPreview`
  - PDF iframe, DOCX Office viewer iframe, signed URL download/print/open.
  - Needs document-reader layout, stable dimensions, print behavior, and clearer failure states.
- `StatusBadge`
  - Status label/tone mapping.
  - Should become canonical `Badge`/`StatusBadge` component using semantic workflow tokens.
- `MetricCard`
  - KPI tile.
  - Should become reusable `StatCard`.
- `LoadingState`
  - Spinner-based loading.
  - Must be replaced by skeletons per redesign requirement.
- `EmptyState`
  - Generic empty state.
- `SetupRequired`
  - Supabase schema/setup error state.

### Data and Workflow Inventory

- Supabase tables currently used directly from UI:
  - `policies`
  - `policy_versions`
  - `policy_files`
  - `policy_metadata`
  - `review_comments`
  - `approval_actions`
  - `notifications`
  - `profiles`
  - `audit_logs`
- RPCs currently called:
  - `submit_policy_version`
  - `return_policy_for_revision`
  - `approve_policy_version`
  - `archive_policy`
  - `track_file_access`
  - `mark_notification_read`
  - `admin_update_profile`
- Storage operations:
  - Upload originals to `policy-originals`.
  - Signed URLs for preview/download/print.
- Current workflow statuses:
  - Policy: `draft`, `pending_approval`, `returned_for_revision`, `resubmitted`, `approved`, `archived`.
  - Version: `draft`, `submitted`, `returned`, `approved`, `superseded`, `archived`.
- Gap against requested domain workflow:
  - Requested labels include `مسودة ← مراجعة ← معتمدة ← ملغاة/مستبدلة`.
  - Current schema has `archived`, not explicit `cancelled` or `replaced`.
  - Diff, signatures, policy dependencies, bilingual paired content, and automatic hierarchical numbering are not implemented yet.

### Assets Inventory

- Fonts:
  - `public/brand/JannaLT-Regular.ttf`
  - `public/brand/Janna-LT-Bold.ttf`
- Logo/image assets:
  - `public/brand/jfc-logo-wide-blue.jpg`
  - `public/brand/jfc-logo-stacked-white.jpg`
  - `public/brand/jfc-logo-stacked-white-alt.jpg`
- Attached design system source files:
  - `jfc-design-tokens.json`
  - `jfc-design-tokens.css`
  - `JFC_Design_System_Spec_v1.0.md`
- Asset gaps:
  - No favicon/Open Graph image/sitemap currently identified.
  - No official simplified icon asset beyond supplied JPG lockups.

### Styling Inventory

- Current style source: `src/styles.css`.
- Current token layer is partial and local:
  - `--blue-950`, `--blue-900`, `--blue-700`, `--blue-500`
  - `--teal-500`, `--green-600`, `--amber-600`, `--red-600`
  - `--ink`, `--muted`, `--line`, `--soft`, `--white`, `--shadow`
- Hard-coded values currently exist throughout:
  - Raw hex values for alerts, backgrounds, status pills, hero surfaces.
  - Raw `px`, `rem`, `rgba`, `clamp`, shadows, radii, breakpoints.
  - Animation keyframes and spinner.
- Current visual patterns:
  - 8px card radius almost everywhere.
  - Blue-heavy sidebar and landing sections.
  - Gradients, blur, animated floating card, decorative hero visual.
  - Card-based operational pages.
  - Tables with horizontal separators.
  - Spinner loading states.
- Fit against desired personality:
  - Internal pages are closer to a work tool, but still too card-heavy.
  - Landing page is too marketing-like for the requested internal product direction.
  - Typography is not yet the main visual structure.
  - Current palette is more saturated and decorative than "quiet authority".

### Repeated Patterns to Consolidate

- Page hero/header blocks across dashboard, upload, workspace, approvals, library, reports.
- Card containers: `policy-card`, `approval-card`, `library-card`, `notification-card`, `info-card`, `upload-card`.
- Buttons: primary, secondary, danger, icon, toolbar actions.
- Status indicators across policy/version/profile.
- Empty/loading/error states.
- Tables and table wrappers.
- Search input shells.
- Timeline items for comments, approvals, audit-like events.
- File action rows.

## Design System Inputs

### Attached Tokens

The supplied files already define:

- Brand scales for sky, blue, navy, gray, indigo, teal, cyan, aqua, green, lime, critical.
- Light and dark semantic tokens.
- Janna LT typography.
- Spacing scale with 4px micro-step and 8px core.
- Radius, shadow, motion, breakpoints, layout values.

### Required Additions Before Implementation

The redesign request is stricter than the supplied tokens. Phase 1 must extend/normalize tokens to include:

- `950` step for every primary scale where missing.
- Separate heading and body font-family tokens.
- Type scale with explicit 1.25 or 1.333 ratio.
- Weight, line-height, and tracking tokens.
- Full semantic status tokens: draft, review, returned, approved, archived/cancelled, replaced.
- Surface tokens: canvas, subtle, elevated, overlay, document, document-muted.
- Elevation levels `0` through `5`.
- Border width/style tokens.
- Z-index scale.
- Motion tokens limited to the product rules: fast/base/slow all <= 200ms for operational UI.
- Print tokens.
- JS export generated/maintained from the same source as CSS variables.

## Implementation Plan

### Phase 1: Token Foundation

Files expected to change:

- Add `src/design/tokens.css`.
- Add `src/design/tokens.ts`.
- Add `src/design/tokenData.ts` or JSON source if needed.
- Update `src/styles.css` to import tokens and remove root hard-coded token definitions.
- Add route and page shell for `/design-system`.

Work:

- Convert supplied token files into the repo as the single source of truth.
- Extend missing `950` values and required semantic aliases.
- Define light/dark themes using `[data-theme]`.
- Add typography, spacing, radius, border, shadow, z-index, breakpoint, motion, and print tokens.
- Add lintable convention: no component CSS should introduce raw color/spacing values after this phase.
- Keep all functionality unchanged.

Validation:

- `npm run lint`
- `npm run build`

### Phase 2: Component System and Cleanup

Files expected to change:

- Add component primitives under `src/components/ui/`.
- Refactor existing components gradually.
- Update `src/styles.css` into organized layers or split into component CSS files if still global.
- Add `/design-system` living styleguide.

Work:

- Create reusable primitives:
  - `Button`
  - `IconButton`
  - `Badge`
  - `StatusBadge`
  - `Card`
  - `PageHeader`
  - `DataTable`
  - `SearchField`
  - `Skeleton`
  - `EmptyState`
  - `Alert`
  - `Timeline`
  - `FileActions`
- Replace spinner loading with skeleton states.
- Remove redundant captions and filler descriptions while preserving labels, alt text, aria text, and form accessibility.
- Convert obvious but repeated visual wrappers to component variants.
- Use logical CSS properties for RTL.

Validation:

- `npm run lint`
- `npm run build`

### Phase 3: Application Page Redesign

Files expected to change:

- All `src/pages/*.tsx`.
- `AppShell`.
- `DocumentPreview`.
- `styles.css` or new style modules/layers.

Work:

- Redesign shell as a calm documentation/workbench interface:
  - Reduced visual weight.
  - Better reading width.
  - Stronger focus on policy title, status, version, dates, and next action.
- Convert landing page away from marketing composition or make authenticated workflow the main product entry.
- Improve dashboard density for repeated work:
  - Task queue first.
  - Status filters.
  - Clear primary action.
- Improve policy detail page:
  - Document-first layout.
  - Sticky but unobtrusive decision panel.
  - Version metadata and signatures area.
  - Comments/timeline with clearer event hierarchy.
- Improve library:
  - Search and filters by status/department.
  - Results optimized for scanning.
- Improve admin/audit pages:
  - Dense tables with sticky headers and accessible row actions.
- Add responsive behavior from 320px to 2560px with container-aware layouts where feasible.

Validation:

- `npm run lint`
- `npm run build`
- Manual smoke test of main flows.

### Phase 3-B: Policy Domain Features

This phase contains functional additions. Some require schema and data-model decisions.

Work items:

- Editor/document structure:
  - Add internal policy section model or client-side document outline where possible.
  - Automatic hierarchical numbering: `1`, `1-1`, `1-1-1`.
  - Generated synced table of contents.
- Versions:
  - Show version number, effective date, next review date.
  - Add text diff between versions.
  - Use AA-compliant diff colors and text labels.
- Approval workflow:
  - Normalize status presentation to draft/review/approved/archived/replaced.
  - Keep existing DB statuses unless a migration is approved.
- Approval signature strip:
  - Prepared by, reviewed by, approved by, timestamp.
  - Data may need new schema fields or derivation from `approval_actions`.
- References:
  - Document reference code.
  - Related procedures/forms.
  - Likely needs new relation table.
- Print/PDF CSS:
  - `@media print` official header/footer.
  - Hide UI controls.
  - Avoid breaks inside headings/tables.
  - Version/page metadata.
- Search:
  - In-document search.
  - Library search with status and department filters.
- Bilingual support:
  - Arabic-first RTL.
  - English parallel view/toggle.
  - Numeral setting.

Risks:

- Automatic numbering and bilingual paired content cannot be exact for arbitrary uploaded DOCX without parsing/editing the document body.
- If the product remains upload-and-preview based, editor features need a new structured content layer.
- Diff requires either extracted text, stored text snapshots, or a parser pipeline.

Validation:

- `npm run lint`
- `npm run build`
- Manual workflow test with at least one DOCX and one PDF.

### Phase 4: Quality and Production Hardening

Work:

- Accessibility:
  - WCAG 2.2 AA keyboard paths.
  - Visible focus rings.
  - Landmarks and headings audit.
  - Reduced motion compliance.
- Performance:
  - Reserve image dimensions.
  - Preload fonts.
  - Lazy-load noncritical images.
  - Remove decorative animation from operational screens.
  - Ensure CLS is near zero.
- SEO/static metadata:
  - Add title/description.
  - Open Graph tags.
  - Structured data if appropriate.
  - Sitemap if production host requires it.
- Print:
  - Formal printed policy layout.
- Cross-viewport verification:
  - 320px, 768px, 1280px, 1920px, 2560px.

Validation:

- `npm run lint`
- `npm run build`
- Browser inspection and screenshots.
- Lighthouse target: >= 95 in all categories.

## Key Risks and Decisions Needed

1. Scope risk: The request combines visual redesign and new product capabilities. The visual redesign can preserve current functions; the policy editor/diff/bilingual structured content may require schema and UX decisions.
2. Document editing risk: Current app uploads DOCX/PDF files and previews them. It does not contain a true structured editor. Automatic numbering, TOC synchronization, and bilingual paired editing need a structured document model.
3. DOCX fidelity risk: The current Word preview depends on Office viewer via signed URL. It is practical for preview but not a local editable document model.
4. Database risk: New domain features may require migrations for signatures, related documents, effective dates, replacement/cancellation, section content, and diff snapshots.
5. Token governance risk: Current CSS has many hard-coded values. A true "no hard-coded values" rule means a broad CSS rewrite, not a light reskin.
6. Motion risk: Current landing animation and spinner conflict with the requested restrained motion and skeleton loading.
7. Dark mode risk: Supplied tokens include dark mode, but current UI has no theme state or persistence.
8. Accessibility risk: Current tables, sidebars, tabs, and file upload controls need a focused keyboard and screen reader pass.
9. Print/PDF risk: Browser print can produce a formal layout for the app view, but exact Word/PDF official output remains tied to the uploaded file unless a structured renderer is built.
10. No-new-library constraint: Text diff, document parsing, and editor behavior can be built minimally without libraries, but a robust editor/diff may justify one dependency later. Any such dependency should be proposed before installation.

## Proposed Stopping Point

Stop after this Phase 0 document. After approval, start Phase 1 only: token foundation and `/design-system` styleguide shell, without changing application behavior.
