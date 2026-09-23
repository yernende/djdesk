export type Locale = "ru" | "en";
export const LOCALE_STORAGE_KEY = "djdesk.locale";

// English source phrases are stable, typed keys; both languages share parameters.
export const ru = {
  Language: "Язык",
  "How to use": "Как пользоваться",
  Close: "Закрыть",
  "Key notation": "Обозначения тональностей",
  "Do / Re / Mi": "До / Ре / Ми",
  "Now playing": "Сейчас играет",
  Pause: "Пауза",
  Play: "Слушать",
  Tempo: "Темп",
  "Seek focused track": "Перемотка выбранного трека",
  "Track analysis summary": "Сводка каталога",
  tracks: "треков",
  "confirmed keys": "тональностей подтверждено",
  "unknown keys": "тональностей неизвестно",
  "mixed modes": "смешанных ладов",
  "Circle of fifths desk": "Гармоническая карта",
  "Loading modal map...": "Загрузка карты…",
  "Tracks arranged by modal position on the circle of fifths":
    "Треки по ладовому положению на квинтовом круге",
  "Draft set chain": "Редактор сета",
  Sets: "Мои сеты",
  "Create set": "Создать сет",
  "Open set": "Открыть сет",
  "Close set": "Закрыть сет",
  "No saved sets": "Нет сохранённых сетов",
  "Choose a saved set": "Выберите сохранённый сет",
  "Set unavailable": "Сет недоступен",
  "Loading sets…": "Загрузка сетов…",
  "No set open": "Сет не открыт",
  "No set yet": "Пока нет сетов",
  "New set name": "Название нового сета",
  Create: "Создать",
  "Back to catalogue": "Вернуться в каталог",
  "Pick a track and press Add to start your first set. Save your private access link to continue on another device. No account needed.":
    "Выберите трек и нажмите «Добавить», чтобы начать первый сет. Сохраните секретную ссылку для доступа с другого устройства. Регистрация не нужна.",
  "Private access link": "Секретная ссылка",
  "Copy link": "Скопировать ссылку",
  "I saved it · Hide": "Ссылка сохранена · Скрыть",
  "Create a new access link": "Создать новую секретную ссылку",
  "Your sets are saved online. Keep your secret link to reopen them on another device.":
    "Ваши сеты сохраняются на сервере. Сохраните секретную ссылку, чтобы открыть их на другом устройстве.",
  "Save this link now. Anyone with it can edit all your sets. Without the link or an active browser session, access cannot be recovered.":
    "Сохраните эту ссылку. Любой, у кого она есть, может изменять все ваши сеты. Без ссылки и действующей сессии браузера восстановить доступ невозможно.",
  "Link copied. Keep it somewhere private.":
    "Ссылка скопирована. Храните её в надёжном месте и не публикуйте.",
  "Select and copy the link below.": "Выделите и скопируйте ссылку вручную.",
  "Replace your secret link? The old link and other devices will lose access. Your sets will remain saved.":
    "Заменить секретную ссылку? Прежняя ссылка и другие устройства потеряют доступ. Ваши сеты сохранятся.",
  "Could not save": "Не удалось сохранить",
  "Saving…": "Сохраняется…",
  Saved: "Сохранено",
  Ready: "Готово",
  "Retry save": "Повторить сохранение",
  "Load saved version": "Загрузить сохранённую версию",
  "Save my version as a copy": "Сохранить мой вариант как копию",
  "Load the saved version? Unsaved changes to this set will be discarded.":
    "Загрузить сохранённую версию? Несохранённые изменения этого сета будут потеряны.",
  "This set was deleted on another device. Save your version as a copy.":
    "Сет удалён на другом устройстве. Сохраните свой вариант как копию.",
  "Some sets could not be saved. Open them to recover your changes.":
    "Некоторые сеты не удалось сохранить. Откройте их, чтобы восстановить свои изменения.",
  "Draft set selector": "Выбор сета",
  "Set name": "Название сета",
  "Delete set": "Удалить сет",
  "Delete set “{name}”?": "Удалить сет «{name}»?",
  "Set name is required": "Введите название сета",
  "My first set": "Мой первый сет",
  "Create a set to start saving a real running order.":
    "Создайте сет, чтобы сохранить порядок треков.",
  "BPM match": "Близость BPM",
  "No previous track in selected slot": "У выбранной позиции нет предыдущего трека",
  "No draft endpoint selected": "В сете пока нет треков для сравнения",
  "BPM match unavailable": "Близость BPM неизвестна",
  "BPM match against {bpm} BPM: {score}/100, {delta}% apart":
    "Близость к {bpm} BPM: {score}/100, разница {delta}%",
  "clockwise pure modal": "модальный лад по часовой стрелке",
  "counter pure modal": "модальный лад против часовой стрелки",
  "{score}% BPM match vs {bpm} BPM": "Близость к {bpm} BPM: {score}%",
  "{name} (copy)": "{name} (копия)",
  "Sort harmonically": "По гармонии",
  "Reorder this draft set to maximize harmonic transitions":
    "Упорядочить треки сета по гармонической совместимости",
  "Non-harmonic transition between these tracks":
    "Переход между этими треками не совпадает по гармонии",
  "Special harmony note": "Заметка о гармонии",
  "Draft track controls": "Действия с треком в сете",
  "Use as replacement target": "Выбрать для замены",
  "Drag to reorder": "Перетащить для перестановки",
  "Move up": "Выше",
  "Move down": "Ниже",
  Remove: "Убрать",
  "Track unavailable": "Трек недоступен",
  "Tracks browser": "Каталог треков",
  "All tracks": "Все треки",
  "Search tracks": "Поиск треков",
  "Clear search": "Очистить поиск",
  "Only compatible": "Только совместимые",
  "Turn off compatibility": "Выключить совместимость",
  "Add a track to a set to compare harmony.": "Добавьте трек в сет, чтобы сравнивать гармонию.",
  "Compatible after {track}": "Совместимые после {track}",
  "Compatible between {previous} and {next}": "Совместимые между {previous} и {next}",
  "Compatible before {track}": "Совместимые перед {track}",
  "No compatible matches. Turn off compatibility to search all tracks.":
    "Совместимые треки не найдены. Выключите совместимость, чтобы искать среди всех треков.",
  "Compatibility was turned off because there is no reference track.":
    "Совместимость выключена: нет опорного трека для сравнения.",
  "First: {selection}": "Сначала: {selection}",
  "Clear priority": "Снять приоритет",
  "No sector priority": "Без приоритета сектора",
  "Sector priority": "Приоритет сектора",
  "No matches in the preferred sector. Other matches are shown.":
    "В выбранном секторе совпадений нет. Показаны остальные результаты.",
  Filters: "Фильтры",
  Key: "Тональность",
  "Any key": "Любая тональность",
  "Known key": "Тональность известна",
  "Unknown key": "Тональность неизвестна",
  Audio: "Аудио",
  "Any audio": "Любое аудио",
  "Audio linked": "Есть аудио",
  "Audio missing": "Нет аудио",
  Quality: "Качество",
  "Any quality": "Любое качество",
  "True HQ": "Высокое качество (HQ)",
  Lossy: "С потерями",
  "Lossy+": "С потерями+",
  LOSSY: "С потерями",
  "LOSSY+": "С потерями+",
  "High-bitrate lossy": "С потерями, высокий битрейт",
  "Not analyzed": "Не проанализировано",
  "BPM min": "BPM от",
  "BPM max": "BPM до",
  Any: "Любой",
  "Key state": "Проверка тональности",
  "Any key state": "Любой статус",
  Confirmed: "Подтверждено",
  Unverified: "Не проверено",
  confirmed: "подтверждено",
  unverified: "не проверено",
  "BPM state": "Проверка BPM",
  "Any BPM state": "Любой статус",
  Harmony: "Гармония",
  "Any notes": "Любые заметки",
  "Has notes": "Есть заметки",
  "No notes": "Нет заметок",
  "Any set use": "Все треки",
  "Already in set": "Уже в сете",
  "Not in set": "Не в сете",
  "Reset filters": "Сбросить фильтры",
  "Selected set slot": "Выбранная позиция сета",
  "Append to end": "Добавлять в конец",
  "Target BPM": "Целевой BPM",
  Jump: "Перейти",
  Go: "Перейти",
  Add: "Добавить",
  "Add again": "Добавить ещё раз",
  Replace: "Заменить",
  "Start and save your first set": "Начать и сохранить первый сет",
  "Create a set before adding tracks": "Создайте сет перед добавлением треков",
  "Replace selected set slot": "Заменить выбранный трек в сете",
  "Replace anyway: {reason}": "Всё равно заменить: {reason}",
  "Non-harmonic transition": "Переход не совпадает по гармонии",
  "Non-harmonic": "Не совпадает по гармонии",
  "Breaks previous link": "Не сочетается с предыдущим треком",
  "Breaks next link": "Не сочетается со следующим треком",
  "Breaks both links": "Не сочетается с соседними треками",
  "Track already appears in at least one draft set": "Трек уже есть в одном из ваших сетов",
  "Add to active draft set": "Добавить в текущий сет",
  "Already in a set": "Уже в сете",
  "Replacing #{position}": "Замена трека №{position}",
  "after #{position}": "после №{position}",
  "before #{position}": "перед №{position}",
  "start of set": "начало сета",
  "end of set": "конец сета",
  Map: "Карта",
  Search: "Поиск",
  Tracks: "Треки",
  Focus: "Трек",
  Set: "Сет",
  audio: "аудио",
  info: "инфо",
  "No track selected": "Трек не выбран",
  "Select a track": "Выберите трек",
  "No audio linked": "Нет аудио",
  "Waiting for audio": "Загрузка аудио",
  Playing: "Играет",
  Paused: "На паузе",
  "Original tempo": "Исходный темп",
  "Unknown BPM": "BPM неизвестен",
  "{bpm} BPM is already near playback target": "{bpm} BPM — уже близко к выбранному темпу",
  "Selected track": "Выбранный трек",
  "Focus track": "Выбранный трек",
  "Not linked": "Нет аудио",
  "Audio is not available for this track.": "Для этого трека аудио недоступно.",
  "Download audio": "Скачать аудио",
  "Copy track link": "Скопировать ссылку на трек",
  "Track link copied.": "Ссылка на трек скопирована.",
  "Copy this track link:": "Скопируйте ссылку на трек:",
  "This track is unavailable.": "Этот трек недоступен.",
  "Tempo preview": "Изменить темп прослушивания",
  "Playback BPM": "BPM прослушивания",
  Placement: "Положение на карте",
  "Not placed on circle yet": "Положение на карте неизвестно",
  "Used chords": "Аккорды",
  "Loading chords...": "Загрузка аккордов…",
  "Full chord table": "Таблица аккордов",
  Start: "Начало",
  End: "Конец",
  Chord: "Аккорд",
  Bass: "Бас",
  Basic: "Основа",
  "Harmony note": "Заметка о гармонии",
  Comment: "Комментарий",
  "Select a dot or row.": "Выберите трек в каталоге.",
  "Select a track in the catalogue.": "Выберите трек в каталоге.",
  "Mobile workspace sections": "Разделы приложения",
  "Not aligned to standard A=440 Hz tuning": "Строй отличается от стандартного ля = 440 Гц",
  "non-440": "не 440 Гц",
  "Loading tracks…": "Загрузка треков…",
  "No tracks found": "Треки не найдены",
  "No tracks yet": "Пока нет треков",
  "Opening the catalog.": "Открываем каталог.",
  "Try a different query or filter set.": "Попробуйте другой запрос или измените фильтры.",
  "The public catalog is not available yet. Please check back later.":
    "Каталог пока недоступен. Попробуйте открыть его позже.",
  Boundary: "Граница",
  Section: "Сектор",
  Natural: "Основной лад",
  "Clockwise modal": "Лад по часовой",
  "Counter modal": "Лад против часовой",
  "Circle filter off": "Без фильтра карты",
  "Unplaced tracks": "Вне карты",
  "{keys} boundary": "Граница {keys}",
  "{key} section": "Сектор {key}",
  "{key} clockwise modal": "{key} · лад по часовой",
  "{key} counter modal": "{key} · лад против часовой",
  natural: "основной лад",
  "modal mixture": "смешение ладов",
  "pure modal": "модальный лад",
  "unknown key": "тональность неизвестна",
  "No audio": "Нет аудио",
  Unknown: "Неизвестно",
  "Probe failed": "Не удалось проанализировать",
  "{bits}-bit": "{bits} бит",
  "{rate} kHz": "{rate} кГц",
  "{rate} kbps": "{rate} кбит/с",
  "Set name must contain 1–120 characters.": "Название сета должно содержать от 1 до 120 символов.",
  "Too many requests. Please try again later.": "Слишком много запросов. Попробуйте позже.",
  "This access link is invalid or has been replaced.": "Ссылка недействительна или уже заменена.",
  "Open your current access link again.": "Откройте действующую секретную ссылку ещё раз.",
  "Open your secret access link to continue.": "Откройте секретную ссылку, чтобы продолжить.",
  "Open the complete secret access link for this workspace.":
    "Откройте полную секретную ссылку на свои сеты.",
  "Refresh the page and try again.": "Обновите страницу и попробуйте ещё раз.",
  "Requests must come from this site.": "Откройте DJDesk и повторите действие на сайте.",
  "Set not found.": "Сет не найден.",
  "This workspace has reached its set limit.": "Достигнут лимит сетов: {limit}.",
  "Invalid set ID.": "Некорректный идентификатор сета.",
  "A set revision is required.": "Обновите сет перед сохранением.",
  "This set changed on another device. Your changes have been kept.":
    "Сет изменён на другом устройстве. Ваш вариант остался в редакторе.",
  "A set can contain up to {limit} track IDs.": "В сете может быть не больше {limit} треков.",
  "A track is not available in the public catalogue.": "Трек недоступен в публичном каталоге.",
  "Track not found.": "Трек не найден.",
  "Audio not available.": "Аудио недоступно.",
  "Invalid request.": "Не удалось выполнить запрос. Обновите страницу и попробуйте снова.",
  "The server could not complete this request.":
    "Сервер не смог выполнить запрос. Попробуйте позже.",
  "Connection failed. Check your network and try again. Your changes are still here.":
    "Не удалось связаться с сервером. Проверьте соединение и повторите попытку. Ваши изменения остались в редакторе.",
  "Something went wrong. Please try again.": "Не удалось выполнить действие. Попробуйте ещё раз.",
} as const;

