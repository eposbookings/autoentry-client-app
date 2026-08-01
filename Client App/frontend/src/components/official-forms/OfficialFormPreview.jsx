import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";

/**
 * Shared read-only official-form preview used by every module.
 *
 * Modules supply form tabs, one active package endpoint and an optional
 * artwork fallback. This component consistently owns blob URL lifecycle,
 * loading/error states and refreshes after the source-data revision changes.
 */
export default function OfficialFormPreview({
  forms = [],
  activeCode,
  onActiveCodeChange,
  endpoint,
  revision = "",
  banner = "Read-only official form preview. Amend values in Details & sections.",
  renderFallback,
  showBanner = true,
  showNavigation = true,
}) {
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfError, setPdfError] = useState("");
  const activeForm = forms.find((form) => form.code === activeCode);
  const nativeAvailable = !!activeForm?.available;

  useEffect(() => {
    if (!forms.length) return;
    if (!forms.some((form) => form.code === activeCode)) {
      onActiveCodeChange(forms[0].code);
    }
  }, [activeCode, forms, onActiveCodeChange]);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setPdfUrl("");
    setPdfError("");
    if (!nativeAvailable || !endpoint) return undefined;
    api.get(endpoint, { responseType: "blob" })
      .then((response) => {
        if (!active) return;
        if (!(response.data instanceof Blob) || !response.data.size) {
          throw new Error("The populated PDF response was empty.");
        }
        objectUrl = URL.createObjectURL(response.data);
        setPdfUrl(objectUrl);
      })
      .catch((error) => {
        if (active) {
          setPdfError(formatApiError(error) || "The populated official PDF could not be loaded.");
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint, nativeAvailable, revision]);

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      {showBanner ? <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{banner}</div> : null}
      {showNavigation ? <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-stone-900">Forms included in this workflow</span>
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900">{forms.length} forms</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {forms.map((form) => (
            <button
              key={form.code}
              type="button"
              onClick={() => onActiveCodeChange(form.code)}
              className={`rounded-md border px-3 py-2 text-left text-xs ${
                activeCode === form.code
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-stone-200 bg-stone-50 text-stone-800"
              }`}
            >
              <span className="block font-bold">{form.code}</span>
              <span className="block opacity-80">{form.label}</span>
              <span className="mt-1 block opacity-80">{form.status || "Needs PDF Editor preparation"}</span>
            </button>
          ))}
        </div>
      </div> : null}
      {nativeAvailable ? (
        pdfUrl ? (
          <iframe
            title={`${activeCode} populated official PDF`}
            src={`${pdfUrl}#toolbar=1&navpanes=0&view=FitH`}
            className="h-[78vh] min-h-[720px] w-full border-0 bg-white shadow-sm"
          />
        ) : (
          <div className={`rounded-md border p-5 text-center text-sm ${
            pdfError
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-stone-200 bg-white text-stone-600"
          }`}>
            {pdfError || `Preparing populated ${activeCode} PDF...`}
          </div>
        )
      ) : renderFallback?.(activeCode)}
    </div>
  );
}
