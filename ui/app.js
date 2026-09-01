/* ============================================================
   Разворот, который правится пальцем.

   Экрана настроек здесь нет как сущности. Страница «Расписание
   уроков» из настоящего дневника и есть редактор: тапаешь по клетке
   и вписываешь своё.
   ============================================================ */
(function (D) {
  "use strict";

  var doc = null;                 // текущий дневник
  var docs = [];                  // все дневники на устройстве
  var journal = new D.Journal(200);
  var weekId = D.weekId(new Date());
  var composing = false;          // идёт ввод через подсказку клавиатуры
  var saveTimer = null;
  var toastTimer = null;

  var $ = function (sel) { return document.querySelector(sel); };
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  /* ---------- изменение документа ---------- */

  /* Единственная дверь, через которую документ меняется.

     silent означает «не перерисовывать разворот». Это не оптимизация,
     а необходимость: перерисовка пересоздаёт клетки, а вместе с ними
     теряется каретка — и цепочка ввода по Enter рвётся на первом же
     слове. Когда правка уже видна на экране (человек сам набрал текст
     в клетке), перерисовывать нечего. */
  function change(ops, label, silent) {
    var inverse = D.applyOps(doc, ops);
    journal.record(inverse, label);
    save();
    if (!silent) render();
    if (label) toast(label);
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      D.Store.putDoc(doc).catch(function () {
        status("Не удалось сохранить — освободите место на устройстве");
      });
    }, 400);
  }

  function toast(label) {
    var t = $("#toast");
    $("#toast-text").textContent = label;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 7000);
  }

  function status(text) { $("#status").textContent = text; }

  function undo() {
    var label = journal.undo(doc);
    if (!label) return;
    save(); render();
    $("#toast").hidden = true;
  }

  /* ---------- демо-неделя ----------
     Пустой экран при первом открытии — главная причина, по которой
     люди закрывают приложение. Поэтому неделя сразу заполнена
     примером. Первая же правка любой клетки стирает ОСТАЛЬНОЙ
     пример, чтобы чужие отметки не уехали в печать и не смешались
     со своими. */

  var DEMO_TASKS = ["упр. 12, стр. 40", "выучить правило", "задачи 5-7",
                    "параграф 3, вопросы", "принести альбом", "читать стр. 22-25"];

  function seedDemo(d) {
    var wid = D.weekId(new Date());
    var cells = {};
    var t = Date.now();
    d.template.days.forEach(function (day, di) {
      if (!day.on) return;
      day.slots.forEach(function (slot, si) {
        if ((di + si) % 2 === 0) {
          cells[D.cellKey(day.id, slot.id, "task")] =
            { v: DEMO_TASKS[(di * 3 + si) % DEMO_TASKS.length], t: t, c: 1, demo: true };
        }
        if (di === 0 && si < 2) {
          cells[D.cellKey(day.id, slot.id, "mark")] = { v: si === 0 ? 5 : 4, t: t, c: 1, demo: true };
        }
      });
    });
    d.weeks[wid] = { cells: cells, struck: {} };
    d.hasDemo = true;
    return d;
  }

  function clearDemoExcept(keepKey) {
    if (!doc.hasDemo) return [];
    var ops = [];
    Object.keys(doc.weeks).forEach(function (wid) {
      var cells = doc.weeks[wid].cells;
      Object.keys(cells).forEach(function (k) {
        if (cells[k] && cells[k].demo && k !== keepKey) {
          ops.push({ path: ["weeks", wid, "cells", k], value: undefined });
        }
      });
    });
    ops.push({ path: ["hasDemo"], value: false });
    return ops;
  }

  /* ---------- запись в клетку ---------- */

  function setCell(dayId, slotId, col, value) {
    var key = D.cellKey(dayId, slotId, col);
    if (!doc.weeks[weekId]) {
      D.applyOps(doc, [{ path: ["weeks", weekId], value: { cells: {}, struck: {} } }]);
    }
    var ops = clearDemoExcept(key);
    var wasDemo = doc.hasDemo;
    if (value === null || value === "") {
      ops.push({ path: ["weeks", weekId, "cells", key], value: undefined });
    } else {
      ops.push({
        path: ["weeks", weekId, "cells", key],
        value: { v: value, t: Date.now(), c: (doc.clock || 0) + 1 },
      });
    }
    // Текст задания человек уже видит — перерисовка нужна только чтобы
    // убрать пример или показать новую отметку.
    var silent = col === "task" && !wasDemo;
    change(ops, wasDemo ? "Пример убран, дальше твоё" : null, silent);
  }

  /* ---------- предметы ---------- */

  function subjectName(id) {
    var s = doc.subjects[id];
    return s ? s.name : "";
  }

  function subjectList() {
    return Object.keys(doc.subjects)
      .map(function (id) { return doc.subjects[id]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "ru"); });
  }

  function findOrCreateSubject(name) {
    var clean = String(name).trim();
    if (!clean) return null;
    var found = null;
    Object.keys(doc.subjects).forEach(function (id) {
      if (doc.subjects[id].name.toLowerCase() === clean.toLowerCase()) found = id;
    });
    if (found) return found;
    var id = D.newId();
    D.applyOps(doc, [{ path: ["subjects", id], value: { id: id, name: clean } }]);
    return id;
  }

  /* ============================================================
     ЦЕПОЧКА ВВОДА
     Проверено отдельной пробой (lab/enter-chain.html): на клавиатуре
     с подсказками Enter сначала означает «подтвердить слово», а не
     «дальше», и приходит как keyCode 229 без key="Enter". Поэтому
     слушаем beforeinput и пропускаем событие, пока идёт композиция.
     ============================================================ */

  function editableCells() {
    return Array.prototype.slice.call(document.querySelectorAll(".subj-edit"));
  }

  function advanceFrom(node) {
    var all = editableCells();
    var i = all.indexOf(node);
    if (i < 0) return;
    var empty = !node.textContent.trim();
    var next;
    if (empty) {
      var curDay = node.dataset.dayId;
      next = all.find(function (c) { return c.dataset.dayId !== curDay && all.indexOf(c) > i; });
    } else {
      next = all[i + 1];
    }
    if (!next) { node.blur(); hideChips(); return; }
    focusCell(next);
  }

  function focusCell(node) {
    node.focus();
    var r = document.createRange();
    r.selectNodeContents(node);
    r.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    showChips();
  }

  function commitSubjectCell(node) {
    var text = node.textContent.trim();
    var dayIdx = Number(node.dataset.dayIdx);
    var slotIdx = Number(node.dataset.slotIdx);
    var day = doc.template.days[dayIdx];
    var slot = day && day.slots[slotIdx];
    if (!slot) return;
    if (!text) {
      if (slot.subjectId) {
        change([{ path: ["template", "days", dayIdx, "slots", slotIdx, "subjectId"], value: null }], null, true);
      }
      return;
    }
    var sid = findOrCreateSubject(text);
    if (sid && sid !== slot.subjectId) {
      // тихо: слово уже стоит в клетке, человек его сам туда написал
      change([{ path: ["template", "days", dayIdx, "slots", slotIdx, "subjectId"], value: sid }], null, true);
      if (!$("#chips").hidden) showChips();   // новый предмет — в ленту подсказок
    }
  }

  function wireEditable(node) {
    node.addEventListener("compositionstart", function () { composing = true; });
    node.addEventListener("compositionend", function () { composing = false; });

    node.addEventListener("beforeinput", function (e) {
      if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
        e.preventDefault();
        if (e.isComposing || composing) return;   // клавиатура подтверждает слово
        commitSubjectCell(node);
        advanceFrom(node);
      }
    });

    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing && !composing) {
        e.preventDefault();
        commitSubjectCell(node);
        advanceFrom(node);
      }
      if (e.key === "Escape") { node.blur(); }
    });

    node.addEventListener("focus", showChips);
    node.addEventListener("blur", function () {
      commitSubjectCell(node);
      setTimeout(function () {
        if (!document.activeElement || !document.activeElement.classList.contains("subj-edit")) hideChips();
      }, 120);
    });
  }

  /* ---------- лента подсказок ---------- */

  function showChips() {
    var bar = $("#chips");
    bar.innerHTML = "";

    var next = el("button", "chip next", "дальше →");
    next.type = "button";
    next.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    next.addEventListener("click", function () {
      var cur = document.activeElement;
      if (cur && cur.classList.contains("subj-edit")) { commitSubjectCell(cur); advanceFrom(cur); }
    });
    bar.appendChild(next);

    subjectList().forEach(function (s) {
      var b = el("button", "chip", s.name);
      b.type = "button";
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () {
        var cur = document.activeElement;
        if (!cur || !cur.classList.contains("subj-edit")) return;
        cur.textContent = s.name;
        commitSubjectCell(cur);
        advanceFrom(cur);
      });
      bar.appendChild(b);
    });
    bar.hidden = false;
  }

  function hideChips() { $("#chips").hidden = true; }

  /* ============================================================
     ЛИСТ СНИЗУ
     Всё, что не вписывается пальцем прямо в клетку, открывается
     листом снизу — там, куда дотягивается большой палец.
     ============================================================ */

  function sheet(title, build) {
    var dlg = $("#sheet");
    var paper = $("#sheet-paper");
    paper.innerHTML = "";
    var h = el("h3", null, title);
    paper.appendChild(h);
    var list = el("div", "sheet-list");
    paper.appendChild(list);
    build(list, function () { dlg.close(); });
    var close = el("button", "sheet-item", "Закрыть");
    close.type = "button";
    close.addEventListener("click", function () { dlg.close(); });
    list.appendChild(close);
    if (!dlg.open) dlg.showModal();
  }

  function item(label, onClick, cls) {
    var b = el("button", "sheet-item" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  /* ---------- отметка ---------- */

  function openMarkSheet(dayId, slotId, subjectLabel) {
    var scale = D.SCALES[doc.template.scaleId] || D.SCALES.ru5;
    var cur = D.cellValue(doc, weekId, dayId, slotId, "mark");
    sheet("Отметка · " + subjectLabel, function (list, close) {
      var row = el("div", "marks-row");
      scale.values.forEach(function (v) {
        var b = el("button", "sheet-item", v.label);
        b.type = "button";
        b.setAttribute("aria-label", v.say);
        b.setAttribute("aria-pressed", cur && cur.v === v.v ? "true" : "false");
        b.addEventListener("click", function () {
          setCell(dayId, slotId, "mark", v.v);
          close();
        });
        row.appendChild(b);
      });
      list.appendChild(row);
      list.appendChild(item("Не выставлена", function () {
        setCell(dayId, slotId, "mark", null);
        close();
      }));
    });
  }

  /* ---------- урок ---------- */

  function openSlotSheet(dayIdx, slotIdx) {
    var day = doc.template.days[dayIdx];
    var slot = day.slots[slotIdx];
    sheet("Урок " + (slotIdx + 1) + " · " + day.name, function (list, close) {
      subjectList().forEach(function (s) {
        var b = item(s.name, function () {
          change([{ path: ["template", "days", dayIdx, "slots", slotIdx, "subjectId"], value: s.id }],
                 "Предмет изменён");
          close();
        });
        b.setAttribute("aria-pressed", slot.subjectId === s.id ? "true" : "false");
        list.appendChild(b);
      });

      list.appendChild(item("+ Добавить свой предмет", function () {
        close();
        var node = document.querySelector('.subj-edit[data-day-idx="' + dayIdx + '"][data-slot-idx="' + slotIdx + '"]');
        if (node) { node.textContent = ""; focusCell(node); }
      }));

      var row = el("div", "sheet-row");
      if (slotIdx > 0) {
        row.appendChild(item("Выше", function () { moveSlot(dayIdx, slotIdx, -1); close(); }));
      }
      if (slotIdx < day.slots.length - 1) {
        row.appendChild(item("Ниже", function () { moveSlot(dayIdx, slotIdx, 1); close(); }));
      }
      list.appendChild(row);

      list.appendChild(item("Убрать урок из расписания", function () {
        removeSlot(dayIdx, slotIdx);
        close();
      }, "danger"));
    });
  }

  function moveSlot(dayIdx, slotIdx, dir) {
    var day = doc.template.days[dayIdx];
    var a = JSON.parse(JSON.stringify(day.slots[slotIdx]));
    var b = JSON.parse(JSON.stringify(day.slots[slotIdx + dir]));
    change([
      { path: ["template", "days", dayIdx, "slots", slotIdx], value: b },
      { path: ["template", "days", dayIdx, "slots", slotIdx + dir], value: a },
    ], "Уроки переставлены");
  }

  /* Урок убирается из расписания, но его записи в уже заполненных
     неделях не исчезают — они зачёркиваются. Страницы дневника
     нумеровали как раз затем, чтобы нельзя было вырвать лист. */
  function removeSlot(dayIdx, slotIdx) {
    var day = doc.template.days[dayIdx];
    var slot = day.slots[slotIdx];
    var ops = [{ path: ["template", "days", dayIdx, "slots", slotIdx], remove: true }];
    Object.keys(doc.weeks).forEach(function (wid) {
      var cells = doc.weeks[wid].cells;
      var used = Object.keys(cells).some(function (k) { return k.indexOf("|" + slot.id + "|") > 0; });
      if (used) ops.push({ path: ["weeks", wid, "struck", slot.id], value: true });
    });
    change(ops, "Урок убран");
  }

  function addSlot(dayIdx) {
    var day = doc.template.days[dayIdx];
    var slot = { id: D.newId(), subjectId: null };
    change([{ path: ["template", "days", dayIdx, "slots", day.slots.length], insert: slot }], null);
    setTimeout(function () {
      var node = document.querySelector('.subj-edit[data-day-idx="' + dayIdx + '"][data-slot-idx="' + (day.slots.length) + '"]');
      if (node) focusCell(node);
    }, 30);
  }

  /* ---------- день ---------- */

  function openDaySheet(dayIdx) {
    var day = doc.template.days[dayIdx];
    sheet(day.name, function (list, close) {
      list.appendChild(item(day.on ? "У нас нет уроков в этот день" : "Сделать учебным днём", function () {
        change([{ path: ["template", "days", dayIdx, "on"], value: !day.on }],
               day.on ? day.name + ": уроков нет" : day.name + ": учебный день");
        close();
      }));
      list.appendChild(item("+ Добавить урок", function () { addSlot(dayIdx); close(); }));
      list.appendChild(item("Переименовать день", function () {
        close();
        var name = prompt("Название дня", day.name);
        if (name && name.trim()) {
          change([{ path: ["template", "days", dayIdx, "name"], value: name.trim() }], "День переименован");
        }
      }));
    });
  }

  /* ============================================================
     РЕНДЕР
     ============================================================ */

  function render() {
    renderCover();
    renderSpread();
    applyLook();
  }

  function applyLook() {
    var look = doc.look || { scale: 1, tracking: 0, leading: 1.24 };
    var r = document.documentElement.style;
    r.setProperty("--scale", String(look.scale));
    r.setProperty("--tracking", look.tracking + "em");
    r.setProperty("--leading", String(look.leading));
  }

  function renderCover() {
    $("#doc-name").textContent = doc.name;
    var spines = $("#spines");
    spines.innerHTML = "";
    docs.forEach(function (d) {
      var b = el("button", "spine", d.name);
      b.type = "button";
      b.setAttribute("aria-current", d.id === doc.id ? "true" : "false");
      b.addEventListener("click", function () { switchDoc(d.id); });
      spines.appendChild(b);
    });
    var add = el("button", "spine add", "+ ещё дневник");
    add.type = "button";
    add.addEventListener("click", openNewDocSheet);
    spines.appendChild(add);
  }

  function renderSpread() {
    $("#week-title").textContent = D.weekTitle(weekId);
    var a = $("#leaf-a"), b = $("#leaf-b");
    a.innerHTML = ""; b.innerHTML = "";
    doc.template.days.forEach(function (day, i) {
      (i < 3 ? a : b).appendChild(dayNode(day, i));
    });
    $("#demobar").hidden = !doc.hasDemo;
  }

  function dayNode(day, dayIdx) {
    var wrap = el("section", "day");
    wrap.dataset.on = String(!!day.on);

    var head = el("div", "dayhead");
    var name = el("button", "dayname", day.name);
    name.type = "button";
    name.setAttribute("aria-label", day.name + ", настроить день");
    name.addEventListener("click", function () { openDaySheet(dayIdx); });
    head.appendChild(name);
    head.appendChild(el("div", "daydate", D.dayDate(weekId, dayIdx)));
    wrap.appendChild(head);

    if (!day.on) {
      var off = el("div", "daynote", "уроков нет");
      wrap.appendChild(off);
      return wrap;
    }

    var table = el("table", "grid");
    var cap = el("caption", null, day.name + ", расписание и задания");
    table.appendChild(cap);

    var thead = el("thead");
    var hr = el("tr");
    [["", "c-n"], ["Предмет", "c-subj"], ["Что задано", ""], ["Отм.", "c-mark"], ["", "c-more"]]
      .forEach(function (h) {
        var th = el("th", h[1], h[0]);
        th.scope = "col";
        hr.appendChild(th);
      });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tb = el("tbody");
    var week = D.week(doc, weekId);
    day.slots.forEach(function (slot, slotIdx) {
      tb.appendChild(slotRow(day, dayIdx, slot, slotIdx, week));
    });
    table.appendChild(tb);
    wrap.appendChild(table);

    var add = el("button", "rowtool", "+ урок");
    add.type = "button";
    add.addEventListener("click", function () { addSlot(dayIdx); });
    wrap.appendChild(add);
    return wrap;
  }

  function slotRow(day, dayIdx, slot, slotIdx, week) {
    var tr = el("tr");
    if (week.struck && week.struck[slot.id]) tr.className = "struck";

    tr.appendChild(el("td", "c-n", String(slotIdx + 1)));

    // предмет: вписывается прямо в клетку
    var tdS = el("td", "c-subj");
    var s = el("div", "subj subj-edit");
    s.contentEditable = "plaintext-only";
    if (s.contentEditable !== "plaintext-only") s.contentEditable = "true";
    s.textContent = subjectName(slot.subjectId);
    s.dataset.dayIdx = String(dayIdx);
    s.dataset.slotIdx = String(slotIdx);
    s.dataset.dayId = day.id;
    s.setAttribute("role", "textbox");
    s.setAttribute("aria-label", day.name + ", урок " + (slotIdx + 1) + ", предмет");
    wireEditable(s);
    tdS.appendChild(s);
    tdS.appendChild(el("span", "time", D.lessonTime(slotIdx)));
    tr.appendChild(tdS);

    // что задано
    var tdT = el("td");
    var task = el("div", "task");
    task.contentEditable = "plaintext-only";
    if (task.contentEditable !== "plaintext-only") task.contentEditable = "true";
    var cell = D.cellValue(doc, weekId, day.id, slot.id, "task");
    task.textContent = cell ? String(cell.v) : "";
    if (cell && cell.demo) task.classList.add("cell-demo");
    task.setAttribute("data-ph", "что задано");
    task.setAttribute("aria-label", "что задано на " + (subjectName(slot.subjectId) || "урок"));
    task.addEventListener("blur", function () {
      var text = task.textContent.trim();
      var was = D.cellValue(doc, weekId, day.id, slot.id, "task");
      if ((was ? String(was.v) : "") !== text) setCell(day.id, slot.id, "task", text);
    });
    task.addEventListener("keydown", function (e) {
      if (e.key === "Escape") task.blur();
    });
    tdT.appendChild(task);
    tr.appendChild(tdT);

    // отметка
    var tdM = el("td", "c-mark");
    var scale = D.SCALES[doc.template.scaleId] || D.SCALES.ru5;
    var mark = D.cellValue(doc, weekId, day.id, slot.id, "mark");
    var found = mark ? scale.values.find(function (v) { return v.v === mark.v; }) : null;
    var mb = el("button", "mark", found ? found.label : "·");
    mb.type = "button";
    mb.dataset.empty = found ? "false" : "true";
    if (found) mb.dataset.mark = String(found.v);
    mb.setAttribute("aria-label", found
      ? "отметка " + found.say + ", изменить"
      : "отметка не выставлена, поставить");
    mb.addEventListener("click", function () {
      openMarkSheet(day.id, slot.id, subjectName(slot.subjectId) || "урок " + (slotIdx + 1));
    });
    tdM.appendChild(mb);
    tr.appendChild(tdM);

    // меню урока
    var tdMore = el("td", "c-more");
    var more = el("button", "rowtool", "⋯");
    more.type = "button";
    more.setAttribute("aria-label", "что сделать с уроком " + (slotIdx + 1));
    more.addEventListener("click", function () { openSlotSheet(dayIdx, slotIdx); });
    tdMore.appendChild(more);
    tr.appendChild(tdMore);

    return tr;
  }

  /* ---------- дневники ---------- */

  async function switchDoc(id) {
    var d = await D.Store.getDoc(id);
    if (!d) return;
    doc = d;
    journal = new D.Journal(200);
    await D.Store.setMeta("active", id);
    render();
  }

  function openNewDocSheet() {
    sheet("Новый дневник", function (list, close) {
      Object.keys(D.PRESETS).forEach(function (pid) {
        var p = D.PRESETS[pid];
        var b = item(p.name + " — " + p.about, async function () {
          close();
          var name = prompt("Чей это дневник?", p.name);
          var d = seedDemo(D.newDoc(pid, (name && name.trim()) || p.name));
          await D.Store.putDoc(d);
          docs = await D.Store.listDocs();
          await switchDoc(d.id);
        });
        list.appendChild(b);
      });
    });
  }

  /* ---------- неделя вперёд-назад ---------- */

  function shiftWeek(delta) {
    var p = weekId.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + delta * 7);
    weekId = D.weekId(d);
    render();
  }

  /* ---------- файл ---------- */

  function saveToFile() {
    var name = "Дневник-" + weekId + ".dnevnik.txt";
    var text = D.toFile(doc);
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var file = new File([blob], name, { type: "text/plain" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: doc.name }).catch(function () {});
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function openFromFile() {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".txt,.json,.dnevnik,text/plain,application/json";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = async function () {
        try {
          var incoming = D.fromFile(String(r.result));
          await D.Store.snapshot(doc, "перед соединением копий");
          var res = D.merge(doc, incoming);
          doc = res.doc;
          journal = new D.Journal(200);
          await D.Store.putDoc(doc);
          render();
          toast("Недели соединились: добавлено " + res.added + ", обновлено " + res.updated);
        } catch (e) {
          alert("Не получилось прочитать файл: " + e.message +
                "\n\nНужен файл, сохранённый этим же дневником.");
        }
      };
      r.readAsText(f, "utf-8");
    });
    inp.click();
  }

  /* ---------- вид ---------- */

  function openLookSheet() {
    sheet("Как это выглядит", function (list) {
      [["Крупнее", "scale", 0.1, 0.8, 1.8],
       ["Буквы просторнее", "tracking", 0.01, 0, 0.08],
       ["Строки просторнее", "leading", 0.08, 1.1, 2.0]].forEach(function (cfg) {
        var row = el("div", "sheet-row");
        row.appendChild(el("div", "sheet-item", cfg[0]));
        row.appendChild(item("−", function () {
          var look = Object.assign({}, doc.look);
          look[cfg[1]] = Math.max(cfg[3], +(look[cfg[1]] - cfg[2]).toFixed(3));
          change([{ path: ["look"], value: look }], null);
        }));
        row.appendChild(item("+", function () {
          var look = Object.assign({}, doc.look);
          look[cfg[1]] = Math.min(cfg[4], +(look[cfg[1]] + cfg[2]).toFixed(3));
          change([{ path: ["look"], value: look }], null);
        }));
        list.appendChild(row);
      });

      list.appendChild(item("Шкала отметок: " + (D.SCALES[doc.template.scaleId] || {}).name, function () {
        var ids = Object.keys(D.SCALES);
        var next = ids[(ids.indexOf(doc.template.scaleId) + 1) % ids.length];
        change([{ path: ["template", "scaleId"], value: next }], "Шкала: " + D.SCALES[next].name);
      }));
    });
  }

  /* ============================================================
     ЗАПУСК
     ============================================================ */

  async function boot() {
    var ok = await D.Store.open();
    if (!ok) {
      status("Хранилище недоступно — записи не сохранятся");
    }

    docs = await D.Store.listDocs();

    if (!docs.length) {
      // Первый запуск. Если на этом же адресе жила первая версия,
      // её записи переносятся, а не теряются.
      var legacy = D.readLegacyV1();
      var first;
      if (legacy) {
        first = D.convertLegacyV1(legacy);
        toast("Записи из прежнего дневника перенесены");
      } else {
        first = seedDemo(D.newDoc("school5", "Дневник"));
      }
      await D.Store.putDoc(first);
      docs = [first];
      await D.Store.setMeta("active", first.id);
    }

    var activeId = await D.Store.getMeta("active");
    doc = docs.find(function (d) { return d.id === activeId; }) || docs[0];

    render();
    status(docs.length > 1
      ? docs.length + " " + D.plural(docs.length, "дневник", "дневника", "дневников") + " на этом устройстве"
      : "Только это устройство");

    // кнопки
    $("#b-prev").addEventListener("click", function () { shiftWeek(-1); });
    $("#b-next").addEventListener("click", function () { shiftWeek(1); });
    $("#b-today").addEventListener("click", function () { weekId = D.weekId(new Date()); render(); });
    $("#b-print").addEventListener("click", function () { window.print(); });
    $("#b-save").addEventListener("click", saveToFile);
    $("#b-open").addEventListener("click", openFromFile);
    $("#b-look").addEventListener("click", openLookSheet);

    // половины разворота на узком экране
    var spread = $("#spread");
    function showHalf(which) {
      var target = which === "b" ? spread.clientWidth : 0;
      var smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      try {
        spread.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
      } catch (e) {
        spread.scrollLeft = target;
      }
      // Плавная прокрутка выполняется не везде, а страница обязана
      // перевернуться. Проверяем и дожимаем.
      setTimeout(function () {
        if (Math.abs(spread.scrollLeft - target) > 4) spread.scrollLeft = target;
      }, 350);
      $("#half-a").setAttribute("aria-pressed", which === "a" ? "true" : "false");
      $("#half-b").setAttribute("aria-pressed", which === "b" ? "true" : "false");
    }
    $("#half-a").addEventListener("click", function () { showHalf("a"); });
    $("#half-b").addEventListener("click", function () { showHalf("b"); });
    spread.addEventListener("scroll", function () {
      var b = spread.scrollLeft > spread.clientWidth / 2;
      $("#half-a").setAttribute("aria-pressed", b ? "false" : "true");
      $("#half-b").setAttribute("aria-pressed", b ? "true" : "false");
    }, { passive: true });
    $("#toast-undo").addEventListener("click", undo);
    $("#b-clear-demo").addEventListener("click", function () {
      change(clearDemoExcept(null), "Пример убран");
      var first = document.querySelector(".subj-edit");
      if (first) { first.textContent = ""; focusCell(first); }
    });

    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        var inCell = document.activeElement &&
          (document.activeElement.isContentEditable);
        if (!inCell) { e.preventDefault(); undo(); }
      }
    });

    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})(window.D);
