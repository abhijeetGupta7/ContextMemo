/* global chrome */

console.log("ContextMemo: Master Engine v9 (Auto-Cleanup & Instant Delete)");

(function () {
  // --------------------------------------------------------------------------
  // 1. GLOBAL STATE
  // --------------------------------------------------------------------------
  
  let activeRange = null; 
  let isExtensionAlive = true; 
  let pollingInterval = null;
  let editingNoteId = null; 

  // --------------------------------------------------------------------------
  // 2. INLINE STYLE PAINTER
  // --------------------------------------------------------------------------
  
  function paintElement(element, type) {
      if (type === 'highlight') {
          element.style.setProperty("background-color", "#ffeb3b", "important");
          element.style.setProperty("color", "#000000", "important");
          element.style.setProperty("display", "inline", "important");
          element.style.setProperty("border-radius", "2px", "important");
          element.style.setProperty("box-shadow", "0 0 0 1px #ffeb3b", "important");
          element.style.setProperty("text-decoration", "none", "important");
          element.style.setProperty("border", "none", "important");
          element.style.setProperty("cursor", "pointer", "important");
          element.dataset.cmType = "highlight";
      } 
      else if (type === 'dot') {
          element.style.setProperty("width", "8px", "important");
          element.style.setProperty("height", "8px", "important");
          element.style.setProperty("background-color", "#f59e0b", "important");
          element.style.setProperty("display", "inline-block", "important");
          element.style.setProperty("border-radius", "50%", "important");
          element.style.setProperty("margin-left", "3px", "important");
          element.style.setProperty("vertical-align", "middle", "important");
          element.style.setProperty("position", "relative", "important");
          element.style.setProperty("z-index", "2147483647", "important");
          element.style.setProperty("cursor", "pointer", "important");
          element.className = "cm-dot"; 
          element.dataset.cmType = "dot";
      }
  }

  // --------------------------------------------------------------------------
  // 3. STORAGE
  // --------------------------------------------------------------------------

  function uid() { return "n_" + Math.random().toString(36).slice(2); }
  // Normalize URL to handle Wiki/GFG variations
  function normalizeUrl(url) {
      try {
          const u = new URL(url);
          u.hash = ''; 
          return u.hostname + u.pathname + u.search; 
      } catch (e) { return url; }
  }
  function currentUrl() { return location.href; }

  const Storage = {
    async save(note) {
        if (!chrome.runtime?.id) { isExtensionAlive = false; return; }
        try {
            const data = await new Promise((r) => chrome.storage.local.get({notes:[]}, r));
            data.notes.push(note);
            await new Promise((r) => chrome.storage.local.set(data, r));
        } catch (e) { isExtensionAlive = false; }
    },
    async update(id, content) {
        if (!chrome.runtime?.id) return;
        try {
            const data = await new Promise((r) => chrome.storage.local.get({notes:[]}, r));
            const idx = data.notes.findIndex(n => n.id === id);
            if (idx !== -1) {
                data.notes[idx].content = content;
                await new Promise((r) => chrome.storage.local.set(data, r));
            }
        } catch(e) {}
    },
    async delete(id) {
        if (!chrome.runtime?.id) return;
        try {
            const data = await new Promise((r) => chrome.storage.local.get({notes:[]}, r));
            const filtered = data.notes.filter(n => n.id !== id);
            await new Promise((r) => chrome.storage.local.set({notes: filtered}, r));
        } catch(e) {}
    },
    async get(pageUrl) {
        if (!chrome.runtime?.id) { isExtensionAlive = false; return []; }
        try {
            return new Promise((r) => {
                chrome.storage.local.get({notes:[]}, (d) => {
                    const normPage = normalizeUrl(pageUrl);
                    r(d.notes ? d.notes.filter(n => normalizeUrl(n.url) === normPage) : []);
                });
            });
        } catch (e) { isExtensionAlive = false; return []; }
    }
  };

  // --------------------------------------------------------------------------
  // 4. LOCATOR ENGINE
  // --------------------------------------------------------------------------

  function getDenseText(text) { return text.replace(/\s+/g, '').toLowerCase(); }

  function buildTextCorpus() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const tag = node.parentNode?.tagName;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT'].includes(tag)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const nodes = [];
    let fullText = "";
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, start: fullText.length, end: fullText.length + walker.currentNode.nodeValue.length, text: walker.currentNode.nodeValue });
      fullText += walker.currentNode.nodeValue;
    }
    return { nodes, fullText };
  }

  function serializeSelection(range) {
    const corpus = buildTextCorpus();
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
    const startOffset = (range.startContainer === startEntry.node) ? range.startOffset : 0;
    const endOffset = (range.endContainer === endEntry.node) ? range.endOffset : endEntry.text.length;

    const globalStart = startEntry.start + startOffset;
    const globalEnd = endEntry.start + endOffset;
    
    return {
      text: corpus.fullText.substring(globalStart, globalEnd),
      denseText: getDenseText(corpus.fullText.substring(globalStart, globalEnd)),
      prefix: getDenseText(corpus.fullText.substring(Math.max(0, globalStart - 60), globalStart)),
      snippet: range.toString()
    };
  }

  function locateRange(serialized) {
    if(!serialized) return null;
    const corpus = buildTextCorpus();
    const fullDense = getDenseText(corpus.fullText);
    const searchDense = serialized.denseText || getDenseText(serialized.text);
    
    let denseIdx = fullDense.indexOf(searchDense);
    let foundDenseStart = -1;

    while (denseIdx !== -1) {
        if(serialized.prefix) {
            const checkStart = Math.max(0, denseIdx - serialized.prefix.length - 10);
            const pagePrefix = fullDense.substring(checkStart, denseIdx);
            if (pagePrefix.includes(serialized.prefix) || serialized.prefix.includes(pagePrefix)) {
                 foundDenseStart = denseIdx;
                 break; 
            }
        } else { foundDenseStart = denseIdx; break; }
        denseIdx = fullDense.indexOf(searchDense, denseIdx + 1);
    }

    if (foundDenseStart === -1) foundDenseStart = fullDense.indexOf(searchDense); 
    if (foundDenseStart === -1) return null;

    let currentDenseCount = 0, startNode = null, endNode = null, startOffset = 0, endOffset = 0;
    const targetDenseEnd = foundDenseStart + searchDense.length;

    for (const entry of corpus.nodes) {
        const nodeDenseLen = getDenseText(entry.text).length;
        
        if (!startNode && (currentDenseCount + nodeDenseLen) > foundDenseStart) {
            startNode = entry.node;
            const charsNeeded = foundDenseStart - currentDenseCount;
            let dCount = 0;
            for(let i=0; i<entry.text.length; i++) {
                if(!/\s/.test(entry.text[i])) dCount++;
                if(dCount > charsNeeded) { startOffset = i; break; }
            }
        }
        if (!endNode && (currentDenseCount + nodeDenseLen) >= targetDenseEnd) {
            endNode = entry.node;
            const charsNeeded = targetDenseEnd - currentDenseCount;
            let dCount = 0;
            for(let i=0; i<entry.text.length; i++) {
                if(!/\s/.test(entry.text[i])) dCount++;
                if(dCount >= charsNeeded) { endOffset = i + 1; break; }
            }
        }
        currentDenseCount += nodeDenseLen;
        if (startNode && endNode) break;
    }

    if (!startNode || !endNode) return null;
    const r = document.createRange();
    try { r.setStart(startNode, startOffset); r.setEnd(endNode, endOffset); return r; } catch(e) { return null; }
  }

  // --------------------------------------------------------------------------
  // 5. VISUALIZER (Draw & Remove)
  // --------------------------------------------------------------------------

  function highlightRange(range, id) {
    if (document.querySelector(`span[data-note-id="${id}"]`)) return;

    const nodesToWrap = [];
    try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { 
            acceptNode: (node) => range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
            nodesToWrap.push(range.startContainer);
        } else {
            while(walker.nextNode()) nodesToWrap.push(walker.currentNode);
        }
    } catch(e) { return; }

    let lastWrapper = null;

    nodesToWrap.forEach((node) => {
        const isStart = (node === range.startContainer);
        const isEnd = (node === range.endContainer);
        let start = isStart ? range.startOffset : 0;
        let end = isEnd ? range.endOffset : node.nodeValue.length;

        if (start >= end) return;

        const span = document.createElement("span");
        paintElement(span, 'highlight'); 
        span.setAttribute("data-note-id", id);
        
        const text = node.nodeValue;
        span.textContent = text.substring(start, end);

        const parent = node.parentNode;
        if (!parent || parent.dataset.cmType === 'highlight') return;

        try {
            if (start > 0) parent.insertBefore(document.createTextNode(text.substring(0, start)), node);
            parent.insertBefore(span, node);
            if (end < text.length) parent.insertBefore(document.createTextNode(text.substring(end)), node);
            parent.removeChild(node);
            lastWrapper = span;
        } catch(e) {}
    });

    if (lastWrapper) {
        const dot = document.createElement("span");
        paintElement(dot, 'dot');
        dot.setAttribute("data-note-id", id); 
        lastWrapper.appendChild(dot);
    }
    
    const sel = window.getSelection();
    if(sel) sel.removeAllRanges();
  }

  // --- FIXED REMOVE FUNCTION ---
  function removeHighlight(id) {
      console.log("Removing note ID:", id);
      
      // 1. Remove all dots specifically first
      const dots = document.querySelectorAll(`span.cm-dot[data-note-id="${id}"]`);
      dots.forEach(d => d.remove());

      // 2. Unwrap all highlights
      const highlights = document.querySelectorAll(`span[data-cm-type="highlight"][data-note-id="${id}"]`);
      
      highlights.forEach(el => {
          const parent = el.parentNode;
          if (!parent) return; 
          
          // Unwrap: Move text out
          while(el.firstChild) {
              parent.insertBefore(el.firstChild, el);
          }
          parent.removeChild(el);
          parent.normalize(); // Merge broken text nodes back together
      });
  }

  // --------------------------------------------------------------------------
  // 6. UI
  // --------------------------------------------------------------------------

  const host = document.createElement("div");
  host.style.all = "initial";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({mode:'open'});

  shadow.innerHTML = `
    <style>
      .box {
        position: fixed; background: white; padding: 12px; border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3); z-index: 2147483647;
        width: 280px; font-family: sans-serif; border: 1px solid #ccc;
      }
      textarea { width: 100%; height: 60px; margin-top: 8px; box-sizing: border-box; font-family: inherit; }
      .btns { display: flex; justify-content: space-between; margin-top: 8px; }
      .right { display: flex; gap: 8px; }
      button { padding: 5px 10px; cursor: pointer; border-radius: 4px; border: none; }
      .save { background: #2563eb; color: white; }
      .cancel { background: #eee; }
      .delete { background: #ef4444; color: white; display: none; }
    </style>
    <div class="box" id="ui" style="display:none">
      <div style="font-weight:bold; color:black;" id="title">Add Note</div>
      <textarea id="txt"></textarea>
      <div class="btns">
        <button class="delete" id="del">Delete</button>
        <div class="right">
            <button class="cancel">Cancel</button>
            <button class="save" id="save">Save</button>
        </div>
      </div>
    </div>
  `;
  
  const ui = shadow.querySelector('#ui');
  const textarea = shadow.querySelector('#txt');
  const title = shadow.querySelector('#title');
  const saveBtn = shadow.querySelector('#save');
  const delBtn = shadow.querySelector('#del');

  function showUI(x, y, snippet, prefill = null, isEdit = false) {
    ui.style.left = x + 'px';
    ui.style.top = y + 'px';
    ui.style.display = 'block';
    
    if (isEdit) {
        title.textContent = "Edit Note";
        saveBtn.textContent = "Update";
        delBtn.style.display = "block";
        textarea.value = prefill || "";
    } else {
        title.textContent = "Add Note";
        saveBtn.textContent = "Save";
        delBtn.style.display = "none";
        textarea.value = "";
    }
    textarea.placeholder = snippet ? `Note for: "${snippet.substring(0, 20)}..."` : 'Enter note...';
    textarea.focus();
  }

  function hideUI() {
    ui.style.display = 'none';
    activeRange = null; 
    editingNoteId = null;
  }

  // --------------------------------------------------------------------------
  // 7. EVENTS & CLICK HANDLING
  // --------------------------------------------------------------------------

  document.addEventListener('click', async (e) => {
      const target = e.target;
      const noteId = target.getAttribute('data-note-id'); 

      if (noteId && (target.dataset.cmType === 'highlight' || target.classList.contains('cm-dot'))) {
          e.preventDefault();
          e.stopPropagation();

          const notes = await Storage.get(currentUrl());
          const note = notes.find(n => n.id === noteId);

          if (note) {
              editingNoteId = noteId; 
              let x = e.clientX + window.scrollX;
              let y = e.clientY + window.scrollY + 15;
              if (x + 300 > window.innerWidth) x = window.innerWidth - 310;
              
              showUI(x, y, note.snippet, note.content, true);
          }
      }
  }, true); 

  saveBtn.addEventListener('click', async () => {
    if (editingNoteId) {
        await Storage.update(editingNoteId, textarea.value);
        hideUI();
        return;
    }
    if(!activeRange) return hideUI();
    const id = uid();
    const serialized = serializeSelection(activeRange);
    if (!serialized) return alert("Selection failed");

    highlightRange(activeRange, id);
    await Storage.save({
        id,
        url: currentUrl(),
        content: textarea.value,
        snippet: serialized.snippet, 
        locator: serialized,
        createdAt: Date.now()
    });
    hideUI();
  });

  // DELETE HANDLER (Triggers instant removal)
  delBtn.addEventListener('click', async () => {
      if (editingNoteId) {
          // 1. Remove Visuals Instantly
          removeHighlight(editingNoteId);
          // 2. Update Storage
          await Storage.delete(editingNoteId);
          hideUI();
      }
  });

  shadow.querySelector('.cancel').addEventListener('click', hideUI);

  chrome.runtime.onMessage.addListener((msg) => {
    if (!isExtensionAlive) return;

    if (msg.type === 'OPEN_NOTE_UI') {
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed) return alert("Select text first");
        
        activeRange = sel.getRangeAt(0).cloneRange();
        const rect = activeRange.getBoundingClientRect();
        
        let x = rect.left + window.scrollX;
        let y = rect.bottom + window.scrollY + 10;
        if (x + 300 > window.innerWidth) x = window.innerWidth - 310;

        showUI(x, y, activeRange.toString(), null, false);
    }
    if (msg.type === 'DELETE_NOTE') {
        removeHighlight(msg.id);
        Storage.delete(msg.id);
    }
    if (msg.type === 'OPEN_NOTE_VIEWER') {
        const el = document.querySelector(`span[data-note-id="${msg.id}"]`);
        if (el) {
            el.scrollIntoView({behavior:'smooth', block:'center'});
            el.style.setProperty("background-color", "#ff9800", "important");
            setTimeout(() => el.style.setProperty("background-color", "#ffeb3b", "important"), 500);
        }
    }
  });

  // --------------------------------------------------------------------------
  // 8. GARBAGE COLLECTOR (Orphan Cleaner)
  // --------------------------------------------------------------------------

  async function rehydrate() {
    if (!isExtensionAlive || document.hidden) return;
    const notes = await Storage.get(currentUrl());
    
    // 1. ADD missing highlights
    for (const note of notes) {
        const range = locateRange(note.locator);
        if (range) highlightRange(range, note.id);
    }

    // 2. CLEANUP orphans (Visuals that have no database entry)
    // This fixes the issue where delete works partially or comes back
    const allHighlights = document.querySelectorAll('span[data-cm-type="highlight"]');
    const validIds = new Set(notes.map(n => n.id));
    
    allHighlights.forEach(el => {
        const id = el.getAttribute('data-note-id');
        if (!validIds.has(id)) {
            // It's an orphan! Kill it.
            removeHighlight(id);
        }
    });
  }

  let attempts = 0;
  pollingInterval = setInterval(() => {
      if (!isExtensionAlive || !chrome.runtime?.id) { clearInterval(pollingInterval); return; }
      rehydrate();
      attempts++;
      if (attempts > 15) clearInterval(pollingInterval);
  }, 1000);

  const observer = new MutationObserver((mutations) => {
      if (!isExtensionAlive) { observer.disconnect(); return; }
      for(const m of mutations) {
          if (m.addedNodes.length > 0) {
              rehydrate();
              break;
          }
      }
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();