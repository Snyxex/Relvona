import axios from "axios";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

const AVATAR_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/i;
const MAX_AVATAR_SIZE = 1024 * 1024;

async function uploadAvatarDataUrl(dataUrl: string) {
  if (!AVATAR_DATA_URL.test(dataUrl)) throw new Error("Invalid profile image");
  const blob = await fetch(dataUrl).then((response) => response.blob());
  if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type) || blob.size < 1 || blob.size > MAX_AVATAR_SIZE) {
    throw new Error("Profile image must be PNG, JPEG, or WebP up to 1 MB");
  }

  const intent = await axios.post(
    `${API_BASE_URL}/auth/me/avatar/intent`,
    { mimeType: blob.type, size: blob.size },
    { withCredentials: true },
  );
  const objectId = intent.data?.objectId;
  const uploadUrl = intent.data?.uploadUrl;
  if (typeof objectId !== "string" || typeof uploadUrl !== "string") {
    throw new Error("Avatar upload intent is invalid");
  }

  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": blob.type },
  });
  if (!uploaded.ok) throw new Error(`Avatar storage upload failed (${uploaded.status})`);

  await axios.post(
    `${API_BASE_URL}/auth/me/avatar/${objectId}/finalize`,
    {},
    { withCredentials: true },
  );
}

api.interceptors.request.use(async (config) => {
  let activeOrgId: string | null = null;
  if (typeof window !== "undefined") {
    activeOrgId = localStorage.getItem("active_org_id");
    if (activeOrgId) {
      config.headers["X-Organization-Id"] = activeOrgId;
    }
  }

  // Keep the legacy profile form compatible while moving image bytes out of
  // PostgreSQL. A data URL exists only in browser memory; saving transparently
  // turns it into intent -> direct RustFS PUT -> finalize, then the normal
  // preferences request continues without carrying the image bytes.
  if (
    typeof window !== "undefined" &&
    config.url === "/auth/me/preferences" &&
    config.method?.toLowerCase() === "patch" &&
    config.data &&
    typeof config.data === "object" &&
    !Array.isArray(config.data)
  ) {
    const payload = config.data as Record<string, unknown>;
    if (typeof payload.avatarUrl === "string" && AVATAR_DATA_URL.test(payload.avatarUrl)) {
      await uploadAvatarDataUrl(payload.avatarUrl);
      const { avatarUrl: _avatarUrl, ...withoutAvatarBytes } = payload;
      config.data = withoutAvatarBytes;
    }
  }

  // Keep the existing dashboard API compatible while moving PDF bytes off the
  // Node.js process. The dashboard can continue posting FormData to /knowledge/pdf;
  // this interceptor turns that request into intent -> direct RustFS PUT -> finalize.
  if (
    typeof window !== "undefined" &&
    config.url === "/knowledge/pdf" &&
    config.method?.toLowerCase() === "post" &&
    config.data instanceof FormData
  ) {
    const file = config.data.get("file");
    const knowledgeBaseId = config.data.get("knowledgeBaseId");
    const requestedTitle = config.data.get("title");

    if (!(file instanceof File) || typeof knowledgeBaseId !== "string" || !knowledgeBaseId) {
      throw new Error("Invalid PDF upload request");
    }
    if (file.type && file.type !== "application/pdf") {
      throw new Error("Only PDF files are supported");
    }
    if (file.size < 1 || file.size > 10 * 1024 * 1024) {
      throw new Error("PDF file exceeds the 10 MB upload limit");
    }

    const requestHeaders: Record<string, string> = {};
    if (activeOrgId) requestHeaders["X-Organization-Id"] = activeOrgId;

    const intent = await axios.post(
      `${API_BASE_URL}/knowledge/pdf/intent`,
      {
        knowledgeBaseId,
        title:
          typeof requestedTitle === "string" && requestedTitle.trim()
            ? requestedTitle.trim()
            : file.name,
        originalFilename: file.name,
        mimeType: "application/pdf",
        maxSize: file.size,
      },
      {
        withCredentials: true,
        headers: requestHeaders,
      },
    );

    const objectId = intent.data?.objectId;
    const uploadUrl = intent.data?.uploadUrl;
    if (typeof objectId !== "string" || typeof uploadUrl !== "string") {
      throw new Error("Storage upload intent is invalid");
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": "application/pdf" },
    });
    if (!uploadResponse.ok) {
      throw new Error(`Direct object storage upload failed (${uploadResponse.status})`);
    }

    config.url = `/knowledge/pdf/${objectId}/finalize`;
    config.method = "post";
    config.data = {};
    config.headers.set("Content-Type", "application/json");
  }

  return config;
});

api.interceptors.response.use(undefined, (error) => {
  if (
    typeof window !== "undefined" &&
    error.response?.status === 401
  ) {
    localStorage.removeItem("active_org_id");
    window.location.assign("/");
  }

  return Promise.reject(error);
});
