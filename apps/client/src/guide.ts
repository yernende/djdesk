import type { Locale } from "./i18n.ts";

export const guide: Record<Locale, readonly { title: string; body: string }[]> = {
  ru: [
    {
      title: "Найдите и послушайте треки",
      body: "Ищите по названию, исполнителю или тональности. Фильтры помогают выбрать темп, качество и наличие аудио. Клик по гармонической карте сужает каталог; кнопка «Все треки» снимает выделение карты. Выберите трек и нажмите «Слушать». Ползунок перематывает запись, «Скачать аудио» сохраняет файл.",
    },
    {
      title: "Соберите свой сет",
      body: "Нажмите «Добавить»: первый сет создастся и сохранится автоматически. Его можно переименовать, а через поле «Название нового сета» создать ещё один. Один трек можно добавлять несколько раз. Меняйте порядок перетаскиванием или кнопками «Выше» и «Ниже». Для замены выберите позицию кнопкой «Выбрать для замены», затем другой трек и «Заменить». Кнопка «По гармонии» упорядочивает сет; решение о переходах остаётся за вами.",
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
      body: "Search by title, artist or key. Filters narrow tempo, quality and audio availability. Click the harmonic map to narrow the catalogue; All tracks clears the map selection. Select a track and press Play. Use the slider to seek and Download audio to save the file.",
    },
    {
      title: "Build your set",
      body: "Press Add to create and save your first set automatically. Rename it, or use New set name to create another. Repeated tracks are allowed. Drag tracks or use Move up and Move down to reorder them. To replace a track, choose Use as replacement target, select another track and press Replace. Sort harmonically orders the set; you decide which transitions to use.",
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
