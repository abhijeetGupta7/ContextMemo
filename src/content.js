/* global chrome */

console.log("ContextMemo: Ultimate Engine v15 (Dense Offsets + Atomic Storage)");

(function () {
  // --------------------------------------------------------------------------
  // CONFIG & CONSTANTS
  // --------------------------------------------------------------------------
  const HIGHLIGHT_ATTR = "data-cm-type";
  const NOTE_ID_ATTR = "data-note-id";
  const HIGHLIGHT_TYPE = "highlight";
  const DOT_CLASS = "cm-dot";
  
  let activeRange = null;
  let editingNoteId = null;
  let isExtensionAlive = true;
  let rehydrateTimer = null;
  let observerTimer = null;

  // --------------------------------------------------------------------------
  // UTILITIES
  // --------------------------------------------------------------------------
  
  function uid() { return "n_" + Math.random().toString(36).slice(2); }

  // Must match App.jsx exactly
  function getCanonicalUrl(url = location.href) {
    try {
      const u = new URL(url);
      return (u.hostname + u.pathname).replace(/\/$/, "").toLowerCase();
    } catch (e) { return (url || "").toLowerCase(); }
  }

  function cleanText(text) {
    return (text || "").replace(/[\s\u00A0]+/g, " ").trim();
  }

  function safeAsync(fn) {
    return (...args) => {
      try { return fn(...args); } 
      catch (e) { console.warn("ContextMemo op failed", e); }
    };
  }

  // --------------------------------------------------------------------------
  // STORAGE (Atomic + Retry)
  // --------------------------------------------------------------------------
  
  const Storage = {
    async _get() {
      return new Promise(r => chrome.storage.local.get({notes:[]}, d => r(d.notes || [])));
    },
    async _set(notes) {
      return new Promise(r => chrome.storage.local.set({notes}, r));
    },
    async save(note) {
      if(!chrome.runtime?.id) return;
      const notes = await this._get();
      notes.push(note);
      await this._set(notes);
    },
    async update(id, patch) {
      if(!chrome.runtime?.id) return;
      const notes = await this._get();
      const idx = notes.findIndex(n => n.id === id);
      if(idx !== -1) {
        notes[idx] = {...notes[idx], ...patch};
        await this._set(notes);
      }
    },
    async delete(id) {
      if(!chrome.runtime?.id) return;
      const notes = await this._get();
      const filtered = notes.filter(n => n.id !== id);
      await this._set(filtered);
    },
    async getForPage() {
      if(!chrome.runtime?.id) return [];
      const notes = await this._get();
      const current = getCanonicalUrl();
      return notes.filter(n => (n.normalizedUrl || getCanonicalUrl(n.url)) === current);
    }
  };

  // --------------------------------------------------------------------------
  // CORE ENGINE: DENSE TEXT CORPUS
  // --------------------------------------------------------------------------
  
  // Builds a map of { node, start, end } based on DENSE text (no whitespace)
  function buildDenseCorpus() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const tag = node.parentNode?.tagName;
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'HEAD', 'META'].includes(tag)) return NodeFilter.FILTER_REJECT;
          // Ignore our own UI
          if (node.parentNode.closest && node.parentNode.closest('[data-contextmemo-ui]')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    let denseAcc = ""; // Accumulator string

    while (walker.nextNode()) {
      const n = walker.currentNode;
      const raw = n.nodeValue;
      // Remove all whitespace to calculate dense length
      const dense = raw.replace(/\s+/g, "");
      
      const start = denseAcc.length;
      denseAcc += dense;
      const end = denseAcc.length;
      
      nodes.push({ node: n, start, end, rawText: raw });
    }
    return { nodes, fullDense: denseAcc };
  }

  // Converts Global Dense Offsets -> DOM Range
  function denseRangeToDOMRange(globalStart, globalEnd, corpus) {
    let startNode = null, endNode = null, startOffset = 0, endOffset = 0;

    for (const entry of corpus.nodes) {
      // Check Start
      if (!startNode && entry.end > globalStart) {
        startNode = entry.node;
        // Map dense offset back to raw offset
        const charsNeeded = globalStart - entry.start;
        let d = 0;
        for (let i = 0; i < entry.rawText.length; i++) {
          if (!/\s/.test(entry.rawText[i])) d++;
          if (d > charsNeeded) { startOffset = i; break; }
        }
      }
      // Check End
      if (!endNode && entry.end >= globalEnd) {
        endNode = entry.node;
        const charsNeeded = globalEnd - entry.start;
        let d = 0;
        for (let i = 0; i < entry.rawText.length; i++) {
          if (!/\s/.test(entry.rawText[i])) d++;
          if (d >= charsNeeded) { endOffset = i + 1; break; } 
        }
      }
      if (startNode && endNode) break;
    }

    if (!startNode || !endNode) return null;

    try {
      const r = document.createRange();
      r.setStart(startNode, startOffset);
      r.setEnd(endNode, Math.min(endOffset, endNode.length));
      return r;
    } catch (e) { return null; }
  }

  // Capture selection using Dense Offsets
  function serializeSelection(range) {
    const corpus = buildDenseCorpus();
    let startEntryIndex = -1, endEntryIndex = -1;

    for (let i = 0; i < corpus.nodes.length; i++) {
      if (range.intersectsNode(corpus.nodes[i].node)) {
        if (startEntryIndex === -1) startEntryIndex = i;
        endEntryIndex = i;
      }
    }
    if (startEntryIndex === -1) return null;

    const startEntry = corpus.nodes[startEntryIndex];
    const endEntry = corpus.nodes[endEntryIndex];

    // Calculate dense offsets inside the nodes
    function getDenseOffset(node, rawOffset) {
       const txt = node.nodeValue.substring(0, rawOffset);
       return txt.replace(/\s+/g, "").length;
    }

    const startOffsetDense = (range.startContainer === startEntry.node) ? getDenseOffset(range.startContainer, range.startOffset) : 0;
    const endOffsetDense = (range.endContainer === endEntry.node) ? getDenseOffset(range.endContainer, range.endOffset) : endEntry.end - endEntry.start;

    const globalStart = startEntry.start + startOffsetDense;
    const globalEnd = endEntry.start + endOffsetDense;

    return {
      globalStart,
      globalEnd,
      denseText: corpus.fullDense.substring(globalStart, globalEnd),
      snippet: range.toString()
    };
  }

  // --------------------------------------------------------------------------
  // VISUALIZER (Inline Styles + Safe DOM)
  // --------------------------------------------------------------------------

  function paintElement(el, type) {
    if (type === HIGHLIGHT_TYPE) {
      el.style.setProperty("background-color", "#ffeb3b", "important");
      el.style.setProperty("color", "#000", "important");
      el.style.setProperty("box-shadow", "0 0 0 1px #ffeb3b", "important");
      el.style.setProperty("border-radius", "2px", "important");
      el.style.setProperty("cursor", "pointer", "important");
      el.setAttribute(HIGHLIGHT_ATTR, HIGHLIGHT_TYPE);
    } else {
      el.style.setProperty("width", "8px", "important");
      el.style.setProperty("height", "8px", "important");
      el.style.setProperty("background-color", "#f59e0b", "important");
      el.style.setProperty("display", "inline-block", "important");
      el.style.setProperty("border-radius", "50%", "important");
      el.style.setProperty("margin-left", "2px", "important");
      el.style.setProperty("vertical-align", "middle", "important");
      el.style.setProperty("position", "relative", "important");
      el.style.setProperty("z-index", "2147483647", "important");
      el.className = DOT_CLASS;
      el.setAttribute(HIGHLIGHT_ATTR, "dot");
    }
  }

  function highlightRange(range, id) {
    if (document.querySelector(`span[${NOTE_ID_ATTR}="${id}"]`)) return;

    const nodes = [];
    try {
      const walker = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        { acceptNode: (n) => range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
      );
      
      if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
        nodes.push(range.startContainer);
      } else {
        while (walker.nextNode()) nodes.push(walker.currentNode);
      }
    } catch (e) { return; }

    let lastWrapper = null;
    nodes.forEach(node => {
        const isStart = (node === range.startContainer);
        const isEnd = (node === range.endContainer);
        const start = isStart ? range.startOffset : 0;
        const end = isEnd ? range.endOffset : node.nodeValue.length;

        if (start >= end) return;

        try {
            const span = document.createElement("span");
            paintElement(span, HIGHLIGHT_TYPE);
            span.setAttribute(NOTE_ID_ATTR, id);
            span.textContent = node.nodeValue.slice(start, end);

            const parent = node.parentNode;
            if (!parent || parent.getAttribute(HIGHLIGHT_ATTR) === HIGHLIGHT_TYPE) return;

            if (start > 0) parent.insertBefore(document.createTextNode(node.nodeValue.slice(0, start)), node);
            parent.insertBefore(span, node);
            if (end < node.nodeValue.length) parent.insertBefore(document.createTextNode(node.nodeValue.slice(end)), node);
            
            parent.removeChild(node);
            lastWrapper = span;
        } catch(e) {}
    });

    if (lastWrapper) {
        const dot = document.createElement("span");
        paintElement(dot, "dot");
        dot.setAttribute(NOTE_ID_ATTR, id);
        lastWrapper.appendChild(dot);
    }
    window.getSelection().removeAllRanges();
  }

  function removeHighlight(id) {
    document.querySelectorAll(`span.${DOT_CLASS}[${NOTE_ID_ATTR}="${id}"]`).forEach(el => el.remove());
    document.querySelectorAll(`span[${HIGHLIGHT_ATTR}="${HIGHLIGHT_TYPE}"][${NOTE_ID_ATTR}="${id}"]`).forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
  }

  // --------------------------------------------------------------------------
  // UI & EVENTS
  // --------------------------------------------------------------------------

  const host = document.createElement("div");
  host.setAttribute("data-contextmemo-ui", "1");
  host.style.all = "initial";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      .box { position: fixed; background: white; padding: 12px; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,0.2); z-index: 2147483647; width: 320px; font-family: sans-serif; border: 1px solid #ccc; }
      textarea { width: 100%; height: 80px; margin-top: 8px; border: 1px solid #ccc; border-radius: 4px; padding: 6px; box-sizing: border-box; resize: vertical; font-family: inherit; }
      .btns { display:flex; justify-content:space-between; margin-top:8px; }
      .right { display:flex; gap:8px; }
      button { padding:6px 10px; border-radius:6px; border:none; cursor:pointer; font-size:13px; }
      .save { background:#2563eb; color:#fff; }
      .cancel { background:#f3f4f6; }
      .delete { background:#ef4444; color:#fff; display:none; }
    </style>
    <div class="box" id="ui" style="display:none">
      <div style="font-weight:bold; font-size:14px;">Add Note</div>
      <textarea id="txt" placeholder="Add note..."></textarea>
      <div class="btns">
        <button class="delete" id="del">Delete</button>
        <div class="right">
          <button class="cancel" id="cancel">Cancel</button>
          <button class="save" id="save">Save</button>
        </div>
      </div>
    </div>
  `;

  const ui = shadow.querySelector("#ui");
  const txt = shadow.querySelector("#txt");
  const titleEl = shadow.querySelector(".box div");
  const btnSave = shadow.querySelector("#save");
  const btnDel = shadow.querySelector("#del");
  const btnCancel = shadow.querySelector("#cancel");

  function showUI(x, y, snippet, content = "", edit = false) {
    ui.style.display = "block";
    ui.style.left = x + "px";
    ui.style.top = y + "px";
    txt.value = content;
    txt.placeholder = snippet ? `Note for: "${snippet.substring(0, 20)}..."` : "Add note...";
    if (edit) {
      titleEl.textContent = "Edit Note";
      btnSave.textContent = "Update";
      btnDel.style.display = "inline-block";
    } else {
      titleEl.textContent = "Add Note";
      btnSave.textContent = "Save";
      btnDel.style.display = "none";
    }
    txt.focus();
  }

  function hideUI() {
    ui.style.display = "none";
    activeRange = null;
    editingNoteId = null;
  }

  // SAVE
  btnSave.addEventListener("click", safeAsync(async () => {
    if (editingNoteId) {
      await Storage.update(editingNoteId, { content: txt.value });
      hideUI();
      return;
    }
    if (!activeRange) { hideUI(); return; }
    
    const id = uid();
    const loc = serializeSelection(activeRange);
    if (!loc) { alert("Cannot anchor here."); hideUI(); return; }

    highlightRange(activeRange, id);

    await Storage.save({
      id,
      url: location.href,
      normalizedUrl: getCanonicalUrl(),
      content: txt.value,
      snippet: loc.snippet,
      locator: loc,
      createdAt: Date.now()
    });
    hideUI();
  }));

  // DELETE
  btnDel.addEventListener("click", safeAsync(async () => {
    if (editingNoteId) {
      removeHighlight(editingNoteId);
      await Storage.delete(editingNoteId);
      hideUI();
    }
  }));

  btnCancel.addEventListener("click", hideUI);

  // CLICK HANDLER
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const id = t.getAttribute(NOTE_ID_ATTR);
    const type = t.getAttribute(HIGHLIGHT_ATTR) || t.dataset.cmType;

    if (id && (type === HIGHLIGHT_TYPE || t.classList.contains(DOT_CLASS))) {
      e.preventDefault(); e.stopPropagation();
      const notes = await Storage.getForPage();
      const note = notes.find(n => n.id === id);
      if (note) {
        editingNoteId = id;
        showUI(e.clientX + window.scrollX, e.clientY + window.scrollY + 10, note.snippet, note.content, true);
      }
    }
  }, true);

  // MESSAGES
  chrome.runtime.onMessage.addListener((msg) => {
    if (!isExtensionAlive) return;
    if (msg.type === "OPEN_NOTE_UI") {
      const sel = window.getSelection();
      if (!sel.rangeCount) return alert("Select text first");
      activeRange = sel.getRangeAt(0).cloneRange();
      const rect = activeRange.getBoundingClientRect();
      showUI(rect.left + window.scrollX, rect.bottom + window.scrollY + 10, activeRange.toString());
    }
    if (msg.type === "DELETE_NOTE") removeHighlight(msg.id);
    if (msg.type === "OPEN_NOTE_VIEWER") {
      const el = document.querySelector(`span[${NOTE_ID_ATTR}="${msg.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.setProperty("background-color", "#ff9800", "important");
        setTimeout(() => el.style.setProperty("background-color", "#ffeb3b", "important"), 500);
      }
    }
  });

  // --------------------------------------------------------------------------
  // REHYDRATION LOOP (With Orphan Cleanup)
  // --------------------------------------------------------------------------

  async function rehydrate() {
    if (!chrome.runtime?.id || document.hidden) return;
    const notes = await Storage.getForPage();
    
    // 1. Draw Missing
    for (const note of notes) {
      if (document.querySelector(`span[${NOTE_ID_ATTR}="${note.id}"]`)) continue;
      
      // TRY: Dense Offset Strategy
      let range = null;
      try {
        const corpus = buildDenseCorpus();
        if(note.locator.globalStart != null) {
            range = denseRangeToDOMRange(note.locator.globalStart, note.locator.globalEnd, corpus);
        }
        // FALLBACK: Dense Text Search
        if (!range && note.locator.denseText) {
            const idx = corpus.fullDense.indexOf(note.locator.denseText);
            if(idx !== -1) range = denseRangeToDOMRange(idx, idx + note.locator.denseText.length, corpus);
        }
      } catch(e) {}

      if (range) highlightRange(range, note.id);
    }

    // 2. Cleanup Orphans
    const validIds = new Set(notes.map(n => n.id));
    document.querySelectorAll(`span[${HIGHLIGHT_ATTR}="${HIGHLIGHT_TYPE}"]`).forEach(el => {
      const id = el.getAttribute(NOTE_ID_ATTR);
      if (id && !validIds.has(id)) removeHighlight(id);
    });
  }

  // Observers
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.notes) rehydrate();
  });

  const observer = new MutationObserver(() => {
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(rehydrate, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(rehydrate, 500);
  setTimeout(rehydrate, 1500);

})();