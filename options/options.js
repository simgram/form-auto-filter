const KEY_ITEMS = "savedItems";
let savedItems = [];
let editingId = null;

const form = document.querySelector("#item-form");
const labelInput = document.querySelector("#item-label");
const urlInput = document.querySelector("#item-url");
const valueInput = document.querySelector("#item-value");
const submitButton = document.querySelector("#submit-item");
const cancelButton = document.querySelector("#cancel-edit");
const list = document.querySelector("#saved-list");
const notice = document.querySelector("#notice");

document.addEventListener("DOMContentLoaded", loadSettings);
form.addEventListener("submit", saveItem);
cancelButton.addEventListener("click", resetForm);

async function loadSettings() {
  const data = await chrome.storage.local.get([KEY_ITEMS]);
  savedItems = Array.isArray(data[KEY_ITEMS]) ? data[KEY_ITEMS] : [];
  renderItems();
}

async function saveItem(event) {
  event.preventDefault();
  const label = labelInput.value.trim();
  const siteKey = parseSiteKey(urlInput.value);
  const value = valueInput.value.trim();
  if (!label || !value) return;
  if (!siteKey) return setNotice("対象URLには http:// または https:// から始まるURLを入力してください。", true);
  const duplicate = savedItems.find((item) => item.label === label && item.siteKey === siteKey && item.id !== editingId);
  if (duplicate && !window.confirm(`「${label}」はこのページ用に登録済みです。既存の値を置き換えますか？`)) return;
  const id = duplicate?.id || editingId || crypto.randomUUID();
  const next = savedItems.filter((item) => item.id !== id && item.id !== editingId);
  next.push({ id, label, value, siteKey });
  savedItems = next;
  await chrome.storage.local.set({ [KEY_ITEMS]: savedItems });
  resetForm();
  renderItems();
  setNotice("保存データを更新しました。");
}

function renderItems() {
  list.replaceChildren();
  if (savedItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "保存データはありません。";
    list.append(empty);
    return;
  }
  for (const item of savedItems) {
    const row = document.createElement("div");
    row.className = "item";
    const label = document.createElement("strong");
    label.textContent = item.label;
    const site = document.createElement("span");
    site.textContent = item.siteKey || "対象URL未設定（編集して設定してください）";
    const value = document.createElement("span");
    value.textContent = item.value;
    const actions = document.createElement("div");
    actions.className = "actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "編集";
    edit.addEventListener("click", () => beginEdit(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "削除";
    remove.addEventListener("click", () => deleteItem(item.id));
    actions.append(edit, remove);
    row.append(label, site, value, actions);
    list.append(row);
  }
}

function beginEdit(item) {
  editingId = item.id;
  labelInput.value = item.label;
  urlInput.value = item.siteKey ? `https://${item.siteKey}` : "";
  valueInput.value = item.value;
  submitButton.textContent = "更新";
  cancelButton.hidden = false;
  labelInput.focus();
}

async function deleteItem(id) {
  const item = savedItems.find((entry) => entry.id === id);
  if (!item || !window.confirm(`「${item.label}」を削除しますか？`)) return;
  savedItems = savedItems.filter((entry) => entry.id !== id);
  await chrome.storage.local.set({ [KEY_ITEMS]: savedItems });
  if (editingId === id) resetForm();
  renderItems();
  setNotice("保存データを削除しました。");
}

function resetForm() {
  editingId = null;
  form.reset();
  submitButton.textContent = "追加";
  cancelButton.hidden = true;
}

function parseSiteKey(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.hostname.toLowerCase()}${url.pathname}`;
  } catch {
    return "";
  }
}

function setNotice(message, isError = false) {
  notice.textContent = message;
  notice.style.color = isError ? "#b91c1c" : "#166534";
  window.setTimeout(() => { if (notice.textContent === message) notice.textContent = ""; }, 3000);
}
