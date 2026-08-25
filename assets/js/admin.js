(() => {
  // wp-content/plugins/security-scanner/assets/js/src/config.js
  var CFG = window.llarSecurityScanner || {};

  // wp-content/plugins/security-scanner/assets/js/src/keyForm.js
  function initKeyForm() {
    const keyField = document.getElementById("llar-key");
    const keyBtn = keyField && keyField.closest("form").querySelector('button[type="submit"]');
    if (!keyField || !keyBtn) {
      return;
    }
    function updateKeyBtn() {
      keyBtn.textContent = keyField.value.trim() ? CFG.i18n && CFG.i18n.saveKey || "Save key" : CFG.i18n && CFG.i18n.register || "Register";
    }
    keyField.addEventListener("input", updateKeyBtn);
    updateKeyBtn();
    const toggleBtn = document.getElementById("llar-key-toggle");
    if (!toggleBtn) {
      return;
    }
    const iconOn = toggleBtn.querySelector(".llar-key-icon:not(.llar-key-icon--off)");
    const iconOff = toggleBtn.querySelector(".llar-key-icon--off");
    toggleBtn.addEventListener("click", function() {
      const reveal = "password" === keyField.type;
      keyField.type = reveal ? "text" : "password";
      toggleBtn.setAttribute("aria-pressed", String(reveal));
      toggleBtn.setAttribute(
        "aria-label",
        reveal ? CFG.i18n && CFG.i18n.hideKey || "Hide site key" : CFG.i18n && CFG.i18n.showKey || "Show site key"
      );
      if (iconOn) {
        iconOn.hidden = reveal;
      }
      if (iconOff) {
        iconOff.hidden = !reveal;
      }
    });
  }

  // wp-content/plugins/security-scanner/assets/js/src/ajax.js
  function fetchJSON(action, body) {
    const data = new URLSearchParams();
    data.append("action", action);
    data.append("nonce", CFG.nonce);
    Object.keys(body || {}).forEach(function(k) {
      const v = body[k];
      if (Array.isArray(v)) {
        v.forEach(function(item) {
          data.append(k, item);
        });
      } else {
        data.append(k, v);
      }
    });
    return fetch(CFG.ajaxUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: data.toString()
    }).then(function(r) {
      return r.json();
    });
  }

  // wp-content/plugins/security-scanner/assets/js/src/viewport.js
  function scrollIntoView(el) {
    if (!el) {
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function revealIntoView(section, target) {
    if (!section) {
      return;
    }
    section.hidden = false;
    scrollIntoView(target || section);
  }

  // wp-content/plugins/security-scanner/assets/js/src/stopScan.js
  function initStopScan() {
    const stopBtn = document.querySelector(".llar-scan-actions__stop");
    if (!stopBtn) {
      return;
    }
    stopBtn.addEventListener("click", function() {
      const statusSection = document.querySelector(".llar-status");
      const progressLabel = statusSection && statusSection.querySelector(".llar-progress__label");
      const stoppedText = CFG.i18n && CFG.i18n.stopped || "Scan stopped.";
      stopBtn.disabled = true;
      if (progressLabel) {
        progressLabel.textContent = CFG.i18n && CFG.i18n.stopping || "Stopping\u2026";
      }
      fetchJSON("security_scanner_stop", {}).then(function() {
        window.__llarStopped = true;
        if (statusSection) {
          statusSection.hidden = true;
        }
        stopBtn.disabled = true;
        const startBtn = document.querySelector(".llar-scan-actions__start");
        if (startBtn) {
          startBtn.disabled = false;
        }
        const wrap = document.querySelector(".wrap.security-scanner");
        if (wrap && wrap.parentNode) {
          const notice = document.createElement("div");
          notice.className = "notice notice-info is-dismissible";
          const p = document.createElement("p");
          p.textContent = stoppedText;
          notice.appendChild(p);
          wrap.parentNode.insertBefore(notice, wrap);
          scrollIntoView(notice);
        }
      }).catch(function() {
        stopBtn.disabled = false;
        if (progressLabel) {
          progressLabel.textContent = CFG.i18n ? CFG.i18n.error : "error";
        }
      });
    });
  }

  // wp-content/plugins/security-scanner/assets/js/src/startForm.js
  function initStartForm() {
    const startForm = document.querySelector(".llar-start-form");
    const startBtn = document.querySelector(".llar-scan-actions__start");
    if (!startForm || !startBtn) {
      return;
    }
    startForm.addEventListener("submit", function() {
      startBtn.classList.add("is-loading");
      startBtn.disabled = true;
    });
  }

  // wp-content/plugins/security-scanner/assets/js/src/dirTree.js
  var dirTreeEl = document.querySelector(".llar-dirtree");
  var treeFlags = {};
  if (dirTreeEl) {
    try {
      treeFlags = JSON.parse(dirTreeEl.getAttribute("data-flags") || "{}") || {};
    } catch (e) {
      treeFlags = {};
    }
  }
  function treeEffective(rel) {
    const segs = rel ? rel.split("/") : [];
    for (let i = segs.length; i >= 0; i--) {
      const prefix = segs.slice(0, i).join("/");
      if (Object.prototype.hasOwnProperty.call(treeFlags, prefix)) {
        return !!treeFlags[prefix];
      }
    }
    return true;
  }
  function treeHasFlagBelow(rel, value) {
    return Object.keys(treeFlags).some(function(k) {
      const below = "" === rel ? "" !== k : 0 === k.indexOf(rel + "/");
      return below && treeFlags[k] === value;
    });
  }
  function initDirTree(onChange) {
    if (!dirTreeEl) {
      return {
        getFlags: function() {
          return {};
        },
        getSelectedSlugs: function() {
          return [];
        }
      };
    }
    const notify = "function" === typeof onChange ? onChange : function() {
    };
    const flagsContainer = dirTreeEl.querySelector(".llar-tree-flags");
    const startBtn = document.querySelector(".llar-scan-actions__start");
    const guardAllowed = startBtn ? !startBtn.disabled : false;
    function treeSetFlag(rel, value) {
      Object.keys(treeFlags).forEach(function(k) {
        if ("" === rel || 0 === k.indexOf(rel + "/")) {
          delete treeFlags[k];
        }
      });
      const parent = rel ? rel.split("/").slice(0, -1).join("/") : null;
      const inherited = null === parent ? true : treeEffective(parent);
      if (inherited === value) {
        delete treeFlags[rel];
      } else {
        treeFlags[rel] = value;
      }
    }
    function syncRow(row) {
      const rel = row.getAttribute("data-rel") || "";
      const input = row.children[1] && row.children[1].querySelector('input[type="checkbox"]');
      if (!input) {
        return;
      }
      const eff = treeEffective(rel);
      const mixed = treeHasFlagBelow(rel, !eff);
      input.checked = eff && !mixed;
      input.indeterminate = mixed;
    }
    function syncAll() {
      Array.prototype.forEach.call(
        dirTreeEl.querySelectorAll(".llar-dirtree__node"),
        syncRow
      );
    }
    function syncHidden() {
      if (!flagsContainer) {
        return;
      }
      flagsContainer.innerHTML = "";
      Object.keys(treeFlags).forEach(function(rel) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = treeFlags[rel] ? "security_scanner_tree_on[]" : "security_scanner_tree_off[]";
        input.value = rel;
        flagsContainer.appendChild(input);
      });
    }
    function updateStartGuard() {
      if (!startBtn || !guardAllowed) {
        return;
      }
      const rootOff = !treeEffective("");
      const anyOn = Object.keys(treeFlags).some(function(k) {
        return treeFlags[k] === true;
      });
      startBtn.disabled = rootOff && !anyOn;
    }
    function onRowToggle(rel, checked) {
      treeSetFlag(rel, checked);
      syncAll();
      syncHidden();
      updateStartGuard();
      notify();
    }
    function buildChildRow(child) {
      const li = document.createElement("li");
      li.className = "llar-tree__folder llar-dirtree__node";
      li.setAttribute("data-rel", child.rel);
      const toggle = document.createElement("span");
      toggle.className = "llar-tree__toggle";
      toggle.textContent = child.has_children ? "\u25B8" : " ";
      li.appendChild(toggle);
      const label = document.createElement("label");
      label.className = "llar-dirtree__label inline-flex cursor-pointer items-center gap-2";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "rounded border-slate-300 text-primary-600 focus:ring-primary-500";
      if (child.slug) {
        input.name = "security_scanner_directories[]";
        input.value = child.slug;
      }
      label.appendChild(input);
      const name = document.createElement("span");
      name.className = "llar-tree__folder-name";
      name.textContent = child.name + "/";
      label.appendChild(name);
      li.appendChild(label);
      const kids = document.createElement("ul");
      kids.className = "llar-tree__list";
      kids.hidden = true;
      li.appendChild(kids);
      return li;
    }
    function registerRow(row) {
      const rel = row.getAttribute("data-rel") || "";
      const label = row.children[1];
      const input = label && label.querySelector('input[type="checkbox"]');
      const toggle = row.children[0];
      const kids = row.lastElementChild && "UL" === row.lastElementChild.tagName ? row.lastElementChild : null;
      if (input) {
        input.addEventListener("change", function() {
          onRowToggle(rel, input.checked);
        });
      }
      if (toggle && kids) {
        toggle.addEventListener("click", function() {
          if (kids.dataset.loaded) {
            kids.hidden = !kids.hidden;
            toggle.textContent = kids.hidden ? "\u25B8" : "\u25BE";
            return;
          }
          toggle.textContent = "\u25BE";
          kids.dataset.loaded = "1";
          kids.hidden = false;
          fetchJSON("security_scanner_dirchildren", { rel }).then(function(payload) {
            const children = payload && payload.data && payload.data.children || [];
            children.forEach(function(child) {
              const childRow = buildChildRow(child);
              kids.appendChild(childRow);
              registerRow(childRow);
            });
            syncAll();
          }).catch(function() {
            kids.hidden = true;
            toggle.textContent = "\u25B8";
            delete kids.dataset.loaded;
          });
        });
      }
    }
    Array.prototype.forEach.call(dirTreeEl.querySelectorAll(".llar-dirtree__node"), registerRow);
    syncAll();
    syncHidden();
    updateStartGuard();
    return {
      /** @return {Object<string, boolean>} Explicit toggles (rel path => checked). */
      getFlags: function() {
        return treeFlags;
      },
      /** @return {string[]} Checked legacy slug checkboxes (no-JS fallback values). */
      getSelectedSlugs: function() {
        return Array.prototype.slice.call(dirTreeEl.querySelectorAll('input[name="security_scanner_directories[]"]')).filter(function(cb) {
          return cb.checked;
        }).map(function(cb) {
          return cb.value;
        });
      }
    };
  }

  // wp-content/plugins/security-scanner/assets/js/src/fileTree.js
  function buildTree(rows) {
    const root = { children: {}, files: [] };
    rows.forEach(function(row) {
      const parts = row.file_path.split("/");
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        node.children[seg] = node.children[seg] || { children: {}, files: [] };
        node = node.children[seg];
      }
      node.files.push(row);
    });
    return root;
  }
  function renderNode(node, prefix, isRoot) {
    const ul = document.createElement("ul");
    ul.className = "llar-tree__list" + (isRoot ? " is-root" : "");
    Object.keys(node.children).sort().forEach(function(name) {
      const child = node.children[name];
      const path = prefix ? prefix + "/" + name : name;
      const hasProblems = nodeHasProblems(child);
      const li = document.createElement("li");
      li.className = "llar-tree__folder";
      const toggle = document.createElement("span");
      toggle.className = "llar-tree__toggle";
      toggle.textContent = hasProblems ? "\u25BE" : "\u25B8";
      li.appendChild(toggle);
      const label = document.createElement("span");
      label.className = "llar-tree__folder-name" + (hasProblems ? " has-problems" : "");
      label.textContent = path + "/";
      li.appendChild(label);
      const subtree = renderNode(child, path, false);
      subtree.hidden = !hasProblems;
      li.appendChild(subtree);
      toggle.addEventListener("click", function() {
        subtree.hidden = !subtree.hidden;
        toggle.textContent = subtree.hidden ? "\u25B8" : "\u25BE";
      });
      ul.appendChild(li);
    });
    node.files.sort(function(a, b) {
      return a.file_path < b.file_path ? -1 : 1;
    }).forEach(function(row) {
      ul.appendChild(renderFile(row));
    });
    return ul;
  }
  function renderFile(row) {
    const li = document.createElement("li");
    li.className = "llar-tree__file" + fileStatusClass(row);
    const name = row.file_path.split("/").pop();
    const nameEl = document.createElement("span");
    nameEl.className = "llar-tree__file-name";
    nameEl.textContent = name;
    nameEl.title = row.file_path;
    li.appendChild(nameEl);
    if (row.severity) {
      const sev = document.createElement("span");
      sev.className = "llar-sev llar-sev--" + row.severity;
      const labels = CFG.i18n && CFG.i18n.severity || {};
      sev.textContent = labels[row.severity] || row.severity;
      li.appendChild(sev);
    }
    if (row.threat_type) {
      const t = document.createElement("em");
      t.className = "llar-tree__threat";
      t.textContent = row.threat_type;
      li.appendChild(t);
    }
    return li;
  }
  function fileStatusClass(row) {
    if ("infected" === row.status) {
      return " is-infected";
    }
    return "clean" !== row.status ? " is-suspicious" : "";
  }
  function nodeHasProblems(node) {
    for (let i = 0; i < node.files.length; i++) {
      if ("clean" !== node.files[i].status) {
        return true;
      }
    }
    for (const name in node.children) {
      if (nodeHasProblems(node.children[name])) {
        return true;
      }
    }
    return false;
  }

  // wp-content/plugins/security-scanner/assets/js/src/preview.js
  function initPreview(treeApi2) {
    const previewSection = document.querySelector(".llar-preview");
    if (!previewSection) {
      return { schedule: function() {
      } };
    }
    const previewTree = previewSection.querySelector(".llar-preview__tree");
    const previewCount = previewSection.querySelector(".llar-preview__count");
    const previewEmpty = previewSection.querySelector(".llar-preview__empty");
    const previewLoading = previewSection.querySelector(".llar-preview__loading");
    const includeInput = document.getElementById("llar-include");
    const excludeInput = document.getElementById("llar-exclude");
    const PREVIEW_DEBOUNCE_MS = 300;
    let previewSeq = 0;
    let previewTimer = null;
    function renderPreview(payload) {
      const files = payload && payload.data && payload.data.files || [];
      if (previewLoading) {
        previewLoading.hidden = true;
      }
      if (previewCount) {
        previewCount.textContent = files.length + " " + (1 === files.length ? CFG.i18n && CFG.i18n.file || "file" : CFG.i18n && CFG.i18n.files || "files");
      }
      if (previewEmpty) {
        previewEmpty.hidden = files.length > 0;
      }
      previewTree.innerHTML = "";
      if (!files.length) {
        return;
      }
      const rows = files.map(function(f) {
        return { file_path: f, status: "clean" };
      });
      previewTree.appendChild(renderNode(buildTree(rows), "", true));
    }
    function loadPreview() {
      const seq = ++previewSeq;
      const onFlags = [];
      const offFlags = [];
      const flags = treeApi2.getFlags();
      Object.keys(flags).forEach(function(rel) {
        (flags[rel] ? onFlags : offFlags).push(rel);
      });
      const selected = treeApi2.getSelectedSlugs();
      fetchJSON("security_scanner_preview", {
        "security_scanner_directories[]": selected,
        "security_scanner_tree_on[]": onFlags,
        "security_scanner_tree_off[]": offFlags,
        security_scanner_include: includeInput ? includeInput.value : "",
        security_scanner_exclude: excludeInput ? excludeInput.value : ""
      }).then(function(payload) {
        if (seq !== previewSeq) {
          return;
        }
        renderPreview(payload);
      }).catch(function() {
        if (seq !== previewSeq) {
          return;
        }
        if (previewLoading) {
          previewLoading.textContent = CFG.i18n ? CFG.i18n.error : "error";
        }
      });
    }
    function schedule() {
      if (previewTimer) {
        window.clearTimeout(previewTimer);
      }
      previewTimer = window.setTimeout(loadPreview, PREVIEW_DEBOUNCE_MS);
    }
    if (includeInput) {
      includeInput.addEventListener("input", schedule);
    }
    if (excludeInput) {
      excludeInput.addEventListener("input", schedule);
    }
    schedule();
    return { schedule };
  }

  // wp-content/plugins/security-scanner/assets/js/src/format.js
  function formatBytes(bytes) {
    if (bytes < 1024) {
      return bytes + " B";
    }
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      ++i;
    }
    return value.toFixed(value < 10 ? 1 : 0) + " " + units[i];
  }
  function formatDuration(seconds) {
    if (seconds < 60) {
      return Math.round(seconds) + "s";
    }
    if (seconds < 3600) {
      return Math.round(seconds / 60) + " min";
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.round(seconds % 3600 / 60);
    return h + "h " + (m > 0 ? m + "m" : "");
  }

  // wp-content/plugins/security-scanner/assets/js/src/results.js
  var resultsSection = document.querySelector(".llar-results");
  var tree = resultsSection ? resultsSection.querySelector(".llar-tree") : null;
  var onlySuspicious = document.getElementById("llar-only-suspicious");
  function loadResults(jobId) {
    fetchJSON("security_scanner_results", { job_id: jobId }).then(renderResults).catch(function() {
      if (resultsSection) {
        resultsSection.hidden = false;
      }
    });
  }
  function renderResults(payload) {
    if (!resultsSection || !tree) {
      return;
    }
    const rows = payload && payload.data && payload.data.results || [];
    window.__llarLastResults = rows;
    resultsSection.hidden = false;
    tree.innerHTML = "";
    const empty = resultsSection.querySelector(".llar-empty");
    if (empty) {
      empty.hidden = true;
    }
    if (!rows.length) {
      if (empty) {
        empty.hidden = false;
      }
      return;
    }
    const showAll = !onlySuspicious || !onlySuspicious.checked;
    const visible = rows.filter(function(row) {
      return showAll || row.status !== "clean";
    });
    if (!visible.length) {
      if (empty) {
        empty.hidden = false;
      }
      return;
    }
    const root = buildTree(visible);
    tree.appendChild(renderNode(root, "", true));
  }
  function initResultsFilter() {
    if (onlySuspicious) {
      onlySuspicious.addEventListener("change", function() {
        if (resultsSection && !resultsSection.hidden) {
          renderResults({ data: { results: window.__llarLastResults || [] } });
        }
      });
    }
  }

  // wp-content/plugins/security-scanner/assets/js/src/status.js
  var STATUS_INTERVAL_MS = 4e3;
  var STATUSES_DONE = ["completed", "done", "failed"];
  function computeEta(window2, scanned, total) {
    if (total <= 0 || scanned <= 0 || window2.length < 2) {
      return null;
    }
    const first = window2[0];
    const last = window2[window2.length - 1];
    const dt = (last.t - first.t) / 1e3;
    const db = last.bytes - first.bytes;
    if (dt <= 0 || db <= 0) {
      return null;
    }
    const rate = db / dt;
    const remaining = total - scanned;
    return remaining / rate;
  }
  function initPolling(jobId) {
    const statusSection = document.querySelector(".llar-status");
    const stopBtn = document.querySelector(".llar-scan-actions__stop");
    const startBtn = document.querySelector(".llar-scan-actions__start");
    if (!statusSection) {
      return;
    }
    revealIntoView(statusSection);
    const progressBar = statusSection.querySelector(".llar-progress__bar");
    const progressLabel = statusSection.querySelector(".llar-progress__label");
    let samples = [];
    function pollStatus() {
      fetchJSON("security_scanner_status", { job_id: jobId }).then(onStatus).catch(function() {
        progressLabel.textContent = CFG.i18n ? CFG.i18n.error : "error";
      });
    }
    function onStatus(payload) {
      if (!payload || !payload.success) {
        progressLabel.textContent = CFG.i18n ? CFG.i18n.error : "error";
        return;
      }
      const status = payload.data.status || "unknown";
      const pct = payload.data.progress_pct || 0;
      const currentFile = payload.data.current_file || "";
      const completed = payload.data.completed || 0;
      const total = payload.data.total || 0;
      const totalBytes = payload.data.total_bytes || 0;
      const scannedBytes = payload.data.scanned_bytes || 0;
      progressBar.style.width = pct + "%";
      const now = Date.now();
      samples.push({ t: now, bytes: scannedBytes });
      if (samples.length > 6) {
        samples.shift();
      }
      let label = pct + "%";
      if (total > 0) {
        label += " \xB7 " + completed + "/" + total;
      }
      if (totalBytes > 0) {
        label += " \xB7 " + formatBytes(scannedBytes) + " / " + formatBytes(totalBytes);
      }
      const eta = computeEta(samples, scannedBytes, totalBytes);
      if (eta !== null) {
        label += " \xB7 ~" + formatDuration(eta);
      }
      if (currentFile) {
        label += " \xB7 " + currentFile;
      }
      progressLabel.textContent = label;
      if (STATUSES_DONE.indexOf(status) === -1) {
        if (window.__llarStopped) {
          return;
        }
        window.setTimeout(pollStatus, STATUS_INTERVAL_MS);
        return;
      }
      statusSection.hidden = true;
      if (stopBtn) {
        stopBtn.disabled = true;
      }
      if (startBtn) {
        startBtn.disabled = false;
      }
      loadResults(jobId);
    }
    pollStatus();
  }

  // wp-content/plugins/security-scanner/assets/js/src/notices.js
  function initNotices() {
    const notice = document.querySelector(".security-scanner-notice");
    if (!notice) {
      return;
    }
    const jobIdInput2 = document.querySelector(".llar-job-id");
    if (jobIdInput2 && jobIdInput2.value) {
      return;
    }
    scrollIntoView(notice);
  }

  // wp-content/plugins/security-scanner/assets/js/src/main.js
  initKeyForm();
  initStopScan();
  initStartForm();
  var notifyPreview = function() {
  };
  var treeApi = initDirTree(function() {
    notifyPreview();
  });
  var previewApi = initPreview(treeApi);
  notifyPreview = previewApi.schedule;
  initResultsFilter();
  var jobIdInput = document.querySelector(".llar-job-id");
  if (jobIdInput && jobIdInput.value) {
    initPolling(jobIdInput.value);
  } else {
    initNotices();
  }
})();
