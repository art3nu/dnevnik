/* ============================================================
   Разбор расписания, вставленного текстом.

   Обычный код, без нейросетей и без сети: работает офлайн на дешёвом
   телефоне мгновенно. Форматы взяты из реальных школьных расписаний,
   сообщений учителей и выгрузок электронных дневников, а не выдуманы.

   ГЛАВНОЕ ПРАВИЛО: разборщик умеет вычитать и распознавать, но НЕ
   достраивать. Он не заполняет дырки в нумерации, не подставляет день
   по умолчанию и не выбирает одну сторону слэша. Строка, которую он не
   понял, честно возвращается непонятой — это штатный результат, а не
   отказ. Молча выданная правдоподобная чушь хуже честного «не поняла».
   ============================================================ */
window.D = window.D || {};

(function (D) {
  "use strict";

  /* ---------- словарь ---------- */

/* Словарь сокращений школьных предметов: 162 ключа, 67 предметов.
   Собран из реальных школьных расписаний, а не придуман. Ключ —
   нормализованная запись: нижний регистр, ё→е, без точек, дефисов,
   пробелов и звёздочек. Поэтому «Физ-ра», «физра», «физ.ра» и
   «Физ ра» дают один ключ. */
  var SUBJECT_DICT = {
    "русскийязык": "Русский язык",
    "русск": "Русский язык",
    "русскяз": "Русский язык",
    "русяз": "Русский язык",
    "русязык": "Русский язык",
    "русс": "Русский язык",
    "рус": "Русский язык",
    "русский": "Русский язык",
    "литература": "Литература",
    "литер": "Литература",
    "литера": "Литература",
    "литра": "Литература",
    "лит": "Литература",
    "русскаялитература": "Русская литература",
    "белорусскаялитература": "Белорусская литература",
    "литературноечтение": "Литературное чтение",
    "литчт": "Литературное чтение",
    "литчтен": "Литературное чтение",
    "чтение": "Литературное чтение",
    "письмо": "Письмо",
    "азбука": "Обучение грамоте (азбука)",
    "роднойязык": "Родной язык",
    "роднойяз": "Родной язык",
    "роднаялитература": "Родная литература",
    "родлит": "Родная литература",
    "математика": "Математика",
    "матем": "Математика",
    "математ": "Математика",
    "мат": "Математика",
    "практматем": "Практическая математика",
    "алгебра": "Алгебра",
    "алгебр": "Алгебра",
    "алг": "Алгебра",
    "геометрия": "Геометрия",
    "геометр": "Геометрия",
    "геомер": "Геометрия",
    "геом": "Геометрия",
    "вис": "Вероятность и статистика",
    "вероятностьистатистика": "Вероятность и статистика",
    "вероятнист": "Вероятность и статистика",
    "веристат": "Вероятность и статистика",
    "стат": "Вероятность и статистика",
    "информатика": "Информатика",
    "инфа": "Информатика",
    "информ": "Информатика",
    "инфор": "Информатика",
    "инф": "Информатика",
    "икт": "Информатика",
    "оснпрогр": "Основы программирования",
    "история": "История",
    "истор": "История",
    "ист": "История",
    "историяроссии": "История",
    "всеобщаяистория": "Всеобщая история",
    "всемирнаяистория": "Всемирная история",
    "обществознание": "Обществознание",
    "общество": "Обществознание",
    "общест": "Обществознание",
    "обществ": "Обществознание",
    "общ": "Обществознание",
    "челобщ": "Человек и общество",
    "человекимир": "Человек и мир",
    "география": "География",
    "географ": "География",
    "геогр": "География",
    "гео": "География",
    "биология": "Биология",
    "биол": "Биология",
    "био": "Биология",
    "физика": "Физика",
    "физик": "Физика",
    "физ": "Физика",
    "химия": "Химия",
    "хим": "Химия",
    "астрономия": "Астрономия",
    "астр": "Астрономия",
    "окружающиймир": "Окружающий мир",
    "окрмир": "Окружающий мир",
    "ом": "Окружающий мир",
    "оом": "Ознакомление с окружающим миром",
    "иностранныйязык": "Иностранный язык",
    "иняз": "Иностранный язык",
    "иностряз": "Иностранный язык",
    "ия": "Иностранный язык",
    "2йиняз": "Второй иностранный язык",
    "английскийязык": "Английский язык",
    "английский": "Английский язык",
    "англяз": "Английский язык",
    "ангяз": "Английский язык",
    "англ": "Английский язык",
    "немецкийязык": "Немецкий язык",
    "немяз": "Немецкий язык",
    "немецяз": "Немецкий язык",
    "немец": "Немецкий язык",
    "нем": "Немецкий язык",
    "французскийязык": "Французский язык",
    "францяз": "Французский язык",
    "фряз": "Французский язык",
    "украинскийязык": "Украинский язык",
    "укряз": "Украинский язык",
    "белорусскийязык": "Белорусский язык",
    "белояз": "Белорусский язык",
    "изобразительноеискусство": "Изобразительное искусство",
    "изобразительнойискусство": "Изобразительное искусство",
    "изо": "Изобразительное искусство",
    "музыка": "Музыка",
    "муз": "Музыка",
    "мхк": "Мировая художественная культура",
    "искусство": "Искусство",
    "трудтехнология": "Труд",
    "труд": "Труд",
    "технология": "Труд",
    "технол": "Труд",
    "техн": "Труд",
    "техно": "Труд",
    "техндев": "Труд",
    "физическаякультура": "Физическая культура",
    "физра": "Физическая культура",
    "фра": "Физическая культура",
    "фзк": "Физическая культура",
    "фк": "Физическая культура",
    "физкульт": "Физическая культура",
    "физкультура": "Физическая культура",
    "физичкультура": "Физическая культура",
    "физическаякультураиздоровье": "Физическая культура",
    "обзр": "ОБЗР",
    "обж": "ОБЖ",
    "однкнр": "ОДНКНР",
    "однк": "ОДНКНР",
    "однрк": "ОДНКНР",
    "орксэ": "ОРКСЭ",
    "разговорыоважном": "Разговоры о важном",
    "разговажн": "Разговоры о важном",
    "разговажном": "Разговоры о важном",
    "вдразговорыоважном": "Разговоры о важном",
    "оважном": "Разговоры о важном",
    "ров": "Разговоры о важном",
    "россиямоигоризонты": "Россия — мои горизонты",
    "росмоигориз": "Россия — мои горизонты",
    "рмг": "Россия — мои горизонты",
    "финграмот": "Финансовая грамотность",
    "финансоваяграмотность": "Финансовая грамотность",
    "финграм": "Финансовая грамотность",
    "функцгр": "Функциональная грамотность",
    "индивпроект": "Индивидуальный проект",
    "проекте": "Индивидуальный учебный проект",
    "проект": "Индивидуальный учебный проект",
    "экономика": "Экономика",
    "эконом": "Экономика",
    "право": "Право",
    "философия": "Философия",
    "бпла": "Беспилотные летательные аппараты",
    "клчас": "Классный час",
    "классныйчас": "Классный час",
    "динпауза": "Динамическая пауза",
    "ритмика": "Ритмика",
    "хор": "Хор",
    "этикет": "Этикет",
    "народоведение": "Народоведение",
    "экскурсия": "Экскурсия",
    "осеннийкросс": "Осенний кросс",
    "деньклассногоруководителя": "День классного руководителя",
  };

  var DAY_ROOTS = [
    ["понед", 0], ["вторн", 1], ["сред", 2],
    ["четв", 3], ["пятн", 4], ["суббот", 5], ["воскрес", 6],
  ];
  var DAY_SHORT = { пн: 0, вт: 1, ср: 2, чт: 3, пт: 4, сб: 5, вс: 6 };
  var DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

  /* ---------- нормализация ---------- */

  // Омоглифы: латинские буквы, неотличимые от кириллических. Встречаются
  // при копировании из вёрстки и ломают сравнение молча.
  var HOMOGLYPHS = {
    a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", A: "А", B: "В",
    C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х",
  };

  function sanitize(text) {
    return String(text)
      .replace(/\r\n?/g, "\n")
      .replace(/[   ​‌‍﻿]/g, " ")  // невидимые пробелы
      .replace(/[‐-―−]/g, "-")                          // все тире к дефису
      .replace(/[«»""'']/g, '"')
      .replace(/^\s*>+\s?/gm, "")                                      // цитирование из почты
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]+$/gm, "");
  }

  function normKey(s) {
    var out = String(s).toLowerCase().replace(/ё/g, "е");
    out = out.replace(/[a-zA-Z]/g, function (ch) { return HOMOGLYPHS[ch] || ch; });
    return out.replace(/[.\-\s*"()№]/g, "");
  }

  /* ---------- словарь: четыре класса поиска ---------- */

  function lookupSubject(raw) {
    var key = normKey(raw);
    if (!key) return null;

    if (SUBJECT_DICT[key]) return { name: SUBJECT_DICT[key], how: "точно" };

    // префикс: название обрезано посередине («математ», «географ»)
    if (key.length >= 4) {
      var hits = [];
      for (var k in SUBJECT_DICT) {
        if (k.indexOf(key) === 0 || key.indexOf(k) === 0) hits.push(SUBJECT_DICT[k]);
      }
      var uniq = hits.filter(function (v, i) { return hits.indexOf(v) === i; });
      if (uniq.length === 1) return { name: uniq[0], how: "по началу слова" };
    }

    // аббревиатура: совпадение множества букв (ОБЖ, ОДНКНР и опечатки в них)
    if (/^[А-ЯЁ]{3,8}$/.test(String(raw).trim())) {
      var letters = key.split("").sort().join("");
      var acr = [];
      for (var k2 in SUBJECT_DICT) {
        if (k2.length === key.length && k2.split("").sort().join("") === letters) {
          acr.push(SUBJECT_DICT[k2]);
        }
      }
      if (acr.length === 1) return { name: acr[0], how: "как сокращение" };
    }
    return null;
  }

  /* ---------- разбор строки ---------- */

  var RE = {
    dateDmy: /\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\b/,
    dateWords: /\b(\d{1,2})\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*(?:\s+\d{4})?\b/i,
    // время: 8:00, 08.00, 8-00, и диапазоны через дефис
    timeRange: /\b(\d{1,2})[:.\-](\d{2})\s*-\s*(\d{1,2})[:.\-](\d{2})\b/,
    timeOne: /\b(\d{1,2})[:.](\d{2})\b/,
    leadNum: /^\s*(\d{1,2})\s*[.)\]]?\s+/,
    fio: /\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\./,
    room: /\s(\d{1,3}[а-я]?)\s*$/,
  };

  function dayIndexOf(text) {
    var key = normKey(text);
    for (var i = 0; i < DAY_ROOTS.length; i++) {
      if (key.indexOf(DAY_ROOTS[i][0]) >= 0) return DAY_ROOTS[i][1];
    }
    if (key.length === 2 && DAY_SHORT[key] !== undefined) return DAY_SHORT[key];
    return -1;
  }

  // Заголовок дня — строка, от которой после снятия дня, даты и
  // разделителей ничего не остаётся.
  function isDayHeader(line) {
    var di = dayIndexOf(line);
    if (di < 0) return -1;
    var rest = line
      .replace(RE.dateDmy, " ")
      .replace(RE.dateWords, " ")
      .replace(/\(\s*\d\s*(четверть|триместр|смена)\s*\)/gi, " ")
      .replace(/\b(идет|идёт)\s+(чётная|четная|нечётная|нечетная)\s+неделя\b/gi, " ")
      .replace(/[,:;.\-—()\d]/g, " ")
      .trim();
    var restKey = normKey(rest);
    for (var i = 0; i < DAY_ROOTS.length; i++) {
      restKey = restKey.split(DAY_ROOTS[i][0]).join("");
    }
    restKey = restKey.replace(/^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|пн|вт|ср|чт|пт|сб|вс)$/i, "");
    return restKey.replace(/[а-яa-z]{0,2}/i, "") === "" || restKey.length <= 2 ? di : -1;
  }

  // Сколько названий дней в строке. Два и больше — это шапка таблицы,
  // где дни стоят колонками, а не заголовок одного дня.
  function countDays(line) {
    var key = normKey(line);
    var n = 0;
    DAY_ROOTS.forEach(function (d) {
      var i = key.indexOf(d[0]);
      if (i >= 0) n++;
    });
    return n;
  }

  /* Что это за строка. Тип назначается независимо от соседей —
     иначе одна непонятная строка утаскивает за собой весь блок. */
  function classify(line, index) {
    var t = line.trim();
    if (!t) return { type: "пусто", index: index, raw: line };

    // шапка таблицы: дни колонками, либо служебные столбцы
    if (countDays(t) >= 2) return { type: "шапка-дни", index: index, raw: line };
    if (/^[№#]?\s*(урок|время|каб|предмет)\b/i.test(t) && /\t|\s{2,}/.test(t)) {
      return { type: "шапка", index: index, raw: line };
    }
    /* Шапка параллели: «№ Время 5а 5б 5в».
       Границу слова \b здесь использовать нельзя: в JavaScript она
       определена через латиницу, и после кириллической буквы её просто
       нет — «5а 5б» тихо не совпадает. Ограничиваем пробелами явно. */
    if (/(^|\s)\d{1,2}\s*[а-дА-Д](\s|$).*(^|\s)\d{1,2}\s*[а-дА-Д](\s|$)/.test(t)) {
      return { type: "шапка-классы", index: index, raw: line };
    }
    // одинокая метка класса строкой: «5А», «8а»
    if (/^\d{1,2}\s*[а-яА-Я]$/.test(t)) return { type: "класс", index: index, raw: line };

    var di = isDayHeader(t);
    if (di >= 0) return { type: "день", day: di, index: index, raw: line };

    /* «Расписание на понедельник:» — это и якорь, и заголовок дня.
       День здесь важнее: без него весь блок уроков остаётся без дня
       и уходит в непонятые. */
    if (/^расписание/i.test(t) || /^дз\b/i.test(t) || /^домашн/i.test(t)) {
      var dayInAnchor = dayIndexOf(t);
      if (dayInAnchor >= 0) {
        return { type: "день", day: dayInAnchor, index: index, raw: line };
      }
      return { type: "якорь", index: index, raw: line };
    }
    if (/^(отсутствуют|замены|замена)\s*:/i.test(t)) {
      return { type: "замены", index: index, raw: line };
    }
    if (RE.fio.test(t) && !lookupSubject(t.replace(RE.fio, ""))) {
      return { type: "фио", index: index, raw: line };
    }

    /* Строка, где кроме времени и служебных слов ничего нет, — это
       сетка звонков, а не урок. Самая частая правдоподобная ошибка:
       выдать шесть уроков с названиями-временами. */
    var withoutTime = t.replace(RE.timeRange, " ").replace(RE.leadNum, " ")
      // без \b: она определена через латиницу и после кириллицы не срабатывает
      .replace(/(^|\s)(урок|уроки|перемена|звонок|звонки|большая|перерыв|смена)(?=\s|$)/gi, " ")
      .replace(/[№#-]/g, " ").trim();
    if (RE.timeRange.test(t) && !/[А-Яа-яЁёA-Za-z]{3,}/.test(withoutTime)) {
      return { type: "звонок", index: index, raw: line };
    }

    return { type: "содержимое", index: index, raw: line };
  }

  /* ---------- разбор ячейки урока ---------- */

  function parseLesson(line, index) {
    var rest = line.trim();
    var out = { raw: line, lineIndex: index, num: null, time: null, room: null, note: "" };

    var m = rest.match(RE.leadNum);
    if (m) { out.num = Number(m[1]); rest = rest.slice(m[0].length); }

    var tr = rest.match(RE.timeRange);
    if (tr) { out.time = tr[1] + ":" + tr[2] + " — " + tr[3] + ":" + tr[4]; rest = rest.replace(RE.timeRange, " "); }

    rest = rest.replace(/^\s*урок\s*:?\s*/i, "");

    // хвост после « - » или « – » — что принести, задание, кабинет
    var dash = rest.split(/\s[-–—]\s/);
    if (dash.length > 1) {
      rest = dash[0];
      out.note = dash.slice(1).join(" - ").trim();
    }

    // квадратные скобки: кабинет или пометка
    var br = rest.match(/\[([^\]]+)\]/);
    if (br) {
      if (/^\d{1,3}[а-я]?$/i.test(br[1].trim())) out.room = br[1].trim();
      else out.note = (out.note ? out.note + "; " : "") + br[1].trim();
      rest = rest.replace(/\[[^\]]*\]/g, " ");
    }

    /* Скобочный хвост — почти всегда пометка, а не часть названия:
       «Физ-ра (форма!)», «Английский (1 группа)». Но у некоторых
       предметов скобки входят в официальное имя — «Труд (технология)»,
       — поэтому отрываем только если остаток узнаётся словарём. */
    var paren = rest.match(/\s*\(([^)]{1,40})\)\s*$/);
    if (paren) {
      var withoutParen = rest.slice(0, paren.index).trim();
      if (withoutParen && lookupSubject(withoutParen)) {
        out.note = (out.note ? out.note + "; " : "") + paren[1].trim();
        rest = withoutParen;
      }
    }

    rest = rest.replace(/\*+/g, " ").trim();

    /* Кабинет отрывается от названия ТОЛЬКО если остаток после отрыва
       узнаётся словарём. Иначе «Кабинет 5» превратится в «Кабинет». */
    var rm = rest.match(RE.room);
    if (rm) {
      var without = rest.slice(0, rm.index).trim();
      if (without && lookupSubject(without)) { out.room = rm[1]; rest = without; }
    }
    // слитный кабинет: «Англ38/122», «ОБЗР103»
    var glued = rest.match(/^([А-Яа-яЁё][А-Яа-яЁё.\-\s]*?)(\d{1,3}(?:\/\d{1,3})?)$/);
    if (glued && lookupSubject(glued[1])) { out.room = glued[2]; rest = glued[1].trim(); }

    out.title = rest.replace(/[\s.,;:]+$/, "").trim();
    if (!out.title) return null;

    var hit = lookupSubject(out.title);
    if (hit) { out.subject = hit.name; out.how = hit.how; return out; }

    /* Название словарём не узнано. Урок сохраняется только при внешнем
       признаке урока — номере или времени. Иначе это не урок, а строка
       текста, и она уходит в непонятые. Это и есть запрет на выдумывание:
       из «Добрый вечер! Сдаём деньги на тетради» урок не рождается. */
    var looksLikeName = out.title.length <= 34 && !/[!?]/.test(out.title) &&
                        out.title.split(/\s+/).length <= 4;
    if (out.num !== null || out.time || looksLikeName) {
      out.subject = out.title;
      out.how = "не узнала";
      return out;
    }
    return null;
  }

  /* Уроки одной строкой через запятую — обычный формат сообщения
     учителя: «Письмо, чтение, матем, физ-ра, ИЗО». Разбивается только
     если БОЛЬШИНСТВО кусков узнаётся словарём, иначе обычное предложение
     с запятыми превратится в пять уроков. */
  function splitCommaList(line, index) {
    if (line.indexOf(",") < 0) return null;
    var parts = line.split(",").map(function (p) { return p.trim(); }).filter(Boolean);
    if (parts.length < 3) return null;
    var known = parts.filter(function (p) { return lookupSubject(p); }).length;
    if (known < Math.ceil(parts.length * 0.6)) return null;
    return parts.map(function (p, i) {
      var hit = lookupSubject(p);
      return {
        raw: line, lineIndex: index, num: i + 1, time: null, room: null, note: "",
        title: p, subject: hit ? hit.name : p, how: hit ? hit.how : "не узнала",
      };
    });
  }

  /* ============================================================
     ГЛАВНАЯ ФУНКЦИЯ
     Возвращает три вещи: что понято, что не понято и что это вообще
     было. Ноль уроков — законный результат, если сказано почему.
     ============================================================ */

  D.parseSchedule = function (text) {
    var clean = sanitize(text);
    var lines = clean.split("\n");
    var marks = lines.map(classify);

    var content = marks.filter(function (m) { return m.type === "содержимое"; });
    var bells = marks.filter(function (m) { return m.type === "звонок"; });
    var dayHeads = marks.filter(function (m) { return m.type === "день"; });
    var deltas = marks.filter(function (m) { return m.type === "замены"; });

    // Сетка звонков — не расписание. Самая частая правдоподобная ошибка:
    // выдать шесть уроков с названиями-временами.
    if (bells.length >= 3 && content.length === 0) {
      return { kind: "bells", days: [], unparsed: [],
               verdict: "Это расписание звонков — предметов в тексте нет." };
    }

    if (deltas.length && content.length <= deltas.length) {
      return { kind: "delta", days: [], unparsed: marks.filter(function (m) {
                 return m.type !== "пусто"; }).map(toUnparsed("DELTA")),
               verdict: "Это изменения к расписанию, а не расписание. Внести их можно руками." };
    }

    /* Таблица, где дни стоят колонками. Разбирать её вслепую — верный
       способ выдать правдоподобную чушь: колонки разъезжаются, как
       только в одной из них урока нет. Честнее сказать прямо. */
    var gridHead = marks.filter(function (m) { return m.type === "шапка-дни"; });
    if (gridHead.length) {
      return { kind: "grid", days: [], unparsed: marks
                 .filter(function (m) { return m.type !== "пусто"; })
                 .map(toUnparsed("GRID")),
               verdict: "Тут расписание таблицей, где дни идут колонками — такую я пока разбираю " +
                        "неверно и не возьмусь. Скопируй один день или впиши руками." };
    }

    var classHead = marks.filter(function (m) { return m.type === "шапка-классы"; });
    if (classHead.length) {
      return { kind: "parallel", days: [], unparsed: marks
                 .filter(function (m) { return m.type !== "пусто"; })
                 .map(toUnparsed("PARALLEL")),
               verdict: "Это расписание сразу нескольких классов. Какой из них твой, " +
                        "я не знаю и угадывать не буду — скопируй колонку своего класса." };
    }

    if (!content.length) {
      return { kind: "empty", days: [], unparsed: [],
               verdict: "В тексте не нашлось ни одного урока." };
    }

    /* Геометрия: строки раскладываются по дням, встреченным в тексте.
       День НЕ подставляется по умолчанию — строки до первого заголовка
       дня уходят в непонятые, а не приписываются понедельнику. */
    var days = [];
    var unparsed = [];
    var current = null;

    marks.forEach(function (m) {
      if (m.type === "день") {
        current = { day: m.day, name: DAY_NAMES[m.day], lessons: [], lineIndex: m.index };
        days.push(current);
        return;
      }
      if (m.type !== "содержимое") return;

      if (!current) {
        // Единственный день без заголовка — законный случай: «расписание
        // на завтра». Но день назвать обязан человек, а не разборщик.
        if (dayHeads.length === 0) {
          current = { day: null, name: null, lessons: [], lineIndex: m.index, needsDay: true };
          days.push(current);
        } else {
          unparsed.push(toUnparsed("NO_DAY")(m));
          return;
        }
      }
      var list = splitCommaList(m.raw, m.index);
      if (list) { list.forEach(function (l) { current.lessons.push(l); }); return; }

      var lesson = parseLesson(m.raw, m.index);
      if (lesson) current.lessons.push(lesson);
      else unparsed.push(toUnparsed("UNKNOWN_SHAPE")(m));
    });

    days = days.filter(function (d) { return d.lessons.length; });

    var total = days.reduce(function (n, d) { return n + d.lessons.length; }, 0);
    var unknown = days.reduce(function (n, d) {
      return n + d.lessons.filter(function (l) { return l.how === "не узнала"; }).length;
    }, 0);

    return {
      kind: total ? "schedule" : "empty",
      days: days,
      unparsed: unparsed,
      needsDay: days.some(function (d) { return d.needsDay; }),
      verdict: buildVerdict(days, total, unparsed.length, unknown),
      stats: { days: days.length, lessons: total, unknown: unknown, unparsed: unparsed.length },
    };
  };

  function toUnparsed(reason) {
    return function (m) { return { raw: m.raw, lineIndex: m.index, reason: reason }; };
  }

  function buildVerdict(days, total, unparsedCount, unknown) {
    if (!total) return "В тексте не нашлось ни одного урока.";
    var parts = ["Нашла " + days.length + " " + D.plural(days.length, "день", "дня", "дней") +
                 ", " + total + " " + D.plural(total, "урок", "урока", "уроков") + "."];
    if (unknown) {
      parts.push(unknown + " " + D.plural(unknown, "название", "названия", "названий") +
                 " не узнала — оставила как есть.");
    }
    if (unparsedCount) {
      parts.push(unparsedCount + " " + D.plural(unparsedCount, "строку", "строки", "строк") +
                 " не поняла.");
    }
    return parts.join(" ");
  }

  D.SUBJECT_DICT = SUBJECT_DICT;
  D.normKey = normKey;
  D.lookupSubject = lookupSubject;
})(window.D);
