# Translating Bridgy's Farm (English, Russian)

The Armenian files in `config/*.json` are the source. English and Russian live in `config/en/` and `config/ru/`.
This file is the one source of truth for every translator and reviewer (people and the `translator` /
`native-reviewer` agents). When this file and a habit disagree, this file wins.

## 1. How the files work

| File | What it holds |
|---|---|
| `config/<lang>/aliases.json` | The command names of that language (same shape as `config/aliases.json`). The **first** name of each list is the one shown in lessons, hints, autocomplete and errors. Every language's names work in every language. |
| `config/<lang>/<file>.json` | A flat map `"key": "text"` for one Armenian file (`texts`, `bridgy`, `guide`, `research`, `village`, `events`, `ranch`, `settings`). |
| `config/<lang>/_source.json` | Fingerprints of the Armenian each translation was made from (written by `--stamp`, never by hand). |

- Keys: the path inside the Armenian file. Inside a list, an object is named by its `id` (or `entity`), else by its position: `quests.use_while.hints.2`, `lessons.Loops.0.text`.
- **What is translated:** every string with Armenian letters, and every string of `texts.json`. Code fields **without** Armenian (`example`, `code`, `sig`, `label`, `syntax`, the phone word strip) are not translated: the game renames their command names itself when it loads. A code field *with* Armenian (a comment, an Armenian parameter name such as `gnal(ուղղություն)`) is translated like any text.
- Missing key → the game shows the Armenian text (never a crash), and `npm test` fails.
- Commands:
  - `npm run i18n`: what is missing / changed / extra, per language and file.
  - `npm run i18n -- ru bridgy --todo > /tmp/todo.json`: the Armenian texts still to translate (missing + changed since the last stamp).
  - `npm run i18n -- ru bridgy --stamp`: after translating, record the Armenian versions and sort the file.
  - `npm test`: the checks (complete, same placeholders, plural forms, no Armenian letters, code names of the right language).
  - Look at a language in the browser: `npm start`, then `http://localhost:8080/?lang=ru` (this visit only).

## 2. Voice and style

**Who reads it:** children aged 9–17 who are learning to program, many of them for the first time. Every line must be clear to a 9-year-old and not childish to a 16-year-old.

**Bridgy** is a cheerful, slightly silly robot who loves the farm and loves code. He is warm, short-spoken, a little goofy, never sarcastic, never preachy, never babyish. He celebrates small wins. When a joke or pun doesn't work in your language, write a new joke that does, at the same spot. Robot sounds: «Բիփ-բուփ» → "Beep-boop" / «Бип-буп».

**Erik and Nshan** are two real students who help a friend: casual, friendly, peer-to-peer.

**Villagers** speak like warm village neighbours (Grandma Anahit is a grandmother, Little Lilit is a small girl).

**Never sound translated.** Read the Armenian, understand what it means and why it is said, then write it the way a native writer would. Don't copy Armenian word order, idioms, punctuation or sentence length.

