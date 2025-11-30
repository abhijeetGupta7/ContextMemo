import React, { useEffect, useState, useMemo } from "react";

// POP UP
export default function App() {
  const [notes, setNotes] = useState([]); // all notes
  const [currentUrl, setCurrentUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState("page"); // 'page' or 'all'
  const [loading, setLoading] = useState(true);

  // load all notes from chrome.storage
  async function loadNotes() {
    try {
      chrome.storage.local.get({ notes: [] }, (result) => {
        setNotes(result.notes || []);
        setLoading(false);
      });
    } catch (e) {
      console.error("Failed to load notes", e);
      setLoading(false);
    }
  }

  // get current active tab URL
  function fetchCurrentTabUrl() {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return setCurrentUrl("");
      setCurrentUrl(tabs[0].url || "");
    });
  }

  useEffect(() => {
    fetchCurrentTabUrl();
    loadNotes();

    // real-time sync across tabs
    const onChanged = (changes, area) => {
      if (area === "local" && changes.notes) {
        setNotes(changes.notes.newValue || []);
      }
    };
    try {
      chrome.storage.onChanged.addListener(onChanged);
    } catch (e) {}

    return () => {
      try {
        chrome.storage.onChanged.removeListener(onChanged);
      } catch (e) {}
    };
  }, []);

  // --- DERIVED LISTS ---

  // Notes only for current page
  const notesForPage = useMemo(
    () => notes.filter((n) => n.url === currentUrl),
    [notes, currentUrl]
  );

  // SEARCH applied inside "This Page"
  const filteredPage = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notesForPage;
    return notesForPage.filter((n) =>
      (n.content + " " + n.snippet).toLowerCase().includes(q)
    );
  }, [notesForPage, filter]);

  // SEARCH applied to all notes (global)
  const filteredGlobal = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) =>
      (n.content + " " + n.snippet + " " + n.url).toLowerCase().includes(q)
    );
  }, [notes, filter]);

  // --- ACTIONS ---

  async function deleteNote(noteId) {
    setNotes((prev) => prev.filter((n) => n.id !== noteId)); // optimistic UI

    chrome.storage.local.get({ notes: [] }, (res) => {
      const remaining = (res.notes || []).filter((n) => n.id !== noteId);
      chrome.storage.local.set({ notes: remaining }, () => {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          if (!tabs || tabs.length === 0) return;
          const tabId = tabs[0].id;
          chrome.tabs.sendMessage(tabId, { type: "DELETE_NOTE", id: noteId }, () => {
            if (chrome.runtime.lastError) {}
          });
        });
      });
    });
  }

  function normalizeForCompare(u) {
    try {
      const url = new URL(u);
      return url.origin + url.pathname.replace(/\/$/, "");
    } catch (e) {
      return u;
    }
  }

  function openNoteInPage(note) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const activeTab = tabs[0];
      const activeNormalized = normalizeForCompare(activeTab.url || "");
      const noteNormalized = normalizeForCompare(note.url || "");

      // same page
      if (activeNormalized === noteNormalized) {
        chrome.tabs.sendMessage(activeTab.id, {
          type: "OPEN_NOTE_VIEWER",
          id: note.id,
        });
        return;
      }

      // open tab → wait → jump to highlight
      chrome.tabs.create({ url: note.url }, (newTab) => {
        if (!newTab || !newTab.id) return;
        const tabId = newTab.id;

        const listener = (updatedTabId, changeInfo) => {
          if (updatedTabId === tabId && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.sendMessage(tabId, {
              type: "OPEN_NOTE_VIEWER",
              id: note.id,
            });
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          try {
            chrome.tabs.onUpdated.removeListener(listener);
          } catch (e) {}
        }, 20000);
      });
    });
  }

// --- EXPORT LOGIC (BONUS FEATURE) ---