export type MessageKey = keyof typeof ru;
export type MessageParams = Record<string, string | number>;
export const en = Object.fromEntries(Object.keys(ru).map((key) => [key, key])) as Record<
  MessageKey,
  string
>;
export const messages: Record<Locale, Record<MessageKey, string>> = { ru, en };

export function resolveLocale(saved: unknown, languages: readonly string[]): Locale {
  if (saved === "ru" || saved === "en") return saved;
  return languages.some((language) => /^ru(?:-|$)/i.test(language)) ? "ru" : "en";
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  return messages[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    String(params[name] ?? match),
  );
}

export function countLabel(
  locale: Locale,
  count: number,
  noun: "tracks" | "segments" = "tracks",
): string {
  if (locale === "en")
    return `${count} ${noun === "tracks" ? (count === 1 ? "track" : "tracks") : count === 1 ? "chord segment" : "chord segments"}`;
  const plural = new Intl.PluralRules("ru").select(count);
  const forms =
    noun === "tracks"
      ? { one: "трек", few: "трека", many: "треков", other: "трека" }
      : {
          one: "фрагмент с аккордом",
          few: "фрагмента с аккордами",
          many: "фрагментов с аккордами",
          other: "фрагмента с аккордами",
        };
  return `${count} ${forms[plural as keyof typeof forms] ?? forms.other}`;
}

