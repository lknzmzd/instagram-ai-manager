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
};

type FilterType = "all" | "drafted" | "approved" | "rejected";

async function fetchItems() {
  const res = await fetch("/api/content/list", {
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error("Failed to load content items");
  }

  return res.json();
}

export default function HomePage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");

  const [pageSlug, setPageSlug] = useState("mortaena");
  const [count, setCount] = useState(3);
  const [goal, setGoal] = useState("growth");
  const [generating, setGenerating] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const data = await fetchItems();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error("Failed to load items:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function updateStatus(id: string, status: "approved" | "rejected") {
    try {
      const res = await fetch("/api/content/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status })
      });

      if (!res.ok) throw new Error("Failed to update status");

      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status } : item))
      );
    } catch (error) {
      console.error(error);
      alert("Failed to update status");
    }
  }

  async function updatePromptStatus(id: string, promptStatus: "approved" | "rejected") {
    try {
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

      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "Failed to update prompt status");

      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, prompt_status: promptStatus } : item
        )
      );
    } catch (error) {
      console.error(error);
      alert("Failed to update prompt status");
    }
  }

  async function deleteItem(id: string) {
    try {
      const res = await fetch("/api/content/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      if (!res.ok) throw new Error("Failed to delete item");

      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      console.error(error);
      alert("Failed to delete item");
    }
  }

  async function generateContent() {
    try {
      setGenerating(true);

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
      setFilter("drafted");
    } catch (error) {
      console.error(error);
      alert("Failed to generate content");
    } finally {
      setGenerating(false);
    }
  }

  async function generateImage(id: string) {
    try {
      const res = await fetch("/api/content/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate image");
      }

      setItems((prev) =>
        prev.map((item) => (item.id === id ? data.item : item))
      );
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to generate image");
    }
  }

  async function uploadToStorage(id: string) {
    try {
      const res = await fetch("/api/content/upload-to-storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to upload image to storage");
      }

      setItems((prev) =>
        prev.map((item) => (item.id === id ? data.item : item))
      );
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to upload image");
    }
  }

  async function sendToCanva(id: string) {
    try {
      const res = await fetch("/api/content/send-to-canva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to send to Canva");
      }

      setItems((prev) =>
        prev.map((item) => (item.id === id ? data.item : item))
      );
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to send to Canva");
    }
  }

  async function publishInstagram(id: string) {
    try {
      const res = await fetch("/api/content/publish-instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to publish to Instagram");
      }

      setItems((prev) =>
        prev.map((item) => (item.id === id ? data.item : item))
      );
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to publish to Instagram");
    }
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => filter === "all" || item.status === filter);
  }, [items, filter]);

  function getStatusColor(status: string) {
    if (status === "approved") return "#22c55e";
    if (status === "rejected") return "#ef4444";
    return "#a3a3a3";
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
      <h1 style={{ marginBottom: "24px", fontSize: "54px" }}>
        Instagram AI Manager
      </h1>

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
          <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", opacity: 0.85 }}>
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
          <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", opacity: 0.85 }}>
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
          <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", opacity: 0.85 }}>
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

      <div style={{ marginBottom: "20px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button onClick={() => setFilter("all")} style={filterButtonStyle(filter === "all")}>
          All
        </button>
        <button onClick={() => setFilter("drafted")} style={filterButtonStyle(filter === "drafted")}>
          Drafted
        </button>
        <button onClick={() => setFilter("approved")} style={filterButtonStyle(filter === "approved")}>
          Approved
        </button>
        <button onClick={() => setFilter("rejected")} style={filterButtonStyle(filter === "rejected")}>
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
          const canUploadToStorage = !!item.generated_image_url;
          const canSendToCanva = !!item.generated_image_url;
          const canPublish =
            item.status === "approved" && !!item.public_image_url;

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
                {pill(item.prompt_status || "pending", item.prompt_status === "approved" ? "#0ea5e9" : "#444")}
                {pill(item.render_status || "not_rendered", item.render_status === "rendered" ? "#2563eb" : "#444")}
                {pill(item.publish_status || "not_published", item.publish_status === "published" ? "#7c3aed" : "#444")}
                {pill(item.public_image_url ? "public_url_ready" : "no_public_url", item.public_image_url ? "#14b8a6" : "#444")}
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

              {item.generated_image_url && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "6px" }}>
                    Generated image
                  </div>
                  <img
                    src={item.generated_image_url}
                    alt={`${item.concept_title} generated`}
                    style={{
                      width: "220px",
                      maxWidth: "100%",
                      borderRadius: "10px",
                      border: "1px solid #333"
                    }}
                  />
                </div>
              )}

              {item.final_media_url && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "6px" }}>
                    Canva export
                  </div>
                  <img
                    src={item.final_media_url}
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
                <button onClick={() => updateStatus(item.id, "approved")} style={actionButtonStyle("#16a34a")}>
                  Approve
                </button>

                <button onClick={() => updateStatus(item.id, "rejected")} style={actionButtonStyle("#dc2626")}>
                  Reject
                </button>

                <button onClick={() => updatePromptStatus(item.id, "approved")} style={actionButtonStyle("#0ea5e9")}>
                  Approve Prompt
                </button>

                <button
                  onClick={() => generateImage(item.id)}
                  disabled={!canGenerateImage}
                  style={actionButtonStyle("#2563eb", !canGenerateImage)}
                  title={canGenerateImage ? "Generate image from approved prompt" : "Approve prompt first"}
                >
                  Generate Image
                </button>

                <button
                  onClick={() => uploadToStorage(item.id)}
                  disabled={!canUploadToStorage}
                  style={actionButtonStyle("#f59e0b", !canUploadToStorage)}
                  title={canUploadToStorage ? "Upload image to public storage" : "Generate image first"}
                >
                  Upload to Storage
                </button>

                <button
                  onClick={() => sendToCanva(item.id)}
                  disabled={!canSendToCanva}
                  style={actionButtonStyle("#14b8a6", !canSendToCanva)}
                  title={canSendToCanva ? "Send generated image to Canva" : "Generate image first"}
                >
                  Send to Canva
                </button>

                <button
                  onClick={() => publishInstagram(item.id)}
                  disabled={!canPublish}
                  style={actionButtonStyle("#7c3aed", !canPublish)}
                  title={canPublish ? "Publish to Instagram" : "Approve and upload image to storage first"}
                >
                  Publish Instagram
                </button>

                <button onClick={() => deleteItem(item.id)} style={actionButtonStyle("#444")}>
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