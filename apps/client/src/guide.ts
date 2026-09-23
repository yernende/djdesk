import type { Locale } from "./i18n.ts";

export const guide: Record<Locale, readonly { title: string; body: string }[]> = {
  ru: [
    {
      title: "Найдите и послушайте треки",
      body: "Поиск по названию, исполнителю или тональности изначально работает по всему каталогу. Выбор и прослушивание трека не ограничивают следующий поиск. Фильтры помогают выбрать темп, качество и наличие аудио. Выберите трек и нажмите «Слушать». Ползунок перематывает запись, «Скачать аудио» сохраняет файл.",
    },
    {
      title: "Перебирайте секторы карты",
      body: "Клик по любой части большого сектора ставит его треки первыми; остальные остаются ниже. На границе приоритет получают оба соседних сектора без повторов треков. Метка «Сначала: …» показывает этот приоритет, её можно снять отдельно. Подсекторы объясняют музыкальное положение треков, но не ограничивают каталог. Без текста треки внутри каждой группы идут по BPM, а переход к целевому BPM работает в приоритетной группе. При поиске сначала учитывается совпадение с запросом: точное название из другого сектора остаётся наверху. Клик по карте не переключает аудио. Очистка поиска убирает только текст.",
    },
    {
      title: "Соберите свой сет",
      body: "Обычное открытие главной страницы показывает пустой редактор. «Создать сет» начинает новый сет, а «Открыть сет» позволяет выбрать сохранённый; список появляется только по запросу. Кнопка «Добавить» также может начать первый сет. Один трек можно добавлять несколько раз. Меняйте порядок перетаскиванием или кнопками «Выше» и «Ниже». Для замены выберите позицию кнопкой «Выбрать для замены», затем другой трек и «Заменить». «Добавлять в конец» возвращает добавление после последнего трека. Кнопка «По гармонии» упорядочивает сет; решение о переходах остаётся за вами.",
    },
    {
      title: "Включайте совместимость по необходимости",
      body: "«Только совместимые» изначально выключен. Включите его, чтобы оставить гармонически подходящие треки: при добавлении — после последнего трека сета, при замене — между соседями выбранной позиции. Подпись рядом с переключателем показывает опорные треки. Прослушивание кандидата не меняет опору, а изменение порядка или позиции сета меняет. Без опоры переключатель недоступен; при её исчезновении он выключается. Темп и наличие трека в сете сами по себе ничего не скрывают. Если совпадений нет, «Выключить совместимость» расширяет выдачу, сохраняя запрос. Предупреждения о рискованных переходах остаются, но не запрещают добавить трек.",
    },
    {
      title: "Открывайте сет явно",
      body: "Создание или открытие сета добавляет ?set=id в адрес страницы. Обновление такого адреса открывает тот же сет при наличии доступа. «Закрыть сет» убирает его из адреса и возвращает пустой редактор; переключение и закрытие редактора сохраняют несохранённые изменения в текущей вкладке. Обычный адрес без ?set= всегда начинает с пустого редактора, даже если браузер помнит доступ к вашим сетам.",
    },
    {
      title: "Делитесь конкретным треком",
      body: "Название трека — ссылка, которую можно открыть в другой вкладке. Маленькая кнопка со значком ссылки справа от названия в карточке копирует адрес вида /?track=id. В нём нет выбранного сета или секретного доступа: такой ссылкой можно делиться. Она открывает карточку без запуска аудио и без ограничений поиска. Если трек недоступен, приложение сообщит об этом. Обновление страницы и кнопки браузера «Назад» и «Вперёд» сохраняют навигацию по ссылкам.",
    },
    {
      title: "Следите за сохранением",
      body: "Имя, порядок и повторы сохраняются автоматически. Дождитесь надписи «Сохранено». Если видите «Не удалось сохранить», оставьте страницу открытой и повторите попытку: несохранённый вариант находится в этом браузере. Принудительное закрытие страницы может его потерять.",
    },
    {
      title: "Сохраните секретную ссылку",
      body: "После первого сохранения скопируйте секретную ссылку и уберите её в надёжное место. Она открывает все ваши сеты на другом устройстве без регистрации. Любой, у кого есть эта ссылка, может их изменять — не публикуйте её. Ссылка действует до замены; сессия браузера — 30 дней. Без ссылки и действующей сессии восстановить доступ невозможно.",
    },
    {
      title: "Замените ссылку при необходимости",
      body: "Действующая сессия позволяет создать новую секретную ссылку. Прежняя ссылка и сессии остальных устройств сразу потеряют доступ, а сами сеты сохранятся. Сохраните новую ссылку и откройте её на нужных устройствах.",
    },
    {
      title: "Разрешите конфликт двух устройств",
      body: "Если один сет изменён в двух вкладках или на двух устройствах, DJDesk оставит ваш вариант в редакторе. «Сохранить мой вариант как копию» создаст отдельный сет. «Загрузить сохранённую версию» заменит редактор данными с сервера и отбросит ваши несохранённые изменения после подтверждения.",
    },
    {
      title: "Настройте язык и обозначения",
      body: "RU / EN переключает язык интерфейса. Отдельно выбираются буквенные обозначения, «До / Ре / Ми», Camelot или Open Key. Меняются подписи; музыкальная совместимость остаётся прежней. На телефоне используйте нижние вкладки «Карта», «Треки», «Трек» и «Сет».",
    },
  ],
  en: [
    {
      title: "Find and listen to tracks",
      body: "Search by title, artist or key across the whole catalogue by default. Selecting or listening to a track does not restrict your next search. Filters narrow tempo, quality and audio availability. Select a track and press Play. Use the slider to seek and Download audio to save the file.",
    },
    {
      title: "Browse around the map",
      body: "Click any part of a large sector to put its tracks first, with all other tracks below. A boundary prioritizes both neighboring sectors without duplicate tracks. The removable First: … label shows the priority. Subsections explain musical placement without restricting the catalogue. Without search text, each group is ordered by BPM and jumping to a target BPM works in the preferred group. Search relevance comes first when you type: an exact title in another sector still appears at the top. Clicking the map does not change audio playback. Clearing search removes only the text.",
    },
    {
      title: "Build your set",
      body: "Opening the home page starts with an empty editor. Create set starts a new set; Open set lets you choose a saved one. The list appears only when requested. Add can also start your first set. Repeated tracks are allowed. Drag tracks or use Move up and Move down to reorder them. To replace a track, choose Use as replacement target, select another track and press Replace. Append to end returns to adding after the final track. Sort harmonically orders the set; you decide which transitions to use.",
    },
    {
      title: "Turn compatibility on when needed",
      body: "Only compatible starts off. Turn it on to keep harmonically suitable tracks: after the last set track when appending, or between the selected position’s neighbors when replacing. The label beside the switch names the reference tracks. Listening to a candidate does not change the reference; changing set order or position does. Without a reference, the switch is unavailable; losing the reference turns it off. Tempo and existing set membership do not hide tracks by themselves. If there are no matches, Turn off compatibility widens the results while keeping the query. Risky transitions still show warnings and remain available to add.",
    },
    {
      title: "Open a set explicitly",
      body: "Creating or opening a set adds ?set=id to the page address. Refreshing that address opens the same set when you have access. Close set removes it from the address and returns to the empty editor. Switching or closing the editor keeps unsaved changes in the current tab. The plain address without ?set= always starts with an empty editor, even when your browser remembers access to your sets.",
    },
    {
      title: "Share a specific track",
      body: "A track title is a link you can open in another tab. The small link button beside the title in the track card copies an address such as /?track=id. It contains no selected set or secret access details and is safe to share. It opens the track card without starting audio or restricting search. An unavailable track shows a message. Refreshing the page and using the browser’s Back and Forward buttons preserve link navigation.",
    },
    {
      title: "Check saving status",
      body: "Names, order and repeats save automatically. Wait for Saved. If you see Could not save, keep the page open and retry: your unsaved version remains in this browser. Forcing the page to close can lose it.",
    },
    {
      title: "Keep your secret link",
      body: "After the first save, copy your private access link and keep it somewhere safe. It opens all your sets on another device without registration. Anyone with the link can edit them, so do not publish it. The link lasts until replaced; a browser session lasts 30 days. Without either the link or an active session, access cannot be recovered.",
    },
    {
      title: "Replace the link when needed",
      body: "An active session lets you create a new secret link. The old link and all other device sessions immediately lose access; your sets stay saved. Keep the new link and open it on your other devices.",
    },
    {
      title: "Resolve a conflict",
      body: "When two tabs or devices change the same set, DJDesk keeps your version in the editor. Save my version as a copy creates another set. Load saved version replaces the editor with server data and discards your unsaved changes after confirmation.",
    },
    {
      title: "Choose language and notation",
      body: "RU / EN changes the interface language. Choose letters, Do / Re / Mi, Camelot or Open Key separately. These change labels while harmonic compatibility stays the same. On phones, use the bottom Map, Tracks, Focus and Set tabs.",
    },
  ],
};

export function russianGuideMarkdown(): string {
  return (
    "# DJDesk — как пользоваться\n\nОткрыть демку: https://djdesk.zouk-in-tomsk.ru\n\n" +
    guide.ru.map(({ title, body }) => `## ${title}\n\n${body}`).join("\n\n") +
    "\n"
  );
}
