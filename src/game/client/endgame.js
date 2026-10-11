// Тексты терминального экрана. Значения ending синхронизированы с turn.js/finale.js.
export const ENDING_VALUES = Object.freeze(['defeat', 'conquest', 'saved', 'partial', 'betrayal', 'lastRefuge', 'silence']);

const TEXT = Object.freeze({
  conquest: { title: 'Победа', text: 'Вы покорили столицы соперников и установили новый порядок на Земле.' },
  victory: { title: 'Победа', text: 'Ваша нация пережила испытание и добилась своего.' },
  eliminated: { title: 'Нация уничтожена', text: 'Ваша нация потеряла последнюю опору. Партия для вас окончена.' },
  playerEliminated: { title: 'Нация уничтожена', text: 'Ваша нация потеряла последнюю опору. Партия для вас окончена.' },
  saved: { title: 'Земля спасена', text: '«Купол» выдержал удар. Цивилизация получила шанс на будущее.' },
  partial: { title: 'Горькая победа', text: 'Защита сработала лишь частично: Земля выжила, но заплатила высокую цену.' },
  defeat: { title: 'Поражение', text: 'Ваша нация пала, и партия для вас окончена.' },
  betrayal: { title: 'Предательство', text: 'Вы покинули «Купол» слишком поздно. Удар застал человечество без общей защиты.' },
  lastRefuge: { title: 'Последнее убежище', text: 'Ковчег сохранил последний островок человечества, но прежняя Земля погибла.' },
  silence: { title: 'Тишина', text: 'Защиты не хватило. После удара над планетой наступила тишина.' },
});

export function endingCopy(result = {}) {
  const ending = ENDING_VALUES.includes(result.ending) ? result.ending : result.outcome;
  return TEXT[ending] ?? { title: 'Партия окончена', text: 'История этой партии завершена.' };
}