const errorKeys: Record<string, MessageKey> = {
  RATE_LIMITED: "Too many requests. Please try again later.",
  ACCESS_LINK_INVALID: "This access link is invalid or has been replaced.",
  SESSION_REQUIRED: "Open your secret access link to continue.",
  SESSION_REVOKED: "Open your current access link again.",
  CSRF_INVALID: "Refresh the page and try again.",
  ORIGIN_INVALID: "Requests must come from this site.",
  SET_NOT_FOUND: "Set not found.",
  SET_LIMIT: "This workspace has reached its set limit.",
  SET_ID_INVALID: "Invalid set ID.",
  REVISION_REQUIRED: "A set revision is required.",
  REVISION_CONFLICT: "This set changed on another device. Your changes have been kept.",
  TRACK_LIMIT: "A set can contain up to {limit} track IDs.",
  TRACK_UNAVAILABLE: "A track is not available in the public catalogue.",
  SET_NAME_INVALID: "Set name must contain 1–120 characters.",
  TRACK_NOT_FOUND: "Track not found.",
  AUDIO_UNAVAILABLE: "Audio not available.",
  INVALID_REQUEST: "Invalid request.",
  SERVER_ERROR: "The server could not complete this request.",
};

// Keep errors as data in Vue state so a language switch also translates an existing alert.
export function translateMessage(locale: Locale, value: unknown): string {
  if (!value) return "";
  if (typeof value === "string" && Object.hasOwn(ru, value))
    return translate(locale, value as MessageKey);
  if (typeof value === "object" && value !== null) {
    const error = value as { code?: string; params?: MessageParams; message?: string };
    if (error.code && Object.hasOwn(errorKeys, error.code))
      return translate(locale, errorKeys[error.code]!, error.params);
    if (value instanceof TypeError)
      return translate(
        locale,
        "Connection failed. Check your network and try again. Your changes are still here.",
      );
    if (!error.code && error.message && Object.hasOwn(ru, error.message))
      return translate(locale, error.message as MessageKey);
  }
  return translate(locale, "Something went wrong. Please try again.");
}
