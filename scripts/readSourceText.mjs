// Тесты-проvenance ищут в исходниках литеральные переводы строк (regex вида `\n  }`),
// а рабочее дерево Windows с core.autocrlf=true хранит CRLF — проверки падали только
// из-за этого. Читаем так, как файл лежит в git-блобе: переводы строк к LF.
import fs from 'node:fs';

export function readSourceText(target) {
  return fs.readFileSync(target, 'utf8').replace(/\r\n?/g, '\n');
}
