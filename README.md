````markdown
# **ContextMemo — Persistent Web Highlighter & Notes Chrome Extension**

A powerful Chrome extension that allows users to highlight text on any webpage, attach notes, and automatically restore those highlights across reloads and navigation. Built for reliability, performance, and seamless user experience.

---

## **Table of Contents**
1. [About the Project](#about-the-project)
2. [Tech Stack](#tech-stack)
3. [Features](#features)
4. [Extension Architecture](#extension-architecture)
5. [Getting Started](#getting-started)
6. [Folder Structure](#folder-structure)

---

## **About the Project**
ContextMemo is designed to let users highlight text across the web and store notes that persist permanently. It focuses on:

- **Persistence**: Highlights reappear even after page reloads.
- **Accuracy**: Uses dense-text anchoring to survive DOM changes.
- **Performance**: Efficient scanning and shadow DOM UI for speed.
- **Stability**: Works reliably on dynamic SPA websites.
- **Privacy**: All data is stored locally on the user's machine.

---

## **Tech Stack**

### **Extension Core**
- JavaScript (ESNext)
- Chrome Extensions Manifest V3  
- DOM Range API  
- TreeWalker API  
- Shadow DOM  
- `chrome.storage.local`

### **Popup UI**
- React 18  
- Vite  
- Tailwind CSS  

---

## **Features**
1. **Highlight & Annotate**
   - Select text and save notes bound to that highlight.
   - Small clickable indicator dot next to each highlight.
   - Edit or delete notes in-place.

2. **Automatic Highlight Restoration**
   - Highlights rehydrate after reloads.
   - Works even when DOM structure changes.
   - Uses dense-text indexing for stability.

3. **Popup Notes Dashboard**
   - View notes for *This Page*.
   - Browse *All Notes* from any website.
   - Search, filter, and jump to highlights.

4. **Shadow DOM Note Editor**
   - Completely isolated from website styles.
   - Guaranteed UI consistency.

5. **CSP-Friendly Styling**
   - Uses inline `style.setProperty(..., "important")`.
   - Works even on strict CSP sites like GitHub, Wikipedia.

6. **Local Storage Persistence**
   - Fully offline.
   - Never sends data to any server.

7. **Export Options**
   - Export all notes as JSON.
   - Export formatted Markdown.

---

## **Extension Architecture**

### **1. Content Script**
- Listens to text selections.
- Serializes DOM Range.
- Generates locator metadata:
  - `denseText`
  - `globalStart` / `globalEnd`
  - snippet
- Injects highlight `<span>` elements.
- Rehydrates highlights on page load.
- Handles note editor UI via Shadow DOM.

### **2. Background Script**
- Coordinates messages between popup and content scripts.
- Manages extension lifecycle events.

### **3. Popup (React App)**
- Lists all notes.
- Filters by URL, search, date.
- Allows deletion and navigation to specific notes.
- Syncs live with `chrome.storage.local`.

---

## **Getting Started**

### **Prerequisites**
- Node.js 18+
- Chrome browser

### **Installation**
1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/contextmemo.git
   cd contextmemo
````

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the extension:

   ```bash
   npm run build
   ```

4. Load into Chrome:

   * Go to `chrome://extensions`
   * Enable **Developer Mode**
   * Click **Load Unpacked**
   * Select the project root folder (the one containing `manifest.json`)

---

## **Folder Structure**

```markdown
contextmemo/
│
├── manifest.json
├── background.js
├── content.js
│
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── index.css
│   ├── assets/
│
├── dist/
├── package.json
└── README.md
```

---

## **How Anchoring Works**

ContextMemo converts webpage text into a dense form (removing extra whitespace) and stores:

* denseText (exact matched sequence)
* globalStart / globalEnd (indexes in the dense document)
* snippet (small preview)

During page reload:

1. Page text → re-densified
2. Offsets → used to relocate snippet
3. DOM Range reconstructed
4. Highlight applied again

This survives:

* whitespace shifts
* layout changes
* SPA re-renders

---

## **Data Format (chrome.storage.local)**

```json
[
  {
    "content": "My note",
    "createdAt": 1764502036205,
    "id": "n_3l0udmjp6r8",
    "locator": {
      "denseText": "equals",
      "globalEnd": 373,
      "globalStart": 367,
      "snippet": "equals "
    },
    "normalizedUrl": "www.example.com/page",
    "snippet": "equals ",
    "url": "https://www.example.com/page?query=1"
  }
]
```

---

## **Future Improvements**

* Multiple highlight colors
* Cloud sync (Supabase / Firebase)
* Password-protected notes
* PDF support
* Keyboard shortcuts

---

## **Contributing**

Pull requests and feature suggestions are welcome!
Focus areas:

* Anchoring improvements
* Popup UI/UX refinements
* Export enhancements

---

## **Final Notes**

ContextMemo is designed for reliability across all websites while staying simple and intuitive:
**highlight → write → save → revisit anytime.**

```
```
