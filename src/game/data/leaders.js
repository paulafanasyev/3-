// Лидеры наций. Все вымышленные. Черты от 0 до 1 влияют на переговоры,
// интриги и реплики (src/game/leaders.js). Портреты: public/game/leaders/<id>.png.
export const TRAITS = Object.freeze({
  pride: 'Гордость',      // не терпит требований и угроз
  greed: 'Жадность',      // ценит золото и выгоду выше отношений
  honor: 'Честь',         // держит слово, не прощает обмана
  cunning: 'Хитрость',    // любит интриги, лучше их раскрывает
  caution: 'Осторожность', // боится сильных, уступает угрозам
  memory: 'Злопамятность', // как медленно забываются обиды
});

export const LEADERS = Object.freeze({
  borea: {
    id: 'borea-ingvar',
    name: 'Ингвар Хольмстад',
    title: 'Хранитель Севера',
    portrait: 'borea.png', // + borea-<настроение>.png
    bio: 'Бывший начальник полярной экспедиции. Говорит мало, держит слово, обид не забывает.',
    traits: { pride: 0.6, greed: 0.2, honor: 0.95, cunning: 0.3, caution: 0.7, memory: 0.9 },
  },
  cartel: {
    id: 'cartel-sabina',
    name: 'Сабина Ортелли',
    title: 'Председатель Картеля',
    portrait: 'cartel.png',
    bio: 'Банкир, купившая половину побережья. Любую дружбу переводит в проценты.',
    traits: { pride: 0.4, greed: 0.95, honor: 0.25, cunning: 0.85, caution: 0.5, memory: 0.4 },
  },
  meridian: {
    id: 'meridian-tael',
    name: 'Таэль Ноэрис',
    title: 'Первая посредница Лиги',
    portrait: 'meridian.png',
    bio: 'Дипломат, примирившая горные кланы. Предпочитает договор войне, а коалицию одиночке.',
    traits: { pride: 0.3, greed: 0.35, honor: 0.8, cunning: 0.5, caution: 0.6, memory: 0.6 },
  },
  auris: {
    id: 'auris-ilan',
    name: 'Илан Сорейо',
    title: 'Канцлер Республики',
    portrait: 'auris.png',
    bio: 'Астрофизик во главе государства. Ради ракеты на орбите готов на многое.',
    traits: { pride: 0.75, greed: 0.4, honor: 0.5, cunning: 0.65, caution: 0.35, memory: 0.5 },
  },
});

/** Лидер своей нации игрока: имя задаёт игрок, черты нейтральные. */
export function customLeader(name = 'Лидер') {
  return {
    id: 'player-leader',
    name,
    title: 'Глава нации',
    portrait: 'custom.png',
    bio: 'Ваш лидер.',
    traits: { pride: 0.5, greed: 0.5, honor: 0.5, cunning: 0.5, caution: 0.5, memory: 0.5 },
  };
}
