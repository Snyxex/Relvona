(function () {
  const scriptTag = document.currentScript;
  const assistantId = scriptTag?.getAttribute("data-assistant-id") || "";
  const widgetKey = scriptTag?.getAttribute("data-widget-key") || "";
  const apiBase = scriptTag?.getAttribute("data-api-base") || "http://localhost:8080";
  const storageSuffix = assistantId || "default";
  const visitorStorageKey = `ai_chat_visitor_token_${storageSuffix}`;

  function visitorToken() {
    try { return localStorage.getItem(visitorStorageKey) || ""; } catch { return ""; }
  }

  function waitForWidget() {
    const windowBox = document.getElementById("ai-chat-window-box");
    const footer = windowBox?.querySelector(".ai-chat-footer");
    if (!windowBox || !footer) return setTimeout(waitForWidget, 100);
    if (document.getElementById("ai-chat-privacy-bar")) return;

    const style = document.createElement("style");
    style.textContent = `
      .ai-chat-privacy-bar{padding:8px 12px;border-top:1px solid #e5e7eb;background:var(--surface-color,#fff);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .ai-chat-privacy-trigger{border:0;background:none;padding:0;color:#6b7280;cursor:pointer;text-decoration:underline}
      .ai-chat-privacy-panel{display:none;margin-top:8px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;color:#374151;background:#fff}
      .ai-chat-privacy-panel.open{display:block}
      .ai-chat-privacy-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0}
      .ai-chat-privacy-danger{border:1px solid #dc2626;background:#fff;color:#dc2626;border-radius:6px;padding:6px 8px;cursor:pointer}
      .ai-chat-privacy-status{margin-top:6px;color:#6b7280}
    `;
    document.head.appendChild(style);

    const bar = document.createElement("div");
    bar.id = "ai-chat-privacy-bar";
    bar.className = "ai-chat-privacy-bar";
    bar.innerHTML = `<button type="button" class="ai-chat-privacy-trigger">Datenschutz & KI-Memory</button><div class="ai-chat-privacy-panel"><div class="ai-chat-privacy-row"><span>Frühere Support-Probleme merken</span><input type="checkbox" class="ai-chat-privacy-memory" checked></div><button type="button" class="ai-chat-privacy-danger">Pseudonyme Daten löschen</button><div class="ai-chat-privacy-status"></div></div>`;
    windowBox.insertBefore(bar, footer);

    const trigger = bar.querySelector(".ai-chat-privacy-trigger");
    const panel = bar.querySelector(".ai-chat-privacy-panel");
    const checkbox = bar.querySelector(".ai-chat-privacy-memory");
    const eraseButton = bar.querySelector(".ai-chat-privacy-danger");
    const status = bar.querySelector(".ai-chat-privacy-status");

    async function loadState() {
      const token = visitorToken();
      if (!token) return;
      const params = new URLSearchParams({ assistantId, widgetKey, visitorToken: token });
      const response = await fetch(`${apiBase}/api/v1/widget/privacy/state?${params}`);
      if (!response.ok) return;
      const data = await response.json();
      checkbox.checked = data.memoryEnabled !== false;
    }

    trigger.addEventListener("click", () => {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) void loadState();
    });

    checkbox.addEventListener("change", async () => {
      status.textContent = "Wird gespeichert …";
      try {
        const response = await fetch(`${apiBase}/api/v1/widget/privacy/memory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assistantId, widgetKey, visitorToken: visitorToken(), enabled: checkbox.checked, consentVersion: "v1" }),
        });
        if (!response.ok) throw new Error();
        status.textContent = checkbox.checked ? "KI-Memory ist aktiviert." : "KI-Memory ist deaktiviert und gespeicherte Memories wurden gelöscht.";
      } catch {
        checkbox.checked = !checkbox.checked;
        status.textContent = "Die Einstellung konnte nicht gespeichert werden.";
      }
    });

    eraseButton.addEventListener("click", async () => {
      if (!confirm("Pseudonyme Visitor-ID, Memories und deren Conversation-Verknüpfungen löschen? Die Support-Unterhaltungen selbst bleiben gemäß den Regeln des Anbieters bestehen.")) return;
      status.textContent = "Daten werden gelöscht …";
      try {
        const response = await fetch(`${apiBase}/api/v1/widget/privacy/visitor`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assistantId, widgetKey, visitorToken: visitorToken() }),
        });
        if (!response.ok) throw new Error();
        try { localStorage.removeItem(visitorStorageKey); } catch {}
        checkbox.checked = false;
        status.textContent = "Pseudonyme Visitor-Daten wurden gelöscht. Beim nächsten Chat wird eine neue zufällige ID erstellt.";
      } catch { status.textContent = "Die Daten konnten nicht gelöscht werden."; }
    });
  }

  waitForWidget();
})();
