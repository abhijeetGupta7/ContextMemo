/* global chrome */

console.log("ContextMemo: Master Engine v6 (Edit & Update Enabled)");

(function () {
  // --------------------------------------------------------------------------
  // 1. GLOBAL STATE
  // --------------------------------------------------------------------------
  
  let activeRange = null; 
  let isExtensionAlive = true; 
  let pollingInterval = null;
  
  // State for Editing
  let editingNoteId = null; // If not null, we are in "Edit Mode"

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
          element.style.setProperty("cursor", "pointer", "important"); // Make dot clickable
          element.className = "cm-dot"; 
      }
  }

  // --------------------------------------------------------------------------
  // 3. STORAGE (Create, Read, Update, Delete)
  // --------------------------------------------------------------------------

  function uid() { return "n_" + Math.random().toString(36).slice(2); }
  function currentUrl() { return location.href.split('#')[0]; }

  const Storage = {
    async save(note) {
        if (!chrome.runtime?.id) { isExtensionAlive = false; return; }
        try {
            const data = await new Promise((r) => chrome.storage.local.get({notes:[]}, r));
            data.notes.push(note);
            await new Promise((r) => chrome.storage.local.set(data, r));
        } catch (e) { isExtensionAlive = false; }
    },
    // NEW: Update function
    async update(id, newContent) {
        if (!chrome.runtime?.id) return;
        const data = await new Promise((r) => chrome.storage.local.get({notes:[]}, r));
        const index = data.notes.findIndex(n => n.id === id);
        if (index !== -1) {
            data.notes[index].content = newContent;
            data.notes[index].updatedAt = Date.now();
            await new Promise((r) => chrome.storage.local.set(data, r));
            console.log("ContextMemo: Note updated");
        }
    },
    // NEW: Delete function
    async delete(id) {
        if (!chrome.runtime?.id) return;
        const data = await new Promise((r) => chrome.storage.local.get({notes:[]}, r));
        const newNotes = data.notes.filter(n => n.id !== id);
        await new Promise((r) => chrome.storage.local.set({notes: newNotes}, r));
    },
    async get(url) {
        if (!chrome.runtime?.id) { isExtensionAlive = false; return []; }
        try {
            return new Promise((resolve) => {
                chrome.storage.local.get({notes:[]}, (d) => {
                    resolve(d.notes ? d.notes.filter(n => n.url === url) : []);
                });
            });
        } catch (e) { isExtensionAlive = false; return []; }
    }
  };

  // --------------------------------------------------------------------------
  // 4. HYBRID LOCATOR ENGINE
  // --------------------------------------------------------------------------

  function getDenseText(text) {
      return text.replace(/\s+/g, '').toLowerCase();
  }

  function buildTextCorpus() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const tag = node.parentNode?.tagName;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'META'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    let fullText = "";
    
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const val = node.nodeValue;
      nodes.push({
        node: node,
        start: fullText.length,
        end: fullText.length + val.length,
        text: val 
      });
      fullText += val;
    }
    return { nodes, fullText };
  }

  function serializeSelection(range) {
    const corpus = buildTextCorpus();
    let startEntryIndex = -1;
    let endEntryIndex = -1;

    for (let i = 0; i < corpus.nodes.length; i++) {
        if (range.intersectsNode(corpus.nodes[i].node)) {
            if (startEntryIndex === -1) startEntryIndex = i;
            endEntryIndex = i;
        }
    }

    if (startEntryIndex === -1) return null;

    const startEntry = corpus.nodes[startEntryIndex];
    const endEntry = corpus.nodes[endEntryIndex];

    let startOffset = (range.startContainer === startEntry.node) ? range.startOffset : 0;
    let endOffset = (range.endContainer === endEntry.node) ? range.endOffset : endEntry.text.length;

    const globalStart = startEntry.start + startOffset;
    const globalEnd = endEntry.start + endOffset;
    
    const selectedText = corpus.fullText.substring(globalStart, globalEnd);
    const contextLen = 60;
    const prefixStart = Math.max(0, globalStart - contextLen);
    const suffixEnd = Math.min(corpus.fullText.length, globalEnd + contextLen);
    
    return {
      text: selectedText,
      denseText: getDenseText(selectedText),
      prefix: getDenseText(corpus.fullText.substring(prefixStart, globalStart)),
      suffix: getDenseText(corpus.fullText.substring(globalEnd, suffixEnd)),
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
        if (serialized.prefix) {
            const checkStart = Math.max(0, denseIdx - serialized.prefix.length - 10);
            const pagePrefix = fullDense.substring(checkStart, denseIdx);
            
            if (pagePrefix.includes(serialized.prefix) || serialized.prefix.includes(pagePrefix) || 
                pagePrefix.slice(-10) === serialized.prefix.slice(-10)) {
                 foundDenseStart = denseIdx;
                 break; 
            }
        } else {
            foundDenseStart = denseIdx;
            break;
        }
        denseIdx = fullDense.indexOf(searchDense, denseIdx + 1);
    }

    if (foundDenseStart === -1) {
        foundDenseStart = fullDense.indexOf(searchDense);
    }

    if (foundDenseStart === -1) return null;

    let currentDenseCount = 0;
    let startNode = null, endNode = null;
    let startOffset = 0, endOffset = 0;
    
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
    try {
        r.setStart(startNode, startOffset);
        r.setEnd(endNode, endOffset);
        return r;
    } catch(e) { return null; }
  }

  // --------------------------------------------------------------------------
  // 5. VISUALIZER
  // --------------------------------------------------------------------------

  function highlightRange(range, id) {
    if (document.querySelector(`span[data-note-id="${id}"]`)) return;

    const nodesToWrap = [];
    try {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            { 
                acceptNode: (node) => {
                    return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            }
        );
        
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

        if (start < 0) start = 0;
        if (end > node.nodeValue.length) end = node.nodeValue.length;
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
        } catch(e) { }
    });

    if (lastWrapper) {
        const dot = document.createElement("span");
        paintElement(dot, 'dot');
        dot.setAttribute("data-note-id", id); // ID on dot for click detection
        lastWrapper.appendChild(dot);
    }
    
    const sel = window.getSelection();
    if(sel) sel.removeAllRanges();
  }

  function removeHighlight(id) {
      const els = document.querySelectorAll(`span[data-note-id="${id}"]`);
      els.forEach(el => {
          // Remove the dot first (it's a child)
          const dot = el.querySelector('.cm-dot');
          if(dot) dot.remove();
          
          const parent = el.parentNode;
          while(el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
          parent.normalize(); 
      });
  }

  // --------------------------------------------------------------------------
  // 6. UI & MAIN LOGIC (Updated for Edit Mode)
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
      textarea { width: 100%; height: 60px; margin-top: 8px; box-sizing: border-box; font-family: inherit; resize: vertical;}
      .btns { display: flex; justify-content: space-between; margin-top: 8px; align-items: center; }
      .right-btns { display: flex; gap: 8px; }
      button { padding: 5px 10px; cursor: pointer; border-radius: 4px; border: none; }
      .save { background: #2563eb; color: white; }
      .cancel { background: #eee; }
      .delete { background: #ef4444; color: white; display: none; } /* Hidden by default */
    </style>
    <div class="box" id="ui" style="display:none">
      <div style="font-weight:bold; color:black;" id="title">Add Note</div>
      <textarea id="txt"></textarea>
      <div class="btns">
        <button class="delete" id="delBtn">Delete</button>
        <div class="right-btns">
            <button class="cancel">Cancel</button>
            <button class="save" id="saveBtn">Save</button>
        </div>
      </div>
    </div>
  `;
  
  const ui = shadow.querySelector('#ui');
  const textarea = shadow.querySelector('#txt');
  const title = shadow.querySelector('#title');
  const saveBtn = shadow.querySelector('#saveBtn');
  const delBtn = shadow.querySelector('#delBtn');

  function showUI(x, y, snippet, prefill = null, isEdit = false) {
    ui.style.left = x + 'px';
    ui.style.top = y + 'px';
    ui.style.display = 'block';
    
    // Set State
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
    editingNoteId = null; // Reset edit state
  }

  // SAVE / UPDATE HANDLER
  saveBtn.addEventListener('click', async () => {
    // CASE A: Updating Existing Note
    if (editingNoteId) {
        await Storage.update(editingNoteId, textarea.value);
        hideUI();
        return;
    }

    // CASE B: Creating New Note
    if(!activeRange) return hideUI();
    
    const id = uid();
    const serialized = serializeSelection(activeRange);

    if (!serialized) {
        alert("Selection too complex.");
        hideUI();
        return;
    }

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

  // DELETE HANDLER (Inside Edit Mode)
  delBtn.addEventListener('click', async () => {
      if (editingNoteId) {
          removeHighlight(editingNoteId);
          await Storage.delete(editingNoteId);
          hideUI();
      }
  });

  shadow.querySelector('.cancel').addEventListener('click', hideUI);

  // --------------------------------------------------------------------------
  // 7. CLICK-TO-EDIT & REHYDRATION
  // --------------------------------------------------------------------------

  // Click Listener for Editing
  document.addEventListener('click', async (e) => {
      // Check if clicking a Highlight or a Dot
      const target = e.target;
      const noteId = target.getAttribute('data-note-id');

      if (noteId && (target.dataset.cmType === 'highlight' || target.classList.contains('cm-dot'))) {
          e.preventDefault();
          e.stopPropagation();

          // Fetch note content
          const notes = await Storage.get(currentUrl());
          const note = notes.find(n => n.id === noteId);

          if (note) {
              editingNoteId = noteId; // Enter Edit Mode
              // Position near the click
              let x = e.clientX + window.scrollX;
              let y = e.clientY + window.scrollY + 15;
              if (x + 300 > window.innerWidth) x = window.innerWidth - 310;
              
              showUI(x, y, note.snippet, note.content, true);
          }
      }
  }, true); // Use capture phase to ensure we catch it

  async function rehydrate() {
    if (!isExtensionAlive || document.hidden) return;
    const notes = await Storage.get(currentUrl());
    
    for (const note of notes) {
        const range = locateRange(note.locator);
        if (range) highlightRange(range, note.id);
    }
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

  chrome.runtime.onMessage.addListener((msg) => {
    if (!isExtensionAlive || !chrome.runtime?.id) return;

    if (msg.type === 'OPEN_NOTE_UI') {
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed) return alert("Select text first");
        
        activeRange = sel.getRangeAt(0).cloneRange();
        const rect = activeRange.getBoundingClientRect();
        
        let x = rect.left + window.scrollX;
        let y = rect.bottom + window.scrollY + 10;
        if (x + 300 > window.innerWidth) x = window.innerWidth - 310;

        showUI(x, y, activeRange.toString(), null, false); // false = Create Mode
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

})();