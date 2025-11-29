/* global chrome */

console.log("ContextMemo content script loaded:", location.href);

(function () {
  // -----------------------------------------------------
  // UTILITIES
  // -----------------------------------------------------

  function uid() {
    return "n_" + Math.random().toString(36).slice(2);
  }

  function currentUrl() {
    return location.href;
  }

  // -----------------------------------------------------
  // STORAGE
  // -----------------------------------------------------

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
    },
  };

  // -----------------------------------------------------
  // SHADOW POPUP UI (isolated from site CSS)
  // -----------------------------------------------------

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
      .save {
        background:#2563eb; color:white;
        border:none; padding:6px 10px; border-radius:6px;
      }
      .cancel {
        background:#eee; border:none;
        padding:6px 10px; border-radius:6px;
      }
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

  // -----------------------------------------------------
  // POPUP POSITION FIX
  // -----------------------------------------------------

  function getSafePopupPosition() {
    const sel = window.getSelection();

    // fallback center
    let x = window.scrollX + window.innerWidth / 2;
    let y = window.scrollY + window.innerHeight / 2;

    if (!sel || sel.rangeCount === 0) return { x, y };

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) return { x, y };

    x = Math.min(
      window.scrollX + rect.left,
      window.scrollX + window.innerWidth - 300 // keep popup inside screen
    );
    y = window.scrollY + rect.bottom + 10;

    return { x, y };
  }

  // -----------------------------------------------------
  // OPEN/CLOSE NOTE UI
  // -----------------------------------------------------

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

  // -----------------------------------------------------
  // HIGHLIGHT ENGINE — stable exact text mapping
  // -----------------------------------------------------

  function highlightSnippet(snippet, id) {
    if (!snippet) return false;

    const rawSnippet = snippet.trim();

    // collect all text nodes + their positions
    let pos = 0;
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      textNodes.push({ node, start: pos, end: pos + text.length });
      pos += text.length;
    }

    const fullText = textNodes.map((t) => t.node.nodeValue).join("");
    const startIdx = fullText.indexOf(rawSnippet);

    if (startIdx === -1) return false;

    const endIdx = startIdx + rawSnippet.length;

    // map indices → DOM nodes
    let startNode, startOffset, endNode, endOffset;

    for (const t of textNodes) {
      if (!startNode && startIdx >= t.start && startIdx < t.end) {
        startNode = t.node;
        startOffset = startIdx - t.start;
      }
      if (!endNode && endIdx > t.start && endIdx <= t.end) {
        endNode = t.node;
        endOffset = endIdx - t.start;
      }
      if (startNode && endNode) break;
    }

    if (!startNode || !endNode) return false;

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    const span = document.createElement("span");
    span.setAttribute("data-note-id", id);
    span.style.backgroundColor = "#fff59d";
    span.style.textDecoration = "underline";
    span.style.padding = "1px 0";
    span.style.borderRadius = "2px";

    const dot = document.createElement("span");
    dot.className = "contextmemo-dot";
    dot.style.width = "8px";
    dot.style.height = "8px";
    dot.style.background = "#f59e0b";
    dot.style.display = "inline-block";
    dot.style.borderRadius = "50%";
    dot.style.marginLeft = "4px";

    try {
      const contents = range.extractContents();
      span.appendChild(contents);
      span.appendChild(dot);
      range.insertNode(span);
      return true;
    } catch (e) {
      return false;
    }
  }

  // -----------------------------------------------------
  // REHYDRATE HIGHLIGHTS ON PAGE LOAD
  // -----------------------------------------------------

  async function rehydrate() {
    const list = await Storage.notesFor(currentUrl());
    list.forEach((n) => {
      if (!document.querySelector(`[data-note-id="${n.id}"]`)) {
        highlightSnippet(n.snippet, n.id);
      }
    });
  }

  rehydrate();
  setTimeout(rehydrate, 300);

  // -----------------------------------------------------
  // MESSAGE HANDLER
  // -----------------------------------------------------

  chrome.runtime.onMessage.addListener((msg) => {
    // OPEN NOTE UI
    if (msg.type === "OPEN_NOTE_UI") {
      const snippet = msg.snippet?.trim();
      if (!snippet) return alert("Select some text first.");

      const pos = getSafePopupPosition();
      showUI(pos.x, pos.y, snippet);
    }

    // DELETE NOTE — FIXED: remove dot + highlight instantly
    if (msg.type === "DELETE_NOTE") {
      const els = document.querySelectorAll(`[data-note-id="${msg.id}"]`);

      els.forEach((el) => {
        const parent = el.parentNode;

        // extract ONLY the text (skip the dot)
        [...el.childNodes].forEach((child) => {
          if (child.className === "contextmemo-dot") return; // skip dot
          parent.insertBefore(child, el);
        });

        parent.removeChild(el);
      });
    }

    // SCROLL + FLASH highlight
    if (msg.type === "OPEN_NOTE_VIEWER") {
      const el = document.querySelector(`[data-note-id="${msg.id}"]`);
      if (!el) return;

      el.scrollIntoView({ behavior: "smooth", block: "center" });

      const prev = el.style.backgroundColor;
      el.style.transition = "background-color 0.3s ease";
      el.style.backgroundColor = "#ffeb3b";

      setTimeout(() => {
        el.style.backgroundColor = prev;
      }, 600);
    }
  });

  // -----------------------------------------------------
  // SAVE NOTE
  // -----------------------------------------------------

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
      createdAt: Date.now(),
    });

    hideUI();
  });

  root.querySelector(".cancel").addEventListener("click", hideUI);
})();
