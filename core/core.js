/* ============================================================
   Ядро дневника: модель, патчи с отменой, хранилище.

   Главное правило, ради которого всё переписано: РАСПИСАНИЕ И
   ЗАПОЛНЕННАЯ НЕДЕЛЯ — РАЗНЫЕ СУЩНОСТИ. В прошлой версии расписание
   читалось один раз при запуске, а несовпадение формы данных молча
   возвращало заводскую заготовку. Из-за этого поправить расписание
   можно было только через «Очистить всё», то есть стерев все отметки.
   Здесь расписание правится когда угодно и не трогает ни одной оценки.
   ============================================================ */
window.D = window.D || {};

(function (D) {
  "use strict";

  /* ---------- мелочи ---------- */

  // Идентификатор, растущий во времени: удобно сортировать и сливать.
  var idCounter = 0;
  D.newId = function () {
    idCounter = (idCounter + 1) % 4096;
    return Date.now().toString(36) + "-" + idCounter.toString(36) + "-" +
           Math.floor(Math.random() * 1679616).toString(36);
  };

  D.plural = function (n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };

  var MONTHS = ["января","февраля","марта","апреля","мая","июня",
                "июля","августа","сентября","октября","ноября","декабря"];
  D.MONTHS = MONTHS;

  D.mondayOf = function (d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };

  // Ключ недели: год и номер понедельника. Недели не «первая, вторая»,
  // а привязаны к календарю, иначе при пропуске недели всё разъезжается.
  D.weekId = function (date) {
    var m = D.mondayOf(date);
    return m.getFullYear() + "-" +
           String(m.getMonth() + 1).padStart(2, "0") + "-" +
           String(m.getDate()).padStart(2, "0");
  };

  D.weekTitle = function (weekId) {
    var p = weekId.split("-");
    var a = new Date(+p[0], +p[1] - 1, +p[2]);
    var b = new Date(a); b.setDate(b.getDate() + 5);
    var left = a.getDate() + (a.getMonth() === b.getMonth() ? "" : " " + MONTHS[a.getMonth()]);
    return left + " — " + b.getDate() + " " + MONTHS[b.getMonth()] + " " + b.getFullYear();
  };

  D.dayDate = function (weekId, index) {
    var p = weekId.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + index);
    return d.getDate() + " " + MONTHS[d.getMonth()];
  };

  /* ---------- шкалы отметок ---------- */

  D.SCALES = {
    ru5: {
      id: "ru5", name: "Пятибалльная",
      values: [
        { v: 5, label: "5", say: "пять" },
        { v: 4, label: "4", say: "четыре" },
        { v: 3, label: "3", say: "три" },
        { v: 2, label: "2", say: "два" },
        { v: "н", label: "н", say: "не был" },
      ],
    },
    smiles: {
      id: "smiles", name: "Смайлики",
      values: [
        { v: 5, label: "☺", say: "отлично" },
        { v: 4, label: "◠", say: "хорошо" },
        { v: 3, label: "◡", say: "нормально" },
        { v: 2, label: "☹", say: "плохо" },
        { v: "н", label: "—", say: "не был" },
      ],
    },
    done: {
      id: "done", name: "Сделано или нет",
      values: [
        { v: 5, label: "✓", say: "сделано" },
        { v: 3, label: "~", say: "начато" },
        { v: 2, label: "✗", say: "не сделано" },
      ],
    },
  };

  D.BELLS = [
    ["1 урок", "09:00 — 09:45"],
    ["перемена", "09:45 — 09:55"],
    ["2 урок", "09:55 — 10:40"],
    ["большая перемена", "10:40 — 11:10"],
    ["3 урок", "11:10 — 11:55"],
    ["перемена", "11:55 — 12:05"],
    ["4 урок", "12:05 — 12:50"],
    ["перемена", "12:50 — 13:00"],
    ["5 урок", "13:00 — 13:45"],
    ["6 урок", "13:55 — 14:40"],
  ];

  D.lessonTime = function (i) {
    var only = D.BELLS.filter(function (b) { return /урок/.test(b[0]); });
    return only[i] ? only[i][1] : "";
  };

  var DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

  /* ---------- заготовки дневников ---------- */

  function makeSubjects(names) {
    var subjects = {}, order = [];
    names.forEach(function (n) {
      var id = D.newId();
      subjects[id] = { id: id, name: n };
      order.push(id);
    });
    return { subjects: subjects, order: order };
  }

  D.PRESETS = {
    school5: {
      id: "school5",
      name: "Пятый класс",
      about: "Шесть дней, пять уроков, пятибалльные отметки",
      scaleId: "ru5",
      days: 6,
      perDay: 5,
      subjects: ["Математика", "Русский язык", "Литература", "История",
                 "Английский", "Биология", "Физкультура", "Технология"],
    },
    primary: {
      id: "primary",
      name: "Началка со смайликами",
      about: "Пять дней, четыре урока, отметки смайликами, клетки крупнее",
      scaleId: "smiles",
      days: 5,
      perDay: 4,
      subjects: ["Чтение", "Письмо", "Математика", "Окружающий мир",
                 "Рисование", "Физкультура", "Музыка"],
    },
    grownup: {
      id: "grownup",
      name: "Взрослый",
      about: "Шесть дней, дела вместо уроков, отметка «сделано или нет»",
      scaleId: "done",
      days: 6,
      perDay: 4,
      subjects: ["Работа", "Деньги", "Здоровье", "Дом", "Учёба", "Люди"],
    },
  };

  /* ---------- создание документа ---------- */

  D.newDoc = function (presetId, name) {
    var preset = D.PRESETS[presetId] || D.PRESETS.school5;
    var s = makeSubjects(preset.subjects);

    var days = [];
    for (var i = 0; i < 6; i++) {
      var slots = [];
      if (i < preset.days) {
        for (var k = 0; k < preset.perDay; k++) {
          slots.push({ id: D.newId(), subjectId: s.order[(i * preset.perDay + k) % s.order.length] });
        }
      }
      days.push({
        id: D.newId(),
        name: DAY_NAMES[i],
        on: i < preset.days,
        slots: slots,
      });
    }

    return {
      schema: 2,
      id: D.newId(),
      name: name || preset.name,
      presetId: preset.id,
      created: Date.now(),
      updated: Date.now(),
      clock: 0,
      template: { days: days, scaleId: preset.scaleId },
      subjects: s.subjects,
      weeks: {},
      look: { scale: 1, tracking: 0, leading: 1.24 },
    };
  };

  /* ---------- неделя ---------- */

  // Недели создаются лениво. Пустая неделя — это отсутствие записи,
  // а не объект с пустыми клетками: так документ не пухнет от прокрутки
  // календаря вперёд-назад.
  D.week = function (doc, weekId) {
    return doc.weeks[weekId] || { cells: {}, struck: {} };
  };

  D.cellKey = function (dayId, slotId, col) {
    return dayId + "|" + slotId + "|" + col;
  };

  D.cellValue = function (doc, weekId, dayId, slotId, col) {
    var w = doc.weeks[weekId];
    if (!w) return null;
    var c = w.cells[D.cellKey(dayId, slotId, col)];
    return c ? c : null;
  };

  /* ============================================================
     ПАТЧИ
     Всё, что меняет документ, проходит здесь. Ни один обработчик
     не пишет в документ напрямую — иначе отмена перестаёт работать
     ровно в тот день, когда она впервые понадобится.
     ============================================================ */

  function getIn(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null) return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function setIn(obj, path, value) {
    var cur = obj;
    for (var i = 0; i < path.length - 1; i++) {
      var k = path[i];
      if (cur[k] == null || typeof cur[k] !== "object") {
        // числовой ключ следующего уровня означает массив
        cur[k] = typeof path[i + 1] === "number" ? [] : {};
      }
      cur = cur[k];
    }
    var last = path[path.length - 1];
    if (value === undefined) {
      if (Array.isArray(cur)) cur.splice(last, 1);
      else delete cur[last];
    } else {
      cur[last] = value;
    }
  }

  function cloneVal(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /* Операция: {path: [...], value: any}. value === undefined означает удаление.
     Для массивов есть отдельная операция вставки: {path, insert: value}. */
  D.applyOps = function (doc, ops) {
    var inverse = [];
    ops.forEach(function (op) {
      if (op.insert !== undefined) {
        var arrPath = op.path.slice(0, -1);
        var idx = op.path[op.path.length - 1];
        var arr = getIn(doc, arrPath);
        arr.splice(idx, 0, cloneVal(op.insert));
        inverse.unshift({ path: op.path.slice(), remove: true });
      } else if (op.remove) {
        var arrPath2 = op.path.slice(0, -1);
        var idx2 = op.path[op.path.length - 1];
        var arr2 = getIn(doc, arrPath2);
        var was = cloneVal(arr2[idx2]);
        arr2.splice(idx2, 1);
        inverse.unshift({ path: op.path.slice(), insert: was });
      } else {
        var before = cloneVal(getIn(doc, op.path));
        setIn(doc, op.path, cloneVal(op.value));
        inverse.unshift({ path: op.path.slice(), value: before });
      }
    });
    doc.clock = (doc.clock || 0) + 1;
    doc.updated = Date.now();
    return inverse;
  };

  /* ---------- журнал и отмена ---------- */

  D.Journal = function (limit) {
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit || 200;
  };

  D.Journal.prototype.record = function (inverse, label) {
    if (!inverse || !inverse.length) return;
    this.undoStack.push({ ops: inverse, label: label || "правка" });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  };

  D.Journal.prototype.undo = function (doc) {
    var step = this.undoStack.pop();
    if (!step) return null;
    var inv = D.applyOps(doc, step.ops);
    this.redoStack.push({ ops: inv, label: step.label });
    return step.label;
  };

  D.Journal.prototype.redo = function (doc) {
    var step = this.redoStack.pop();
    if (!step) return null;
    var inv = D.applyOps(doc, step.ops);
    this.undoStack.push({ ops: inv, label: step.label });
    return step.label;
  };

  D.Journal.prototype.canUndo = function () { return this.undoStack.length > 0; };

  /* ============================================================
     ХРАНИЛИЩЕ
     IndexedDB, потому что дневников теперь несколько и в них живут
     годы записей. localStorage встречается ровно в одном месте —
     в переносе данных из первой версии, ниже.
     ============================================================ */

  var DB_NAME = "dnevnik";
  var DB_VERSION = 1;

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("snapshots")) {
          db.createObjectStore("snapshots", { keyPath: "key" });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(db, store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, mode);
      var s = t.objectStore(store);
      var out = fn(s);
      t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }

  D.Store = {
    db: null,
    available: true,

    open: async function () {
      try {
        this.db = await openDb();
        if (navigator.storage && navigator.storage.persist) {
          // Просим не вытеснять данные. Safari чистит хранилище
          // неустановленных сайтов, поэтому это не формальность.
          try { await navigator.storage.persist(); } catch (e) {}
        }
        return true;
      } catch (e) {
        this.available = false;
        return false;
      }
    },

    listDocs: async function () {
      if (!this.db) return [];
      return await tx(this.db, "docs", "readonly", function (s) { return s.getAll(); });
    },

    getDoc: async function (id) {
      if (!this.db) return null;
      return await tx(this.db, "docs", "readonly", function (s) { return s.get(id); });
    },

    putDoc: async function (doc) {
      if (!this.db) return false;
      await tx(this.db, "docs", "readwrite", function (s) { return s.put(doc); });
      return true;
    },

    deleteDoc: async function (id) {
      if (!this.db) return false;
      await tx(this.db, "docs", "readwrite", function (s) { return s.delete(id); });
      return true;
    },

    getMeta: async function (key) {
      if (!this.db) return null;
      return await tx(this.db, "meta", "readonly", function (s) { return s.get(key); });
    },

    setMeta: async function (key, value) {
      if (!this.db) return false;
      await tx(this.db, "meta", "readwrite", function (s) { return s.put(value, key); });
      return true;
    },

    // Снимок перед каждым опасным действием: перенос из старой версии,
    // смена заготовки, соединение копий.
    snapshot: async function (doc, why) {
      if (!this.db) return false;
      var key = doc.id + "|" + Date.now();
      await tx(this.db, "snapshots", "readwrite", function (s) {
        return s.put({ key: key, docId: doc.id, at: Date.now(), why: why,
                       doc: JSON.parse(JSON.stringify(doc)) });
      });
      var all = await tx(this.db, "snapshots", "readonly", function (s) { return s.getAll(); });
      var mine = all.filter(function (x) { return x.docId === doc.id; })
                    .sort(function (a, b) { return b.at - a.at; });
      var extra = mine.slice(10);
      if (extra.length) {
        await tx(this.db, "snapshots", "readwrite", function (s) {
          extra.forEach(function (x) { s.delete(x.key); });
          return null;
        });
      }
      return true;
    },

    snapshots: async function (docId) {
      if (!this.db) return [];
      var all = await tx(this.db, "snapshots", "readonly", function (s) { return s.getAll(); });
      return all.filter(function (x) { return x.docId === docId; })
                .sort(function (a, b) { return b.at - a.at; });
    },
  };

  /* ============================================================
     ПЕРЕНОС ИЗ ПЕРВОЙ ВЕРСИИ
     Единственное обращение к localStorage во всём проекте. Старая
     версия жила на том же адресе, и без переноса у всех, кто уже
     поставил дневник на телефон, он молча открылся бы пустым.
     ============================================================ */

  D.readLegacyV1 = function () {
    try {
      var raw = localStorage.getItem("dnevnik.v1");
      if (!raw) return null;
      var old = JSON.parse(raw);
      if (!old || !old.week || !Array.isArray(old.week.days)) return null;
      return old;
    } catch (e) { return null; }
  };

  D.convertLegacyV1 = function (old) {
    var doc = D.newDoc("school5", "Дневник");
    doc.template.days = [];
    doc.subjects = {};

    var byName = {};
    function subjectId(name) {
      var key = String(name || "").trim() || "—";
      if (!byName[key]) {
        var id = D.newId();
        byName[key] = id;
        doc.subjects[id] = { id: id, name: key };
      }
      return byName[key];
    }

    var weekId = D.weekId(new Date());
    var cells = {};

    (old.week.days || []).forEach(function (d, di) {
      var day = { id: D.newId(), name: d.name || DAY_NAMES[di] || "День", on: true, slots: [] };
      (d.lessons || []).forEach(function (l) {
        var slot = { id: D.newId(), subjectId: subjectId(l.subj) };
        day.slots.push(slot);
        var t = Date.now();
        if (l.task) cells[D.cellKey(day.id, slot.id, "task")] = { v: l.task, t: t, c: 1 };
        if (l.mark !== null && l.mark !== undefined) {
          cells[D.cellKey(day.id, slot.id, "mark")] = { v: l.mark, t: t, c: 1 };
        }
      });
      doc.template.days.push(day);
    });

    doc.weeks[weekId] = { cells: cells, struck: {} };
    if (old.meta && old.meta.owner) doc.name = "Дневник — " + old.meta.owner;
    doc.fromLegacy = true;
    return doc;
  };

  /* ---------- файл ---------- */

  D.toFile = function (doc) {
    return JSON.stringify({ format: "dnevnik", schema: 2, exported: Date.now(), doc: doc }, null, 2);
  };

  D.fromFile = function (text) {
    var j = JSON.parse(text);
    if (j && j.format === "dnevnik" && j.doc) return j.doc;
    if (j && j.schema === 2 && j.template) return j;      // голый документ
    if (j && j.week && j.week.days) return D.convertLegacyV1(j);  // файл первой версии
    throw new Error("Это не файл дневника");
  };

  /* Соединение копий, а не замена. Главный страх пользователя —
     «открою старую копию и потеряю месяц» — снимается тем, что
     операция в принципе не умеет удалять: побеждает более поздняя
     правка каждой клетки по отдельности. */
  D.merge = function (mine, theirs) {
    var result = JSON.parse(JSON.stringify(mine));
    var added = 0, updated = 0;

    Object.keys(theirs.subjects || {}).forEach(function (id) {
      if (!result.subjects[id]) { result.subjects[id] = theirs.subjects[id]; added++; }
    });

    Object.keys(theirs.weeks || {}).forEach(function (wid) {
      if (!result.weeks[wid]) result.weeks[wid] = { cells: {}, struck: {} };
      var mineW = result.weeks[wid], theirsW = theirs.weeks[wid];
      Object.keys(theirsW.cells || {}).forEach(function (k) {
        var a = mineW.cells[k], b = theirsW.cells[k];
        if (!a) { mineW.cells[k] = b; added++; return; }
        // сравнение по счётчику документа, потом по времени: часы на
        // детском планшете уходят, счётчик — нет
        var aKey = [(a.c || 0), (a.t || 0)], bKey = [(b.c || 0), (b.t || 0)];
        if (bKey[0] > aKey[0] || (bKey[0] === aKey[0] && bKey[1] > aKey[1])) {
          mineW.cells[k] = b; updated++;
        }
      });
    });

    // Дни и уроки, которых у нас нет, добавляются; ничего не удаляется.
    var haveDays = {};
    result.template.days.forEach(function (d) { haveDays[d.id] = d; });
    (theirs.template.days || []).forEach(function (d) {
      var mineD = haveDays[d.id];
      if (!mineD) { result.template.days.push(d); added++; return; }
      var haveSlots = {};
      mineD.slots.forEach(function (s) { haveSlots[s.id] = true; });
      (d.slots || []).forEach(function (s) {
        if (!haveSlots[s.id]) { mineD.slots.push(s); added++; }
      });
    });

    result.clock = Math.max(result.clock || 0, theirs.clock || 0) + 1;
    result.updated = Date.now();
    return { doc: result, added: added, updated: updated };
  };

})(window.D);
