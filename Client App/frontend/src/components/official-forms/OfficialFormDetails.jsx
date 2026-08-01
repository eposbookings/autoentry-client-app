import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";

const AUTO_KEYS = new Set(["full_name", "utr"]);

function packageCode(formCode) {
  const value = String(formCode || "").toUpperCase();
  return /-\d{4}$/.test(value) ? value : `${value}-2026`;
}

function isArtworkOnlyField(field) {
  const geometry = field?.geometry || {};
  const generatedKey = String(field?.system_key || "").includes("_field_");
  return Number(field?.page) === 1
    && !String(field?.official_box || "").trim()
    && generatedKey
    && Number(geometry.x) < 0.09
    && Number(geometry.y) < 0.04
    && Number(geometry.width) > 0.15
    && Number(geometry.height) > 0.06;
}

function moneyGridValue(value, transform) {
  const wholeDigits = Math.max(1, Number(transform.whole_digits || 8));
  const decimalPlaces = Math.max(0, Number(transform.decimal_places || 0));
  if (value === null || value === undefined || String(value).trim() === "") {
    return " ".repeat(wholeDigits + decimalPlaces);
  }
  const amount = Number(String(value).replace(/[,£]/g, ""));
  if (!Number.isFinite(amount)) return " ".repeat(wholeDigits + decimalPlaces);
  const [whole, fraction = ""] = Math.abs(amount).toFixed(decimalPlaces).split(".");
  return whole.slice(-wholeDigits).padStart(wholeDigits, " ") + fraction.padEnd(decimalPlaces, "0");
}

function characterSource(value, transform) {
  if (transform?.kind === "money_character") return moneyGridValue(value, transform);
  const source = value === null || value === undefined ? "" : String(value);
  return transform?.strip_non_alphanumeric ? source.replace(/[^A-Za-z0-9]/g, "") : source;
}

function moneyValueFromGrid(source, transform) {
  const wholeDigits = Math.max(1, Number(transform.whole_digits || 8));
  const decimalPlaces = Math.max(0, Number(transform.decimal_places || 0));
  const whole = source.slice(0, wholeDigits).replace(/\s/g, "") || "0";
  const fraction = source.slice(wholeDigits, wholeDigits + decimalPlaces).replace(/\s/g, "").padEnd(decimalPlaces, "0");
  if (!source.replace(/\s/g, "")) return "";
  return decimalPlaces ? `${whole}.${fraction}` : whole;
}

