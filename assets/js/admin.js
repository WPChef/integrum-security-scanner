(() => {
  // wp-content/plugins/integrum-security-scanner/assets/js/src/config.js
  var CFG = window.llarSecurityScanner || {};

  // wp-content/plugins/integrum-security-scanner/assets/js/src/keyForm.js
  function initKeyForm() {
    const keyField = document.getElementById("iss-key");
    const form = keyField && keyField.closest("form");
    const keyBtn = document.getElementById("iss-key-submit");
    const termsRow = document.getElementById("iss-terms-row");
    const termsCheckbox = document.getElementById("iss-terms-agree");
    const termsOpenBtns = document.querySelectorAll(".iss-terms-open");
    const termsDialog = document.getElementById("iss-terms-dialog");
    const termsCloseBtn = termsDialog && termsDialog.querySelector(".iss-terms-close");
    if (!keyField || !form || !keyBtn) {
      return;
    }
    function isRegisterMode() {
      return "" === keyField.value.trim();
    }
    function updateSubmitState() {
      if (isRegisterMode() && termsCheckbox && !termsCheckbox.checked) {
        keyBtn.disabled = true;
        return;
      }
      keyBtn.disabled = false;
    }
    function updateKeyBtn() {
      keyBtn.textContent = keyField.value.trim() ? CFG.i18n && CFG.i18n.saveKey || "Save key" : CFG.i18n && CFG.i18n.register || "Register";
      if (termsRow) {
        termsRow.hidden = !isRegisterMode();
      }
      if (termsCheckbox) {
        termsCheckbox.required = isRegisterMode();
      }
      updateSubmitState();
    }
    keyField.addEventListener("input", updateKeyBtn);
    termsCheckbox && termsCheckbox.addEventListener("change", updateSubmitState);
    form.addEventListener("submit", function(event) {
      if (isRegisterMode() && termsCheckbox && !termsCheckbox.checked) {
        event.preventDefault();
        return;
      }
      window.setTimeout(function() {
        keyBtn.classList.add("is-loading");
        keyBtn.disabled = true;
      }, 0);
    });
    updateKeyBtn();
    if (termsOpenBtns.length && termsDialog && "function" === typeof termsDialog.showModal) {
      Array.prototype.forEach.call(termsOpenBtns, function(btn) {
        btn.addEventListener("click", function() {
          termsDialog.showModal();
        });
      });
      if (termsCloseBtn) {
        termsCloseBtn.addEventListener("click", function() {
          termsDialog.close();
        });
      }
      termsDialog.addEventListener("click", function(event) {
        if (event.target === termsDialog) {
          termsDialog.close();
        }
      });
    }
    const toggleBtn = document.getElementById("iss-key-toggle");
    if (!toggleBtn) {
      return;
    }
    const iconOn = toggleBtn.querySelector(".iss-key-icon:not(.iss-key-icon--off)");
    const iconOff = toggleBtn.querySelector(".iss-key-icon--off");
    toggleBtn.addEventListener("click", function() {
      const reveal = "password" === keyField.type;
      keyField.type = reveal ? "text" : "password";
      toggleBtn.setAttribute("aria-pressed", String(reveal));
      toggleBtn.setAttribute(
        "aria-label",
        reveal ? CFG.i18n && CFG.i18n.hideKey || "Hide site key" : CFG.i18n && CFG.i18n.showKey || "Show site key"
      );
      if (iconOn) {
        reveal ? iconOn.setAttribute("hidden", "") : iconOn.removeAttribute("hidden");
      }
      if (iconOff) {
        reveal ? iconOff.removeAttribute("hidden") : iconOff.setAttribute("hidden", "");
      }
    });
  }

  // wp-content/plugins/integrum-security-scanner/assets/js/src/ajax.js
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

  // wp-content/plugins/integrum-security-scanner/assets/js/src/viewport.js
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

  // wp-content/plugins/integrum-security-scanner/assets/js/src/dirTree.js
  var dirTreeEl = document.querySelector(".iss-dirtree");
  var treeFlags = {};
  var dirTreeLocked = false;
  var registerRowRef = null;
  var syncAllRef = null;
  if (dirTreeEl) {
    try {
      treeFlags = JSON.parse(dirTreeEl.getAttribute("data-flags") || "{}") || {};
    } catch (e) {
      treeFlags = {};
    }
  }
  function setDirTreeLocked(locked) {
    dirTreeLocked = !!locked;
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
    const flagsContainer = dirTreeEl.querySelector(".iss-tree-flags");
    const startBtn = document.querySelector(".iss-scan-actions__start");
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
        dirTreeEl.querySelectorAll(".iss-dirtree__node"),
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
        input.name = treeFlags[rel] ? "integrum_security_scanner_tree_on[]" : "integrum_security_scanner_tree_off[]";
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
      li.className = "iss-tree__folder iss-dirtree__node";
      li.setAttribute("data-rel", child.rel);
      const toggle = document.createElement("span");
      toggle.className = "iss-tree__toggle";
      toggle.textContent = child.has_children ? "\u25B8" : " ";
      li.appendChild(toggle);
      const label = document.createElement("label");
      label.className = "iss-dirtree__label inline-flex cursor-pointer items-center gap-2";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "rounded border-slate-300 text-primary-600 focus:ring-primary-500";
      if (child.slug) {
        input.name = "integrum_security_scanner_directories[]";
        input.value = child.slug;
      }
      label.appendChild(input);
      const name = document.createElement("span");
      name.className = "iss-tree__folder-name";
      name.textContent = child.name + "/";
      label.appendChild(name);
      li.appendChild(label);
      const kids = document.createElement("ul");
      kids.className = "iss-tree__list";
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
        input.addEventListener("click", function(event) {
          if (dirTreeLocked && input.checked) {
            event.preventDefault();
          }
        });
        input.addEventListener("change", function() {
          if (dirTreeLocked && !input.checked) {
            syncRow(row);
            syncHidden();
            return;
          }
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
          fetchJSON("integrum_security_scanner_dirchildren", { rel }).then(function(payload) {
            const children = payload && payload.data && payload.data.children || [];
            children.forEach(function(child) {
              if (kids.querySelector(':scope > .iss-dirtree__node[data-rel="' + cssEscape(child.rel) + '"]')) {
                return;
              }
              const childRow = buildChildRow(child);
              const firstFile = kids.querySelector(":scope > .iss-tree__file");
              if (firstFile) {
                kids.insertBefore(childRow, firstFile);
              } else {
                kids.appendChild(childRow);
              }
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
    Array.prototype.forEach.call(dirTreeEl.querySelectorAll(".iss-dirtree__node"), registerRow);
    syncAll();
    syncHidden();
    updateStartGuard();
    registerRowRef = registerRow;
    syncAllRef = syncAll;
    return {
      /** @return {Object<string, boolean>} Explicit toggles (rel path => checked). */
      getFlags: function() {
        return treeFlags;
      },
      /** @return {string[]} Checked legacy slug checkboxes (no-JS fallback values). */
      getSelectedSlugs: function() {
        return Array.prototype.slice.call(dirTreeEl.querySelectorAll('input[name="integrum_security_scanner_directories[]"]')).filter(function(cb) {
          return cb.checked;
        }).map(function(cb) {
          return cb.value;
        });
      }
    };
  }
  function materializeFolder(rel) {
    if (!dirTreeEl) {
      return null;
    }
    const root = dirTreeEl.querySelector('.iss-dirtree__node[data-rel=""]');
    if (!root) {
      return null;
    }
    if (!rel) {
      return root;
    }
    const segs = rel.split("/");
    let node = root;
    let prefix = "";
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      prefix = prefix ? prefix + "/" + seg : seg;
      const kids = node.lastElementChild && "UL" === node.lastElementChild.tagName ? node.lastElementChild : null;
      if (!kids) {
        return null;
      }
      let li = kids.querySelector(':scope > .iss-dirtree__node[data-rel="' + cssEscape(prefix) + '"]');
      if (!li) {
        li = buildSyntheticRow(prefix, seg, kids);
      }
      node = li;
    }
    return node;
  }
  function buildSyntheticRow(rel, name, kids) {
    const li = document.createElement("li");
    li.className = "iss-tree__folder iss-dirtree__node";
    li.setAttribute("data-rel", rel);
    const toggle = document.createElement("span");
    toggle.className = "iss-tree__toggle";
    toggle.textContent = "\u25B8";
    li.appendChild(toggle);
    const label = document.createElement("label");
    label.className = "iss-dirtree__label inline-flex cursor-pointer items-center gap-2";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "rounded border-slate-300 text-primary-600 focus:ring-primary-500";
    label.appendChild(input);
    const nameEl = document.createElement("span");
    nameEl.className = "iss-tree__folder-name";
    nameEl.textContent = name + "/";
    label.appendChild(nameEl);
    li.appendChild(label);
    const sub = document.createElement("ul");
    sub.className = "iss-tree__list";
    sub.hidden = true;
    li.appendChild(sub);
    const firstFile = kids.querySelector(":scope > .iss-tree__file");
    if (firstFile) {
      kids.insertBefore(li, firstFile);
    } else {
      kids.appendChild(li);
    }
    if (registerRowRef) {
      registerRowRef(li);
    }
    if (syncAllRef) {
      syncAllRef();
    }
    return li;
  }
  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
  }

  // wp-content/plugins/integrum-security-scanner/assets/js/src/stopScan.js
  function initStopScan() {
    const stopBtn = document.querySelector(".iss-scan-actions__stop");
    if (!stopBtn) {
      return;
    }
    stopBtn.addEventListener("click", function() {
      const statusSection = document.querySelector(".iss-status");
      const progressLabel = statusSection && statusSection.querySelector(".iss-progress__label");
      const stoppedText = CFG.i18n && CFG.i18n.stopped || "Scan stopped.";
      stopBtn.disabled = true;
      if (progressLabel) {
        progressLabel.textContent = CFG.i18n && CFG.i18n.stopping || "Stopping\u2026";
      }
      fetchJSON("integrum_security_scanner_stop", {}).then(function() {
        window.__llarStopped = true;
        setDirTreeLocked(false);
        if (statusSection) {
          statusSection.hidden = true;
        }
        stopBtn.disabled = true;
        const startBtn = document.querySelector(".iss-scan-actions__start");
        if (startBtn) {
          startBtn.disabled = false;
        }
        const wrap = document.querySelector(".wrap.integrum-security-scanner");
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

  // wp-content/plugins/integrum-security-scanner/assets/js/src/startForm.js
  function initStartForm() {
    const startForm = document.querySelector(".iss-start-form");
    const startBtn = document.querySelector(".iss-scan-actions__start");
    if (!startForm || !startBtn) {
      return;
    }
    startForm.addEventListener("submit", function() {
      setDirTreeLocked(true);
      startBtn.classList.add("is-loading");
      startBtn.disabled = true;
    });
  }

  // wp-content/plugins/integrum-security-scanner/assets/js/src/fileTree.js
  function renderFile(row) {
    const li = document.createElement("li");
    li.className = "iss-tree__file" + fileStatusClass(row);
    const name = row.file_path.split("/").pop();
    const nameEl = document.createElement("span");
    nameEl.className = "iss-tree__file-name";
    nameEl.textContent = name;
    nameEl.title = row.file_path;
    li.appendChild(nameEl);
    const i18n = CFG.i18n || {};
    if (row.status && "clean" !== row.status && "pending" !== row.status) {
      const st = document.createElement("span");
      st.className = "iss-verdict iss-verdict--" + row.status + " iss-tip";
      st.textContent = i18n.statusLabels && i18n.statusLabels[row.status] || row.status;
      st.tabIndex = 0;
      const stHint = i18n.statusHints && i18n.statusHints[row.status] || "";
      if (stHint) {
        st.dataset.tip = stHint;
      }
      li.appendChild(st);
    }
    if (row.severity) {
      const sev = document.createElement("span");
      sev.className = "iss-sev iss-sev--" + row.severity + " iss-tip";
      sev.textContent = i18n.severity && i18n.severity[row.severity] || row.severity;
      sev.tabIndex = 0;
      const sevHint = i18n.severityHints && i18n.severityHints[row.severity] || "";
      if (sevHint) {
        sev.dataset.tip = sevHint;
      }
      li.appendChild(sev);
    }
    if (row.threat_type) {
      const t = document.createElement("em");
      t.className = "iss-tree__threat";
      t.textContent = row.threat_type;
      li.appendChild(t);
    }
    if (row.detail && Object.keys(row.detail).length) {
      li.appendChild(buildDetail(row.detail));
    }
    return li;
  }
  function dirname(path) {
    const idx = path.lastIndexOf("/");
    return -1 === idx ? "" : path.slice(0, idx);
  }
  function buildDetail(detail) {
    const wrap = document.createElement("span");
    wrap.className = "iss-file-detail";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "iss-file-detail__toggle";
    btn.textContent = "\u24D8";
    btn.title = "Imunify response";
    btn.setAttribute("aria-expanded", "false");
    wrap.appendChild(btn);
    const panel = document.createElement("span");
    panel.className = "iss-file-detail__panel";
    panel.hidden = true;
    Object.keys(detail).forEach(function(key) {
      const item = document.createElement("span");
      item.className = "iss-file-detail__item";
      const k = document.createElement("em");
      k.textContent = key + ":";
      const v = document.createElement("code");
      v.textContent = detail[key];
      item.appendChild(k);
      item.appendChild(v);
      panel.appendChild(item);
    });
    wrap.appendChild(panel);
    btn.addEventListener("click", function() {
      panel.hidden = !panel.hidden;
      btn.setAttribute("aria-expanded", String(!panel.hidden));
    });
    return wrap;
  }
  function fileStatusClass(row) {
    if ("infected" === row.status) {
      return " is-infected";
    }
    if ("pending" === row.status) {
      return " is-pending";
    }
    return "clean" !== row.status ? " is-suspicious" : " is-clean";
  }

  // wp-content/plugins/integrum-security-scanner/assets/js/src/results.js
  var treeEl = document.querySelector(".iss-dirtree");
  var filterWrap = document.getElementById("iss-only-suspicious-wrap");
  var onlySuspicious = document.getElementById("iss-only-suspicious");
  function loadResults(jobId) {
    return fetchJSON("integrum_security_scanner_results", { job_id: jobId }).then(function(payload) {
      const rows = payload && payload.data && payload.data.results || [];
      attachResults(rows);
      return rows;
    }).catch(function() {
      return [];
    });
  }
  function clearResults() {
    if (!treeEl) {
      return;
    }
    treeEl.classList.remove("is-complete");
    Array.prototype.forEach.call(treeEl.querySelectorAll(".iss-tree__file"), function(el) {
      el.remove();
    });
    Array.prototype.forEach.call(treeEl.querySelectorAll(".iss-node-badge"), function(el) {
      el.remove();
    });
    Array.prototype.forEach.call(treeEl.querySelectorAll(".iss-tree__folder-name.has-problems"), function(el) {
      el.classList.remove("has-problems");
    });
    if (filterWrap) {
      filterWrap.hidden = true;
    }
    window.__llarLastResults = [];
  }
  function attachResults(rows) {
    if (!treeEl) {
      return;
    }
    clearResults();
    window.__llarLastResults = rows;
    const stats = {};
    rows.forEach(function(row) {
      const dir = dirname(row.file_path);
      const bad = "clean" !== row.status;
      const infected = "infected" === row.status;
      const folder = materializeFolder(dir);
      if (folder) {
        const kids = folder.lastElementChild;
        if (kids && "UL" === kids.tagName) {
          kids.appendChild(renderFile(row));
        }
      }
      const segs = dir ? dir.split("/") : [];
      for (let i = 0; i <= segs.length; i++) {
        const rel = segs.slice(0, i).join("/");
        stats[rel] = stats[rel] || { scanned: 0, alert: 0, infected: 0 };
        ++stats[rel].scanned;
        if (bad) {
          ++stats[rel].alert;
        }
        if (infected) {
          ++stats[rel].infected;
        }
      }
    });
    Object.keys(stats).forEach(function(rel) {
      const folder = materializeFolder(rel);
      if (!folder) {
        return;
      }
      addBadge(folder, stats[rel]);
      if (stats[rel].alert > 0) {
        markProblems(folder);
        expandChain(folder);
      }
    });
    treeEl.classList.add("is-complete");
    if (filterWrap && rows.length) {
      filterWrap.hidden = false;
    }
    applyFilter();
  }
  function addBadge(folder, s) {
    const kids = folder.lastElementChild;
    if (!kids || "UL" !== kids.tagName) {
      return;
    }
    const badge = document.createElement("span");
    if (s.alert > 0) {
      badge.className = "iss-node-badge iss-node-badge--alert" + (s.infected > 0 ? " iss-node-badge--infected" : "");
      badge.textContent = "\u26A0 " + s.alert;
      badge.title = s.alert + " suspicious/infected file(s) in this subtree";
    } else {
      badge.className = "iss-node-badge iss-node-badge--ok";
      badge.textContent = "\u2713 " + s.scanned;
      badge.title = s.scanned + " file(s) scanned, all clean";
    }
    folder.insertBefore(badge, kids);
  }
  function markProblems(folder) {
    const name = folder.querySelector(":scope > .iss-dirtree__label .iss-tree__folder-name");
    if (name) {
      name.classList.add("has-problems");
    }
  }
  function expandChain(folder) {
    const kids = folder.lastElementChild;
    if (kids && "UL" === kids.tagName) {
      kids.hidden = false;
      const ownToggle = folder.querySelector(":scope > .iss-tree__toggle");
      if (ownToggle) {
        ownToggle.textContent = "\u25BE";
      }
    }
    let el = folder;
    while (el && el !== treeEl) {
      if ("UL" === el.tagName && el.classList.contains("iss-tree__list")) {
        el.hidden = false;
        const owner = el.parentElement;
        const toggle = owner && owner.querySelector(":scope > .iss-tree__toggle");
        if (toggle) {
          toggle.textContent = "\u25BE";
        }
      }
      el = el.parentElement;
    }
  }
  function applyFilter() {
    if (!treeEl) {
      return;
    }
    const hide = !onlySuspicious || onlySuspicious.checked;
    const folders = [];
    Array.prototype.forEach.call(treeEl.querySelectorAll(".iss-tree__file"), function(el) {
      el.hidden = hide && el.classList.contains("is-clean");
      if (!hide) {
        const list = el.parentElement;
        if (list && "UL" === list.tagName && folders.indexOf(list) === -1) {
          folders.push(list);
        }
      }
    });
    folders.forEach(function(list) {
      if (list.parentElement) {
        expandChain(list.parentElement);
      }
    });
  }
  function initResultsFilter() {
    if (onlySuspicious) {
      onlySuspicious.addEventListener("change", applyFilter);
    }
  }

  // wp-content/plugins/integrum-security-scanner/assets/js/src/preview.js
  function initPreview(treeApi2) {
    const previewCount = document.querySelector(".iss-preview__count");
    const previewEmpty = document.querySelector(".iss-preview__empty");
    const previewLoading = document.querySelector(".iss-preview__loading");
    const treeOverlay = document.querySelector(".iss-tree-overlay");
    const includeInput = document.getElementById("iss-include");
    const excludeInput = document.getElementById("iss-exclude");
    const PREVIEW_DEBOUNCE_MS = 300;
    const connected = CFG.hasKey === "1";
    let previewSeq = 0;
    let previewTimer = null;
    function setTreeOverlay(on) {
      if (treeOverlay) {
        treeOverlay.classList.toggle("is-active", !!on);
      }
    }
    function renderPreview(payload) {
      const files = payload && payload.data && payload.data.files || [];
      setTreeOverlay(false);
      if (previewLoading) {
        previewLoading.hidden = true;
      }
      if (previewCount) {
        previewCount.textContent = files.length + " " + (1 === files.length ? CFG.i18n && CFG.i18n.file || "file" : CFG.i18n && CFG.i18n.files || "files");
      }
      if (previewEmpty) {
        previewEmpty.hidden = files.length > 0;
      }
      clearResults();
      const byDir = {};
      files.forEach(function(f) {
        const dir = dirname(f);
        (byDir[dir] = byDir[dir] || []).push(f);
      });
      Object.keys(byDir).forEach(function(dir) {
        const folder = materializeFolder(dir);
        if (!folder) {
          return;
        }
        const kids = folder.lastElementChild;
        if (!kids || "UL" !== kids.tagName) {
          return;
        }
        byDir[dir].forEach(function(f) {
          kids.appendChild(renderFile({ file_path: f, status: "pending" }));
        });
      });
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
      setTreeOverlay(true);
      fetchJSON("integrum_security_scanner_preview", {
        "integrum_security_scanner_directories[]": selected,
        "integrum_security_scanner_tree_on[]": onFlags,
        "integrum_security_scanner_tree_off[]": offFlags,
        integrum_security_scanner_include: includeInput ? includeInput.value : "",
        integrum_security_scanner_exclude: excludeInput ? excludeInput.value : ""
      }).then(function(payload) {
        if (seq !== previewSeq) {
          return;
        }
        renderPreview(payload);
      }).catch(function() {
        if (seq !== previewSeq) {
          return;
        }
        setTreeOverlay(false);
        if (previewLoading) {
          previewLoading.textContent = CFG.i18n ? CFG.i18n.error : "error";
        }
      });
    }
    function schedule() {
      if (!connected) {
        return;
      }
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
    if (!connected && previewLoading) {
      previewLoading.hidden = true;
    }
    schedule();
    return { schedule };
  }

  // wp-content/plugins/integrum-security-scanner/assets/js/src/format.js
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

  // wp-content/plugins/integrum-security-scanner/assets/js/src/history.js
  var bodyEl = document.querySelector(".iss-history__body");
  var emptyEl = document.querySelector(".iss-history__empty");
  var runsCache = null;
  var fetchPromise = null;
  function fetchRuns() {
    if (runsCache) {
      return Promise.resolve(runsCache);
    }
    if (!fetchPromise) {
      fetchPromise = fetchJSON("integrum_security_scanner_history", {}).then(function(payload) {
        fetchPromise = null;
        runsCache = payload && payload.data && payload.data.runs || [];
        return runsCache;
      }).catch(function() {
        fetchPromise = null;
        return [];
      });
    }
    return fetchPromise;
  }
  function refreshHistory() {
    if (!bodyEl) {
      return;
    }
    runsCache = null;
    fetchRuns().then(renderRuns);
  }
  function renderRuns(runs) {
    bodyEl.textContent = "";
    runs.forEach(function(run) {
      bodyEl.appendChild(buildRunRows(run));
    });
    if (emptyEl) {
      emptyEl.hidden = runs.length > 0;
    }
  }
  function buildRunRows(run) {
    const frag = document.createDocumentFragment();
    const row = document.createElement("tr");
    row.className = "iss-history__row";
    row.dataset.job = run.job_id;
    row.setAttribute("aria-expanded", "false");
    const dateTd = document.createElement("td");
    dateTd.className = "iss-history__td";
    dateTd.textContent = run.date;
    row.appendChild(dateTd);
    const problemsTd = document.createElement("td");
    problemsTd.className = "iss-history__td";
    const count = document.createElement("span");
    count.className = "iss-history__count" + (run.problems > 0 ? " iss-history__count--alert" : " iss-history__count--ok");
    count.textContent = String(run.problems);
    problemsTd.appendChild(count);
    row.appendChild(problemsTd);
    const scannedTd = document.createElement("td");
    scannedTd.className = "iss-history__td iss-history__td--muted";
    scannedTd.textContent = String(run.scanned);
    row.appendChild(scannedTd);
    frag.appendChild(row);
    const detail = document.createElement("tr");
    detail.className = "iss-history__detail";
    detail.hidden = true;
    const detailTd = document.createElement("td");
    detailTd.colSpan = 3;
    detailTd.className = "iss-history__detail-td";
    const tree = document.createElement("div");
    tree.className = "iss-tree iss-history__tree";
    tree.dataset.job = run.job_id;
    detailTd.appendChild(tree);
    detail.appendChild(detailTd);
    frag.appendChild(detail);
    return frag;
  }
  function buildTree(files) {
    const root = document.createElement("ul");
    root.className = "iss-tree__list is-root";
    const lists = { "": root };
    if (!files.length) {
      const li = document.createElement("li");
      li.className = "iss-history__no-files";
      li.textContent = CFG.i18n && CFG.i18n.historyClean || "No problem files in this scan.";
      root.appendChild(li);
      return root;
    }
    function folderList(rel) {
      if (lists[rel]) {
        return lists[rel];
      }
      const segs = rel.split("/");
      const li = document.createElement("li");
      li.className = "iss-tree__folder";
      li.dataset.rel = rel;
      const toggle = document.createElement("span");
      toggle.className = "iss-tree__toggle";
      toggle.textContent = "\u25BE";
      const name = document.createElement("span");
      name.className = "iss-tree__folder-name";
      name.textContent = segs[segs.length - 1] + "/";
      li.appendChild(toggle);
      li.appendChild(name);
      const ul = document.createElement("ul");
      ul.className = "iss-tree__list";
      li.appendChild(ul);
      folderList(segs.slice(0, -1).join("/")).appendChild(li);
      toggle.addEventListener("click", function() {
        ul.hidden = !ul.hidden;
        toggle.textContent = ul.hidden ? "\u25B8" : "\u25BE";
      });
      lists[rel] = ul;
      return ul;
    }
    files.forEach(function(file) {
      folderList(dirname(file.file_path)).appendChild(renderFile(file));
    });
    return root;
  }
  function ensureTree(detail) {
    const treeEl2 = detail.querySelector(".iss-history__tree");
    if (!treeEl2 || treeEl2.childElementCount) {
      return Promise.resolve();
    }
    treeEl2.textContent = CFG.i18n && CFG.i18n.historyLoading || "Loading\u2026";
    return fetchRuns().then(function(runs) {
      const run = runs.filter(function(r) {
        return r.job_id === treeEl2.dataset.job;
      })[0] || null;
      treeEl2.textContent = "";
      treeEl2.appendChild(buildTree(run ? run.files : []));
    });
  }
  if (bodyEl) {
    bodyEl.addEventListener("click", function(event) {
      const row = event.target.closest ? event.target.closest(".iss-history__row") : null;
      if (!row) {
        return;
      }
      const detail = row.nextElementSibling;
      if (!detail || !detail.classList.contains("iss-history__detail")) {
        return;
      }
      if (detail.hidden) {
        ensureTree(detail).then(function() {
          detail.hidden = false;
          row.setAttribute("aria-expanded", "true");
        });
      } else {
        detail.hidden = true;
        row.setAttribute("aria-expanded", "false");
      }
    });
  }

  // wp-content/plugins/integrum-security-scanner/assets/js/src/status.js
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
    const statusSection = document.querySelector(".iss-status");
    const stopBtn = document.querySelector(".iss-scan-actions__stop");
    const startBtn = document.querySelector(".iss-scan-actions__start");
    if (!statusSection) {
      return;
    }
    revealIntoView(statusSection);
    setDirTreeLocked(true);
    const progressBar = statusSection.querySelector(".iss-progress__bar");
    const progressLabel = statusSection.querySelector(".iss-progress__label");
    let samples = [];
    function pollStatus() {
      fetchJSON("integrum_security_scanner_status", { job_id: jobId }).then(onStatus).catch(function() {
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
      setDirTreeLocked(false);
      if (stopBtn) {
        stopBtn.disabled = true;
      }
      if (startBtn) {
        startBtn.disabled = false;
      }
      hideScanNotice(statusSection);
      loadResults(jobId).then(function(rows) {
        showSummary(statusSection, status, rows);
        refreshHistory();
      });
    }
    function hideScanNotice(statusSection2) {
      const section = statusSection2.closest("section");
      if (!section) {
        return;
      }
      Array.prototype.forEach.call(
        section.querySelectorAll(".integrum-security-scanner-notice"),
        function(notice) {
          notice.hidden = true;
        }
      );
    }
    function showSummary(statusSection2, status, rows) {
      const summary = statusSection2.parentElement ? statusSection2.parentElement.querySelector(".iss-scan-summary") : null;
      if (!summary) {
        return;
      }
      const i18n = CFG.i18n || {};
      let text;
      let skin;
      if ("failed" === status) {
        text = i18n.scanFailed || "Scan failed.";
        skin = "iss-scan-summary--failed";
      } else {
        const suspicious = rows.filter(function(row) {
          return row.status && "clean" !== row.status;
        }).length;
        text = (i18n.scanCompleted || "Scan completed: {scanned} files scanned, {suspicious} suspicious.").replace("{scanned}", String(rows.length)).replace("{suspicious}", String(suspicious));
        skin = suspicious > 0 ? "iss-scan-summary--findings" : "iss-scan-summary--clean";
      }
      summary.textContent = text;
      summary.className = "iss-scan-summary mb-4 rounded-lg border px-4 py-3 text-sm " + skin;
      summary.hidden = false;
    }
    pollStatus();
  }

  // wp-content/plugins/integrum-security-scanner/assets/js/src/notices.js
  function initNotices() {
    const notice = document.querySelector(".integrum-security-scanner-notice");
    if (!notice) {
      return;
    }
    const jobIdInput2 = document.querySelector(".iss-job-id");
    if (jobIdInput2 && jobIdInput2.value) {
      return;
    }
    scrollIntoView(notice);
  }

  // wp-content/plugins/integrum-security-scanner/assets/js/src/main.js
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
  var jobIdInput = document.querySelector(".iss-job-id");
  if (jobIdInput && jobIdInput.value) {
    initPolling(jobIdInput.value);
  } else {
    initNotices();
  }
})();
