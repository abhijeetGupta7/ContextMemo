/* global chrome */

/**
 * Runs when the extension is installed OR updated.
 * We create our right-click menu here.
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log("ContextMemo installed/updated.");

  // Remove any old menus to avoid duplicates on update
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "contextmemo-add",
      title: "Add ContextMemo",
      contexts: ["selection"], // Only when text is selected
    });
  });
});

/**
 * When the user clicks our context menu.
 * Sends selection text to the content script to open the note UI.
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "contextmemo-add") return;
  if (!tab?.id) return;

  // Send message to content script
  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "OPEN_NOTE_UI",
      snippet: info.selectionText || "",
    },
    (response) => {
      // Gracefully ignore sites that block scripts
      if (chrome.runtime.lastError) {
        console.warn("ContextMemo: Could not connect to content script:", chrome.runtime.lastError.message);
      }
    }
  );
});