### English
- American spelling (color, center), plain friendly words, contractions are fine ("you're", "let's").
- Address the player as "you". No "Dear user", no "Well done! You are great!" stacks.
- Quotes around button names and names: straight double quotes `"Run"` (the game makes the named button glow; the quote must be exactly `"` + the button's label + `"`).
- Programming words: command, loop, condition, variable, function, list, object, value, line, error, program, run.

### Russian
- Address the player with «ты» and singular imperatives: «Нажми ▶», «Посади пшеницу».
- Use «ё» everywhere it belongs (ещё, всё, жёлтый, мёд).
- Quotes: «ёлочки» `«Запустить»` (the button glow needs exactly `«` + label + `»`). Dashes: «—».
- Natural word order and correct cases. Prefer a common word to an anglicism, but standard school programming terms are right: команда, цикл, условие, переменная, функция, список, объект, значение, строка, ошибка, программа, запустить.
- **Inserted words stay in the dictionary form.** `{item}`, `{name}`, `{animal}`, `{color}` arrive in the nominative singular. Build the sentence so that is correct: «Нужно: {item}», «{item} ×{n}», «Получено: {item}», never «нет {item}» or «много {item}».
- **Numbers with nouns** use plural forms: `{n} {n|минута|минуты|минут}` (one | few | many). Test in your head with 1, 2, 5, 11, 21.
- Gender: a sentence about the player avoids past-tense gender («Ты собрал(а)» ✗) → present/future or neutral wording («Урожай собран!», «Получилось!»).

### Everything
- **Placeholders** `{n}`, `{item}`, … must all stay, spelled exactly the same; you may move them. `\n` line breaks stay where the layout needs them.
- **Symbols stay:** ▶ ⏸ ⏭ ⏹ ⏱ ⚠ ✓ ✕ ֏ ⭐ and any HTML or `**`.
- **Short labels stay short.** Buttons, tabs, chips, titles and every `ui.short.*` key must not be longer than the Armenian (phones are 320 px wide). If the natural word is long, choose a shorter natural one ("Storage", «Склад»).
- **No new facts, nothing dropped.** Every number, rule and instruction is kept. Allowed additions: the short culture explanations below, the first time a player meets a word.
- **Teaching rules:** never turn a hint into ready-to-paste code; if the Armenian gives steps in words, give the same steps in words. Lesson examples stay small examples, not the quest's answer.
- **Code inside text** uses the shown names of your language (first name in `config/<lang>/aliases.json`): `sow()`, `go(Right)`, `Plants.Wheat` / `posadit()`, `idti(Vpravo)`, `Rasteniya.Pshenitsa`. Never Armenian names (`tnkel`, `Buyser.Coren`), never the hidden old English names (`plant`, `harvest`, `move`, `North`). JavaScript stays JavaScript (`while`, `if`, `let`, `true`, `Math.random()`). Translate comments and texts *inside* code; keep the code valid.

## 3. Armenian culture: keep it, explain it once

The game is proudly Armenian. Keep the Armenian names; explain them briefly the **first** time a player meets them (a lesson, a quest, a villager's story), not every time and never in short labels.

| Armenian | English | Russian | First-time explanation (EN / RU) |
|---|---|---|---|
| Վարդավառ | Vardavar | Вардавар | the summer water festival / летний праздник воды |
| Տրնդեզ | Trndez | Трндез | the spring bonfire festival / весенний праздник с костром |
| Նավասարդ | Navasard | Навасард | the ancient Armenian New Year / древний армянский Новый год |
| Գիտելիքի օր | Knowledge Day | День знаний | (1 September) |
| Ուսուցչի օր | Teacher's Day | День учителя | |
| Զատիկ | Easter | Пасха | |
| Ամանոր | New Year | Новый год | |
| լավաշ | lavash | лаваш | thin Armenian flatbread / тонкий армянский хлеб |
| գաթա | gata | гата | sweet Armenian pastry / сладкая армянская выпечка |
| նազուկ | nazook | назук | a rolled sweet pastry / сладкий рулет-печенье |
| ղափամա | ghapama | хапама | stuffed pumpkin dish (here, watermelon!) / фаршированная тыква (у нас — арбуз!) |
| խորոված | khorovats | хоровац | Armenian barbecue / армянский шашлык |
| մածուն | matsun | мацун | Armenian yogurt / армянский йогурт |
| Լոռի պանիր | Lori cheese | лорийский сыр | cheese from the Lori region |
| թոնիր | tonir | тонир | a clay oven in the ground / глиняная печь в земле |
| գամփռ | gampr | гампр | the Armenian shepherd dog / армянская овчарка |
| փափախ | papakh | папаха | a tall wool hat / высокая шерстяная шапка |
| իշխան | ishkhan | ишхан | Lake Sevan trout / севанская форель |
| դրամ, ֏ | dram, ֏ | драм, ֏ | Armenian money |
| Սևան | Lake Sevan | Севан | |

Names of people: Bridgy / Бриджи, Erik / Эрик, Nshan / Ншан, Grandma Anahit / бабушка Анаит, Siranush the baker / пекарь Сирануш, Aram the fisherman / рыбак Арам, Little Lilit / маленькая Лилит.

## 4. Glossary (one translation per thing, everywhere)

Game title: «Բրիջիի ֆերման» → **Bridgy's Farm** / **Ферма Бриджи**. Ranch DLC «Բրիջիի ռանչոն» → **Bridgy's Ranch** / **Ранчо Бриджи**.

### Main screen and buttons
| Armenian | English | Russian |
|---|---|---|
| Գործարկել | Run | Запустить |
| Կանգնեցնել | Stop | Стоп |
| Դադար | Pause | Пауза |
| Շարունակել | Resume / Continue | Продолжить |
| Քայլ | Step | Шаг |
| Հետազոտություններ (the research button, `ui.researchButton`) | Research | Исследования |
| Հետազոտել (phone top bar, `ui.researchShort`) / Հետազոտություն | Research | Исследовать / Исследование |
| Պահեստ | Storage | Склад |
| Ֆերմա | Farm | Ферма |
| Կոդ | Code | Код |
| Կոնսոլ | Console | Консоль |
| Բրիջի, օգնի՛ր | Help, Bridgy! | Бриджи, помоги! |
| Ի՞նչ անեմ հիմա | What do I do now? | Что делать дальше? |
| Հուշում տուր | Give me a hint | Подскажи |
| Բրիջիի գիրքը | Bridgy's Book | Книга Бриджи |
| Կարգավորումներ | Settings | Настройки |
| Իմ պրոֆիլը | My profile | Мой профиль |
| Դուրս գալ | Log out | Выйти |
| Մուտք / Մտնել | Log in | Вход / Войти |
| Գրանցում / Գրանցվել | Sign up | Регистрация / Зарегистрироваться |
| Մուտքանուն | Username | Логин |
| Գաղտնաբառ | Password | Пароль |
| Խաղալ որպես հյուր | Play as a guest | Играть как гость |
| Լավագույններ | Top players | Лучшие игроки (the start-screen tab: «Лучшие») |
| Միավորներ | Points | Очки |
| Կոդի բառեր | Code words | Слова кода |
| Կատարելություն | Perfection | Совершенство |
| Առաջադրանք | Quest | Задание |
| Դաս | Lesson | Урок |
| Հուշում | Hint | Подсказка |
| Լավ | OK | Хорошо |
| Գյուղ | Village | Деревня |
| Փորձնական ֆերմա / ռանչո (challenge) | Test farm / Test ranch | Пробная ферма / Пробное ранчо |
| Ռանչո | Ranch | Ранчо |
| Առևտուր | Market | Торговля |
| Շաբաթվա մրցույթ | Weekly challenge | Конкурс недели |
| Գրառում(ներ) (secret notes) | Note(s) | Записка (записки) |
| Կպչուկներ | Stickers | Наклейки |
| Դրոն | drone | дрон |
| վանդակ (one square of the farm grid) | tile (never "square": that's the square watermelon) | клетка |
| վայր (a ranch area) | area | участок |
| մեքենա / սարք (a machine) | machine | устройство (never «машина»: that's a car) |
| ( ) / { } / [ ] | parentheses / curly braces / square brackets ("brackets" only for any kind) | круглые / фигурные / квадратные скобки |
| how close a carpet is to its sample | match ("Match: 87%") | сходство («Сходство: 87%») |
| բեղիկ (yellow watermelon) | tendril | усик |
| «Վժժժ» (the drone speeding up) | Zoooom! | Вжжж! |
| Աստղ ⭐ | Star | Звезда |
| Խնդրանքներ (village board) | Requests | Просьбы |

### Plants (the field)
| Armenian | English | Russian |
|---|---|---|
| Ցորեն | Wheat | Пшеница |
| Մասուր | Rosehip | Шиповник |
| Ծիրանենի | Apricot tree | Абрикос |
| Թթենի | Mulberry tree | Шелковица |
| Բադրիջան | Eggplant | Баклажан |
| Ձմերուկ | Watermelon | Арбуз |
| Դեղին ձմերուկ | Yellow watermelon | Жёлтый арбуз |
| Քառակուսի ձմերուկ | Square watermelon | Квадратный арбуз |
| Փտած ձմերուկ | Rotten watermelon | Гнилой арбуз |
| Նուռ (its seeds are counted) | Pomegranate (seeds) | Гранат (зёрнышки) |
| Խաղող / խաղողի վազ | Grapes / grapevine | Виноград / виноградная лоза |
| Սունկ | Mushroom | Гриб |
| Օձ | Snake | Змея |
| Մուկ | Mouse | Мышь |
| Լաբիրինթոս / Այգու լաբիրինթոս | Maze / Garden maze | Лабиринт / Садовый лабиринт |
| Ցանկապատ | Hedge | Изгородь |
| Գանձ | Treasure | Клад |
| Մարգագետին | Meadow | Луг |
| Վարած հող | Plowed soil | Пашня |
| Լճակ | Pond | Пруд |
| հերկել | plow | вспахать |
| հասունանալ / հասած | ripen / ripe | созреть / спелый |

### Goods
| Armenian | English | Russian |
|---|---|---|
| Փայտ | Wood | Дрова |
| Սերմեր / Սերմ | Seeds / Seed | Семена / Семечко |
| Նռան հյութ | Pomegranate juice | Гранатовый сок |
| Ջուր | Water | Вода |
| Հումուս | Humus | Перегной |
| Կախարդական փոշի | Magic dust | Волшебная пыль |
| Օձի մաշկ | Snake skin | Змеиная кожа |
| Ոսկի | Gold | Золото |
| Ձուկ | Fish | Рыба |
| Ալյուր | Flour | Мука |
| Մուրաբա | Jam | Варенье |
| Խորոված ձուկ | Grilled fish | Рыба на гриле |
| Մեդալ | Medal | Медаль |
| Ձու | Egg | Яйцо |
| Կաթ / Այծի կաթ / Գոմեշի կաթ | Milk / Goat milk / Buffalo milk | Молоко / Козье молоко / Молоко буйволицы |
| Պանիր | Cheese | Сыр |
| Կարագ | Butter | Масло |
| Ձվածեղ | Omelet | Омлет |
| Հատիկ | Grain | Зерно |
| Խոտի հակ | Hay bale | Тюк сена |
| Գոմաղբ | Manure | Навоз |
| Դեղ | Medicine | Лекарство |
| Տախտակ | Plank | Доска |
| Մեղր / Մեղրամոմ / Խորիսխ | Honey / Beeswax / Honeycomb | Мёд / Воск / Соты |
| Մոմ | Candle | Свеча |
| Մեղրոտ գաթա | Honey gata | Медовая гата |
| Մեղրաբլիթ | Honey cake | Медовик |
| Բուրդ (Սպիտակ, Դարչնագույն, Սև, Ոսկեգույն) | Wool (White, Brown, Black, Golden) | Шерсть (белая, коричневая, чёрная, золотая) |
| Թել (+ Կարմիր, Նարնջագույն, Դեղին, Կանաչ, Կապույտ, Փափուկ) | Yarn (+ Red, Orange, Yellow, Green, Blue, Soft) | Пряжа (+ красная, оранжевая, жёлтая, зелёная, синяя, мягкая) |
| Գորգ | Carpet | Ковёр |
| Աղվամազ | Fluff | Пух |
| Արևածաղիկ | Sunflower | Подсолнух |

Russian units when goods are counted in a sentence: milk, honey, juice, water → «порция»; cheese → «головка»; fluff → «клочок»; yarn → «моток»; grain → «мешок».

Short goods names (in lists, buttons) are written like titles in English ("Goat milk") and with a capital first letter in Russian («Козье молоко»).

### Places, machines, animals
| Armenian | English | Russian |
|---|---|---|
| Կամուրջ | Bridge | Мост |
| Ջրաղաց | Water mill (short: Mill) | Мельница |
| Մուրաբայի տուն / Մուրաբայի կաթսա | Jam house / Jam pot | Домик варенья / Котёл для варенья |
| Փուռ | Bakery | Пекарня |
| Ջերմատուն | Greenhouse | Теплица |
| Դպրոց | School | Школа |
| Տոնական հրապարակ | Festival square | Праздничная площадь |
| Հավանոց | Henhouse | Курятник |
| Գոմ | Cow barn | Коровник |
| Այծանոց | Goat pen | Козлятник |
| Փարախ | Sheepfold | Овчарня |
| Մեղվանոց | Apiary | Пасека |
| Գոմեշանոց | Buffalo pen | Загон для буйволов |
| Ճագարանոց | Rabbit hutch | Крольчатник |
| Շուկա | Market (ranch, daily prices) | Рынок |
| Արհեստանոց | Workshop | Мастерская |
| Խանութ | Shop | Магазин |
| Կերաման / Ջրաման / Ջրհոր | Feed trough / Water trough / Well | Кормушка / Поилка / Колодец |
| Զամբյուղ / Կրպակ | Basket / Stall | Корзина / Лавка |
| Կաթնատուն / Վառարան | Dairy / Stove | Молочная / Печь |
| Ճախարակ / Դազգահ / Ներկաման | Spinning wheel / Loom / Dye pot | Прялка / Ткацкий станок / Красильня |
| Մեղրատուն / Փեթակ | Honey house / Hive | Медогонка / Улей |
| Լճակ (buffalo) | Mud pool | Лужа |
| Հավ, Կով, Այծ, Ոչխար, Գոմեշ, Ճագար | Hen, Cow, Goat, Sheep, Buffalo, Rabbit | Курица, Корова, Коза, Овца, Буйвол, Кролик |
| Էշ / սայլ | Donkey / cart | Ослик / тележка |
| Կակաչ, Երիցուկ, Վարդ, Հասմիկ | Poppy, Daisy, Rose, Jasmine | Мак, Ромашка, Роза, Жасмин |
| Գյուղի տոնավաճառ | Village fair | Деревенская ярмарка |
| Գորգերի դազգահ | Carpet loom | Ковровый станок |

### Seasons, weather, hats
Seasons: Spring, Summer, Autumn, Winter / Весна, Лето, Осень, Зима. Weather: Sunny, Rain, Storm, Heat, Snow / Солнечно, Дождь, Гроза, Жара, Снег. «Այսօրվա բախտը» → Today's luck / Удача дня.

Hat = **hat** / **шляпа** (the papakh is «папаха»). «Ոսկե գլխարկ» Golden hat / Золотая шляпа; «Ծղոտե գլխարկ» Straw hat / Соломенная шляпа; «X-ի գլխարկ» → "X hat" / «Шляпа X» (e.g. "Fisher hat" / «Шляпа рыбака», "Vardavar hat" / «Шляпа Вардавара», "Weaver hat" / «Шляпа ткача»).

### Research cards
| Armenian | English | Russian |
|---|---|---|
| Կրկնություն | Loops | Циклы |
| Գլխարկներ | Hats | Шляпы |
| Արագություն | Speed | Скорость |
| Մեծ ֆերմա | Big farm | Большая ферма |
| Տնկել | Planting | Посадка |
| Տպել | Say | Вывод |
| Գործողություններ | Operators | Операторы |
| Ջրում | Watering | Полив |
| Ծիրանենի | Apricot trees | Абрикосы |
| Բադրիջան (card) | Eggplants | Баклажаны |
| Նռներ | Pomegranates | Гранаты |
| Ձմերուկներ | Watermelons | Арбузы |
| Խաղողի վազեր | Grapevines | Виноград |
| Սունկեր | Mushrooms | Грибы |
| Ձկնորսություն | Fishing | Рыбалка |
| Դրոնների թիմ | Drone team | Команда дронов |
| Գաղտնիք | Secret | Секрет |
| Դանդաղեցում | Slow motion | Замедление |
| Ժամացույց | Clock | Часы |
| Փոփոխականների պատուհան | Variables window | Окно переменных |
| Ոսկե ֆերմա | Golden farm | Золотая ферма |
| Զգայարաններ | Senses | Чувства |
| Օրացույց | Calendar | Календарь |
| Փոփոխականներ / Ցուցակներ / Օբյեկտներ / Ֆունկցիաներ | Variables / Lists / Objects / Functions | Переменные / Списки / Объекты / Функции |
| Երաժշտություն | Music | Музыка |
| Գներ | Prices | Цены |
| Ավտոմատ բացում | Auto research | Автоисследование |
| Ներմուծում | Import | Импорт |
| Math և պատահական թվեր | Math and random numbers | Math и случайные числа |

Names in other cards follow the plants above (Wheat, Eggplant, Humus, Snake, …).

## 5. Before you finish a batch
1. Read it again as a 10-year-old native speaker. Anything stiff, long or "translated"? Rewrite it.
2. `npm run i18n -- <lang> <file> --stamp`, then `npm test`: every translation check must pass. Never weaken a test.
3. For screens: open `?lang=<lang>` at 390×844 and 320×640 and look for cut-off text.
4. New words you had to choose go in your report as "New glossary words", for the teacher to approve; they are added here afterwards.
