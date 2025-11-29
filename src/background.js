/* global chrome */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "contextmemo-add",
    title: "Add ContextMemo",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || info.menuItemId !== "contextmemo-add") return;

  chrome.tabs.sendMessage(tab.id, {
    type: "OPEN_NOTE_UI",
    snippet: info.selectionText || ""
  });
});
