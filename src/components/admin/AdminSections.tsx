import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Download, QrCode, RefreshCw, Save, Search } from "lucide-react";
import { ORG_UNITS } from "../../lib/departments";
import { errorMessage, supabase } from "../../lib/supabase";
import { useToast } from "../Toast";

interface SectionRow {
  code: string;
  kind: "department" | "section";
  parent_code: string | null;
  label: string;
  access_code: string;
  is_active: boolean;
}

function sectionUrl(code: string) {
  return `${window.location.origin}/s/${code}`;
}

export function AdminSections() {
  const toast = useToast();
  const [rows, setRows] = useState<SectionRow[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase.from("section_access").select("*").order("label");
    setRows((data as SectionRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Render a QR image for every listed section.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const row of rows) {
        try {
          next[row.code] = await QRCode.toDataURL(sectionUrl(row.code), {
            width: 320,
            margin: 1,
            color: { dark: "#052233", light: "#ffffff" },
          });
        } catch {
          // A failed image should never break the list.
        }
      }
      if (!cancelled) {
        setPreviews(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  async function seed() {
    if (!supabase) return;
    setSeeding(true);
    try {
      for (const unit of ORG_UNITS) {
        const { error } = await supabase.rpc("admin_upsert_section", {
          p_code: unit.code,
          p_kind: unit.kind,
          p_parent_code: unit.parentCode,
          p_label: unit.label,
        });
        if (error) throw error;
      }
      toast.success("تم تحديث قائمة الإدارات والأقسام.");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSeeding(false);
    }
  }

  async function saveCode(row: SectionRow) {
    if (!supabase) return;
    const value = (codes[row.code] ?? row.access_code).trim();
    if (!/^[0-9]{5}$/.test(value)) {
      toast.error("الرمز يجب أن يكون ٥ أرقام.");
      return;
    }

    setBusy(row.code);
    try {
      const { error } = await supabase.rpc("admin_set_section_code", {
        p_code: row.code,
        p_access_code: value,
      });
      if (error) throw error;
      toast.success("تم حفظ رمز الدخول.");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function downloadQr(row: SectionRow) {
    const source = previews[row.code];
    if (!source) return;
    const link = document.createElement("a");
    link.href = source;
    link.download = `${row.code}-${row.label}.png`;
    link.click();
  }

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter(
      (row) =>
        row.label.toLowerCase().includes(normalized) ||
        row.code.toLowerCase().includes(normalized),
    );
  }, [rows, query]);

  return (
    <section className="data-section">
      <div className="section-title-row">
        <h2>الإدارات والأقسام والباركود</h2>
        <button type="button" className="secondary-button" disabled={seeding} onClick={() => void seed()}>
          <RefreshCw aria-hidden="true" className={seeding ? "spin" : undefined} />
          {seeding ? "جاري التحديث..." : "تحديث القائمة"}
        </button>
      </div>

      {rows.length === 0 && !loading ? (
        <p className="chart-empty">اضغط «تحديث القائمة» لإنشاء باركود لكل إدارة وقسم.</p>
      ) : null}

      {rows.length > 0 ? (
        <label className="search-box">
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث باسم الإدارة أو رمزها"
          />
        </label>
      ) : null}

      <div className="barcode-grid">
        {visible.map((row) => (
          <article className="barcode-card" key={row.code}>
            <div className="barcode-card-head">
              <div>
                <strong>{row.label}</strong>
                <span className="barcode-code" dir="ltr">
                  {row.code}
                </span>
              </div>
              <span className={row.kind === "department" ? "unit-pill" : "unit-pill unit-pill-sub"}>
                {row.kind === "department" ? "إدارة" : "قسم"}
              </span>
            </div>

            <div className="barcode-image">
              {previews[row.code] ? (
                <img src={previews[row.code]} alt={`باركود ${row.label}`} />
              ) : (
                <span className="barcode-placeholder">
                  <QrCode aria-hidden="true" />
                </span>
              )}
            </div>

            <label className="barcode-pin">
              <span>رمز الدخول</span>
              <input
                dir="ltr"
                inputMode="numeric"
                maxLength={5}
                value={codes[row.code] ?? row.access_code}
                onChange={(event) =>
                  setCodes((current) => ({
                    ...current,
                    [row.code]: event.target.value.replace(/\D/g, "").slice(0, 5),
                  }))
                }
              />
            </label>

            <div className="barcode-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy === row.code}
                onClick={() => void saveCode(row)}
              >
                <Save aria-hidden="true" />
                حفظ
              </button>
              <button type="button" className="secondary-button" onClick={() => downloadQr(row)}>
                <Download aria-hidden="true" />
                تنزيل
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
