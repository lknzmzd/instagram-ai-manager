"use client";

import { useEffect, useMemo, useState } from "react";

type ContentItem = {
  id: string;
  status: string;
  post_type: string;
  concept_title: string;
  visual_brief: string;
  on_image_text: string;
  caption: string;
  hashtags: string[] | null;
  final_media_url: string | null;
  render_status: string | null;
  publish_status: string | null;
  image_prompt: string | null;
  prompt_status: string | null;
  generated_image_url: string | null;
  public_image_url: string | null;
  published_at?: string | null;
  instagram_media_id?: string | null;
};

type PostLog = {
  id: string;
  content_item_id: string | null;
  media_url: string | null;
  caption: string | null;
  status: "success" | "failed";
  error_message: string | null;
  instagram_post_id: string | null;
  created_at: string;
};

type InstagramTokenHealth = {
  accountId: string;
  accountName: string | null;
  instagramBusinessId: string;
  expiresAt: string | null;
  lastRefreshedAt: string | null;
  isExpired: boolean;
  shouldRefreshSoon: boolean;
  isRefreshEligible: boolean;
};

type QueueItem = {
  id: string;
  concept_title: string;
  caption: string | null;
  status: string | null;
  prompt_status: string | null;
  queue_status: string | null;
  render_status: string | null;
  publish_status: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  public_image_url: string | null;
  instagram_media_id: string | null;
  automation_batch_id: string | null;
  created_at: string;
};

type FilterType = "all" | "drafted" | "approved" | "rejected";

