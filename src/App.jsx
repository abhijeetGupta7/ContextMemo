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

  // delete note: remove from chrome.storage and notify content script to remove highlight
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

        // safety timeout
        setTimeout(() => {
          try {
            chrome.tabs.onUpdated.removeListener(listener);
          } catch (e) {}
        }, 20000);
      });
    });
  }

  return (
    <div className="min-w-[320px] max-w-[420px] p-3 font-sans text-sm">
      <header className="flex items-center justify-between mb-3">
        <h1 className="text-base font-semibold">ContextMemo</h1>
        <div className="text-xs text-gray-500">{notes.length} notes</div>
      </header>

      <div className="flex gap-2 mb-3">
        <button
          className={`px-3 py-1 rounded ${
            mode === "page" ? "bg-blue-600 text-white" : "bg-gray-100"
          }`}
          onClick={() => setMode("page")}
        >
          This page
        </button>
        <button
          className={`px-3 py-1 rounded ${
            mode === "all" ? "bg-blue-600 text-white" : "bg-gray-100"
          }`}
          onClick={() => setMode("all")}
        >
          All notes
        </button>
        <input
          className="flex-1 px-2 py-1 border rounded text-sm"
          placeholder="Search notes..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="max-h-[44vh] overflow-auto">
        {loading && (
          <div className="text-center text-gray-500 py-6">Loading...</div>
        )}

        {/* -------- THIS PAGE MODE -------- */}
        {!loading && mode === "page" && (
          <div>
            {filteredPage.length === 0 && (
              <div className="text-gray-500">No notes for this page.</div>
            )}
            {filteredPage.map((note) => (
              <div key={note.id} className="border rounded p-2 mb-2">
                <div className="text-xs text-gray-600 mb-1">{note.snippet}</div>
                <div className="text-sm mb-2">
                  {note.content || (
                    <span className="text-gray-400">(no note)</span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-xs text-gray-400">
                    {new Date(note.createdAt).toLocaleString()}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-2 py-1 text-xs bg-gray-100 rounded"
                      onClick={() => openNoteInPage(note)}
                    >
                      Open
                    </button>
                    <button
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded"
                      onClick={() => deleteNote(note.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* -------- ALL NOTES MODE -------- */}
        {!loading && mode === "all" && (
          <div>
            {filteredGlobal.length === 0 && (
              <div className="text-gray-500">No notes found.</div>
            )}
            {filteredGlobal.map((note) => (
              <div key={note.id} className="border rounded p-2 mb-2">
                <div className="text-xs text-blue-600 mb-1 truncate">
                  {note.url}
                </div>
                <div className="text-xs text-gray-600 mb-1">{note.snippet}</div>
                <div className="text-sm mb-2">{note.content}</div>

                <div className="flex justify-between items-center">
                  <div className="text-xs text-gray-400">
                    {new Date(note.createdAt).toLocaleString()}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-2 py-1 text-xs bg-gray-100 rounded"
                      onClick={() => openNoteInPage(note)}
                    >
                      Open
                    </button>
                    <button
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded"
                      onClick={() => deleteNote(note.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="mt-3 text-xs text-gray-500">
        Tip: click a note's <strong>Open</strong> to jump to the page and reveal
        the highlight.
      </footer>
    </div>
  );
}
