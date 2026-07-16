import { CheckCircle2, FileText, ShieldCheck } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { MetricCard } from "../components/MetricCard";
import { StatusBadge } from "../components/StatusBadge";
import {
  colorScales,
  feedbackTokens,
  layoutTokens,
  motionTokens,
  radiusTokens,
  semanticColorTokens,
  shadowTokens,
  spacingTokens,
  typographyTokens,
  workflowStatusTokens,
} from "../design/tokens";

const statusSamples = [
  "draft",
  "pending_approval",
  "returned_for_revision",
  "resubmitted",
  "approved",
  "archived",
] as const;

function TokenSwatch({ name, cssVar, value }: { name: string; cssVar: string; value: string }) {
  return (
    <article className="token-swatch" aria-label={`${name} ${cssVar}`}>
      <span className="token-color" style={{ background: value }} />
      <strong>{name}</strong>
      <code>{cssVar}</code>
    </article>
  );
}

export function DesignSystemPage() {
  return (
    <main className="design-system-page" dir="rtl">
      <header className="design-hero">
        <div>
          <p className="eyebrow">JFC Design System</p>
          <h1>نظام تصميم منصة السياسات</h1>
          <p>
            مرجع حي لرموز الهوية والمكوّنات الأساسية. يعتمد على CSS variables كمصدر
            حقيقة واحد، مع تصدير TypeScript للواجهات.
          </p>
        </div>
        <img src="/brand/jfc-logo-wide-blue.jpg" alt="Jeddah First Health Cluster" />
      </header>

      <section className="design-section" aria-labelledby="color-scales">
        <div className="design-section-heading">
          <p className="eyebrow">Colors</p>
          <h2 id="color-scales">سلالم الألوان</h2>
        </div>
        <div className="color-scale-list">
          {Object.entries(colorScales).map(([scaleName, tokens]) => (
            <article className="color-scale" key={scaleName}>
              <h3>{scaleName}</h3>
              <div className="scale-strip">
                {tokens.map((token) => (
                  <TokenSwatch key={token.cssVar} {...token} />
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="design-section" aria-labelledby="semantic-colors">
        <div className="design-section-heading">
          <p className="eyebrow">Semantics</p>
          <h2 id="semantic-colors">الألوان الدلالية</h2>
        </div>
        <div className="token-grid">
          {semanticColorTokens.map((token) => (
            <TokenSwatch key={token.cssVar} {...token} />
          ))}
        </div>
      </section>

      <section className="design-section" aria-labelledby="workflow-status">
        <div className="design-section-heading">
          <p className="eyebrow">Workflow</p>
          <h2 id="workflow-status">حالات سير الاعتماد</h2>
        </div>
        <div className="workflow-token-grid" aria-label="Feedback colors">
          {feedbackTokens.map((token) => (
            <TokenSwatch key={token.cssVar} {...token} />
          ))}
        </div>
        <div className="workflow-token-grid">
          {workflowStatusTokens.map((token) => (
            <TokenSwatch key={token.cssVar} {...token} />
          ))}
        </div>
        <div className="component-band">
          {statusSamples.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </section>

      <section className="design-section" aria-labelledby="typography">
        <div className="design-section-heading">
          <p className="eyebrow">Typography</p>
          <h2 id="typography">الطباعة</h2>
        </div>
        <div className="type-specimen">
          <div>
            <span>Heading</span>
            <h3>سياسات وإجراءات مؤسسية قابلة للتدقيق</h3>
          </div>
          <p>
            النصوص الطويلة تحتاج إلى ارتفاع سطر واسع، عرض قراءة ثابت، وتباين واضح
            بين عنوان الوثيقة والمتن والمعلومات الوصفية.
          </p>
        </div>
        <div className="token-table" role="table" aria-label="Typography tokens">
          {typographyTokens.map((token) => (
            <div className="token-row" role="row" key={token.cssVar}>
              <strong role="cell">{token.name}</strong>
              <code role="cell">{token.cssVar}</code>
              <span role="cell">{token.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="design-section" aria-labelledby="spacing-radius">
        <div className="design-section-heading">
          <p className="eyebrow">Foundations</p>
          <h2 id="spacing-radius">المسافات والزوايا والارتفاع</h2>
        </div>
        <div className="foundation-grid">
          <article>
            <h3>Spacing</h3>
            <div className="space-list">
              {spacingTokens.map((token) => (
                <div className="space-row" key={token.cssVar}>
                  <code>{token.cssVar}</code>
                  <span style={{ inlineSize: token.value }} />
                </div>
              ))}
            </div>
          </article>
          <article>
            <h3>Radius</h3>
            <div className="radius-list">
              {radiusTokens.map((token) => (
                <div key={token.cssVar}>
                  <span style={{ borderRadius: token.value }} />
                  <code>{token.cssVar}</code>
                </div>
              ))}
            </div>
          </article>
          <article>
            <h3>Elevation</h3>
            <div className="shadow-list">
              {shadowTokens.map((token) => (
                <div key={token.cssVar} style={{ boxShadow: token.value }}>
                  <code>{token.cssVar}</code>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="design-section" aria-labelledby="motion-layout">
        <div className="design-section-heading">
          <p className="eyebrow">Motion and Layout</p>
          <h2 id="motion-layout">الحركة والتخطيط</h2>
        </div>
        <div className="token-table" role="table" aria-label="Motion and layout tokens">
          {[...motionTokens, ...layoutTokens].map((token) => (
            <div className="token-row" role="row" key={token.cssVar}>
              <strong role="cell">{token.name}</strong>
              <code role="cell">{token.cssVar}</code>
              <span role="cell">{token.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="design-section" aria-labelledby="component-samples">
        <div className="design-section-heading">
          <p className="eyebrow">Components</p>
          <h2 id="component-samples">عينات المكوّنات</h2>
        </div>
        <div className="component-grid">
          <MetricCard
            title="قيد المراجعة"
            value="12"
            hint="تحتاج قرارًا"
            icon={ShieldCheck}
          />
          <MetricCard title="ملفات مكتملة" value="48" hint="معتمدة" icon={CheckCircle2} />
          <article className="component-sample">
            <div className="component-actions">
              <button className="primary-button" type="button">
                <FileText aria-hidden="true" />
                إجراء أساسي
              </button>
              <button className="secondary-button" type="button">
                إجراء ثانوي
              </button>
              <button className="danger-button" type="button">
                إجراء حساس
              </button>
            </div>
          </article>
          <EmptyState
            title="لا توجد عناصر"
            body="تستخدم هذه الحالة عندما تكون القائمة فارغة فعلًا."
          />
        </div>
      </section>
    </main>
  );
}