// --- EXPORT LOGIC (BONUS FEATURE) ---

  const handleExport = (format) => {
    const dataToExport = mode === 'page' ? filteredPage : filteredGlobal;
    
    if (dataToExport.length === 0) {
      alert("No notes to export in current view.");
      return;
    }

    let content = "";
    let mimeType = "text/plain";
    let extension = "txt";

    // Helper: Clean up text (remove code blocks, excessive spaces)
    const cleanAndTruncate = (text, maxLength = 150) => {
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
        let cleanUrl = decodeURIComponent(url);
        
        // The Page Title (Clickable)
        content += `## 🔗 [${cleanUrl}](${url})\n\n`;
        
        grouped[url].forEach((n) => {
          const safeSnippet = cleanAndTruncate(n.snippet, 300); // Increased limit slightly
          
          // The Blockquote (The text you highlighted)
          content += `> ❝ ${safeSnippet} ❞\n\n`; 
          
          // Your Note
          if (n.content) {
            content += `**📝 Note:** ${n.content}\n\n`;
          } else {
            content += `*(No comment added)*\n\n`;
          }

          // Metadata footer for this specific note
          content += `_<small>${new Date(n.createdAt).toLocaleString()}</small>_\n`;
          
          // Separator between notes on the same page
          content += `\n---\n\n`; 
        });
      });
    }

    // Trigger Download
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
  
  return (
    <div className="min-w-[320px] max-w-[420px] p-3 font-sans text-sm bg-white">
      <header className="flex items-center justify-between mb-3 border-b pb-2">
        <h1 className="text-base font-bold text-gray-800">ContextMemo</h1>
        <div className="flex gap-2">
            <button 
                onClick={() => handleExport('json')} 
                className="text-[10px] bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-600 font-medium"
                title="Export as JSON"
            >
                JSON
            </button>
            <button 
                onClick={() => handleExport('md')} 
                className="text-[10px] bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-600 font-medium"
                title="Export as Markdown"
            >
                MD
            </button>
        </div>
      </header>

      <div className="flex gap-2 mb-3">
        <button
          className={`px-3 py-1 rounded border transition-colors ${
            mode === "page" 
                ? "bg-blue-50 border-blue-200 text-blue-700 font-medium" 
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
          onClick={() => setMode("page")}
        >
          This Page
        </button>
        <button
          className={`px-3 py-1 rounded border transition-colors ${
            mode === "all" 
                ? "bg-blue-50 border-blue-200 text-blue-700 font-medium" 
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
          onClick={() => setMode("all")}
        >
          All Notes
        </button>
      </div>

      <input
        className="w-full px-3 py-2 border border-gray-300 rounded mb-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        placeholder="Filter notes..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      <div className="max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
        {loading && (
          <div className="text-center text-gray-500 py-6">Loading notes...</div>
        )}

        {/* -------- THIS PAGE MODE -------- */}
        {!loading && mode === "page" && (
          <div>
            {filteredPage.length === 0 && (
              <div className="text-center text-gray-400 py-4 italic">No notes found for this page.</div>
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

        {/* -------- ALL NOTES MODE -------- */}
        {!loading && mode === "all" && (
          <div>
            {filteredGlobal.length === 0 && (
              <div className="text-center text-gray-400 py-4 italic">No notes found.</div>
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
      
      <div className="mt-3 pt-2 border-t text-xs text-gray-400 flex justify-between">
         <span>{notes.length} total notes</span>
      </div>
    </div>
  );
}

// Extracted Component for cleaner code
function NoteItem({ note, showUrl, onOpen, onDelete }) {
    return (
        <div className="border border-gray-200 rounded-lg p-3 mb-2 bg-white hover:shadow-sm transition-shadow">
            {showUrl && (
                <div className="text-xs text-blue-600 mb-1 truncate font-medium bg-blue-50 px-1 py-0.5 rounded inline-block max-w-full">
                    {note.url}
                </div>
            )}
            <div className="text-xs text-gray-500 mb-1 border-l-2 border-yellow-400 pl-2 italic">
                "{note.snippet ? (note.snippet.length > 80 ? note.snippet.substring(0, 80) + "..." : note.snippet) : "..."}"
            </div>
            <div className="text-sm text-gray-800 mb-2 font-medium">
                {note.content || <span className="text-gray-400 italic">Empty note</span>}
            </div>
            <div className="flex justify-between items-center mt-2">
                <div className="text-[10px] text-gray-400">
                    {new Date(note.createdAt).toLocaleDateString()}
                </div>
                <div className="flex gap-2">
                    <button
                        className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                        onClick={onOpen}
                    >
                        Jump to
                    </button>
                    <button
                        className="px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded transition-colors"
                        onClick={onDelete}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}