function ReplicaPage({
  document,
  pageNumber,
  packageFields,
  fieldByKey,
  values,
  setValues,
  disabled,
  onActiveField,
}) {
  const canvasRef = useRef(null);
  const [model, setModel] = useState(null);
  const [error, setError] = useState("");
  const manifestByName = useMemo(() => Object.fromEntries(
    packageFields.map((field) => [field.pdf_field_name, field])
  ), [packageFields]);

  useEffect(() => {
    let active = true;
    let renderTask;
    (async () => {
      try {
        setError("");
        setModel(null);
        const pdfjs = await import("pdfjs-dist/webpack.mjs");
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.35 });
        const canvas = canvasRef.current;
        if (!canvas || !active) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        renderTask = page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          annotationMode: pdfjs.AnnotationMode.DISABLE,
        });
        await renderTask.promise;
        const annotations = (await page.getAnnotations({ intent: "display" }))
          .filter((annotation) => annotation.subtype === "Widget" && manifestByName[annotation.fieldName])
          .map((annotation) => {
            const rectangle = viewport.convertToViewportRectangle(annotation.rect);
            return {
              ...annotation,
              manifest: manifestByName[annotation.fieldName],
              left: Math.min(rectangle[0], rectangle[2]),
              top: Math.min(rectangle[1], rectangle[3]),
              width: Math.abs(rectangle[2] - rectangle[0]),
              height: Math.abs(rectangle[3] - rectangle[1]),
            };
          });
        if (active) setModel({ width: viewport.width, height: viewport.height, annotations });
      } catch (loadError) {
        if (active && loadError?.name !== "RenderingCancelledException") {
          setError(loadError?.message || "This official page could not be rendered.");
        }
      }
    })();
    return () => {
      active = false;
      renderTask?.cancel?.();
    };
  }, [document, manifestByName, pageNumber]);

  const updateCharacter = (manifest, nextValue) => {
    const transform = manifest.value_transform || {};
    const index = Math.max(0, Number(transform.index || 0));
    const group = packageFields.filter((field) => (
      field.system_key === manifest.system_key
      && field.value_transform?.kind === transform.kind
    ));
    const length = Math.max(index + 1, ...group.map((field) => Number(field.value_transform?.index || 0) + 1));
    const source = characterSource(values[manifest.system_key], transform).padEnd(length, " ").split("");
    source[index] = String(nextValue || "").slice(-1);
    const combined = source.join("");
    const value = transform.kind === "money_character"
      ? moneyValueFromGrid(combined, transform)
      : combined.replace(/\s+$/g, "");
    setValues((current) => ({ ...current, [manifest.system_key]: value }));
  };

  if (error) return <div className="rounded-md border border-red-200 bg-red-50 p-5 text-center text-sm text-red-800">{error}</div>;
  return (
    <div className="overflow-auto rounded-md border border-slate-300 bg-slate-200 p-2">
      <div className="relative mx-auto bg-white shadow-md" style={{ width: model?.width || 804, height: model?.height || 1137 }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {(model?.annotations || []).map((annotation) => {
          const manifest = annotation.manifest;
          const key = manifest.system_key;
          const field = fieldByKey[key] || {};
          const transform = manifest.value_transform || {};
          const locked = disabled || field.automatic || AUTO_KEYS.has(key);
          const style = {
            left: annotation.left,
            top: annotation.top,
            width: annotation.width,
            height: annotation.height,
          };
          const describe = () => onActiveField({
            box: manifest.official_box,
            key,
            label: field.label || manifest.placeholder || `Official field ${key}`,
            automatic: locked,
          });
          if (manifest.type === "boolean" || (annotation.fieldType === "Btn" && annotation.checkBox)) {
            return (
              <button
                key={annotation.id}
                type="button"
                aria-label={field.label || `Box ${manifest.official_box}`}
                aria-disabled={locked}
                onFocus={describe}
                onMouseEnter={describe}
                onClick={() => {
                  if (!locked) setValues((current) => ({ ...current, [key]: !current[key] }));
                }}
                className={`absolute z-10 flex items-center justify-center border text-sm font-bold outline-none ${locked ? "cursor-not-allowed border-slate-400 bg-slate-200/80 text-slate-700" : "border-emerald-500 bg-white/80 text-black focus:ring-2 focus:ring-emerald-500"}`}
                style={style}
              >{values[key] ? "X" : ""}</button>
            );
          }
          if (transform.kind === "character" || transform.kind === "money_character") {
            const source = characterSource(values[key], transform);
            const character = source[Number(transform.index || 0)] || "";
            return (
              <input
                key={annotation.id}
                aria-label={field.label || `Box ${manifest.official_box}`}
                value={character.trim()}
                readOnly={locked}
                maxLength={1}
                inputMode={transform.kind === "money_character" ? "numeric" : undefined}
                onFocus={describe}
                onMouseEnter={describe}
                onChange={(event) => updateCharacter(manifest, event.target.value)}
                className={`absolute z-10 border bg-white px-0 text-center font-mono text-[11px] text-black outline-none ${locked ? "cursor-not-allowed border-slate-300 bg-slate-200 text-slate-700" : "cursor-text border-emerald-500 focus:ring-2 focus:ring-emerald-500"}`}
                style={style}
              />
            );
          }
          const largeText = field.type === "textarea" || annotation.height > 70;
          const shared = {
            key: annotation.id,
            "aria-label": field.label || `Box ${manifest.official_box}`,
            value: values[key] ?? "",
            readOnly: locked,
            maxLength: manifest.max_length || field.max_length || undefined,
            onFocus: describe,
            onMouseEnter: describe,
            onChange: (event) => setValues((current) => ({ ...current, [key]: event.target.value })),
            className: `absolute z-10 resize-none border bg-white/85 px-1 font-mono text-[11px] leading-4 text-black outline-none ${locked ? "cursor-not-allowed border-slate-300 bg-slate-200/75 text-slate-700" : "border-emerald-500 focus:ring-2 focus:ring-emerald-500"}`,
            style,
          };
          return largeText ? <textarea {...shared} /> : <input {...shared} />;
        })}
        {!model ? <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-slate-600">Rendering official page {pageNumber}...</div> : null}
      </div>
    </div>
  );
}

function FallbackDetails({ headerItems, fields, renderField, emptyMessage }) {
  return (
    <>
      {headerItems.length ? (
        <div className="m-4 grid gap-3 rounded-md border border-[#96d8d6] bg-[#edf8f7] p-3 md:grid-cols-2">
          {headerItems.map((item) => <div key={item.label}><div className="text-xs font-bold text-stone-700">{item.label}</div><div className="mt-1 rounded-sm border border-[#78cbc8] bg-stone-100 px-3 py-2 text-sm text-stone-600">{item.value}</div></div>)}
        </div>
      ) : null}
      {fields.length ? (
        <div className="grid overflow-hidden border-t border-[#83cfcc] md:grid-cols-2">
          {fields.map((field) => <div key={field.key} className="grid grid-cols-[46px_minmax(0,1fr)] gap-3 border-b border-r border-[#a7ddda] bg-[#edf8f7] p-3"><span className="h-fit bg-[#009b96] px-1 py-1 text-center text-xs font-bold text-white">{field.box || "-"}</span>{renderField(field)}</div>)}
        </div>
      ) : <p className="px-4 py-6 text-center text-sm text-amber-800">{emptyMessage}</p>}
    </>
  );
}

export default function OfficialFormDetails({
  title,
  formCode,
  endpoint,
  headerItems = [],
  fields = [],
  values = {},
  setValues,
  disabled = false,
  renderField,
  emptyMessage = "No editable fields are registered for this form.",
}) {
  const [document, setDocument] = useState(null);
  const [packageFields, setPackageFields] = useState([]);
  const [pageNumbers, setPageNumbers] = useState([]);
  const [activePage, setActivePage] = useState(1);
  const [activeField, setActiveField] = useState(null);
  const [error, setError] = useState("");
  const fieldByKey = useMemo(() => Object.fromEntries(fields.map((field) => [field.key, field])), [fields]);

  useEffect(() => {
    let active = true;
    let loadingTask;
    let loadedDocument;
    setDocument(null);
    setPackageFields([]);
    setPageNumbers([]);
    setActivePage(1);
    setError("");
    if (!formCode || !endpoint || !setValues) return undefined;
    (async () => {
      try {
        const [pdfResponse, packageResponse, pdfjs] = await Promise.all([
          api.get(endpoint, { responseType: "blob" }),
          api.get(`/admin/document-forms/packages/${packageCode(formCode)}`),
          import("pdfjs-dist/webpack.mjs"),
        ]);
        if (!(pdfResponse.data instanceof Blob) || !pdfResponse.data.size) throw new Error("The official PDF response was empty.");
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(await pdfResponse.data.arrayBuffer()) });
        loadedDocument = await loadingTask.promise;
        if (!active) return;
        const loadedFields = (packageResponse.data?.fields || []).filter((field) => !isArtworkOnlyField(field));
        const isMainReturn = packageCode(formCode).startsWith("SA100-");
        const editablePages = [...new Set(loadedFields
          .map((field) => Number(field.page))
          .filter((page) => Number.isInteger(page) && page >= 1 && page <= loadedDocument.numPages)
          .filter((page) => !isMainReturn || page >= 3))]
          .sort((left, right) => left - right);
        const visiblePages = editablePages.length
          ? editablePages
          : Array.from({ length: loadedDocument.numPages || 0 }, (_, index) => index + 1);
        setPackageFields(loadedFields);
        setPageNumbers(visiblePages);
        setActivePage(visiblePages[0] || 1);
        setDocument(loadedDocument);
      } catch (loadError) {
        if (active) {
          const responseDetail = loadError?.response?.data?.detail;
          setError(
            (typeof responseDetail === "string" && responseDetail)
            || formatApiError(loadError)
            || loadError?.message
            || "The official form editor could not be loaded."
          );
        }
      }
    })();
    return () => {
      active = false;
      loadingTask?.destroy?.();
      loadedDocument?.destroy?.();
    };
  }, [endpoint, formCode, setValues]);

  const hasReplica = !!(formCode && endpoint && setValues);
  return (
    <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <header className="border-b-4 border-emerald-700 bg-emerald-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="text-[11px] font-bold uppercase tracking-widest text-emerald-800">HMRC official layout</div><h3 className="font-semibold text-stone-900">{title}</h3></div>
          {hasReplica ? <span className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-900">Replica editor</span> : null}
        </div>
        {hasReplica ? <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-600"><span><i className="mr-1 inline-block h-2.5 w-2.5 border border-emerald-500 bg-white align-middle" />Manual entry</span><span><i className="mr-1 inline-block h-2.5 w-2.5 border border-slate-400 bg-slate-200 align-middle" />Automatic / locked</span><span>Fields remain positioned in their official boxes.</span></div> : null}
      </header>
      {hasReplica ? (
        <div className="bg-slate-100 p-3">
          {pageNumbers.length > 1 ? <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-2"><span className="mr-1 text-xs font-bold text-slate-700">Official page</span>{pageNumbers.map((page) => <button key={page} type="button" onClick={() => setActivePage(page)} className={`h-8 min-w-8 rounded border px-2 text-xs font-semibold ${activePage === page ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500"}`}>{page}</button>)}</div> : null}
          {activeField ? <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950"><strong>{activeField.box ? `Box ${activeField.box}` : activeField.key}</strong> - {activeField.label}{activeField.automatic ? " (automatically populated and locked)" : ""}</div> : null}
          {document ? <ReplicaPage document={document} pageNumber={activePage} packageFields={packageFields} fieldByKey={fieldByKey} values={values} setValues={setValues} disabled={disabled} onActiveField={setActiveField} /> : <div className={`rounded-md border p-6 text-center text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-600"}`}>{error || `Preparing the ${formCode} official-layout editor...`}</div>}
        </div>
      ) : <FallbackDetails headerItems={headerItems} fields={fields} renderField={renderField} emptyMessage={emptyMessage} />}
    </section>
  );
}
