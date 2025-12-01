# **ContextMemo — Persistent Web Highlighter & Notes Extension**

ContextMemo is a powerful Chrome extension that allows users to highlight text on any webpage, attach notes, and automatically restore those highlights across reloads and navigation. Built with reliability and cross-website compatibility in mind, it provides a seamless and consistent annotation experience for developers, researchers, and everyday users.

---

## 🎥 Demo Video

### ▶ Watch the Demo

**[Watch Video](https://drive.google.com/file/d/1OqiyC5DmomM2LYs-eM2aYVTQdKhEp5lA/view?usp=sharing)**

### ⬇ Download 
**[Download Demo Video](https://github.com/abhijeetGupta7/ContextMemo/raw/refs/heads/main/public/ContextMemo%20Demo%20%281%29.mp4)**

---

# ✨ **Features**

### 🖍 **Highlight & Save Notes**

* Select text to instantly save a note associated with that snippet.
* A subtle dot appears next to each highlight for quick visibility.
* Click any highlight or dot to view, edit, or delete the associated note.

### 📑 **Popup Dashboard (React)**

* View notes specific to **This Page**.
* Browse **All Notes** across all websites.
* Search and filter using keywords.
* Jump directly to the exact highlight inside the page.

### 🔄 **Automatic Rehydration**

* Highlights automatically reappear after page reloads.
* Fully supports dynamic SPAs (React, Vue, Angular).
* Uses a dense-text anchoring algorithm to survive DOM mutations.

### 🧩 **Shadow DOM UI**

* The note editor is encapsulated within a Shadow DOM root.
* Ensures complete isolation from website CSS, preventing layout issues.

### 🛡 **CSP-Friendly Styling**

* Highlight styles are applied via
  `element.style.setProperty(..., "important")`
* Works flawlessly on strict CSP websites such as GitHub and Wikipedia.

### 💾 **Data Saved Locally**

* All data is stored via `chrome.storage.local`.
* Notes persist across browsing sessions.
* Instant sync between content scripts and the popup UI.

### 📤 **Export Options**

* Export all notes as **JSON**.
* Export grouped, formatted **Markdown** for documentation or study workflows.

---

# 🧱 **Tech Stack**

### **Extension Core**

* JavaScript
* DOM Range API
* TreeWalker API
* Shadow DOM
* Chrome Manifest V3

### **Popup UI**

* React 18
* Vite
* Tailwind CSS

---

# 🛠 **Installation (Chrome Developer Mode)**

1. **Clone the repository:**

   ```bash
   git clone https://github.com/abhijeetGupta7/ContextMemo.git
   cd ContextMemo
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Build the popup UI:**

   ```bash
   npm run build
   ```

4. **Load the extension:**

   * Open Chrome → `chrome://extensions`
   * Enable **Developer Mode**
   * Click **Load Unpacked**
   * Select the folder containing `manifest.json` (typically `dist/`)

---

# 📌 **How Anchoring Works (Explained Simply)**

When you highlight text, ContextMemo saves:

* The raw text snippet
* A whitespace-compressed version (`denseText`)
* The global dense start index (`globalStart`)
* The dense end index (`globalEnd`)

### Example

```
Snippet: "inactive "
Dense Text: "inactive"
Dense Offset Range: 1176 → 1184
```

### **On page reload:**

1. The extension gathers all visible text on the webpage.
2. It compresses this text into a new dense string.
3. Using the saved offsets, it locates the exact substring.
4. Reconstructs the original DOM Range.
5. Reapplies the highlight spans.

This enables high accuracy even when:

* Whitespace changes
* The DOM structure changes
* The website re-renders (React/Angular/Vue)

Because the **text content**, not the DOM, serves as the anchor.

---

# 🛠 **How Data Is Stored in chrome.storage**

Each note is stored as a structured object:

```json
[
  {
    "content": "Remember to review auth flow",
    "createdAt": 1764502036205,
    "id": "n_3l0udmjp6r8",
    "locator": {
      "denseText": "authentication",
      "globalEnd": 982,
      "globalStart": 968,
      "snippet": "authentication "
    },
    "normalizedUrl": "example.com/docs/api-authentication",
    "snippet": "authentication ",
    "url": "https://example.com/docs/api-authentication?version=2&ref=notes"
  }
]

```

### **Why these fields exist**

| Field           | Purpose                                |
| --------------- | -------------------------------------- |
| `id`            | Unique ID for each note                |
| `url`           | Actual webpage URL                     |
| `normalizedUrl` | Cleaned URL for grouping and filtering |
| `snippet`       | Preview of the highlighted text        |
| `locator`       | Dense-text anchor used for rehydration |
| `content`       | User-written note content              |
| `createdAt`     | Timestamp for sorting and display      |

The popup interface reads from this structure to list, filter, and manage notes.

---

# 🧩 **Architecture Overview**

```
[Text Selection]
      |
      v
Content Script
  - serialize selection
  - create locator + snippet
  - wrap DOM with highlight spans
      |
      v
chrome.storage.local
      |
      v
Popup Dashboard (React)
  - lists, filters, searches, deletes notes
      |
      v
Content Script
  - rehydrates highlights
  - scrolls/jumps to notes on request
```

---

# 🚀 **Future Improvements**

* Multiple highlight colors
* Cloud sync (Supabase / Firebase)
* Account-based syncing
* PDF highlighting support
* Import/export archives
* Password-protected notes
* Option to disable dot indicators

---

# 🤝 **Contributing**

Contributions and suggestions are welcome. You can help improve:

* Highlight detection accuracy
* Anchoring algorithm stability
* Popup UI/UX
* Export formatting

---

# 🙌 **Final Notes**

ContextMemo prioritizes reliability and simplicity.
Highlight → Write → Save → Revisit — anytime, on any website.

---
