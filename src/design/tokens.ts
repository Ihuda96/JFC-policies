export const colorScaleSteps = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
] as const;

export const colorScaleNames = [
  "sky",
  "blue",
  "navy",
  "gray",
  "indigo",
  "teal",
  "cyan",
  "aqua",
  "green",
  "lime",
  "critical",
] as const;

export type TokenName = (typeof colorScaleNames)[number];
export type TokenStep = (typeof colorScaleSteps)[number];

export type CssToken = {
  name: string;
  cssVar: string;
  value: string;
};

function cssToken(name: string, cssVar: string): CssToken {
  return {
    name,
    cssVar,
    value: `var(${cssVar})`,
  };
}

export const colorScales = Object.fromEntries(
  colorScaleNames.map((scale) => [
    scale,
    colorScaleSteps.map((step) =>
      cssToken(`${scale}.${step}`, `--jfc-color-${scale}-${step}`),
    ),
  ]),
) as Record<TokenName, CssToken[]>;

export const semanticColorTokens = [
  cssToken("surface.canvas", "--jfc-surface-canvas"),
  cssToken("surface.subtle", "--jfc-surface-subtle"),
  cssToken("surface.elevated", "--jfc-surface-elevated"),
  cssToken("surface.sunken", "--jfc-surface-sunken"),
  cssToken("surface.overlay", "--jfc-surface-overlay"),
  cssToken("surface.document", "--jfc-surface-document"),
  cssToken("surface.document-muted", "--jfc-surface-document-muted"),
  cssToken("surface.inverse", "--jfc-surface-inverse"),
  cssToken("text.primary", "--jfc-text-primary"),
  cssToken("text.secondary", "--jfc-text-secondary"),
  cssToken("text.muted", "--jfc-text-muted"),
  cssToken("text.inverse", "--jfc-text-inverse"),
  cssToken("text.link", "--jfc-text-link"),
  cssToken("border.default", "--jfc-border-default"),
  cssToken("border.subtle", "--jfc-border-subtle"),
  cssToken("border.strong", "--jfc-border-strong"),
  cssToken("border.focus", "--jfc-border-focus"),
  cssToken("action.primary", "--jfc-action-primary"),
  cssToken("action.primary-hover", "--jfc-action-primary-hover"),
  cssToken("action.primary-active", "--jfc-action-primary-active"),
  cssToken("action.primary-on", "--jfc-action-primary-on"),
  cssToken("action.secondary", "--jfc-action-secondary"),
  cssToken("action.danger", "--jfc-action-danger"),
] as const;

export const feedbackTokens = [
  cssToken("success", "--jfc-feedback-success-bg"),
  cssToken("warning", "--jfc-feedback-warning-bg"),
  cssToken("danger", "--jfc-feedback-danger-bg"),
  cssToken("info", "--jfc-feedback-info-bg"),
] as const;

export const workflowStatusTokens = [
  cssToken("draft", "--jfc-status-draft-bg"),
  cssToken("review", "--jfc-status-review-bg"),
  cssToken("returned", "--jfc-status-returned-bg"),
  cssToken("approved", "--jfc-status-approved-bg"),
  cssToken("archived", "--jfc-status-archived-bg"),
  cssToken("cancelled", "--jfc-status-cancelled-bg"),
  cssToken("replaced", "--jfc-status-replaced-bg"),
  cssToken("info", "--jfc-status-info-bg"),
] as const;

export const typographyTokens = [
  cssToken("font.heading", "--jfc-font-family-heading"),
  cssToken("font.body", "--jfc-font-family-body"),
  cssToken("weight.regular", "--jfc-font-weight-regular"),
  cssToken("weight.bold", "--jfc-font-weight-bold"),
  cssToken("size.0", "--jfc-font-size-0"),
  cssToken("size.1", "--jfc-font-size-1"),
  cssToken("size.2", "--jfc-font-size-2"),
  cssToken("size.3", "--jfc-font-size-3"),
  cssToken("size.4", "--jfc-font-size-4"),
  cssToken("size.5", "--jfc-font-size-5"),
  cssToken("size.6", "--jfc-font-size-6"),
  cssToken("size.7", "--jfc-font-size-7"),
  cssToken("size.8", "--jfc-font-size-8"),
  cssToken("line.tight", "--jfc-line-height-tight"),
  cssToken("line.heading", "--jfc-line-height-heading"),
  cssToken("line.body", "--jfc-line-height-body"),
  cssToken("line.compact", "--jfc-line-height-compact"),
  cssToken("tracking.normal", "--jfc-letter-spacing-normal"),
] as const;

export const spacingTokens = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "10",
  "12",
  "14",
  "16",
  "20",
  "24",
  "32",
].map((step) => cssToken(`space.${step}`, `--jfc-space-${step}`));

export const radiusTokens = [
  cssToken("radius.0", "--jfc-radius-0"),
  cssToken("radius.xs", "--jfc-radius-xs"),
  cssToken("radius.sm", "--jfc-radius-sm"),
  cssToken("radius.md", "--jfc-radius-md"),
  cssToken("radius.lg", "--jfc-radius-lg"),
  cssToken("radius.xl", "--jfc-radius-xl"),
  cssToken("radius.full", "--jfc-radius-full"),
] as const;

export const shadowTokens = [
  cssToken("shadow.0", "--jfc-shadow-0"),
  cssToken("shadow.1", "--jfc-shadow-1"),
  cssToken("shadow.2", "--jfc-shadow-2"),
  cssToken("shadow.3", "--jfc-shadow-3"),
  cssToken("shadow.4", "--jfc-shadow-4"),
  cssToken("shadow.5", "--jfc-shadow-5"),
] as const;

export const motionTokens = [
  cssToken("duration.fast", "--jfc-duration-fast"),
  cssToken("duration.base", "--jfc-duration-base"),
  cssToken("duration.slow", "--jfc-duration-slow"),
  cssToken("ease.standard", "--jfc-ease-standard"),
  cssToken("ease.enter", "--jfc-ease-enter"),
  cssToken("ease.exit", "--jfc-ease-exit"),
] as const;

export const layoutTokens = [
  cssToken("breakpoint.sm", "--jfc-breakpoint-sm"),
  cssToken("breakpoint.md", "--jfc-breakpoint-md"),
  cssToken("breakpoint.lg", "--jfc-breakpoint-lg"),
  cssToken("breakpoint.xl", "--jfc-breakpoint-xl"),
  cssToken("container.md", "--jfc-container-md"),
  cssToken("container.lg", "--jfc-container-lg"),
  cssToken("document.width", "--jfc-document-width"),
  cssToken("sidebar.width", "--jfc-sidebar-width"),
  cssToken("header.height", "--jfc-header-height"),
  cssToken("print.page-margin", "--jfc-print-page-margin"),
] as const;
