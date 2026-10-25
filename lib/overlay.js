// Overlay anotasi — copy dari pi-browser-plus (milik penulis), dipakai dengan credit.
/**
 * pi-browser-plus annotation overlay.
 *
 * Injected into the page with `eval --stdin` or as a page init script. This file
 * is a plain script, not a module: the extension reads its text and sends it to
 * the browser verbatim.
 *
 * It installs `window.__piAnn` with:
 *   setMode("off" | "comment" | "style")   toggle interaction
 *   read()                                 annotations as plain JSON
 *   clear()                                drop annotations and their styles
 *
 * The UI lives in a shadow root so page CSS cannot restyle it, and the host is
 * marked aria-hidden so browser snapshots do not treat it as page content.
 *
 * Annotations survive navigation through sessionStorage, re-resolving their
 * selectors on load. A selector that no longer resolves is kept and marked
 * stale rather than dropped, so the comment is not lost.
 */
(function () {
	if (window.__piAnn && window.__piAnn.version === 2) return;

	var HOST_ID = "pi-ann-host";
	var MARK = "data-pi-ann";
	// Annotations belong to a page, so they are stored per path. That survives a
	// reload and a return visit without mis-anchoring selectors on another page.
	var STORE_PREFIX = "__pi_ann_v2:";
	var DRAG_THRESHOLD = 8;
	var Z = 2147483647;

	function storeKey() {
		try {
			return STORE_PREFIX + location.origin + location.pathname;
		} catch (e) {
			return STORE_PREFIX + "unknown";
		}
	}

	var STYLE_PROPS = [
		{ key: "font-family", label: "Font", type: "select",
			options: ["", "system-ui", "Georgia, serif", "Times New Roman, serif", "Arial, sans-serif", "Verdana, sans-serif", "Courier New, monospace", "Inter, sans-serif"] },
		{ key: "font-size", label: "Size", type: "text" },
		{ key: "font-weight", label: "Weight", type: "select",
			options: ["", "300", "400", "500", "600", "700", "800"] },
		{ key: "line-height", label: "Line height", type: "text" },
		{ key: "color", label: "Color", type: "color" },
		{ key: "background-color", label: "Background", type: "color" },
		{ key: "padding", label: "Padding", type: "text" },
		{ key: "margin", label: "Margin", type: "text" },
		{ key: "text-align", label: "Align", type: "select", options: ["", "left", "center", "right", "justify"] },
		{ key: "border-radius", label: "Radius", type: "text" },
	];

	var state = {
		mode: "off",
		items: [],
		nextId: 1,
		hover: null,
		styleTarget: null,
		pending: null,
		drag: null,
		// Set after a completed drag so the click that follows it does not also
		// create an element annotation on top of the region annotation.
		suppressClick: false,
	};

	// --- element analysis ---------------------------------------------------

	function unique(selector) {
		try {
			return document.querySelectorAll(selector).length === 1;
		} catch (e) {
			return false;
		}
	}

	/**
	 * A short, stable selector for an element: id, then a unique class-qualified
	 * selector, then ancestry with :nth-of-type only where siblings collide.
	 */
	function cssPath(el) {
		if (!el || el.nodeType !== 1) return "";
		if (el.id && unique("#" + CSS.escape(el.id))) return "#" + CSS.escape(el.id);

		var parts = [];
		var node = el;
		while (node && node.nodeType === 1 && node !== document.documentElement) {
			var tag = node.tagName.toLowerCase();
			if (node.id && unique("#" + CSS.escape(node.id))) {
				parts.unshift("#" + CSS.escape(node.id));
				break;
			}
			var testid =
				node.getAttribute && (node.getAttribute("data-testid") || node.getAttribute("data-test-id"));
			if (testid && unique(tag + '[data-testid="' + testid + '"]')) {
				parts.unshift(tag + '[data-testid="' + testid + '"]');
				break;
			}

			var classes = [];
			if (node.classList) {
				for (var i = 0; i < node.classList.length && classes.length < 2; i++) {
					var cls = node.classList[i];
					if (cls && !/^[0-9]/.test(cls)) classes.push(CSS.escape(cls));
				}
			}
			var part = tag + (classes.length ? "." + classes.join(".") : "");
			if (classes.length && unique(part)) {
				parts.unshift(part);
				break;
			}

			var parent = node.parentElement;
			if (parent) {
				var same = [];
				for (var j = 0; j < parent.children.length; j++) {
					if (parent.children[j].tagName === node.tagName) same.push(parent.children[j]);
				}
				if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
			}
			parts.unshift(part);
			node = parent;
		}
		return parts.join(" > ");
	}

	function describe(el) {
		if (!el) return "";
		var text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
		var label = el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("placeholder"));
		var name = el.getAttribute && el.getAttribute("name");
		var bits = [el.tagName.toLowerCase()];
		if (label) bits.push('"' + label + '"');
		else if (name) bits.push("name=" + name);
		else if (text) bits.push('"' + text + '"');
		return bits.join(" ");
	}

	function isOurs(el) {
		if (!el) return true;
		if (el === host) return true;
		if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute(MARK)) return true;
		var node = el;
		while (node) {
			if (node === host) return true;
			node = node.parentNode || node.host || null;
		}
		return false;
	}

	/** True when the event came from our own UI, revealed through the shadow root. */
	function fromOverlay(event) {
		var path = (event.composedPath && event.composedPath()) || [];
		for (var i = 0; i < path.length; i++) {
			if (path[i] === host || path[i] === root) return true;
		}
		return false;
	}

	function isInteractive(el) {
		if (!el || el.nodeType !== 1) return false;
		var tag = el.tagName;
		if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return true;
		var role = el.getAttribute && el.getAttribute("role");
		return !!role && /^(button|link|tab|menuitem|checkbox|radio|switch|option)$/.test(role);
	}

	function hasDirectText(el) {
		if (!el || el.nodeType !== 1) return false;
		for (var i = 0; i < el.childNodes.length; i++) {
			var node = el.childNodes[i];
			if (node.nodeType === 3 && node.textContent.trim().length > 1) return true;
		}
		return false;
	}

	/** Decorative layers that cover real content and carry no meaning of their own. */
	function isDecorative(el) {
		if (!el || el.nodeType !== 1) return false;
		return el.tagName === "CANVAS" || el.tagName.toLowerCase() === "svg";
	}

	/**
	 * Choose the element a user most likely means.
	 *
	 * Real sites stack decorative layers (an animated canvas, a gradient overlay)
	 * over real content with `pointer-events: auto`, so the topmost element at a
	 * point is often a canvas that means nothing. Walk the stack that contains the
	 * point and prefer an interactive element, then one with its own text, then
	 * the topmost non-decorative element.
	 */
	function pick(x, y) {
		var stack = document.elementsFromPoint(x, y);
		var usable = [];
		for (var i = 0; i < stack.length; i++) {
			if (!isOurs(stack[i])) usable.push(stack[i]);
		}
		if (!usable.length) {
			// Our host may be covering the point.
			host.style.pointerEvents = "none";
			var beneath = document.elementsFromPoint(x, y);
			host.style.pointerEvents = "";
			for (var k = 0; k < beneath.length; k++) {
				if (!isOurs(beneath[k])) usable.push(beneath[k]);
			}
		}
		if (!usable.length) return null;

		for (var a = 0; a < usable.length; a++) {
			if (isInteractive(usable[a])) return usable[a];
		}
		for (var b = 0; b < usable.length; b++) {
			if (!isDecorative(usable[b]) && hasDirectText(usable[b])) return usable[b];
		}
		for (var c = 0; c < usable.length; c++) {
			if (!isDecorative(usable[c])) return usable[c];
		}
		return usable[0];
	}

	// --- shadow UI ----------------------------------------------------------

	var host = document.createElement("div");
	host.id = HOST_ID;
	host.setAttribute(MARK, "");
	host.setAttribute("aria-hidden", "true");
	host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:" + Z + ";";
	var root = host.attachShadow({ mode: "open" });

	var css = document.createElement("style");
	css.textContent = [
		"*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,sans-serif}",
		".bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:6px;align-items:center;",
		"background:#111a;color:#fff;padding:7px 10px;border-radius:10px;pointer-events:auto;font-size:12px;",
		"box-shadow:0 6px 22px #0007;backdrop-filter:blur(6px);max-width:92vw;flex-wrap:wrap}",
		".bar b{font-weight:600;letter-spacing:.04em;color:#7dd3fc;margin-right:2px}",
		".bar button{all:unset;cursor:pointer;padding:4px 9px;border-radius:6px;background:#ffffff1f;color:#fff;font-size:12px}",
		".bar button:hover{background:#ffffff33}",
		".bar button[data-on]{background:#0284c7;font-weight:600}",
		".bar .hint{color:#ffffff99;font-size:11px;margin-left:4px}",
		".hl{position:fixed;pointer-events:none;border:2px solid #0284c7;background:#0284c71a;border-radius:3px;z-index:1}",
		".band{position:fixed;pointer-events:none;border:2px dashed #0284c7;background:#0284c726;border-radius:3px;z-index:2}",
		".pin{position:fixed;pointer-events:none;border:2px solid #f59e0b;border-radius:3px;z-index:1}",
		".pin.region{border-style:dashed}",
		".badge{position:fixed;background:#f59e0b;color:#111;font-size:11px;font-weight:700;padding:1px 5px;",
		"border-radius:9px;pointer-events:auto;cursor:pointer;z-index:3;box-shadow:0 1px 5px #0006}",
		".badge.stale{background:#9ca3af}",
		".pop,.panel{position:fixed;pointer-events:auto;background:#111;color:#fff;border:1px solid #333;border-radius:9px;",
		"padding:9px;font-size:12px;z-index:4;box-shadow:0 10px 30px #0008;width:300px}",
		".pop textarea,.panel textarea{all:unset;display:block;width:100%;min-height:54px;background:#000;color:#fff;",
		"border:1px solid #444;border-radius:6px;padding:6px;font-size:12px;resize:vertical}",
		".row{display:flex;gap:6px;justify-content:flex-end;margin-top:7px;align-items:center}",
		".row button{all:unset;cursor:pointer;padding:4px 10px;border-radius:6px;background:#0284c7;color:#fff;font-size:12px}",
		".row button.ghost{background:#ffffff1f}",
		".row button.danger{background:#b91c1c}",
		".row .grow{flex:1}",
		".panel .f{display:flex;align-items:center;gap:6px;margin-bottom:5px}",
		".panel .f label{width:78px;color:#ffffffb3;font-size:11px}",
		".panel .f input,.panel .f select{all:unset;flex:1;background:#000;color:#fff;border:1px solid #444;",
		"border-radius:5px;padding:3px 6px;font-size:12px;min-width:0}",
		".panel .f input[type=color]{height:22px;padding:1px;flex:0 0 42px}",
		".panel h4{margin:0 0 8px;font-size:12px;color:#7dd3fc;font-weight:600}",
		".panel .sel{font-size:11px;color:#ffffff99;margin-bottom:7px;word-break:break-all}",
		".list{max-height:52vh;overflow:auto}",
		".list .it{border-top:1px solid #ffffff1f;padding:6px 0;display:flex;gap:8px;align-items:flex-start}",
		".list .it:first-child{border-top:0}",
		".list .n{color:#f59e0b;font-weight:700;min-width:16px}",
		".list .body{flex:1;min-width:0}",
		".list .sel2{font-size:10px;color:#ffffff80;word-break:break-all;margin-top:2px}",
		".list .acts{display:flex;gap:4px;flex-shrink:0}",
		".list .acts button{all:unset;cursor:pointer;font-size:11px;padding:2px 6px;border-radius:4px;background:#ffffff1f;color:#fff}",
		".list .stale{color:#9ca3af;font-size:10px}",
	].join("");

	var bar = document.createElement("div");
	bar.className = "bar";
	root.append(css, bar);

	function barButton(label, mode) {
		var b = document.createElement("button");
		b.textContent = label;
		b.dataset.mode = mode;
		b.onclick = function (event) {
			event.stopPropagation();
			setMode(state.mode === mode ? "off" : mode);
		};
		return b;
	}

	var btnComment = barButton("Comment", "comment");
	var btnStyle = barButton("Style", "style");
	var btnList = document.createElement("button");
	btnList.textContent = "List";
	btnList.onclick = function (event) {
		event.stopPropagation();
		openList();
	};
	var btnDone = document.createElement("button");
	btnDone.textContent = "Done";
	btnDone.onclick = function (event) {
		event.stopPropagation();
		setMode("off");
	};
	var count = document.createElement("span");
	count.className = "hint";
	var hint = document.createElement("span");
	hint.className = "hint";

	var brand = document.createElement("b");
	brand.textContent = "PI ANNOTATE";
	bar.append(brand, btnComment, btnStyle, btnList, btnDone, count, hint);

	var hl = document.createElement("div");
	hl.className = "hl";
	hl.style.display = "none";
	var band = document.createElement("div");
	band.className = "band";
	band.style.display = "none";
	root.append(hl, band);

	// --- mounting -----------------------------------------------------------

	// An init script runs before the parser creates <html>, so the host may have
	// to wait for documentElement. Everything else is built detached and is fine.
	function mountHost(callback) {
		if (document.documentElement) {
			document.documentElement.appendChild(host);
			callback();
			return;
		}
		document.addEventListener(
			"DOMContentLoaded",
			function () {
				if (document.documentElement) document.documentElement.appendChild(host);
				callback();
			},
			{ once: true },
		);
	}

	// --- annotation rendering ----------------------------------------------

	function boxOf(item) {
		if (item.el && item.el.isConnected) {
			var r = item.el.getBoundingClientRect();
			return { left: r.left, top: r.top, width: r.width, height: r.height, live: true };
		}
		if (item.rect) {
			return {
				left: item.rect.x - window.scrollX,
				top: item.rect.y - window.scrollY,
				width: item.rect.w,
				height: item.rect.h,
				live: false,
			};
		}
		return null;
	}

	function reposition() {
		for (var i = 0; i < state.items.length; i++) {
			var item = state.items[i];
			var box = boxOf(item);
			if (!box) {
				if (item.box) item.box.style.display = "none";
				if (item.badgeEl) item.badgeEl.style.display = "none";
				continue;
			}
			if (item.box) {
				item.box.style.display = "block";
				item.box.style.left = box.left + "px";
				item.box.style.top = box.top + "px";
				item.box.style.width = box.width + "px";
				item.box.style.height = box.height + "px";
			}
			if (item.badgeEl) {
				item.badgeEl.style.display = "block";
				item.badgeEl.style.left = Math.max(2, box.left - 6) + "px";
				item.badgeEl.style.top = Math.max(2, box.top - 10) + "px";
			}
		}
	}

	var repositionQueued = false;
	function queueReposition() {
		if (repositionQueued) return;
		repositionQueued = true;
		requestAnimationFrame(function () {
			repositionQueued = false;
			reposition();
		});
	}

	window.addEventListener("scroll", queueReposition, true);
	window.addEventListener("resize", queueReposition);

	function renderItem(item) {
		var box = document.createElement("div");
		box.className = "pin" + (item.kind === "region" ? " region" : "");
		box.setAttribute(MARK, "");
		var badge = document.createElement("div");
		badge.className = "badge" + (item.stale ? " stale" : "");
		badge.setAttribute(MARK, "");
		badge.textContent = String(item.id);
		badge.title = "Click to edit or delete";
		badge.onclick = function (event) {
			event.stopPropagation();
			editItem(item.id);
		};
		root.append(box, badge);
		item.box = box;
		item.badgeEl = badge;
	}

	function removeItem(id) {
		state.items = state.items.filter(function (item) {
			if (item.id !== id) return true;
			if (item.box) item.box.remove();
			if (item.badgeEl) item.badgeEl.remove();
			return false;
		});
		persist();
		updateChrome();
	}

	function updateChrome() {
		count.textContent = state.items.length ? String(state.items.length) + " marked" : "";
		btnComment.toggleAttribute("data-on", state.mode === "comment");
		btnStyle.toggleAttribute("data-on", state.mode === "style");
		if (state.mode === "comment") hint.textContent = "click, or drag an area";
		else if (state.mode === "style") hint.textContent = "click an element to restyle";
		else hint.textContent = state.items.length ? "done" : "";
		bar.style.display = "flex";
		queueReposition();
	}

	// --- persistence --------------------------------------------------------

	function serializable(item) {
		return {
			id: item.id,
			kind: item.kind,
			selector: item.selector,
			tag: item.tag,
			describe: item.describe,
			text: item.text,
			comment: item.comment,
			styles: item.styles,
			rect: item.rect,
		};
	}

	function persist() {
		try {
			sessionStorage.setItem(storeKey(), JSON.stringify(state.items.map(serializable)));
		} catch (e) {
			// Storage may be unavailable or full; annotations still work in-page.
		}
	}

	function restore() {
		var raw;
		try {
			raw = sessionStorage.getItem(storeKey());
		} catch (e) {
			return;
		}
		if (!raw) return;
		var saved;
		try {
			saved = JSON.parse(raw);
		} catch (e) {
			return;
		}
		if (!saved || !saved.length) return;

		for (var i = 0; i < saved.length; i++) {
			var record = saved[i];
			var el = null;
			if (record.selector) {
				try {
					el = document.querySelector(record.selector);
				} catch (e) {
					el = null;
				}
			}
			// A region is anchored to its stored coordinates, so it is never stale.
			// An element annotation with no resolved element and no rect is.
			var anchored = !!el || !!record.rect;
			if (!anchored) continue;
			var item = {
				id: record.id,
				kind: record.kind,
				selector: record.selector,
				tag: record.tag,
				describe: record.describe,
				text: record.text,
				comment: record.comment,
				styles: record.styles,
				rect: record.rect,
				el: el,
				stale: !el && record.kind !== "region",
			};
			state.items.push(item);
			renderItem(item);
			if (item.id >= state.nextId) state.nextId = item.id + 1;
		}
		updateChrome();
	}

	// --- comment popup (also used to edit) ---------------------------------

	var pop = null;

	function closePop() {
		if (pop) pop.remove();
		pop = null;
		state.pending = null;
	}

	/**
	 * Open the comment box. With `editing` an existing annotation, Save updates it
	 * and a Delete button appears.
	 */
	function openPop(target, x, y, editing) {
		closePop();
		state.pending = target;
		pop = document.createElement("div");
		pop.className = "pop";
		pop.setAttribute(MARK, "");
		var ta = document.createElement("textarea");
		ta.placeholder = "What should change here?";
		ta.value = editing ? editing.comment || "" : "";
		var row = document.createElement("div");
		row.className = "row";

		if (editing) {
			var del = document.createElement("button");
			del.className = "danger";
			del.textContent = "Delete";
			del.onclick = function (e) {
				e.stopPropagation();
				removeItem(editing.id);
				closePop();
			};
			row.append(del);
		}
		var grow = document.createElement("div");
		grow.className = "grow";
		var cancel = document.createElement("button");
		cancel.className = "ghost";
		cancel.textContent = "Cancel";
		cancel.onclick = function (e) {
			e.stopPropagation();
			closePop();
		};
		var save = document.createElement("button");
		save.textContent = "Save";
		save.onclick = function (e) {
			e.stopPropagation();
			commit();
		};
		row.append(grow, cancel, save);
		pop.append(ta, row);

		var left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 312));
		var top = Math.min(Math.max(8, y + 10), Math.max(8, window.innerHeight - 160));
		pop.style.left = left + "px";
		pop.style.top = top + "px";
		pop.addEventListener("keydown", function (e) {
			if (e.key === "Escape") {
				e.stopPropagation();
				closePop();
			}
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.stopPropagation();
				commit();
			}
		});
		root.append(pop);
		ta.focus();

		function commit() {
			var text = ta.value.trim();
			if (!text) return closePop();
			if (editing) {
				editing.comment = text;
				persist();
				closePop();
				return;
			}
			if (target && target.region) addRegion(target, text);
			else if (target) addItem({ kind: "comment", el: target, comment: text });
			closePop();
		}
	}

	function editItem(id) {
		var item = null;
		for (var i = 0; i < state.items.length; i++) {
			if (state.items[i].id === id) item = state.items[i];
		}
		if (!item) return;
		var box = boxOf(item);
		var x = box ? box.left : 40;
		var y = box ? box.top + box.height : 60;
		openPop(item, x, y, item);
	}

	// --- list panel ---------------------------------------------------------

	var listPanel = null;

	function closeList() {
		if (listPanel) listPanel.remove();
		listPanel = null;
	}

	function openList() {
		closeList();
		listPanel = document.createElement("div");
		listPanel.className = "panel";
		listPanel.setAttribute(MARK, "");
		var title = document.createElement("h4");
		title.textContent = "Annotations (" + state.items.length + ")";
		listPanel.append(title);

		if (!state.items.length) {
			var empty = document.createElement("div");
			empty.className = "sel";
			empty.textContent = "Nothing marked yet.";
			listPanel.append(empty);
		}

		var body = document.createElement("div");
		body.className = "list";
		state.items.forEach(function (item) {
			var row = document.createElement("div");
			row.className = "it";
			var n = document.createElement("div");
			n.className = "n";
			n.textContent = String(item.id);
			var mid = document.createElement("div");
			mid.className = "body";
			var what = document.createElement("div");
			what.textContent = item.comment || (item.styles ? "style change" : "");
			var sel = document.createElement("div");
			sel.className = "sel2";
			sel.textContent = item.selector || "(region)";
			mid.append(what, sel);
			if (item.stale) {
				var stale = document.createElement("div");
				stale.className = "stale";
				stale.textContent = "element no longer on this page";
				mid.append(stale);
			}
			var acts = document.createElement("div");
			acts.className = "acts";
			var edit = document.createElement("button");
			edit.textContent = "Edit";
			edit.onclick = function (e) {
				e.stopPropagation();
				closeList();
				editItem(item.id);
			};
			var del = document.createElement("button");
			del.textContent = "Delete";
			del.onclick = function (e) {
				e.stopPropagation();
				removeItem(item.id);
				closeList();
				openList();
			};
			acts.append(edit, del);
			row.append(n, mid, acts);
			body.append(row);
		});
		listPanel.append(body);

		var row = document.createElement("div");
		row.className = "row";
		var clear = document.createElement("button");
		clear.className = "ghost";
		clear.textContent = "Clear all";
		clear.onclick = function (e) {
			e.stopPropagation();
			clear();
			closeList();
		};
		var close = document.createElement("button");
		close.textContent = "Close";
		close.onclick = function (e) {
			e.stopPropagation();
			closeList();
		};
		row.append(clear, close);
		listPanel.append(row);

		listPanel.style.left = "50%";
		listPanel.style.top = "80px";
		listPanel.style.transform = "translateX(-50%)";
		listPanel.onclick = function (e) {
			e.stopPropagation();
		};
		root.append(listPanel);
	}

	// --- add items ----------------------------------------------------------

	function addItem(partial) {
		var el = partial.el;
		var item = {
			id: state.nextId++,
			kind: partial.kind,
			comment: partial.comment || "",
			styles: partial.styles || null,
			rect: partial.rect || null,
			selector: el ? cssPath(el) : "",
			tag: el ? el.tagName.toLowerCase() : "region",
			describe: el ? describe(el) : "selected area",
			text: el ? (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) : "",
			el: el || null,
		};
		state.items.push(item);
		renderItem(item);
		persist();
		updateChrome();
		return item;
	}

	/** A dragged area, in page coordinates so it survives scrolling. */
	function addRegion(region, comment) {
		return addItem({
			kind: "region",
			comment: comment,
			rect: {
				x: region.x + window.scrollX,
				y: region.y + window.scrollY,
				w: region.w,
				h: region.h,
			},
		});
	}

	// --- style panel --------------------------------------------------------

	var panel = null;

	function closePanel() {
		if (panel) panel.remove();
		panel = null;
		state.styleTarget = null;
	}

	function openPanel(el) {
		closePanel();
		state.styleTarget = el;
		var overrides = {};

		panel = document.createElement("div");
		panel.className = "panel";
		panel.setAttribute(MARK, "");
		var title = document.createElement("h4");
		title.textContent = "Style adjust";
		var sel = document.createElement("div");
		sel.className = "sel";
		sel.textContent = cssPath(el);
		panel.append(title, sel);

		STYLE_PROPS.forEach(function (prop) {
			var row = document.createElement("div");
			row.className = "f";
			var label = document.createElement("label");
			label.textContent = prop.label;
			var input;
			if (prop.type === "select") {
				input = document.createElement("select");
				prop.options.forEach(function (value) {
					var opt = document.createElement("option");
					opt.value = value;
					opt.textContent = value || "(unchanged)";
					input.append(opt);
				});
			} else {
				input = document.createElement("input");
				input.type = prop.type === "color" ? "color" : "text";
				if (prop.type !== "color" && prop.key === "font-size") input.placeholder = "e.g. 18px";
			}
			var current = el.style.getPropertyValue(prop.key) || getComputedStyle(el).getPropertyValue(prop.key) || "";
			if (prop.type === "color") {
				input.value = /^#/.test(current.trim()) ? current.trim() : "#000000";
			} else if (prop.type === "select") {
				input.value = prop.options.indexOf(current.trim()) >= 0 ? current.trim() : "";
			} else {
				input.value = el.style.getPropertyValue(prop.key) || "";
			}
			input.oninput = input.onchange = function () {
				var value = input.value.trim();
				if (!value) {
					el.style.removeProperty(prop.key);
					delete overrides[prop.key];
				} else {
					el.style.setProperty(prop.key, value);
					overrides[prop.key] = value;
				}
			};
			input.onclick = function (e) {
				e.stopPropagation();
			};
			row.append(label, input);
			panel.append(row);
		});

		var row = document.createElement("div");
		row.className = "row";
		var cancel = document.createElement("button");
		cancel.className = "ghost";
		cancel.textContent = "Revert";
		cancel.onclick = function (e) {
			e.stopPropagation();
			Object.keys(overrides).forEach(function (key) {
				el.style.removeProperty(key);
			});
			closePanel();
		};
		var save = document.createElement("button");
		save.textContent = "Save style";
		save.onclick = function (e) {
			e.stopPropagation();
			if (Object.keys(overrides).length === 0) return closePanel();
			addItem({ kind: "style", el: el, styles: Object.assign({}, overrides), comment: "style adjust" });
			closePanel();
		};
		row.append(cancel, save);
		panel.append(row);

		var rect = el.getBoundingClientRect();
		var left = Math.min(Math.max(8, rect.right + 8), Math.max(8, window.innerWidth - 312));
		var top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - 380));
		panel.style.left = left + "px";
		panel.style.top = top + "px";
		panel.onclick = function (e) {
			e.stopPropagation();
		};
		root.append(panel);
	}

	// --- interaction --------------------------------------------------------

	function onMove(event) {
		if (state.mode === "off" || pop || panel) return;
		if (state.drag) {
			var dx = event.clientX - state.drag.x0;
			var dy = event.clientY - state.drag.y0;
			if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) state.drag.moved = true;
			state.drag.x = event.clientX;
			state.drag.y = event.clientY;
			band.style.display = "block";
			band.style.left = Math.min(state.drag.x0, event.clientX) + "px";
			band.style.top = Math.min(state.drag.y0, event.clientY) + "px";
			band.style.width = Math.abs(dx) + "px";
			band.style.height = Math.abs(dy) + "px";
			hl.style.display = "none";
			return;
		}
		if (fromOverlay(event)) {
			hl.style.display = "none";
			return;
		}
		var el = pick(event.clientX, event.clientY);
		if (!el) {
			hl.style.display = "none";
			return;
		}
		var r = el.getBoundingClientRect();
		hl.style.display = "block";
		hl.style.left = r.left + "px";
		hl.style.top = r.top + "px";
		hl.style.width = r.width + "px";
		hl.style.height = r.height + "px";
		state.hover = el;
	}

	function onDown(event) {
		if (state.mode !== "comment") return; // drag selects an area for a comment
		if (pop || panel || listPanel) return;
		if (fromOverlay(event)) return;
		state.suppressClick = false; // a fresh interaction clears any stale suppression
		state.drag = { x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, moved: false };
	}

	function onUp(event) {
		if (!state.drag) return;
		var drag = state.drag;
		state.drag = null;
		band.style.display = "none";
		if (fromOverlay(event)) return;

		event.preventDefault();
		event.stopPropagation();

		if (!drag.moved) return; // a plain click is handled by onClick

		var x = Math.min(drag.x0, drag.x);
		var y = Math.min(drag.y0, drag.y);
		var w = Math.abs(drag.x - drag.x0);
		var h = Math.abs(drag.y - drag.y0);
		if (w < DRAG_THRESHOLD || h < DRAG_THRESHOLD) return;
		// The browser fires click after mouseup; swallow it or it would replace the
		// region annotation with an element one.
		state.suppressClick = true;
		openPop({ region: true, x: x, y: y, w: w, h: h }, x + 8, y + h);
	}

	function onClick(event) {
		if (state.mode === "off") return;
		if (fromOverlay(event)) return;
		if (state.suppressClick) {
			state.suppressClick = false;
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		var el = pick(event.clientX, event.clientY);
		if (!el) return;
		// Swallow the page's own handler so annotating never activates a control.
		event.preventDefault();
		event.stopPropagation();
		if (state.mode === "comment") openPop(el, event.clientX, event.clientY);
		else if (state.mode === "style") openPanel(el);
	}

	function onKey(event) {
		if (state.mode === "off") return;
		if (event.key === "Escape") {
			if (pop) {
				event.stopPropagation();
				closePop();
			} else if (listPanel) {
				event.stopPropagation();
				closeList();
			} else if (panel) {
				event.stopPropagation();
				closePanel();
			} else {
				setMode("off");
			}
		}
	}

	document.addEventListener("mousemove", onMove, true);
	document.addEventListener("mousedown", onDown, true);
	document.addEventListener("mouseup", onUp, true);
	document.addEventListener("click", onClick, true);
	document.addEventListener("keydown", onKey, true);

	function setMode(mode) {
		if (mode !== "comment" && mode !== "style") mode = "off";
		state.mode = mode;
		state.drag = null;
		band.style.display = "none";
		if (mode === "off") {
			hl.style.display = "none";
			closePop();
			closePanel();
			closeList();
			document.documentElement.style.cursor = "";
		} else {
			document.documentElement.style.cursor = "crosshair";
		}
		updateChrome();
		return state.mode;
	}

	function read() {
		return {
			mode: state.mode,
			count: state.items.length,
			items: state.items.map(serializable).map(function (record) {
				var item = null;
				for (var i = 0; i < state.items.length; i++) {
					if (state.items[i].id === record.id) item = state.items[i];
				}
				record.stale = !!(item && item.stale);
				return record;
			}),
		};
	}

	function clear() {
		state.items.slice().forEach(function (item) {
			if (item.box) item.box.remove();
			if (item.badgeEl) item.badgeEl.remove();
		});
		state.items = [];
		state.nextId = 1;
		closePop();
		closePanel();
		closeList();
		persist();
		updateChrome();
		return read();
	}

	window.__piAnn = {
		version: 2,
		setMode: setMode,
		read: read,
		clear: clear,
		get mode() {
			return state.mode;
		},
	};

	mountHost(function () {
		restore();
		updateChrome();
	});
})();
