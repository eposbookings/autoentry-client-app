import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Upload, Ban, ArrowLeft, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

export default function ClientSubmit() {
  const { itemId } = useParams();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [mode, setMode] = useState(null); // 'photo' | 'no_photo'
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const cameraRef = useRef();
  const fileRef = useRef();

  useEffect(() => {
    api.get(`/client/items/${itemId}`)
      .then((r) => setItem(r.data))
      .catch((e) => {
        const msg = formatApiError(e);
        console.error("Item fetch failed:", msg);
        toast.error(msg);
        nav(-1);
      });
  }, [itemId, nav]);

  function pickFile(f) {
    if (!f) return;
    setFile(f);
    setMode("photo");
    setPreview(URL.createObjectURL(f));
  }

  function clearPhoto() {
    setFile(null);
    setPreview(null);
    setMode(null);
  }

  async function submit() {
    if (!mode) return toast.error("Choose how you want to submit");
    if (mode === "no_photo" && !comment.trim()) {
      return toast.error("Please add a comment to explain why no photo is needed");
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("mode", mode);
      fd.append("comment", comment.trim());
      if (mode === "photo" && file) fd.append("file", file);
      await api.post(`/client/items/${itemId}/submit`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setDone(true);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!item) return <div className="text-stone-500">Loading…</div>;

  if (done) {
    return (
      <div className="text-center py-12 fade-up" data-testid="submit-success">
        <div className="mx-auto h-20 w-20 rounded-full flex items-center justify-center" style={{ background: "var(--success-bg)" }}>
          <CheckCircle2 className="h-10 w-10" style={{ color: "var(--success)" }} />
        </div>
        <h2 className="font-display text-3xl font-bold mt-6 text-stone-900">Thank you</h2>
        <p className="mt-2 text-stone-600 max-w-md mx-auto">Your document has been submitted successfully and emailed to your accountant.</p>
        <div className="mt-8 flex gap-3 justify-center">
          <Button variant="outline" onClick={() => nav(`/portal/list/${item.type}`)} data-testid="back-list-btn">Back to list</Button>
          <Button onClick={() => nav("/portal")} style={{ background: "var(--brand)" }} data-testid="back-home-btn">Dashboard</Button>
        </div>
      </div>
    );
  }

  const noPhotoMandatory = mode === "no_photo";

  return (
    <div className="space-y-6">
      <button onClick={() => nav(-1)} className="text-sm text-stone-500 hover:text-stone-700 inline-flex items-center gap-1" data-testid="back-from-submit">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="bg-white border border-stone-200 rounded-2xl p-6">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">{item.type === "purchase" ? "Purchase invoice" : "Sales invoice"}</div>
        <div className="font-display text-2xl font-bold text-stone-900 mt-1">{item.description}</div>
        <div className="text-sm text-stone-500 mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {item.date && <span>Date · {item.date}</span>}
          {item.amount && <span>Amount · {item.amount}</span>}
        </div>
      </div>

      {/* Three actions */}
      <div className="grid gap-3">
        <ActionRow
          icon={<Camera className="h-5 w-5" />}
          title="Take photo"
          subtitle="Use your phone's camera"
          active={mode === "photo" && file}
          onClick={() => cameraRef.current?.click()}
          testid="action-camera"
        />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} data-testid="camera-input" />

        <ActionRow
          icon={<Upload className="h-5 w-5" />}
          title="Upload photo"
          subtitle="Choose from your device"
          active={mode === "photo" && file}
          onClick={() => fileRef.current?.click()}
          testid="action-upload"
        />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} data-testid="upload-input" />

        <ActionRow
          icon={<Ban className="h-5 w-5" />}
          title="No photo needed"
          subtitle="Tell us why (comment required)"
          active={mode === "no_photo"}
          onClick={() => { clearPhoto(); setMode("no_photo"); }}
          testid="action-no-photo"
        />
      </div>

      {preview && (
        <div className="relative bg-white border border-stone-200 rounded-2xl p-3" data-testid="photo-preview">
          <img src={preview} alt="Preview" className="rounded-lg w-full max-h-80 object-contain bg-stone-50" />
          <button onClick={clearPhoto} className="absolute top-4 right-4 h-8 w-8 rounded-full bg-stone-900/80 text-white flex items-center justify-center" data-testid="clear-photo">
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
          placeholder={noPhotoMandatory ? "e.g. Paid personally, supplier no longer trading, duplicate invoice…" : "Anything we should know? (stamped onto the photo)"}
          rows={4}
          className="mt-2"
          data-testid="comment-input"
        />
      </div>

      <Button
        onClick={submit}
        disabled={busy || !mode || (mode === "no_photo" && !comment.trim()) || (mode === "photo" && !file)}
        className="w-full h-14 text-base font-semibold rounded-xl"
        style={{ background: "var(--brand)" }}
        data-testid="submit-btn"
      >
        {busy ? "Submitting…" : "Submit document"}
      </Button>
    </div>
  );
}

function ActionRow({ icon, title, subtitle, active, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-5 flex items-center gap-4 transition-all ${active ? "border-[var(--brand)] bg-[var(--brand)]/5" : "border-stone-200 bg-white card-hover"}`}
      data-testid={testid}
    >
      <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${active ? "text-white" : "text-stone-700 bg-stone-100"}`}
        style={active ? { background: "var(--brand)" } : undefined}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="font-semibold text-stone-900">{title}</div>
        <div className="text-sm text-stone-500">{subtitle}</div>
      </div>
      {active && <CheckCircle2 className="h-5 w-5" style={{ color: "var(--brand)" }} />}
    </button>
  );
}
