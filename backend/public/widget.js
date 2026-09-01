(function () {
  const scriptTag = document.currentScript || document.querySelector("script[data-assistant-id]");
  const assistantId = scriptTag ? scriptTag.getAttribute("data-assistant-id") : null;
  const apiBase = scriptTag ? scriptTag.getAttribute("data-api-base") || "http://localhost:5000" : "http://localhost:5000";

  let config = {
    name: "Support Assistant",
    welcomeMessage: "Hello! How can I help you today?",
    primaryColor: "#3B82F6",
    organizationId: null,
  };

  let state = {
    isOpen: false,
    customerId: localStorage.getItem("ai_chat_customer_id") || null,
    conversationId: localStorage.getItem("ai_chat_conv_id") || null,
    messages: [],
    loading: false,
    handoff: false,
  };

  // Inject Styles
  const styleTag = document.createElement("style");
  styleTag.innerHTML = `
    .ai-chat-launcher {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 30px;
      background-color: var(--primary-color, #3B82F6);
      color: white;
      border: none;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      cursor: pointer;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease;
    }
    .ai-chat-launcher:hover { transform: scale(1.05); }
    
    .ai-chat-window {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 580px;
      max-height: calc(100vh - 120px);
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.15);
      z-index: 99999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .ai-chat-window.open { display: flex; }

    .ai-chat-header {
      background: var(--primary-color, #3B82F6);
      color: white;
      padding: 16px;
      font-weight: 600;
      font-size: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .ai-chat-body {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #f9fafb;
    }
    .ai-chat-msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.4;
      word-break: break-word;
    }
    .ai-chat-msg.customer {
      align-self: flex-end;
      background: var(--primary-color, #3B82F6);
      color: white;
      border-bottom-right-radius: 2px;
    }
    .ai-chat-msg.ai, .ai-chat-msg.agent {
      align-self: flex-start;
      background: #e5e7eb;
      color: #1f2937;
      border-bottom-left-radius: 2px;
    }
    .ai-chat-footer {
      padding: 12px;
      background: #ffffff;
      border-top: 1px solid #e5e7eb;
      display: flex;
      gap: 8px;
    }
    .ai-chat-input {
      flex: 1;
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .ai-chat-send {
      background: var(--primary-color, #3B82F6);
      color: white;
      border: none;
      padding: 0 16px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
    }
  `;
  document.head.appendChild(styleTag);

  // Build UI Container
  const container = document.createElement("div");
  container.innerHTML = `
    <button class="ai-chat-launcher" id="ai-chat-launcher-btn">💬</button>
    <div class="ai-chat-window" id="ai-chat-window-box">
      <div class="ai-chat-header">
        <span id="ai-chat-assistant-name">Support Assistant</span>
        <button style="background:none;border:none;color:white;cursor:pointer;font-size:18px;" id="ai-chat-close-btn">✕</button>
      </div>
      <div class="ai-chat-body" id="ai-chat-msg-container"></div>
      <div class="ai-chat-footer">
        <input type="text" class="ai-chat-input" id="ai-chat-input-field" placeholder="Type a message..." />
        <button class="ai-chat-send" id="ai-chat-send-btn">Send</button>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const launcherBtn = document.getElementById("ai-chat-launcher-btn");
  const windowBox = document.getElementById("ai-chat-window-box");
  const closeBtn = document.getElementById("ai-chat-close-btn");
  const nameLabel = document.getElementById("ai-chat-assistant-name");
  const msgContainer = document.getElementById("ai-chat-msg-container");
  const inputField = document.getElementById("ai-chat-input-field");
  const sendBtn = document.getElementById("ai-chat-send-btn");

  // Fetch Config
  async function initWidget() {
    try {
      const res = await fetch(`${apiBase}/api/v1/widget/config?assistantId=${assistantId || ""}`);
      if (res.ok) {
        config = await res.json();
        document.documentElement.style.setProperty("--primary-color", config.primaryColor || "#3B82F6");
        nameLabel.textContent = config.name || "Support Assistant";
      }

      // Session setup
      const sessionRes = await fetch(`${apiBase}/api/v1/widget/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: config.assistantId,
          organizationId: config.organizationId,
        }),
      });

      if (sessionRes.ok) {
        const session = await sessionRes.json();
        state.customerId = session.customerId;
        state.conversationId = session.conversationId;
        localStorage.setItem("ai_chat_customer_id", session.customerId);
        localStorage.setItem("ai_chat_conv_id", session.conversationId);

        // Fetch history
        loadMessages();
      }
    } catch (e) {
      console.warn("AI Chat Widget init failed:", e);
    }
  }

  async function loadMessages() {
    if (!state.conversationId || !config.organizationId) return;
    try {
      const res = await fetch(
        `${apiBase}/api/v1/widget/messages?conversationId=${state.conversationId}&organizationId=${config.organizationId}`
      );
      if (res.ok) {
        const msgs = await res.json();
        state.messages = msgs;
        renderMessages();
      }
    } catch (e) {}
  }

  function renderMessages() {
    msgContainer.innerHTML = "";

    if (state.messages.length === 0 && config.welcomeMessage) {
      const welcomeEl = document.createElement("div");
      welcomeEl.className = "ai-chat-msg ai";
      welcomeEl.textContent = config.welcomeMessage;
      msgContainer.appendChild(welcomeEl);
    }

    state.messages.forEach((m) => {
      const msgEl = document.createElement("div");
      msgEl.className = `ai-chat-msg ${m.senderType}`;
      msgEl.textContent = m.content;
      msgContainer.appendChild(msgEl);
    });

    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  async function sendMessage() {
    const text = inputField.value.trim();
    if (!text || state.loading) return;

    inputField.value = "";
    state.loading = true;

    // Append local temp message
    state.messages.push({ senderType: "customer", content: text });
    renderMessages();

    try {
      const res = await fetch(`${apiBase}/api/v1/widget/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: config.organizationId,
          conversationId: state.conversationId,
          content: text,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.aiResponse) {
          state.messages.push({ senderType: "ai", content: data.aiResponse.content });
        }
        renderMessages();
      }
    } catch (e) {
      console.error(e);
    } finally {
      state.loading = false;
    }
  }

  launcherBtn.addEventListener("click", () => {
    state.isOpen = !state.isOpen;
    windowBox.classList.toggle("open", state.isOpen);
  });
  closeBtn.addEventListener("click", () => {
    state.isOpen = false;
    windowBox.classList.remove("open");
  });
  sendBtn.addEventListener("click", sendMessage);
  inputField.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  initWidget();
})();
