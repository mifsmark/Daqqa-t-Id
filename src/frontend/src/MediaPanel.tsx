import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export type MediaItem = {
  id: string;
  url: string;
  contentType: string;
  purpose: "avatar" | "portfolio" | "booking";
};

type MediaPanelProps = {
  listUrl: string;
  kind: "worker" | "booking";
  bookingId?: string;
  canUpload: boolean;
  privatePhotos?: boolean;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function MediaPanel({
  listUrl,
  kind,
  bookingId,
  canUpload,
  privatePhotos = false,
}: MediaPanelProps) {
  const queryClient = useQueryClient();
  const [purpose, setPurpose] = useState<"avatar" | "portfolio">("portfolio");
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const {
    data: media = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["media", listUrl],
    queryFn: () => api<MediaItem[]>(listUrl),
  });

  async function upload(file: File) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setNotice("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      setNotice("Choose an image smaller than 5 MB.");
      return;
    }
    const form = new FormData();
    form.append("purpose", kind === "booking" ? "booking" : purpose);
    if (kind === "booking" && bookingId) form.append("bookingId", bookingId);
    form.append("file", file);
    setUploading(true);
    setNotice("");
    try {
      await api("/api/media", { method: "POST", body: form });
      setNotice(
        kind === "booking"
          ? "Photo added to this private booking."
          : "Photo added to your public profile.",
      );
      await queryClient.invalidateQueries({ queryKey: ["media", listUrl] });
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not upload this image.",
      );
    } finally {
      setUploading(false);
    }
  }

  const avatar = media.find((item) => item.purpose === "avatar");
  const gallery = media.filter((item) => item.purpose !== "avatar");
  const heading = kind === "booking" ? "Booking photos" : "Profile photos";

  return (
    <section className="media-panel" aria-label={heading}>
      <div className="media-panel-heading">
        <div>
          <h2>{heading}</h2>
          <p>
            {privatePhotos
              ? "Only you and the other person on this confirmed booking can see these photos."
              : "These images appear on your public helper profile."}
          </p>
        </div>
      </div>
      {isLoading && <p className="muted">Loading photos…</p>}
      {error && (
        <p className="form-error" role="alert">
          Photos could not be loaded. Please try again later.
        </p>
      )}
      {kind === "worker" && avatar && (
        <figure className="media-avatar">
          <img src={avatar.url} alt="Helper profile" loading="lazy" />
          <figcaption>Profile photo</figcaption>
        </figure>
      )}
      {gallery.length > 0 && (
        <div className="media-gallery">
          {gallery.map((item, index) => (
            <figure key={item.id}>
              <img
                src={item.url}
                alt={
                  kind === "booking"
                    ? `Private booking photo ${index + 1}`
                    : `Helper portfolio photo ${index + 1}`
                }
                loading="lazy"
              />
              {kind === "worker" && <figcaption>Work photo</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {media.length === 0 && !isLoading && !error && (
        <p className="empty compact">
          {kind === "booking"
            ? "No photos have been shared for this booking yet."
            : "No profile photos yet."}
        </p>
      )}
      {canUpload && (
        <div className="media-upload">
          {kind === "worker" && (
            <label>
              Photo type
              <select
                value={purpose}
                onChange={(event) =>
                  setPurpose(event.target.value as "avatar" | "portfolio")
                }
              >
                <option value="avatar">Profile photo</option>
                <option value="portfolio">Work photo</option>
              </select>
            </label>
          )}
          <label>
            {kind === "booking" ? "Add a booking photo" : "Add a photo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <small>PNG, JPEG, or WebP · up to 5 MB</small>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {uploading ? "Uploading photo…" : notice}
        </p>
      )}
    </section>
  );
}
