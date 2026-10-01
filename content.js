(() => {
  const TARGET_SELECTOR = 'input[type="text"], input[type="tel"], input[type="email"], textarea';
  const FIELD_MARK = "data-local-fill-host";
  const hosts = new Map();
  const statuses = new Map();
  let styleText = "";
  let scanTimer;

  fetch(chrome.runtime.getURL("content.style.css"))
    .then((response) => {
      if (!response.ok) throw new Error(`CSSの読み込みに失敗しました (${response.status})`);
      return response.text();
    })
    .then((css) => {
      styleText = css;
      scan(document);
      restoreSavedValues();
      observeDom();
    })
    .catch((error) => console.error("入力アシスタントを初期化できませんでした:", error));

  function observeDom() {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scan(node);
        }
      }
      positionAll();
      clearTimeout(scanTimer);
      scanTimer = setTimeout(restoreSavedValues, 120);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "name", "type", "aria-label", "aria-labelledby", "id", "for", "disabled", "readonly"],
    });
    window.addEventListener("scroll", positionAll, true);
    window.addEventListener("resize", positionAll);
  }

  function scan(root) {
    if (!styleText) return;
    if (root.matches?.(TARGET_SELECTOR)) attach(root);
    root.querySelectorAll?.(TARGET_SELECTOR).forEach(attach);
  }

  function attach(field) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    if (field.disabled || field.readOnly || field.type === "hidden" || field.hasAttribute(FIELD_MARK)) return;
    field.setAttribute(FIELD_MARK, "");
    const host = document.createElement("div");
    host.className = "local-input-assistant-host";
    host.setAttribute("aria-label", "入力値を保存");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = styleText;
    const controls = document.createElement("div");
    controls.className = "controls";
    controls.innerHTML = '<button type="button" class="save" title="この値を保存" aria-label="この値を保存">💾</button><span class="status" aria-live="polite"></span>';
    shadow.append(style, controls);
    document.documentElement.append(host);
    hosts.set(field, host);
    statuses.set(field, controls.querySelector(".status"));
    controls.querySelector(".save").addEventListener("click", () => saveField(field, controls));
    position(field, host);
  }

  function position(field, host) {
    if (!field.isConnected) return;
    const rect = field.getBoundingClientRect();
    host.style.left = `${Math.max(0, Math.min(window.innerWidth - 38, rect.right - 38))}px`;
    host.style.top = `${Math.max(0, Math.min(window.innerHeight - 34, rect.bottom - 34))}px`;
    host.hidden = rect.width === 0 || rect.height === 0;
  }

  function positionAll() {
    for (const [field, host] of hosts) {
      if (!field.isConnected) {
        host.remove();
        hosts.delete(field);
        statuses.delete(field);
        field.removeAttribute(FIELD_MARK);
      } else {
        position(field, host);
      }
    }
  }

  function fieldInfo(field) {
    const labels = field.labels ? Array.from(field.labels, (label) => label.innerText) : [];
    const wrapping = field.closest("label");
    if (wrapping) labels.push(wrapping.innerText);
    const ariaLabel = field.getAttribute("aria-label");
    if (ariaLabel) labels.push(ariaLabel);
    const labelledBy = field.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const label = document.getElementById(id);
        if (label) labels.push(label.innerText);
      }
    }
    const nearby = field.parentElement?.innerText?.trim().split("\n")[0] || "";
    return {
      labels: [...labels, field.placeholder, field.name, field.id, nearby].filter(Boolean),
    };
  }

  function normalize(text) {
    return String(text).toLocaleLowerCase("ja-JP").replace(/[\s\u3000_*:：()（）［］「」]/g, "").replace(/必須|任意/g, "");
  }

  function currentSiteKey() {
    return `${window.location.hostname.toLowerCase()}${window.location.pathname}`;
  }

  async function restoreSavedValues() {
    const fields = document.querySelectorAll(TARGET_SELECTOR);
    const siteKey = currentSiteKey();
    const { savedItems = [] } = await chrome.storage.local.get(["savedItems"]);
    if (!Array.isArray(savedItems) || !savedItems.length) return;
    for (const field of fields) {
      if (!field.isConnected || field.disabled || field.readOnly || field.value.trim()) continue;
      const fieldLabels = fieldInfo(field).labels.map(normalize).filter((label) => label.length >= 2);
      const best = savedItems.find((item) =>
        item.siteKey === siteKey &&
        Boolean(item.value) &&
        fieldLabels.includes(normalize(item.label || ""))
      );
      if (best && field.isConnected && !field.value.trim()) {
        setNativeValue(field, best.value);
        const status = statuses.get(field);
        if (status) showStatus(status, `「${best.label}」を復元しました`);
      }
    }
  }

  async function saveField(field, controls) {
    const value = field.value.trim();
    if (!value) return showStatus(controls, "値を入力してください", true);
    const info = fieldInfo(field);
    const label = (info.labels[0] || field.placeholder || field.name || "保存項目").trim().slice(0, 100);
    const siteKey = currentSiteKey();
    const { savedItems = [] } = await chrome.storage.local.get(["savedItems"]);
    const existing = savedItems.findIndex((item) => item.siteKey === siteKey && normalize(item.label) === normalize(label));
    const legacy = existing < 0
      ? savedItems.findIndex((item) => !item.siteKey && normalize(item.label) === normalize(label))
      : -1;
    const targetIndex = existing >= 0 ? existing : legacy;
    const item = { id: targetIndex >= 0 ? savedItems[targetIndex].id : crypto.randomUUID(), label, value, siteKey };
    const next = [...savedItems];
    if (targetIndex >= 0) next[targetIndex] = item;
    else next.push(item);
    await chrome.storage.local.set({ savedItems: next });
    showStatus(controls, `「${label}」をこのページ用に保存しました`);
  }

  function setNativeValue(field, value) {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function showStatus(target, text, error = false) {
    const status = target.matches?.(".status") ? target : target.querySelector?.(".status");
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("error", error);
    setTimeout(() => { if (status.textContent === text) status.textContent = ""; }, 2800);
  }
})();
