import React, { useEffect, useState, useMemo } from "react";

export default function App() {
  const [notes, setNotes] = useState([]);
  const [currentNormalizedUrl, setCurrentNormalizedUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState("page"); // 'page' or 'all'
  const [loading, setLoading] = useState(true);

  // --- 1. URL NORMALIZER (Must match content.js logic exactly) ---
  function getCanonicalUrl(url) {
    try {
        if (!url) return "";
        const u = new URL(url);
        // Strip protocol, search params, hash, and trailing slash for consistent matching
        return (u.hostname + u.pathname).replace(/\/$/, "").toLowerCase();
    } catch (e) { return (url || "").toLowerCase(); }
  }

  // --- 2. DATA LOADING & SYNC ---
  const loadNotes = async () => {
    try {
      chrome.storage.local.get({ notes: [] }, (result) => {
        if (chrome.runtime.lastError) {
          console.error("Storage error:", chrome.runtime.lastError);
          setLoading(false);
          return;
        }
        setNotes(result.notes || []);
        setLoading(false);
      });
    } catch (e) {
      console.error("Failed to load notes", e);
      setLoading(false);
    }
  };

  function fetchCurrentTabUrl() {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const rawUrl = tabs[0].url || "";
      // Store the NORMALIZED version for filtering
      setCurrentNormalizedUrl(getCanonicalUrl(rawUrl));
    });
  }

  useEffect(() => {
    fetchCurrentTabUrl();
    loadNotes();

    // Real-time sync listener
    const onChanged = (changes, area) => {
      if (area === "local" && changes.notes) {
        setNotes(changes.notes.newValue || []);
      }
    };

    // Refresh data when popup opens/focuses
    const onFocus = () => { loadNotes(); fetchCurrentTabUrl(); };

    try {
      chrome.storage.onChanged.addListener(onChanged);
      window.addEventListener('focus', onFocus);
    } catch (e) {}

    return () => {
      try {
        chrome.storage.onChanged.removeListener(onChanged);
        window.removeEventListener('focus', onFocus);
      } catch (e) {}
    };
  }, []);

  // --- 3. FILTERING LOGIC ---

  const notesForPage = useMemo(
    () => notes.filter((n) => {
        const noteNorm = n.normalizedUrl || getCanonicalUrl(n.url);
        return noteNorm === currentNormalizedUrl;
    }),
    [notes, currentNormalizedUrl]
  );

  const filteredPage = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notesForPage;
    return notesForPage.filter((n) =>
      (n.content + " " + (n.snippet || "")).toLowerCase().includes(q)
    );
  }, [notesForPage, filter]);

  const filteredGlobal = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) =>
      (n.content + " " + (n.snippet || "") + " " + n.url).toLowerCase().includes(q)
    );
  }, [notes, filter]);

  // --- 4. ACTIONS (Delete & Open) ---

  async function deleteNote(noteId) {
    // Optimistic UI Update
    setNotes((prev) => prev.filter((n) => n.id !== noteId));

    chrome.storage.local.get({ notes: [] }, (res) => {
      const remaining = (res.notes || []).filter((n) => n.id !== noteId);
      chrome.storage.local.set({ notes: remaining }, () => {
        // Notify content script
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          if (!tabs || tabs.length === 0) return;
          chrome.tabs.sendMessage(tabs[0].id, { type: "DELETE_NOTE", id: noteId }, () => {
             if(chrome.runtime.lastError) {} 
          });
        });
      });
    });
  }

  function openNoteInPage(note) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const activeTab = tabs[0];
      
      const activeNorm = getCanonicalUrl(activeTab.url || "");
      const noteNorm = note.normalizedUrl || getCanonicalUrl(note.url || "");

      if (activeNorm === noteNorm) {
        chrome.tabs.sendMessage(activeTab.id, {
          type: "OPEN_NOTE_VIEWER",
          id: note.id,
        });
        return;
      }

      chrome.tabs.create({ url: note.url }, (newTab) => {
        if (!newTab?.id) return;
        
        const listener = (updatedTabId, changeInfo) => {
          if (updatedTabId === newTab.id && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(() => {
                chrome.tabs.sendMessage(newTab.id, {
                type: "OPEN_NOTE_VIEWER",
                id: note.id,
                });
            }, 1000);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
            try { chrome.tabs.onUpdated.removeListener(listener); } catch(e){}
        }, 20000);
      });
    });
  }

  // --- 5. EXPORT LOGIC ---

  const handleExport = (format) => {
    const dataToExport = mode === 'page' ? filteredPage : filteredGlobal;
    
    if (dataToExport.length === 0) {
      alert("No notes to export in current view.");
      return;
    }

    let content = "";
    let mimeType = "text/plain";
    let extension = "txt";

    const cleanAndTruncate = (text, maxLength = 300) => {
        if (!text) return "";
        let clean = text.replace(/\s+/g, ' ').trim();
        if (clean.length > maxLength) return clean.substring(0, maxLength) + " ...";
        return clean;
    };

    if (format === 'json') {
      content = JSON.stringify(dataToExport, null, 2);
      mimeType = "application/json";
      extension = "json";
    } else if (format === 'md') {
      mimeType = "text/markdown";
      extension = "md";
      
      const grouped = {};
      dataToExport.forEach(n => {
        if(!grouped[n.url]) grouped[n.url] = [];
        grouped[n.url].push(n);
      });

      content = `# 📝 ContextMemo Export\n\n`;
      content += `_Generated: ${new Date().toLocaleString()}_\n\n`;
      content += `---\n\n`;
      
      Object.keys(grouped).forEach(url => {
        let cleanUrl = url;
        try { cleanUrl = decodeURIComponent(url); } catch(e){}

        content += `## 🔗 [${cleanUrl}](${url})\n\n`;
        
        grouped[url].forEach((n) => {
          const safeSnippet = cleanAndTruncate(n.snippet, 300);
          
          content += `> ❝ ${safeSnippet} ❞\n\n`; 
          
          if (n.content) {
            content += `**📝 Note:** ${n.content}\n\n`;
          } else {
            content += `*(No comment added)*\n\n`;
          }

          content += `_<small>${new Date(n.createdAt).toLocaleString()}</small>_\n`;
          content += `\n---\n\n`; 
        });
      });
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contextmemo_export_${new Date().toISOString().slice(0,10)}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- 6. RENDER UI ---

  return (
    <div className="min-w-[350px] max-w-[450px] p-4 font-sans text-sm bg-white">
      {/* Header */}
      <header className="flex items-center justify-between mb-4 border-b pb-3">
        <h1 className="text-base font-bold text-gray-800">ContextMemo</h1>
        <div className="flex gap-2">
            <button onClick={() => handleExport('json')} className="text-[10px] bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-600 font-medium" title="Export JSON">JSON</button>
            <button onClick={() => handleExport('md')} className="text-[10px] bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-600 font-medium" title="Export Markdown">MD</button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="flex gap-2 mb-3">
        <button
          className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
            mode === "page" 
                ? "bg-blue-50 border-blue-200 text-blue-700 font-medium" 
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
          onClick={() => setMode("page")}
        >
          This Page
        </button>
        <button
          className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
            mode === "all" 
                ? "bg-blue-50 border-blue-200 text-blue-700 font-medium" 
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
          onClick={() => setMode("all")}
        >
          All Notes
        </button>
      </div>

      {/* Search Bar */}
      <input
        className="w-full px-3 py-2 border border-gray-200 rounded-lg mb-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        placeholder="Search notes..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {/* Note List Container */}
      <div className="max-h-[350px] overflow-y-auto pr-1 custom-scrollbar space-y-3">
        {loading && (
          <div className="text-center text-gray-500 py-6">Loading notes...</div>
        )}

        {/* List for "This Page" */}
        {!loading && mode === "page" && (
          <div>
            {filteredPage.length === 0 && (
              <div className="text-center text-gray-400 py-4 italic">
                No notes found for this page.
              </div>
            )}
            {filteredPage.map((note) => (
              <NoteItem 
                key={note.id} 
                note={note} 
                onOpen={() => openNoteInPage(note)} 
                onDelete={() => deleteNote(note.id)} 
              />
            ))}
          </div>
        )}

        {/* List for "All Notes" */}
        {!loading && mode === "all" && (
          <div>
            {filteredGlobal.length === 0 && (
              <div className="text-center text-gray-400 py-4 italic">
                No notes found.
              </div>
            )}
            {filteredGlobal.map((note) => (
              <NoteItem 
                key={note.id} 
                note={note} 
                showUrl={true}
                onOpen={() => openNoteInPage(note)} 
                onDelete={() => deleteNote(note.id)} 
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Footer Status */}
      <div className="mt-3 pt-2 border-t text-xs text-gray-400 flex justify-between">
         <span>{notes.length} total notes</span>
         <span className="text-green-600">Sync Active</span>
      </div>
    </div>
  );
}

// Sub-component for individual note card
function NoteItem({ note, showUrl, onOpen, onDelete }) {
    return (
        <div className="border border-gray-200 rounded-lg p-3 mb-2 bg-white hover:shadow-sm transition-shadow">
            {showUrl && (
                <div className="text-xs text-blue-600 mb-1 truncate font-medium bg-blue-50 px-1 py-0.5 rounded inline-block max-w-full">
                    {note.url}
                </div>
            )}
            {/* Snippet Preview */}
            <div className="text-xs font-semibold text-gray-500 mb-1 border-l-2 border-yellow-400 pl-2 italic">
                "{note.snippet ? (note.snippet.length > 80 ? note.snippet.substring(0, 80) + "..." : note.snippet) : "..."}"
            </div>
            {/* Note Content */}
            <div className="text-sm text-gray-800 mb-2 font-medium">
                {note.content || <span className="text-gray-400 italic">Empty note</span>}
            </div>
            {/* Footer Actions */}
            <div className="flex justify-between items-center mt-2">
                <div className="text-[10px] font-bold text-gray-600">
                    {new Date(note.createdAt).toLocaleDateString()}
                </div>
                <div className="flex gap-2">
                    <button
                        className="px-2 py-1 text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                        onClick={onOpen}
                        title="Go to highlight"
                    >
                        Jump to
                    </button>
                    <button
                        className="px-2 py-1 font-extrabold text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded transition-colors"
                        onClick={onDelete}
                        title="Remove note"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}