```markdown
# ContextMemo — Persistent Web Highlighter & Notes Extension

ContextMemo is a Chrome extension that lets you highlight text on any webpage, attach notes, and automatically restore those highlights even after page reloads or navigation. 

---

## 🎥 Demo Video

> *Insert your demo link here once ready.*

---

# ✨ Features

### 🖍 Highlight & Save Notes
- Select text → save a note for that snippet  
- A small dot appears next to each highlight  
- Click any highlight/dot to edit or delete the note  

### 📑 Popup Dashboard (React)
- View notes for **This Page**  
- View **All Notes** globally  
- Search and filter notes  
- Jump back to a highlight inside the page  

### 🔄 Automatic Rehydration
- Highlights reappear after page reload  
- Works on fast-changing SPAs (React, Vue, Angular)  
- Handles DOM mutations using a dense-text anchoring strategy  

### 🧩 Shadow DOM UI
- Note editor opens inside an isolated Shadow DOM  
- Prevents CSS conflicts with any website  

### 🛡 CSP-Friendly Styling
- Highlight styles applied using `element.style.setProperty(..., "important")`  
- Works even on strict websites (e.g., GitHub, Wikipedia)

### 💾 Data Saved Locally
- Uses `chrome.storage.local`  
- Notes persist across sessions  
- Popup syncs instantly whenever notes update  

### 📤 Export Options
- Export notes as **JSON**  
- Export grouped, formatted **Markdown**  

---

# 🧱 Tech Stack

### **Extension Core**
- JavaScript  
- DOM Range API  
- TreeWalker API  
- Shadow DOM  
- Chrome Manifest V3  

### **Popup UI**
- React 18  
- Vite  
- Tailwind CSS  

---

# 🛠 Installation (Chrome Developer Mode)

1. Clone the repo:

```bash
git clone https://github.com/YOUR_USERNAME/contextmemo.git
cd contextmemo
````

2. Install dependencies:

```bash
npm install
```

3. Build the popup UI:

```bash
npm run build
```

4. Load Extension:

* Open Chrome → `chrome://extensions`
* Enable **Developer mode**
* Click **Load Unpacked** 
* Select the project folder containing `manifest.json` (dist)

---

# 📌 How Anchoring Works (Explained Simply)

When you highlight text, ContextMemo records:

* the raw snippet
* a whitespace-compressed version (`denseText`)
* the dense start index (`globalStart`)
* the dense end index (`globalEnd`)

### Example

```
Snippet: "inactive "
Dense Text: "inactive"
Dense Offset Range: 1176 → 1184
```

Later, when the page reloads:

1. The extension scans *all* visible text on the page
2. Compresses it again into a dense string
3. Locates the same substring using saved offsets
4. Reconstructs the original DOM Range
5. Applies highlight spans back into the page

This allows highlights to persist even if:

* whitespace changes
* the page structure changes
* the website re-renders using React/Angular

This anchoring method is stable because the **text content** rarely changes, even when the DOM does.

---

# 🛠 How Data Is Stored in chrome.storage

Each note is stored as a structured object:

```json
[
  {
    "content": "xssx",
    "createdAt": 1764502036205,
    "id": "n_3l0udmjp6r8",
    "locator": {
      "denseText": "equals",
      "globalEnd": 373,
      "globalStart": 367,
      "snippet": "equals "
    },
    "normalizedUrl": "www.geeksforgeeks.org/problems/subarray-with-given-sum-1587115621/1",
    "snippet": "equals ",
    "url": "https://www.geeksforgeeks.org/problems/subarray-with-given-sum-1587115621/1?page=1&sortBy=submissions"
  }
]
```

### Why these fields exist

| Field           | Purpose                                        |
| --------------- | ---------------------------------------------- |
| `id`            | Unique per note                                |
| `url`           | Real page URL                                  |
| `normalizedUrl` | Used for grouping & filtering                  |
| `snippet`       | Preview of highlighted text                    |
| `locator`       | Used to restore highlights via dense anchoring |
| `content`       | User’s note text                               |
| `createdAt`     | Display & sorting                              |

The popup UI filters and displays notes using this structured data.

---

# 🧩 Architecture Overview

```
[Text Selection]
      |
      v
Content Script
  - serialize selection
  - save locator + snippet
  - wrap DOM with spans
      |
      v
chrome.storage.local
      |
      v
Popup Dashboard (React)
  - lists, searches, filters, removes notes
      |
      v
Content Script
  - rehydrates highlights
  - jumps to specific notes
```

---

# 🚀 Future Improvements

* Multiple highlight colors
* Cloud sync (Supabase / Firebase)
* Account-based syncing
* PDF highlighting support
* Import/export archives
* Password-protected notes
* Option to disable dots

---

# 🤝 Contributing

Pull requests and suggestions are welcome.
You can help improve:

* Highlight detection
* Anchoring algorithm edge cases
* Popup UI/UX
* Export formats

---

# 🙌 Final Notes

ContextMemo focuses on reliability across all websites while keeping the experience simple:
highlight, write, save, and revisit your thoughts anytime.

```
```
