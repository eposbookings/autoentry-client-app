import React, { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Upload, Ban, ArrowLeft, CheckCircle2, X, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";

export default function ClientSubmitAdditional() {
  const { type } = useParams();
  const nav = useNavigate();
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState(null); // 'photo' | 'no_photo'
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileKind, setFileKind] = useState(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [reviewWarning, setReviewWarning] = useState(null);
  const cameraRef = useRef();
  const fileRef = useRef();

  const typeLabel = type === "purchase" ? "Purchase invoice" : "Sales invoice";

  function pickFile(f) {
    if (!f) return;
    setFile(f);
    setMode("photo");
    setPreview(URL.createObjectURL(f));
    setFileKind(isPdfFile(f) ? "pdf" : "image");
    setReviewWarning(null);
  }

  function clearPhoto() {
    setFile(null);
    setPreview(null);
    setFileKind(null);
    setMode(null);
    setReviewWarning(null);
  }

  async function submit() {
    if (!description.trim()) return toast.error("Please add a description for this invoice");
    if (!mode) return toast.error("Choose how you want to submit");
    if (mode === "no_photo" && !comment.trim()) {
      return toast.error("Please add a comment to explain why no photo is needed");
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("type", type);
      fd.append("description", description.trim());
      fd.append("mode", mode);
      fd.append("comment", comment.trim());
      if (reviewWarning) {
        fd.append("client_approved_ai_warning", "true");
        fd.append("ai_review_token", reviewWarning.token);
      }
      if (mode === "photo" && file) fd.append("file", file);
      const { data } = await api.post(`/client/submit-additional`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data?.ok === false && data?.ai_review?.token) {
        setReviewWarning(data.ai_review);
        toast.warning(data.ai_review.message);
        return;
      }
      setDone(true);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="text-center py-12 fade-up" data-testid="additional-success">
        <div className="mx-auto h-20 w-20 rounded-full flex items-center justify-center" style={{ background: "var(--success-bg)" }}>
          <CheckCircle2 className="h-10 w-10" style={{ color: "var(--success)" }} />
        </div>
        <h2 className="font-display text-3xl font-bold mt-6 text-stone-900">Thank you</h2>
        <p className="mt-2 text-stone-600 max-w-md mx-auto">Your additional invoice has been submitted successfully and emailed to your accountant.</p>
        <div className="mt-8 flex gap-3 justify-center">
          <Button variant="outline" onClick={() => { setDone(false); setDescription(""); clearPhoto(); setComment(""); setReviewWarning(null); }} data-testid="add-another-btn">Add another</Button>
          <Button onClick={() => nav(`/portal/list/${type}`)} style={{ background: "var(--brand)" }} data-testid="back-list-btn">Back to list</Button>
        </div>
      </div>
    );
  }

  const noPhotoMandatory = mode === "no_photo";

  return (
    <div className="space-y-6">
      <button onClick={() => nav(-1)} className="text-sm text-stone-500 hover:text-stone-700 inline-flex items-center gap-1" data-testid="back-from-additional">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="bg-white border border-stone-200 rounded-2xl p-6">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">Additional {typeLabel}</div>
        <div className="font-display text-2xl font-bold text-stone-900 mt-1">Submit a new invoice</div>
        <p className="text-sm text-stone-500 mt-2">This invoice isn't on your outstanding list — add a short description and a photo or comment.</p>
      </div>

      <div>
        <label className="text-sm font-semibold text-stone-700">Description <span className="text-red-600">*required</span></label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Office chairs — Staples #4821"
          className="mt-2 h-12"
          data-testid="additional-description"
        />
      </div>

      {/* Three actions */}
      <div className="grid gap-3">
        <ActionRow
          icon={<Camera className="h-5 w-5" />}
          title="Take photo"
          subtitle="Use your phone's camera"
          active={mode === "photo" && file}
          onClick={() => cameraRef.current?.click()}
          testid="additional-action-camera"
        />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} data-testid="additional-camera-input" />

        <ActionRow
          icon={<Upload className="h-5 w-5" />}
          title="Upload document"
          subtitle="Choose an image or PDF"
          active={mode === "photo" && file}
          onClick={() => fileRef.current?.click()}
          testid="additional-action-upload"
        />
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} data-testid="additional-upload-input" />

        <ActionRow
          icon={<Ban className="h-5 w-5" />}
          title="No photo needed"
          subtitle="Tell us why (comment required)"
          active={mode === "no_photo"}
          onClick={() => { clearPhoto(); setMode("no_photo"); }}
          testid="additional-action-no-photo"
        />
      </div>

      {preview && (
        <div className="relative bg-white border border-stone-200 rounded-2xl p-3" data-testid="additional-photo-preview">
          {fileKind === "pdf" ? (
            <div className="rounded-lg min-h-56 bg-stone-50 flex flex-col items-center justify-center text-center px-6">
              <FileText className="h-12 w-12 text-stone-500" />
              <div className="mt-3 font-semibold text-stone-900 break-all">{file?.name || "PDF document"}</div>
              <div className="mt-1 text-sm text-stone-500">PDF document selected</div>
            </div>
          ) : (
            <img src={preview} alt="Preview" className="rounded-lg w-full max-h-80 object-contain bg-stone-50" />
          )}
          <button onClick={clearPhoto} className="absolute top-4 right-4 h-8 w-8 rounded-full bg-stone-900/80 text-white flex items-center justify-center" data-testid="additional-clear-photo">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div>
        <label className="text-sm font-semibold text-stone-700">
          Comment {noPhotoMandatory ? <span className="text-red-600">*required</span> : <span className="text-stone-400 font-normal">(optional)</span>}
        </label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={noPhotoMandatory ? "e.g. Paid personally, invoice attached separately…" : "Anything we should know? (stamped onto the photo)"}
          rows={4}
          className="mt-2"
          data-testid="additional-comment-input"
        />
      </div>

      {reviewWarning && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3" data-testid="additional-ai-review-warning">
          <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5 flex-none" />
          <div className="text-sm">
            <div className="font-semibold text-amber-900">
              {reviewWarning.status === "rejected" ? "Document check warning" : "Quick check warning"}
            </div>
            <p className="mt-1 text-amber-900">{reviewWarning.message}</p>
            <p className="mt-2 text-amber-800">You can choose a different document, or submit anyway. If you continue, the submission will be stamped as client approved.</p>
          </div>
        </div>
      )}

      <Button
        onClick={submit}
        disabled={busy || !description.trim() || !mode || (mode === "no_photo" && !comment.trim()) || (mode === "photo" && !file)}
        className="w-full h-14 text-base font-semibold rounded-xl"
        style={{ background: "var(--brand)" }}
        data-testid="additional-submit-btn"
      >
        {busy ? "Submitting…" : reviewWarning ? "Submit anyway" : "Submit invoice"}
      </Button>
    </div>
  );
}

function isPdfFile(file) {
  return file?.type === "application/pdf" || file?.name?.toLowerCase().endsWith(".pdf");
}

function ActionRow({ icon, title, subtitle, active, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-4 rounded-xl border p-5 text-left shadow-[0_3px_12px_rgba(28,25,23,0.06)] transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 ${active ? "border-emerald-400 bg-emerald-50/50" : "border-stone-200 bg-white hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_10px_26px_rgba(6,78,59,0.12)]"}`}
      data-testid={testid}
    >
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-1 ${active ? "text-white ring-emerald-600" : "bg-emerald-50 text-emerald-700 ring-emerald-100"}`}
        style={active ? { background: "var(--brand)" } : undefined}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="font-display font-bold text-stone-950">{title}</div>
        <div className="mt-1 text-sm text-stone-500">{subtitle}</div>
        <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{active ? "Selected" : "Choose option"}</div>
      </div>
      {active && <CheckCircle2 className="h-5 w-5" style={{ color: "var(--brand)" }} />}
    </button>
  );
}
