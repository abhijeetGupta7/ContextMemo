/* global chrome */

console.log("ContextMemo content script loaded:", location.href);

(function () {

  // ---------- UTIL ----------
  function uid() {
    return "n_" + Math.random().toString(36).slice(2);
  }

  function currentUrl() {
    return location.href;
  }

  // ---------- STORAGE ----------
  const Storage = {
    async getAll() {
      return new Promise((res) =>
        chrome.storage.local.get({ notes: [] }, (d) => res(d.notes || []))
      );
    },
    async save(note) {
      const all = await this.getAll();
      all.push(note);
      return new Promise((res) =>
        chrome.storage.local.set({ notes: all }, () => res(true))
      );
    },
    async notesFor(url) {
      const all = await this.getAll();
      return all.filter((n) => n.url === url);
    }
  };

  // ---------- SHADOW UI ----------
  const host = document.createElement("div");
  host.style.all = "initial";
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      .box {
        position: fixed;
        background:white;
        padding:10px;
        border-radius:8px;
        border:1px solid #bbb;
        box-shadow:0 4px 20px rgba(0,0,0,0.25);
        z-index:2147483647;
        width:260px;
        font-family: sans-serif;
      }
      textarea {
        width:100%;
        height:80px;
        padding:6px;
      }
      .row {
        margin-top:8px;
        display:flex;
        justify-content:flex-end;
        gap:6px;
      }
      .save { background:#2563eb; color:white; border:none; padding:6px 10px; border-radius:6px; }
      .cancel { background:#eee; border:none; padding:6px 10px; border-radius:6px; }
    </style>

    <div id="box" class="box" style="display:none">
      <div style="font-weight:bold; margin-bottom:6px;">Add Note</div>
      <textarea id="note"></textarea>
      <div class="row">
        <button class="cancel">Cancel</button>
        <button class="save">Save</button>
      </div>
    </div>
  `;

  const ui = root.querySelector("#box");
  const textarea = root.querySelector("#note");

  function showUI(x, y, snippet) {
    ui.style.left = x + "px";
    ui.style.top = y + "px";
    ui.style.display = "block";
    textarea.value = "";
    ui.dataset.snippet = snippet;
    textarea.focus();
  }

  function hideUI() {
    ui.style.display = "none";
    delete ui.dataset.snippet;
  }

  // ---------- HIGHLIGHT ENGINE ----------
  function highlightSnippet(snippet, id) {
    if (!snippet) return false;

    const rawSnippet = snippet.trim();

    // Collect text nodes with ORIGINAL spacing (no normalization)
    let textIndex = 0;
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      textNodes.push({
        node,
        start: textIndex,
        end: textIndex + text.length
      });
      textIndex += text.length;
    }

    // Find snippet in the FULL TEXT
    const fullText = textNodes.map((t) => t.node.nodeValue).join("");
    const matchIndex = fullText.indexOf(rawSnippet);

    if (matchIndex === -1) {
      console.warn("Snippet not found:", rawSnippet);
      return false;
    }

    const matchEnd = matchIndex + rawSnippet.length;

    // Map index → node + offset
    let startNode, startOffset, endNode, endOffset;

    for (const t of textNodes) {
      if (!startNode && matchIndex >= t.start && matchIndex < t.end) {
        startNode = t.node;
        startOffset = matchIndex - t.start;
      }
      if (!endNode && matchEnd > t.start && matchEnd <= t.end) {
        endNode = t.node;
        endOffset = matchEnd - t.start;
        break;
      }
    }

    if (!startNode || !endNode) return false;

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    // Wrapper with INLINE styles (UNSTOPPABLE)
    const span = document.createElement("span");
    span.setAttribute("data-note-id", id);

    span.style.backgroundColor = "#fff59d";
    span.style.textDecoration = "underline";
    span.style.borderRadius = "2px";
    span.style.padding = "1px 0";
    span.style.display = "inline";
    span.style.position = "relative";
    span.style.zIndex = "2147480000";

    const dot = document.createElement("span");
    dot.style.width = "8px";
    dot.style.height = "8px";
    dot.style.background = "#f59e0b";
    dot.style.display = "inline-block";
    dot.style.borderRadius = "50%";
    dot.style.marginLeft = "4px";
    dot.style.verticalAlign = "middle";

    try {
      const contents = range.extractContents();
      span.appendChild(contents);
      span.appendChild(dot);
      range.insertNode(span);
      return true;
    } catch (e) {
      console.warn("Highlight failed:", e);
      return false;
    }
  }

  // ---------- REHYDRATE ----------
  async function rehydrate() {
    const list = await Storage.notesFor(currentUrl());
    list.forEach((n) => highlightSnippet(n.snippet, n.id));
  }

  rehydrate();
  setTimeout(rehydrate, 300);

  // ---------- MESSAGE LISTENER ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "OPEN_NOTE_UI") {
      const snippet = msg.snippet?.trim();
      if (!snippet) return alert("Select some text first.");

      const sel = window.getSelection();
      let x = window.innerWidth / 2;
      let y = window.innerHeight / 2;

      if (sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        x = rect.left + window.scrollX;
        y = rect.bottom + window.scrollY + 10;
      }

      showUI(x, y, snippet);
    }
  });

  // ---------- SAVE ----------
  root.querySelector(".save").addEventListener("click", async () => {
    const snippet = ui.dataset.snippet;
    const content = textarea.value.trim();

    const id = uid();
    const ok = highlightSnippet(snippet, id);

    if (!ok) {
      alert("Could not highlight this snippet.");
      hideUI();
      return;
    }

    await Storage.save({
      id,
      url: currentUrl(),
      snippet,
      content,
      createdAt: Date.now()
    });

    hideUI();
  });

  root.querySelector(".cancel").addEventListener("click", hideUI);

})();