async function safeJson<T = any>(res: Response): Promise<T> {
  const raw = await res.text();

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server returned non-JSON response: ${raw.slice(0, 300)}`);
  }
}

async function fetchItems() {
  const res = await fetch("/api/content/list", {
    cache: "no-store"
  });

  const data = await safeJson<{ items?: ContentItem[]; error?: string }>(res);

  if (!res.ok) {
    throw new Error(data?.error || "Failed to load content items");
  }

  return data;
}

async function fetchLogs() {
  const res = await fetch("/api/post-logs", {
    cache: "no-store"
  });

  const data = await safeJson<{ logs?: PostLog[]; error?: string }>(res);

  if (!res.ok) {
    throw new Error(data?.error || "Failed to load post logs");
  }

  return data;
}

async function fetchTokenHealth() {
  const res = await fetch("/api/instagram/token-status", {
    cache: "no-store"
  });

  const data = await safeJson<{
    health?: InstagramTokenHealth;
    error?: string;
  }>(res);

  if (!res.ok) {
    throw new Error(data?.error || "Failed to load Instagram token status");
  }

  return data;
}

async function fetchQueue() {
  const res = await fetch("/api/automation/queue", {
    cache: "no-store"
  });

  const data = await safeJson<{
    queue?: QueueItem[];
    error?: string;
  }>(res);

  if (!res.ok) {
    throw new Error(data?.error || "Failed to load automation queue");
  }

  return data;
}

export default function HomePage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [logs, setLogs] = useState<PostLog[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [tokenHealth, setTokenHealth] = useState<InstagramTokenHealth | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingTokenHealth, setLoadingTokenHealth] = useState(true);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");

  const [pageSlug, setPageSlug] = useState("mortaena");
  const [count, setCount] = useState(3);
  const [goal, setGoal] = useState("growth");
  const [generating, setGenerating] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  async function load() {
    try {
      setLoading(true);
      const data = await fetchItems();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error("Failed to load items:", error);
      setMessage(
        error instanceof Error ? error.message : "Failed to load content items"
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs() {
    try {
      setLoadingLogs(true);
      const data = await fetchLogs();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (error) {
      console.error("Failed to load logs:", error);
      setMessage(
        error instanceof Error ? error.message : "Failed to load post logs"
      );
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }

  async function loadTokenHealth() {
    try {
      setLoadingTokenHealth(true);
      const data = await fetchTokenHealth();
      setTokenHealth(data.health ?? null);
    } catch (error) {
      console.error("Failed to load token health:", error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to load Instagram token status"
      );
      setTokenHealth(null);
    } finally {
      setLoadingTokenHealth(false);
    }
  }

  async function loadQueue() {
    try {
      setLoadingQueue(true);
      const data = await fetchQueue();
      setQueue(Array.isArray(data.queue) ? data.queue : []);
    } catch (error) {
      console.error("Failed to load automation queue:", error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to load automation queue"
      );
      setQueue([]);
    } finally {
      setLoadingQueue(false);
    }
  }

  useEffect(() => {
    load();
    loadLogs();
    loadTokenHealth();
    loadQueue();
  }, []);

  async function clearLogs() {
    const confirmed = window.confirm(
      "Are you sure you want to delete all publish logs?"
    );

    if (!confirmed) return;

    try {
      setClearingLogs(true);
      setMessage("");

      const res = await fetch("/api/post-logs", {
        method: "DELETE"
      });

      const data = await safeJson<{
        success?: boolean;
        error?: string;
        message?: string;
      }>(res);

      if (!res.ok) {
        throw new Error(data?.error || "Failed to clear post logs");
      }

      setLogs([]);
      setMessage(data?.message || "All post logs deleted");
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to clear post logs");
    } finally {
      setClearingLogs(false);
    }
  }

  async function updateStatus(id: string, status: "approved" | "rejected") {
    try {
      setBusyId(id);
      setMessage("");

      const res = await fetch("/api/content/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status })
      });

      const data = await safeJson(res);

      if (!res.ok) throw new Error(data?.error || "Failed to update status");

      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status } : item))
      );

      setMessage(`Status updated to ${status}`);
      await loadQueue();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to update status");
    } finally {
      setBusyId(null);
    }
  }

  async function updatePromptStatus(
    id: string,
    promptStatus: "approved" | "rejected"
  ) {
    try {
      setBusyId(id);
      setMessage("");

      const res = await fetch("/api/content/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          extra_fields: {
            prompt_status: promptStatus
          }
        })
      });

      const data = await safeJson(res);

      if (!res.ok) throw new Error(data?.error || "Failed to update prompt status");

      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, prompt_status: promptStatus } : item
        )
      );

      setMessage(`Prompt status updated to ${promptStatus}`);
      await loadQueue();
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error ? error.message : "Failed to update prompt status"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function deleteItem(id: string) {
    try {
      setBusyId(id);
      setMessage("");

      const res = await fetch("/api/content/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await safeJson(res);

      if (!res.ok) throw new Error(data?.error || "Failed to delete item");

      setItems((prev) => prev.filter((item) => item.id !== id));
      setMessage("Item deleted");
      await loadQueue();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to delete item");
    } finally {
      setBusyId(null);
    }
  }

  async function generateContent() {
    try {
      setGenerating(true);
      setMessage("");

      const res = await fetch("/api/content/generate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_slug: pageSlug,
          count,
          goal
        })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to generate content");
      }

      await load();
      await loadQueue();
      setFilter("drafted");
      setMessage("Content batch generated");
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to generate content");
    } finally {
      setGenerating(false);
    }
  }

  async function generateImage(id: string) {
    try {
      setBusyId(id);
      setMessage("");

      const res = await fetch("/api/content/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await safeJson<{ item?: ContentItem; error?: string }>(res);

      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate image");
      }

      setItems((prev) => prev.map((item) => (item.id === id ? data.item! : item)));
      setMessage("Image generated");
      await loadQueue();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to generate image");
    } finally {
      setBusyId(null);
    }
  }

  async function uploadToStorage(id: string) {
    try {
      setBusyId(id);
      setMessage("");

      const res = await fetch("/api/content/upload-to-storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await safeJson<{ item?: ContentItem; error?: string }>(res);

      if (!res.ok) {
        throw new Error(data?.error || "Failed to upload image to storage");
      }

      setItems((prev) => prev.map((item) => (item.id === id ? data.item! : item)));
      setMessage("Image uploaded to public storage");
      await loadLogs();
      await loadQueue();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to upload image");
    } finally {
      setBusyId(null);
    }
  }

  async function sendToCanva(id: string) {
    try {
      setBusyId(id);
      setMessage("");

      const res = await fetch("/api/content/send-to-canva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await safeJson<{ item?: ContentItem; error?: string }>(res);

      if (!res.ok) {
        throw new Error(data?.error || "Failed to send to Canva");
      }

      setItems((prev) => prev.map((item) => (item.id === id ? data.item! : item)));
      setMessage("Sent to Canva");
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to send to Canva");
    } finally {
      setBusyId(null);
    }
  }

  async function publishInstagram(id: string) {
    try {
      setBusyId(id);
      setMessage("");

      const res = await fetch("/api/content/publish-instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await safeJson<{
        item?: ContentItem;
        error?: string;
        instagramMediaId?: string | null;
        success?: boolean;
      }>(res);

      if (!res.ok) {
        throw new Error(data?.error || "Failed to publish to Instagram");
      }

      setItems((prev) => prev.map((item) => (item.id === id ? data.item! : item)));
      await loadLogs();
      await loadTokenHealth();
      await loadQueue();

      setMessage(
        data.instagramMediaId
          ? `Published to Instagram successfully (${data.instagramMediaId})`
          : "Published to Instagram successfully"
      );
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to publish to Instagram"
      );
      await loadLogs();
      await loadTokenHealth();
      await loadQueue();
    } finally {
      setBusyId(null);
    }
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => filter === "all" || item.status === filter);
  }, [items, filter]);

  const stats = useMemo(() => {
    const total = items.length;
    const approved = items.filter((item) => item.status === "approved").length;
    const drafted = items.filter((item) => item.status === "drafted").length;
    const rejected = items.filter((item) => item.status === "rejected").length;
    const rendered = items.filter(
      (item) =>
        !!item.generated_image_url ||
        !!item.final_media_url ||
        !!item.public_image_url
    ).length;
    const storageReady = items.filter((item) => !!item.public_image_url).length;
    const published = items.filter((item) => item.publish_status === "published").length;

    return {
      total,
      approved,
      drafted,
      rejected,
      rendered,
      storageReady,
      published
    };
  }, [items]);

  const queueStats = useMemo(() => {
    const total = queue.length;
    const ready = queue.filter((item) => item.queue_status === "ready").length;
    const processing = queue.filter((item) => item.queue_status === "processing").length;
    const posted = queue.filter((item) => item.queue_status === "posted").length;
    const failed = queue.filter((item) => item.queue_status === "failed").length;

    return { total, ready, processing, posted, failed };
  }, [queue]);

  function getStatusColor(status: string) {
    if (status === "approved") return "#22c55e";
    if (status === "rejected") return "#ef4444";
    if (status === "drafted") return "#f59e0b";
    return "#a3a3a3";
  }

  function getQueueColor(status: string | null) {
    if (status === "ready") return "#2563eb";
    if (status === "processing") return "#f59e0b";
    if (status === "posted") return "#16a34a";
    if (status === "failed") return "#dc2626";
    return "#444";
  }

  function getTokenStatusColor() {
    if (!tokenHealth) return "#6b7280";
    if (tokenHealth.isExpired) return "#dc2626";
    if (tokenHealth.shouldRefreshSoon) return "#f59e0b";
    return "#16a34a";
  }

  function getTokenStatusText() {
    if (!tokenHealth) return "Unknown";
    if (tokenHealth.isExpired) return "Expired";
    if (tokenHealth.shouldRefreshSoon) return "Refresh Soon";
    return "Healthy";
  }

  function pill(text: string, color: string) {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "4px 8px",
          borderRadius: "999px",
          background: color,
          color: "white",
          fontSize: "12px",
          fontWeight: 700
        }}
      >
        {text}
      </span>
    );
  }

  function filterButtonStyle(active: boolean): React.CSSProperties {
    return {
      padding: "8px 12px",
      background: active ? "#ffffff" : "#1f1f1f",
      color: active ? "#000000" : "#ffffff",
      border: "1px solid #333",
      borderRadius: "8px",
      cursor: "pointer",
      fontWeight: 600
    };
  }

  function actionButtonStyle(
    background: string,
    disabled = false
  ): React.CSSProperties {
    return {
      padding: "6px 10px",
      background: disabled ? "#555" : background,
      border: "none",
      borderRadius: "6px",
      color: "white",
      cursor: disabled ? "not-allowed" : "pointer",
      fontWeight: 600
    };
  }

  function statCard(label: string, value: number, color: string) {
    return (
      <div
        style={{
          minWidth: "140px",
          padding: "14px",
          borderRadius: "12px",
          background: "#0d0f14",
          border: "1px solid #2a2a2a"
        }}
      >
        <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "8px" }}>
          {label}
        </div>
        <div style={{ fontSize: "28px", fontWeight: 800, color }}>{value}</div>
      </div>
    );
  }

  function getPreviewImage(item: ContentItem) {
    return item.public_image_url || item.final_media_url || item.generated_image_url || null;
  }

  if (loading) {
    return (
      <main
        style={{
          padding: 32,
          minHeight: "100vh",
          background: "#05070d",
          color: "white"
        }}
      >
        Loading...
      </main>
    );
  }

  return (
    <main
      style={{
        padding: "32px",
        fontFamily: "Arial, sans-serif",
        background: "#05070d",
        minHeight: "100vh",
        color: "white"
      }}
    >
      <h1 style={{ marginBottom: "12px", fontSize: "54px" }}>
        Instagram AI Manager
      </h1>

      <div style={{ marginBottom: "24px", fontSize: "15px", opacity: 0.8 }}>
        Content generation, approval, image production, storage upload, Instagram publishing, and automation tracking.
      </div>

      {message && (
        <div
          style={{
            marginBottom: "20px",
            padding: "12px 14px",
            borderRadius: "10px",
            border: "1px solid #234",
            background: "#0b1220",
            color: "#cfe5ff",
            fontSize: "14px"
          }}
        >
          {message}
        </div>
      )}

      <section
        style={{
          marginBottom: "24px",
          padding: "18px",
          background: "#0d0f14",
          border: "1px solid #2a2a2a",
          borderRadius: "12px"
        }}
      >
        <div
          style={{
            marginBottom: "14px",
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            alignItems: "center"
          }}
        >
          <div>
            <div style={{ fontSize: "22px", fontWeight: 800, marginBottom: "4px" }}>
              Instagram Token Status
            </div>
            <div style={{ fontSize: "13px", opacity: 0.75 }}>
              Token health for your active Instagram publishing account.
            </div>
          </div>

          <button
            onClick={loadTokenHealth}
            disabled={loadingTokenHealth}
            style={{
              padding: "10px 14px",
              background: loadingTokenHealth ? "#555" : "#1f2937",
              border: "none",
              borderRadius: "8px",
              color: "white",
              cursor: loadingTokenHealth ? "not-allowed" : "pointer",
              fontWeight: 700
            }}
          >
            {loadingTokenHealth ? "Refreshing..." : "Refresh Token Status"}
          </button>
        </div>

        {loadingTokenHealth ? (
          <div style={{ opacity: 0.75 }}>Loading token status...</div>
        ) : !tokenHealth ? (
          <div style={{ opacity: 0.75 }}>No token status available.</div>
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {pill(getTokenStatusText(), getTokenStatusColor())}
              {tokenHealth.isRefreshEligible
                ? pill("Refresh Eligible", "#2563eb")
                : pill("Not Yet Refreshable", "#444")}
            </div>

            <div style={{ fontSize: "14px", lineHeight: 1.7 }}>
              <div>
                <strong>Account:</strong> {tokenHealth.accountName || "Unnamed account"}
              </div>
              <div>
                <strong>Instagram Business ID:</strong> {tokenHealth.instagramBusinessId}
              </div>
              <div>
                <strong>Expires At:</strong>{" "}
                {tokenHealth.expiresAt
                  ? new Date(tokenHealth.expiresAt).toLocaleString()
                  : "Unknown"}
              </div>
              <div>
                <strong>Last Refreshed:</strong>{" "}
                {tokenHealth.lastRefreshedAt
                  ? new Date(tokenHealth.lastRefreshedAt).toLocaleString()
                  : "Never"}
              </div>
            </div>

            <div
              style={{
                padding: "12px",
                borderRadius: "10px",
                background: tokenHealth.isExpired
                  ? "#2a0d12"
                  : tokenHealth.shouldRefreshSoon
                  ? "#2b1d08"
                  : "#0d1f15",
                border: tokenHealth.isExpired
                  ? "1px solid #5b1d28"
                  : tokenHealth.shouldRefreshSoon
                  ? "1px solid #6b4f1d"
                  : "1px solid #1f5133",
                color: tokenHealth.isExpired
                  ? "#fecaca"
                  : tokenHealth.shouldRefreshSoon
                  ? "#fde68a"
                  : "#bbf7d0",
                fontSize: "14px"
              }}
            >
              {tokenHealth.isExpired
                ? "Token is expired. Publishing may fail until you reconnect and store a new long-lived token."
                : tokenHealth.shouldRefreshSoon
                ? "Token is still working, but it should be refreshed soon."
                : "Token looks healthy and does not need refresh yet."}
            </div>
          </div>
        )}
      </section>

      <div
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "28px"
        }}
      >
        {statCard("Total Items", stats.total, "#ffffff")}
        {statCard("Drafted", stats.drafted, "#f59e0b")}
        {statCard("Approved", stats.approved, "#22c55e")}
        {statCard("Rejected", stats.rejected, "#ef4444")}
        {statCard("Images Ready", stats.rendered, "#3b82f6")}
        {statCard("Storage Ready", stats.storageReady, "#14b8a6")}
        {statCard("Published", stats.published, "#8b5cf6")}
      </div>

      <section
        style={{
          marginBottom: "24px",
          padding: "18px",
          background: "#0d0f14",
          border: "1px solid #2a2a2a",
          borderRadius: "12px"
        }}
      >
        <div
          style={{
            marginBottom: "14px",
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            alignItems: "center"
          }}
        >
          <div>
            <div style={{ fontSize: "22px", fontWeight: 800, marginBottom: "4px" }}>
              Automation Queue
            </div>
            <div style={{ fontSize: "13px", opacity: 0.75 }}>
              Scheduled posts for the automation engine.
            </div>
          </div>

          <button
            onClick={loadQueue}
            disabled={loadingQueue}
            style={{
              padding: "10px 14px",
              background: loadingQueue ? "#555" : "#1f2937",
              border: "none",
              borderRadius: "8px",
              color: "white",
              cursor: loadingQueue ? "not-allowed" : "pointer",
              fontWeight: 700
            }}
          >
            {loadingQueue ? "Refreshing..." : "Refresh Queue"}
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
            marginBottom: "18px"
          }}
        >
          {statCard("Queued Total", queueStats.total, "#ffffff")}
          {statCard("Ready", queueStats.ready, "#2563eb")}
          {statCard("Processing", queueStats.processing, "#f59e0b")}
          {statCard("Posted", queueStats.posted, "#16a34a")}
          {statCard("Failed", queueStats.failed, "#dc2626")}
        </div>

        {loadingQueue ? (
          <div style={{ opacity: 0.75 }}>Loading automation queue...</div>
        ) : queue.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No scheduled queue items yet.</div>
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {queue.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: "14px",
                  borderRadius: "10px",
                  background: "#0b0d12",
                  border: "1px solid #23262d"
                }}
              >
                <div
                  style={{
                    marginBottom: "10px",
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                    alignItems: "center"
                  }}
                >
                  {pill(item.queue_status || "unknown", getQueueColor(item.queue_status))}
                  {pill(item.publish_status || "not_published", item.publish_status === "published" ? "#7c3aed" : "#444")}
                  {item.automation_batch_id && pill(item.automation_batch_id, "#334155")}
                </div>

                <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>
                  {item.concept_title}
                </div>

                <div style={{ fontSize: "13px", opacity: 0.8, lineHeight: 1.7 }}>
                  <div>
                    <strong>Scheduled:</strong>{" "}
                    {item.scheduled_for
                      ? new Date(item.scheduled_for).toLocaleString()
                      : "Not scheduled"}
                  </div>
                  <div>
                    <strong>Published:</strong>{" "}
                    {item.published_at
                      ? new Date(item.published_at).toLocaleString()
                      : "Not yet"}
                  </div>
                  <div>
                    <strong>Status:</strong> {item.status || "unknown"} / {item.prompt_status || "unknown"}
                  </div>
                  <div>
                    <strong>Instagram Media ID:</strong> {item.instagram_media_id || "—"}
                  </div>
                </div>

                {item.caption && (
                  <div style={{ marginTop: "10px", fontSize: "14px", opacity: 0.9 }}>
                    <strong>Caption:</strong> {item.caption}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ marginBottom: "20px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <a
          href="/api/canva/connect"
          style={{
            display: "inline-block",
            padding: "10px 16px",
            background: "#00c4cc",
            color: "#001014",
            borderRadius: "8px",
            fontWeight: 700,
            textDecoration: "none"
          }}
        >
          Connect Canva
        </a>

        <a
          href="/api/canva/me"
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-block",
            padding: "10px 16px",
            background: "#1f2937",
            color: "white",
            borderRadius: "8px",
            fontWeight: 700,
            textDecoration: "none"
          }}
        >
          Test Canva Connection
        </a>

        <button
          onClick={() => {
            load();
            loadLogs();
            loadTokenHealth();
            loadQueue();
          }}
          style={{
            padding: "10px 16px",
            background: "#374151",
            color: "white",
            borderRadius: "8px",
            fontWeight: 700,
            border: "none",
            cursor: "pointer"
          }}
        >
          Refresh All
        </button>
      </div>

      <div
        style={{
          marginBottom: "24px",
          padding: "16px",
          background: "#0d0f14",
          border: "1px solid #2a2a2a",
          borderRadius: "12px",
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          alignItems: "end"
        }}
      >
        <div>
          <label
            style={{
              display: "block",
              marginBottom: "6px",
              fontSize: "13px",
              opacity: 0.85
            }}
          >
            Page slug
          </label>
          <input
            value={pageSlug}
            onChange={(e) => setPageSlug(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid #333",
              background: "#111",
              color: "white",
              minWidth: "180px"
            }}
          />
        </div>

        <div>
          <label
            style={{
              display: "block",
              marginBottom: "6px",
              fontSize: "13px",
              opacity: 0.85
            }}
          >
            Count
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid #333",
              background: "#111",
              color: "white",
              width: "90px"
            }}
          />
        </div>

        <div>
          <label
            style={{
              display: "block",
              marginBottom: "6px",
              fontSize: "13px",
              opacity: 0.85
            }}
          >
            Goal
          </label>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid #333",
              background: "#111",
              color: "white",
              minWidth: "160px"
            }}
          />
        </div>

        <button
          onClick={generateContent}
          disabled={generating}
          style={{
            padding: "10px 16px",
            background: generating ? "#555" : "#2563eb",
            border: "none",
            borderRadius: "8px",
            color: "white",
            cursor: generating ? "not-allowed" : "pointer",
            fontWeight: 700
          }}
        >
          {generating ? "Generating..." : "Generate"}
        </button>
      </div>

      <section
        style={{
          marginBottom: "28px",
          padding: "18px",
          background: "#0d0f14",
          border: "1px solid #2a2a2a",
          borderRadius: "12px"
        }}
      >
        <div
          style={{
            marginBottom: "14px",
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            alignItems: "center"
          }}
        >
          <div>
            <div style={{ fontSize: "22px", fontWeight: 800, marginBottom: "4px" }}>
              Recent Publish Logs
            </div>
            <div style={{ fontSize: "13px", opacity: 0.75 }}>
              Last publishing attempts and outcomes.
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={loadLogs}
              disabled={loadingLogs || clearingLogs}
              style={{
                padding: "10px 14px",
                background: loadingLogs || clearingLogs ? "#555" : "#1f2937",
                border: "none",
                borderRadius: "8px",
                color: "white",
                cursor: loadingLogs || clearingLogs ? "not-allowed" : "pointer",
                fontWeight: 700
              }}
            >
              {loadingLogs ? "Refreshing..." : "Refresh Logs"}
            </button>

            <button
              onClick={clearLogs}
              disabled={clearingLogs || loadingLogs}
              style={{
                padding: "10px 14px",
                background: clearingLogs || loadingLogs ? "#555" : "#b91c1c",
                border: "none",
                borderRadius: "8px",
                color: "white",
                cursor: clearingLogs || loadingLogs ? "not-allowed" : "pointer",
                fontWeight: 700
              }}
            >
              {clearingLogs ? "Clearing..." : "Clear Logs"}
            </button>
          </div>
        </div>

        {loadingLogs ? (
          <div style={{ opacity: 0.75 }}>Loading logs...</div>
        ) : logs.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No logs yet.</div>
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {logs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: "14px",
                  borderRadius: "10px",
                  background: "#0b0d12",
                  border: "1px solid #23262d"
                }}
              >
                <div
                  style={{
                    marginBottom: "10px",
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                    alignItems: "center"
                  }}
                >
                  {pill(
                    log.status,
                    log.status === "success" ? "#16a34a" : "#dc2626"
                  )}
                  {log.instagram_post_id &&
                    pill(`IG ${log.instagram_post_id}`, "#7c3aed")}
                  {log.content_item_id &&
                    pill(`Item ${log.content_item_id.slice(0, 8)}`, "#334155")}
                </div>

                <div style={{ fontSize: "13px", opacity: 0.75, marginBottom: "8px" }}>
                  {new Date(log.created_at).toLocaleString()}
                </div>

                {log.media_url && (
                  <div style={{ marginBottom: "8px", fontSize: "14px" }}>
                    <strong>Media:</strong>{" "}
                    <a
                      href={log.media_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#60a5fa" }}
                    >
                      Open media
                    </a>
                  </div>
                )}

                {log.caption && (
                  <div style={{ marginBottom: "8px", fontSize: "14px", lineHeight: 1.5 }}>
                    <strong>Caption:</strong> {log.caption}
                  </div>
                )}

                {log.error_message && (
                  <div
                    style={{
                      marginTop: "8px",
                      padding: "10px",
                      borderRadius: "8px",
                      background: "#2a0d12",
                      border: "1px solid #5b1d28",
                      color: "#fecaca",
                      fontSize: "14px"
                    }}
                  >
                    <strong>Error:</strong> {log.error_message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ marginBottom: "20px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={() => setFilter("all")}
          style={filterButtonStyle(filter === "all")}
        >
          All
        </button>
        <button
          onClick={() => setFilter("drafted")}
          style={filterButtonStyle(filter === "drafted")}
        >
          Drafted
        </button>
        <button
          onClick={() => setFilter("approved")}
          style={filterButtonStyle(filter === "approved")}
        >
          Approved
        </button>
        <button
          onClick={() => setFilter("rejected")}
          style={filterButtonStyle(filter === "rejected")}
        >
          Rejected
        </button>
      </div>

      <div style={{ marginBottom: "20px", fontSize: "14px", opacity: 0.8 }}>
        Showing {filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}
      </div>

      <div style={{ display: "grid", gap: "16px" }}>
        {filteredItems.map((item) => {
          const imagePrompt =
            item.image_prompt ||
            `${item.concept_title}. ${item.visual_brief}. ${item.on_image_text}`;

          const canGenerateImage = item.prompt_status === "approved";
          const canUploadToStorage = !!item.generated_image_url && !item.public_image_url;
          const canSendToCanva = !!item.generated_image_url;
          const canPublish = item.status === "approved" && !!item.public_image_url;
          const isBusy = busyId === item.id;
          const previewImage = getPreviewImage(item);

          return (
            <div
              key={item.id}
              style={{
                border: "1px solid #2a2a2a",
                borderRadius: "12px",
                padding: "16px",
                background: "#0d0f14"
              }}
            >
              <div style={{ marginBottom: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {pill(item.status, getStatusColor(item.status))}
                {pill(
                  item.prompt_status || "pending",
                  item.prompt_status === "approved" ? "#0ea5e9" : "#444"
                )}
                {pill(
                  item.render_status || "not_rendered",
                  item.render_status === "rendered" ? "#2563eb" : "#444"
                )}
                {pill(
                  item.publish_status || "not_published",
                  item.publish_status === "published" ? "#7c3aed" : "#444"
                )}
                {pill(
                  item.public_image_url ? "public_url_ready" : "no_public_url",
                  item.public_image_url ? "#14b8a6" : "#444"
                )}
              </div>

              <div style={{ marginBottom: "8px", fontSize: "12px", opacity: 0.9 }}>
                {item.post_type}
              </div>

              <h2 style={{ margin: "0 0 12px 0", fontSize: "20px" }}>
                {item.concept_title}
              </h2>

              <p style={{ margin: "0 0 12px 0", opacity: 0.95 }}>
                <strong>Visual:</strong> {item.visual_brief}
              </p>

              <p style={{ margin: "0 0 12px 0", opacity: 0.95 }}>
                <strong>On-image text:</strong> {item.on_image_text}
              </p>

              <p style={{ margin: "0 0 12px 0" }}>
                <strong>Caption:</strong> {item.caption}
              </p>

              <p style={{ marginBottom: "12px" }}>
                <strong>Hashtags:</strong>{" "}
                {Array.isArray(item.hashtags) ? item.hashtags.join(" ") : ""}
              </p>

              <div
                style={{
                  marginBottom: "12px",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "#111827",
                  border: "1px solid #1f2937"
                }}
              >
                <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "6px" }}>
                  Image prompt
                </div>
                <div style={{ fontSize: "14px", lineHeight: 1.5 }}>
                  {imagePrompt}
                </div>
              </div>

              {previewImage && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "6px" }}>
                    Preview image
                  </div>
                  <img
                    src={previewImage}
                    alt={item.concept_title}
                    style={{
                      width: "220px",
                      maxWidth: "100%",
                      borderRadius: "10px",
                      border: "1px solid #333"
                    }}
                  />
                </div>
              )}

              {item.public_image_url && (
                <div style={{ marginBottom: "12px", fontSize: "13px", opacity: 0.9 }}>
                  <strong>Public image URL:</strong>{" "}
                  <a
                    href={item.public_image_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#60a5fa" }}
                  >
                    Open
                  </a>
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => updateStatus(item.id, "approved")}
                  disabled={isBusy}
                  style={actionButtonStyle("#16a34a", isBusy)}
                >
                  Approve
                </button>

                <button
                  onClick={() => updateStatus(item.id, "rejected")}
                  disabled={isBusy}
                  style={actionButtonStyle("#dc2626", isBusy)}
                >
                  Reject
                </button>

                <button
                  onClick={() => updatePromptStatus(item.id, "approved")}
                  disabled={isBusy}
                  style={actionButtonStyle("#0ea5e9", isBusy)}
                >
                  Approve Prompt
                </button>

                <button
                  onClick={() => generateImage(item.id)}
                  disabled={!canGenerateImage || isBusy}
                  style={actionButtonStyle("#2563eb", !canGenerateImage || isBusy)}
                  title={canGenerateImage ? "Generate image from approved prompt" : "Approve prompt first"}
                >
                  {isBusy ? "Working..." : "Generate Image"}
                </button>

                <button
                  onClick={() => uploadToStorage(item.id)}
                  disabled={!canUploadToStorage || isBusy}
                  style={actionButtonStyle("#f59e0b", !canUploadToStorage || isBusy)}
                  title={canUploadToStorage ? "Upload image to public storage" : "Generate image first or already uploaded"}
                >
                  {isBusy ? "Working..." : "Upload to Storage"}
                </button>

                <button
                  onClick={() => sendToCanva(item.id)}
                  disabled={!canSendToCanva || isBusy}
                  style={actionButtonStyle("#14b8a6", !canSendToCanva || isBusy)}
                  title={canSendToCanva ? "Send generated image to Canva" : "Generate image first"}
                >
                  {isBusy ? "Working..." : "Send to Canva"}
                </button>

                <button
                  onClick={() => publishInstagram(item.id)}
                  disabled={!canPublish || isBusy}
                  style={actionButtonStyle("#7c3aed", !canPublish || isBusy)}
                  title={canPublish ? "Publish to Instagram" : "Approve and upload image to storage first"}
                >
                  {isBusy ? "Working..." : "Publish Instagram"}
                </button>

                <button
                  onClick={() => deleteItem(item.id)}
                  disabled={isBusy}
                  style={actionButtonStyle("#444", isBusy)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}